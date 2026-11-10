import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/prisma";
import { checkAdminAuth, adminEventFilter, checkEventAdminAuth, forbiddenResponse } from "@/lib/auth/admin";
import { NotificationType, type Prisma } from "@/generated/prisma";
import { renderComponentToHTML } from "@/lib/helpers/html";
import RegistrationUpdateMail from "@/components/emails/RegistrationUpdateMail";
import { sendMail } from "@/lib/mail";
import { cancelRegistrationAndReleaseCapacity, syncReleasedProductStocks } from "@/lib/events/registration-capacity";
import { createNotification } from "@/lib/notifications";

type FinanceAction = "NONE" | "UPCHARGE_REQUIRED" | "MANUAL_REFUND_RECOMMENDED";

const registrationInclude = {
    payments: { orderBy: { createdAt: "desc" as const }, take: 1 },
    event: { include: { products: true } },
    registrationItems: {
        include: {
            product: true,
        },
    },
} satisfies Prisma.RegistrationInclude;

type RegistrationWithAdminContext = Prisma.RegistrationGetPayload<{
    include: typeof registrationInclude;
}>;

function isTicketProduct(
    product: { type: "TICKET" | "ACCOMMODATION" | "ADDON" } | undefined
) {
    return product?.type === "TICKET";
}

function toNumber(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function toMoney(value: number) {
    return Number(value.toFixed(2));
}

function summarizeRegistrationChanges(changes: Array<{ label: string; old: string; new: string }>) {
    const statusChange = changes.find((change) => change.label === "Registration Status");
    if (statusChange) {
        return `Status changed from ${statusChange.old} to ${statusChange.new}`;
    }

    const paymentChange = changes.find((change) => change.label === "Payment Status");
    if (paymentChange) {
        return `Payment status changed from ${paymentChange.old} to ${paymentChange.new}`;
    }

    const labels = changes.slice(0, 3).map((change) => change.label);
    return labels.length > 0 ? `Updated: ${labels.join(", ")}` : undefined;
}

// PATCH /api/admin/registrations/[id] - Update registration details by admin
export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const authResult = await checkAdminAuth(req.headers);
        if (!authResult.authorized) {
            return forbiddenResponse(authResult.error);
        }

        if (!authResult.adminId) {
            return NextResponse.json({ error: "Admin profile incomplete" }, { status: 403 });
        }

        const id = (await params).id;
        const body = await req.json();

        const {
            status,
            preferences,
            customFieldData,
            paymentStatus,
            paymentAmount,
            notes: changeReason
        } = body;

        // 1. Fetch current state for diffing
        const current = await prisma.registration.findUnique({
            where: { id },
            include: registrationInclude
        }) as RegistrationWithAdminContext | null;

        if (!current) return NextResponse.json({ error: "Registration not found" }, { status: 404 });

        // Verify this admin owns the event this registration belongs to
        const eventFilter = await adminEventFilter(authResult.adminId);
        const accessible = await prisma.event.findFirst({
            where: { id: current.eventId, ...eventFilter },
            select: { id: true },
        });
        if (!accessible) return forbiddenResponse("No access to this registration");

        const writeAuth = await checkEventAdminAuth(current.eventId, undefined, req.headers, true);
        if (!writeAuth.authorized) return forbiddenResponse(writeAuth.error);

        if ((paymentStatus !== undefined && paymentStatus !== current.payments[0]?.paymentStatus) ||
            (paymentAmount !== undefined && Number(paymentAmount) !== Number(current.payments[0]?.amount))) {
          const financeAuth = await checkEventAdminAuth(current.eventId, "STRIPE_FINANCES", req.headers, true);
          if (!financeAuth.authorized) return forbiddenResponse(financeAuth.error);
        }

        // Org-member access to approval status changes requires EVENT_APPROVAL permission
        if (status === "APPROVED") {
          const approvalAuth = await checkEventAdminAuth(current.eventId, "EVENT_APPROVAL", req.headers);
          if (!approvalAuth.authorized) {
            return forbiddenResponse(approvalAuth.error ?? "EVENT_APPROVAL permission required");
          }
        }

        const changes: Array<{ label: string; old: string; new: string }> = [];

        // Helper to find product name
        const getProductName = (id?: string) => current.event.products.find(p => p.id === id)?.name || id || "None";

        // Diff Status
        if (status && status !== current.status) {
            changes.push({ label: "Registration Status", old: current.status, new: status });
        }

        // Diff Preferences (Badge/Hotel)
        const oldPref = current.preferences as Record<string, unknown>;
        if (preferences) {
            if (preferences.productId !== oldPref.productId) {
                changes.push({ label: "Badge Tier", old: getProductName(oldPref.productId as string), new: getProductName(preferences.productId) });
            }
            if (preferences.needsHotel !== oldPref.needsHotel) {
                changes.push({ label: "Hotel Room", old: oldPref.needsHotel ? "Yes" : "No", new: preferences.needsHotel ? "Yes" : "No" });
            }
            if (preferences.earlyArrival !== oldPref.earlyArrival) {
                changes.push({ label: "Early Arrival", old: oldPref.earlyArrival ? "Yes" : "No", new: preferences.earlyArrival ? "Yes" : "No" });
            }
            if (preferences.lateDeparture !== oldPref.lateDeparture) {
                changes.push({ label: "Late Departure", old: oldPref.lateDeparture ? "Yes" : "No", new: preferences.lateDeparture ? "Yes" : "No" });
            }
        }

        // Diff Payment
        const currentPayment = current.payments[0];
        if (paymentStatus && currentPayment && paymentStatus !== currentPayment.paymentStatus) {
            changes.push({ label: "Payment Status", old: currentPayment.paymentStatus, new: paymentStatus });
        }
        if (paymentAmount !== undefined && currentPayment && Number(paymentAmount) !== Number(currentPayment.amount)) {
            changes.push({ label: "Total Price", old: `${currentPayment.amount}€`, new: `${paymentAmount}€` });
        }

        // Diff Custom Fields
        if (customFieldData) {
            const oldData = current.customFieldData as Record<string, unknown>;
            for (const key in customFieldData) {
                if (JSON.stringify(customFieldData[key]) !== JSON.stringify(oldData[key])) {
                    changes.push({ label: `Field: ${key}`, old: String(oldData[key] || "Empty"), new: String(customFieldData[key]) });
                }
            }
        }

        // 2. Perform update in a transaction
        const registration = await prisma.$transaction(async (tx) => {
            // Find admin profile for current user
            const adminUserId = authResult.user?.id;
            if (!adminUserId) {
                throw new Error("Admin authentication failed");
            }

            const admin = await tx.admin.findUnique({
                where: { userId: adminUserId }
            });

            const isCancellingRegistration = status === "CANCELLED" && current.status !== "CANCELLED";
            const currentTicketItem = current.registrationItems.find((item) => isTicketProduct(item.product));
            const requestedTicketId = typeof preferences?.productId === "string" ? preferences.productId : undefined;
            const oldSelectionTotal = toMoney(current.registrationItems.reduce((sum, item) => sum + toNumber(item.priceAtBooking), 0));
            const completedPayments = await tx.payment.findMany({
                where: {
                    registrationId: id,
                    paymentStatus: "COMPLETED"
                }
            });
            const completedAmount = toMoney(completedPayments.reduce((sum, payment) => sum + toNumber(payment.amount), 0));

            let financeAction: FinanceAction = "NONE";
            let financeAmount = 0;
            let releasedProductIds: string[] = [];

            if (isCancellingRegistration) {
                releasedProductIds = await cancelRegistrationAndReleaseCapacity(tx, id);
            } else {
                if (requestedTicketId && requestedTicketId !== currentTicketItem?.productId) {
                    const nextTicketProduct = current.event.products.find((product) => product.id === requestedTicketId);
                    if (!nextTicketProduct || !isTicketProduct(nextTicketProduct)) {
                        throw new Error("Selected badge tier is invalid");
                    }

                    if (nextTicketProduct.capacity !== null && nextTicketProduct.soldCount >= nextTicketProduct.capacity) {
                        throw new Error("Selected badge tier is sold out");
                    }

                    if (currentTicketItem) {
                        await tx.registrationItem.update({
                            where: { id: currentTicketItem.id },
                            data: {
                                productId: requestedTicketId,
                                priceAtBooking: nextTicketProduct.price
                            }
                        });

                        await tx.product.updateMany({
                            where: {
                                id: currentTicketItem.productId,
                                soldCount: { gt: 0 }
                            },
                            data: {
                                soldCount: { decrement: 1 }
                            }
                        });

                        await tx.product.update({
                            where: { id: requestedTicketId },
                            data: {
                                soldCount: { increment: 1 }
                            }
                        });
                    } else {
                        await tx.registrationItem.create({
                            data: {
                                registrationId: id,
                                productId: requestedTicketId,
                                priceAtBooking: nextTicketProduct.price
                            }
                        });

                        await tx.product.update({
                            where: { id: requestedTicketId },
                            data: {
                                soldCount: { increment: 1 }
                            }
                        });
                    }
                }

                const refreshedItems = await tx.registrationItem.findMany({
                    where: { registrationId: id },
                    include: { product: true }
                });

                const newSelectionTotal = toMoney(refreshedItems.reduce((sum, item) => sum + toNumber(item.priceAtBooking), 0));
                const selectionDelta = toMoney(newSelectionTotal - oldSelectionTotal);
                const pendingPayment = await tx.payment.findFirst({
                    where: {
                        registrationId: id,
                        paymentStatus: "PENDING"
                    },
                    orderBy: { createdAt: "desc" }
                });
                const pendingAmount = toNumber(pendingPayment?.amount);

                if (selectionDelta > 0) {
                    financeAction = "UPCHARGE_REQUIRED";
                    financeAmount = selectionDelta;
                    const nextPendingAmount = toMoney(pendingAmount + selectionDelta);

                    if (pendingPayment) {
                        await tx.payment.update({
                            where: { id: pendingPayment.id },
                            data: {
                                amount: nextPendingAmount,
                                currency: "EUR",
                                paymentProvider: pendingPayment.paymentProvider || "STRIPE"
                            }
                        });
                    } else {
                        await tx.payment.create({
                            data: {
                                userId: current.userId,
                                registrationId: id,
                                amount: financeAmount,
                                currency: "EUR",
                                paymentStatus: "PENDING",
                                paymentProvider: "STRIPE"
                            }
                        });
                    }
                } else {
                    if (selectionDelta < 0) {
                        const reduction = Math.abs(selectionDelta);

                        if (pendingPayment) {
                            if (pendingAmount > reduction) {
                                await tx.payment.update({
                                    where: { id: pendingPayment.id },
                                    data: {
                                        amount: toMoney(pendingAmount - reduction)
                                    }
                                });
                            } else {
                                await tx.payment.delete({ where: { id: pendingPayment.id } });
                            }
                        }

                        const remainingRefund = toMoney(Math.max(0, reduction - pendingAmount));
                        if (remainingRefund > 0) {
                            financeAction = "MANUAL_REFUND_RECOMMENDED";
                            financeAmount = remainingRefund;
                        }
                    } else if (pendingPayment && pendingAmount <= 0) {
                        await tx.payment.delete({ where: { id: pendingPayment.id } });
                    }
                }

                const approvalJustGranted = current.event.requireApproval && status === "APPROVED" && current.status !== "APPROVED";
                if (approvalJustGranted) {
                    const dueAfterApproval = toMoney(Math.max(0, newSelectionTotal - completedAmount));
                    const activePendingPayment = await tx.payment.findFirst({
                        where: {
                            registrationId: id,
                            paymentStatus: "PENDING"
                        },
                        orderBy: { createdAt: "desc" }
                    });

                    if (dueAfterApproval > 0) {
                        if (activePendingPayment) {
                            await tx.payment.update({
                                where: { id: activePendingPayment.id },
                                data: {
                                    amount: dueAfterApproval,
                                    currency: "EUR",
                                    paymentProvider: activePendingPayment.paymentProvider || "STRIPE"
                                }
                            });
                        } else {
                            await tx.payment.create({
                                data: {
                                    userId: current.userId,
                                    registrationId: id,
                                    amount: dueAfterApproval,
                                    currency: "EUR",
                                    paymentStatus: "PENDING",
                                    paymentProvider: "STRIPE"
                                }
                            });
                        }

                        financeAction = "UPCHARGE_REQUIRED";
                        financeAmount = dueAfterApproval;
                    }
                }
            }

            if (financeAction === "UPCHARGE_REQUIRED") {
                changes.push({ label: "Finance", old: "No adjustment", new: `Additional payment required (${financeAmount}EUR)` });
            }
            if (financeAction === "MANUAL_REFUND_RECOMMENDED") {
                changes.push({ label: "Finance", old: "No adjustment", new: `Manual refund review recommended (${financeAmount}EUR)` });
            }

            const updatedReg = await tx.registration.update({
                where: { id },
                data: {
                    ...(!isCancellingRegistration && status && { status }),
                    ...(!isCancellingRegistration && current.event.requireApproval && status === "APPROVED"
                        ? { expiresAt: current.event.paymentDeadline || null }
                        : {}),
                    ...(preferences && { preferences: preferences as Prisma.InputJsonValue }),
                    ...(customFieldData && { customFieldData: customFieldData as Prisma.InputJsonValue }),
                    ...(changeReason !== undefined && { notes: changeReason }),
                },
                include: {
                    user: { select: { name: true, email: true } },
                    event: { select: { id: true, name: true } },
                    payments: { orderBy: { createdAt: 'desc' }, take: 1 }
                }
            });

            if (paymentStatus || paymentAmount !== undefined) {
                const latestPayment = updatedReg.payments[0];
                if (latestPayment) {
                    await tx.payment.update({
                        where: { id: latestPayment.id },
                        data: {
                            ...(paymentStatus && { paymentStatus }),
                            ...(paymentAmount !== undefined && { amount: Number(paymentAmount) })
                        }
                    });
                }
            }

            // Create history record
            if (changes.length > 0) {
                await tx.registrationHistory.create({
                    data: {
                        registrationId: id,
                        changedByAdminId: admin?.id || null,
                        action: "UPDATED",
                        changes: changes as Prisma.InputJsonValue,
                        notes: changeReason || null
                    }
                });
            }

            return {
                updatedReg,
                releasedProductIds,
                finance: {
                    action: financeAction,
                    amount: toMoney(financeAmount)
                }
            };
        });

        await syncReleasedProductStocks(registration.releasedProductIds);

        // 3. Send notification email with diff
        if (changes.length > 0) {
            try {
                const eventUrl = `${process.env.BETTER_AUTH_URL || process.env.NEXTAUTH_URL || "https://local.dev:3443"}/events/${registration.updatedReg.event.id}`;
                
                const emailHTML = await renderComponentToHTML(RegistrationUpdateMail, {
                    userName: registration.updatedReg.user.name || "Attendee",
                    eventName: registration.updatedReg.event.name,
                    status: registration.updatedReg.status,
                    adminNotes: changeReason,
                    eventUrl,
                    changes // Pass the detected changes
                });

                await sendMail(
                    registration.updatedReg.user.email,
                    `Registration Changes: ${registration.updatedReg.event.name}`,
                    emailHTML
                );
            } catch (mailError) {
                console.error("Failed to send registration update email:", mailError);
            }

            try {
                const statusChanged = changes.some((change) => change.label === "Registration Status");
                await createNotification(
                    registration.updatedReg.userId,
                    NotificationType.EVENT,
                    statusChanged
                        ? `Registration status updated: ${registration.updatedReg.event.name}`
                        : `Registration updated: ${registration.updatedReg.event.name}`,
                    summarizeRegistrationChanges(changes),
                    `/events/${registration.updatedReg.event.id}`,
                );
            } catch (notificationError) {
                console.error("Failed to create registration update notification:", notificationError);
            }
        }

        const refreshedPayments = await prisma.payment.findMany({
            where: { registrationId: registration.updatedReg.id },
            orderBy: { createdAt: 'desc' },
            take: 1
        });

        const refreshedItems = await prisma.registrationItem.findMany({
            where: { registrationId: registration.updatedReg.id }
        });
        const totalDue = toMoney(refreshedItems.reduce((sum, item) => sum + toNumber(item.priceAtBooking), 0));

        return NextResponse.json({
            message: "Registration updated successfully",
            registration: {
                ...registration.updatedReg,
                payments: refreshedPayments
            },
            finance: registration.finance,
            totals: {
                selectionTotal: totalDue
            }
        }, { status: 200 });

    } catch (error) {
        console.error("Error updating admin registration:", error);
        const message = error instanceof Error ? error.message : "Internal Server Error";
        if (message === "Selected badge tier is invalid") {
            return NextResponse.json({ error: message }, { status: 422 });
        }
        if (message === "Selected badge tier is sold out") {
            return NextResponse.json({ error: message }, { status: 409 });
        }
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
