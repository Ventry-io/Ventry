import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/prisma";
import { getSession } from "@/lib/auth/session";
import { findHotelByRoomProductId, normalizeStayPolicy, resolveStayFee } from "@/lib/events/accommodation";
import { Prisma } from "@/generated/prisma";
import { decrementProductStock, getOrInitProductStock, incrementProductStock } from "@/lib/redis";
import { countActiveRegistrations, releaseExpiredPendingRegistrations } from "@/lib/events/registration-capacity";
import { hasCheckInIdentity, hasBillingAddress } from "@/lib/user/profile-completion";

const availabilityEventInclude = {
    products: {
        select: {
            id: true,
            name: true,
            type: true,
            capacity: true,
            soldCount: true,
            price: true,
        },
        orderBy: {
            createdAt: "asc" as const,
        },
    },
} satisfies Prisma.EventInclude;

type AvailabilityEvent = Prisma.EventGetPayload<{
    include: typeof availabilityEventInclude;
}>;

const registrationEventInclude = {
    products: {
        orderBy: { createdAt: "asc" as const },
    },
} satisfies Prisma.EventInclude;

type RegistrationEvent = Prisma.EventGetPayload<{
    include: typeof registrationEventInclude;
}>;

function isTicketIdUniqueConstraintError(error: unknown) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        return false;
    }

    const target = (error.meta as { target?: string[] | string } | undefined)?.target;
    if (Array.isArray(target)) {
        return target.includes("ticketId");
    }

    if (typeof target === "string") {
        return target.includes("ticketId");
    }

    return error.message.includes("ticketId");
}

async function syncRegistrationTicketSequence() {
    await prisma.$queryRawUnsafe(`
        SELECT setval(
            pg_get_serial_sequence('"Registration"', 'ticketId'),
            GREATEST(
                COALESCE((SELECT MAX("ticketId") FROM "Registration"), 1),
                (SELECT last_value FROM "Registration_ticketId_seq")
            ),
            true
        )
    `);
}

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const eventId = Number((await params).id);
        if (Number.isNaN(eventId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

        await releaseExpiredPendingRegistrations(eventId);

        const event = await prisma.event.findUnique({
            where: { id: eventId },
            include: availabilityEventInclude
        }) as AvailabilityEvent | null;

        if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

        const availability = event.products.map(p => ({
            id: p.id,
            name: p.name,
            type: p.type,
            price: p.price,
            capacity: p.capacity,
            sold: p.soldCount,
            remaining: p.capacity === null ? 'Unlimited' : Math.max(0, p.capacity - p.soldCount),
            isSoldOut: p.capacity !== null && p.soldCount >= p.capacity
        }));

        return NextResponse.json({ 
            eventId: event.id,
            eventName: event.name,
            availability 
        });

    } catch (error) {
        console.error("Availability check error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const reservedItems: string[] = []; // Track IDs we successfully reserved in Redis
    
    try {
        const session = await getSession();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        if (!hasCheckInIdentity(session.user) || !hasBillingAddress(session.user)) {
            return NextResponse.json({ error: "Add your legal name and billing address before booking a ticket." }, { status: 422 });
        }

        const eventId = Number((await params).id);
        if (Number.isNaN(eventId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

        await releaseExpiredPendingRegistrations(eventId);

        const body = await req.json();
        // Support both old format (single productId) and new format (productIds array)
        const productIds: string[] = Array.from(new Set((body.productIds || (body.productId ? [body.productId] : [])).filter(Boolean)));
        const { preferences } = body;

        if (productIds.length === 0) {
             return NextResponse.json({ error: "No products selected" }, { status: 400 });
        }

        // 1. Verify event exists and is published
        const event = await prisma.event.findUnique({
            where: { id: eventId, status: 'PUBLISHED' },
            include: registrationEventInclude
        }) as RegistrationEvent | null;

        if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

        if (event.registrationOpensAt && new Date() < new Date(event.registrationOpensAt)) {
            return NextResponse.json({ error: "Registration is not yet open" }, { status: 403 });
        }

        // 2. Validate Products & Check Redis Availability
        const validProducts = event.products.filter(p => productIds.includes(p.id));
        if (validProducts.length !== productIds.length) {
             return NextResponse.json({ error: "One or more invalid products selected" }, { status: 400 });
        }

        // Categorize results
        const confirmedProductIds: string[] = [];
        const waitlistProductIds: string[] = [];
        let totalAmount = 0;

        for (const product of validProducts) {
            if (product.capacity !== null) {
                await getOrInitProductStock(product.id, product.capacity, product.soldCount);
                const hasStock = await decrementProductStock(product.id);
                
                if (hasStock) {
                    reservedItems.push(product.id);
                    confirmedProductIds.push(product.id);
                    totalAmount += product.price;
                } else {
                    if (!product.allowWaitlist) {
                        throw new Error(`Product "${product.name}" is sold out.`);
                    }
                    waitlistProductIds.push(product.id);
                }
            } else {
                // Unlimited
                confirmedProductIds.push(product.id);
                totalAmount += product.price;
            }
        }

        const serializedProducts = event.products.map(product => ({
            id: product.id,
            name: product.name,
            price: product.price,
            description: product.description,
            type: product.type,
            capacity: product.capacity,
            soldCount: product.soldCount
        }));
        const stayPolicy = normalizeStayPolicy(
            event.stayPolicy,
            serializedProducts,
            event.name,
            event.startDate,
            event.endDate
        );
        const selectedAccommodationId =
            preferences?.accommodationId ||
            validProducts.find(product => product.type === "ACCOMMODATION")?.id;
        const selectedRoom = validProducts.find(product => product.id === selectedAccommodationId);
        const selectedHotel = findHotelByRoomProductId(
            stayPolicy,
            selectedAccommodationId,
            serializedProducts,
            event.name,
            event.startDate,
            event.endDate
        );

        if (preferences?.earlyArrival && selectedHotel?.stayPolicy.earlyArrival.enabled) {
            totalAmount += resolveStayFee(selectedHotel.stayPolicy.earlyArrival, selectedRoom?.price || 0);
        }
        if (preferences?.lateDeparture && selectedHotel?.stayPolicy.lateDeparture.enabled) {
            totalAmount += resolveStayFee(selectedHotel.stayPolicy.lateDeparture, selectedRoom?.price || 0);
        }

        const expiresAt = event.paymentDeadline;
        const requiresApprovalBeforePayment = Boolean(event.requireApproval);

        // 3. Database Transaction
        const runRegistrationTransaction = () => prisma.$transaction(async (tx) => {
            // Check existing registration
            const existing = await tx.registration.findUnique({
                where: { userId_eventId: { userId: session.user.id, eventId } },
                include: {
                    payments: {
                        select: {
                            paymentStatus: true
                        }
                    }
                }
            });

            const canReuseExistingRegistration =
                existing?.status === "CANCELLED" &&
                !existing.payments.some((payment) => payment.paymentStatus === "COMPLETED");

            if (existing && !canReuseExistingRegistration) {
                 throw new Error("Already registered for this event");
            }

            if (event.maxRegistrations && confirmedProductIds.length > 0) {
                const activeRegistrationCount = await countActiveRegistrations(tx, eventId);
                if (activeRegistrationCount >= event.maxRegistrations) {
                    throw new Error("Registration is full");
                }
            }

            const isFullyWaitlisted = confirmedProductIds.length === 0 && waitlistProductIds.length > 0;
            const status = isFullyWaitlisted ? 'WAITLISTED' : 'PENDING';
            const selectedTicketId = validProducts.find((product) => product.type === "TICKET")?.id;
            const nextExpiresAt = requiresApprovalBeforePayment ? null : expiresAt;

            if (canReuseExistingRegistration && existing) {
                await tx.payment.updateMany({
                    where: {
                        registrationId: existing.id,
                        paymentStatus: "PENDING"
                    },
                    data: {
                        paymentStatus: "FAILED"
                    }
                });

                await tx.registrationItem.deleteMany({
                    where: {
                        registrationId: existing.id
                    }
                });

                await tx.waitlistEntry.deleteMany({
                    where: {
                        registrationId: existing.id
                    }
                });
            }

            const reg = canReuseExistingRegistration && existing
                ? await tx.registration.update({
                    where: {
                        id: existing.id
                    },
                    data: {
                        status,
                        expiresAt: nextExpiresAt,
                        preferences: {
                            ...preferences,
                            productId: selectedTicketId,
                            productIds
                        } as Prisma.InputJsonValue
                    }
                })
                : await tx.registration.create({
                    data: {
                        userId: session.user.id,
                        eventId: eventId,
                        status: status,
                        expiresAt: nextExpiresAt,
                        preferences: {
                            ...preferences,
                            productId: selectedTicketId,
                            productIds
                        } as Prisma.InputJsonValue
                    }
                });

            // Process Confirmed Items
            for (const pid of confirmedProductIds) {
                const p = validProducts.find(vp => vp.id === pid);
                if (!p) continue;

                await tx.registrationItem.create({
                    data: {
                        registrationId: reg.id,
                        productId: pid,
                        priceAtBooking: p.price
                    }
                });
                
                // Increment DB Counter
                if (p.capacity !== null) {
                     const updated = await tx.product.updateMany({
                        where: { id: pid, soldCount: { lt: p.capacity } },
                        data: { soldCount: { increment: 1 } }
                    });
                    
                    if (updated.count === 0) {
                        throw new Error(`System Error: Capacity mismatch for product ${p.name}. Please try again.`);
                    }
                } else {
                    await tx.product.update({
                        where: { id: pid },
                        data: { soldCount: { increment: 1 } }
                    });
                }
            }

            // Process Waitlist Items
            for (const pid of waitlistProductIds) {
                 await tx.waitlistEntry.create({
                    data: {
                        registrationId: reg.id,
                        productId: pid
                    }
                });
            }

            let payment = null;
              if (totalAmount > 0 && !isFullyWaitlisted && !requiresApprovalBeforePayment) {
                 payment = await tx.payment.create({
                    data: {
                        userId: session.user.id,
                        registrationId: reg.id,
                        amount: totalAmount,
                        currency: 'EUR',
                        paymentStatus: 'PENDING',
                        paymentProvider: 'STRIPE'
                    }
                });
            }

            return { reg, payment, status };
        }, {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        });

        let result: Awaited<ReturnType<typeof runRegistrationTransaction>>;
        try {
            result = await runRegistrationTransaction();
        } catch (error) {
            if (!isTicketIdUniqueConstraintError(error)) {
                throw error;
            }

            await syncRegistrationTicketSequence();
            result = await runRegistrationTransaction();
        }

        return NextResponse.json({ 
            message: result.status === 'WAITLISTED' ? "Added to waitlist" : "Registration successful",
            registrationId: result.reg.id,
            paymentId: result.payment?.id,
            awaitingApproval: requiresApprovalBeforePayment && result.status !== 'WAITLISTED',
            status: result.status,
            confirmedProducts: confirmedProductIds,
            waitlistedProducts: waitlistProductIds
        }, { status: 201 });

    } catch (error) {
        console.error("Registration error:", error);
        
        if (reservedItems.length > 0) {
            await Promise.all(reservedItems.map(id => incrementProductStock(id)));
        }

        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
            return NextResponse.json({
                error: "Registration is busy right now. Please try again."
            }, { status: 409 });
        }

        const message = error instanceof Error ? error.message : "Internal Server Error";
        const status = message.includes("sold out") || message === "Registration is full" ? 403 : 500;

        return NextResponse.json({ error: message }, { status });
    }
}
