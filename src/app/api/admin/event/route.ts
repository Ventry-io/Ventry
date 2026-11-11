import { type NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma/prisma";
import type { Prisma } from "@/generated/prisma";
import { checkAdminAuth, adminEventFilter, forbiddenResponse } from "@/lib/auth/admin";
import { adminCreateEventSchema } from "@/types/schemas/event/admin";
import { z } from "zod";

type CreateEventData = z.infer<typeof adminCreateEventSchema>;

function remapStayPolicyProductIds(stayPolicy: CreateEventData["stayPolicy"], productIdMap: Map<string, string>) {
    if (!stayPolicy || typeof stayPolicy !== "object" || !("hotels" in stayPolicy) || !Array.isArray(stayPolicy.hotels)) {
        return stayPolicy;
    }

    return {
        ...stayPolicy,
        hotels: stayPolicy.hotels.map((hotel) => ({
            ...hotel,
            roomTypeProductIds: hotel.roomTypeProductIds.map((productId) => productIdMap.get(productId) || productId)
        }))
    };
}

function prepareCreatePayload(validatedData: CreateEventData) {
    const productIdMap = new Map(
        validatedData.products
            .filter((product) => Boolean(product.id))
            .map((product) => [product.id as string, randomUUID()])
    );

    return {
        ...validatedData,
        products: validatedData.products.map((product) => ({
            ...product,
            id: product.id ? productIdMap.get(product.id) : randomUUID()
        })),
        stayPolicy: remapStayPolicyProductIds(validatedData.stayPolicy, productIdMap)
    };
}

function toPersistedProducts(products: CreateEventData["products"]) {
    return products.map((product) => ({
        id: product.id,
        name: product.name,
        description: product.description,
        price: product.price,
        type: product.type as "TICKET" | "ACCOMMODATION" | "ADDON",
        capacity: product.capacity,
    }));
}

function buildCreateEventArgs(
    validatedData: CreateEventData,
    adminId: string,
    organizationId?: string | null,
) {
    return {
        data: {
            name: validatedData.name,
            description: validatedData.description,
            startDate: validatedData.startDate,
            endDate: validatedData.endDate,
            imageUrl: validatedData.imageUrl,
            status: validatedData.status,
            stayPolicy: validatedData.stayPolicy as Prisma.InputJsonValue,
            customFields: validatedData.customFields as Prisma.InputJsonValue,
            schedule: validatedData.schedule as Prisma.InputJsonValue,
            pageDesign: validatedData.pageDesign as Prisma.InputJsonValue | undefined,
            ownerId: adminId,
            ...(organizationId ? { organizationId } : {}),
            location: {
                create: validatedData.location
            },
            products: {
                create: toPersistedProducts(validatedData.products)
            },
            requireApproval: validatedData.requireApproval,
            publishAt: validatedData.publishAt,
            registrationOpensAt: validatedData.registrationOpensAt,
            maxRegistrations: validatedData.maxRegistrations,
            requiresHotel: validatedData.requiresHotel,
            paymentDeadline: validatedData.paymentDeadline,
            scanOnce: validatedData.scanOnce,
            communityEnabled: validatedData.communityEnabled ?? false,
            communityOpenAfterEnd: validatedData.communityOpenAfterEnd ?? true,
            communityModerated: validatedData.communityModerated ?? true,
            communityModerateComments: validatedData.communityModerateComments ?? false,
            communityAttendeesOnly: validatedData.communityAttendeesOnly ?? true,
        },
        include: {
            location: true,
            products: {
                orderBy: { createdAt: "asc" as const }
            }
        }
    } satisfies Prisma.EventCreateArgs;
}

function isEventIdUniqueConstraintError(error: unknown) {
    if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "P2002"
    ) {
        return false;
    }

    const prismaError = error as {
        message?: string;
        meta?: {
            modelName?: unknown;
            target?: unknown;
        };
    };
    if (prismaError.meta?.modelName !== "Event") {
        return false;
    }

    const target = prismaError.meta.target;
    const fields = Array.isArray(target) ? target : [];
    return fields.includes("id") || (fields.length === 0 && /fields?: \(`id`\)/i.test(prismaError.message || ""));
}

async function resetEventCreateSequences(tx: Prisma.TransactionClient) {
    await tx.$executeRaw`
        SELECT setval(
            pg_get_serial_sequence('"Event"', 'id'),
            COALESCE((SELECT MAX("id") FROM "Event"), 0) + 1,
            false
        )
    `;
    await tx.$executeRaw`
        SELECT setval(
            pg_get_serial_sequence('"Location"', 'id'),
            COALESCE((SELECT MAX("id") FROM "Location"), 0) + 1,
            false
        )
    `;
}

// GET /api/admin/event - List events owned by or accessible to this admin
export async function GET(_req: NextRequest) {
    try {
        const authResult = await checkAdminAuth();
        if (!authResult.authorized) {
            return forbiddenResponse(authResult.error);
        }

        if (!authResult.adminId) {
            return NextResponse.json({ error: "Admin profile incomplete" }, { status: 403 });
        }

        const eventFilter = await adminEventFilter(authResult.adminId);
        const events = await prisma.event.findMany({
            where: eventFilter,
            include: {
                location: true,
                _count: {
                    select: { registrations: true }
                }
            },
            orderBy: { startDate: 'desc' }
        });

        return NextResponse.json({ events }, { status: 200 });
    } catch (error) {
        console.error("Error listing admin events:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

// POST /api/admin/event - Create a new event
export async function POST(req: NextRequest) {
    try {
        const authResult = await checkAdminAuth();
        if (!authResult.authorized) {
            return forbiddenResponse(authResult.error);
        }

        if (!authResult.adminId) {
            return NextResponse.json({ error: "Admin profile incomplete" }, { status: 403 });
        }

        // If the admin owns an organization, associate new events with it so all org members can access them
        const ownedOrg = await prisma.adminOrganization.findFirst({
            where: { ownerId: authResult.adminId },
            select: { id: true },
        });

        const body = await req.json();
        const validatedData = adminCreateEventSchema.parse(body);
        const createPayload = prepareCreatePayload(validatedData);
        const createArgs = buildCreateEventArgs(createPayload, authResult.adminId, ownedOrg?.id);

        const event = await prisma.event.create(createArgs).catch(async (error) => {
            if (!isEventIdUniqueConstraintError(error)) {
                throw error;
            }

            return prisma.$transaction(async (tx) => {
                await resetEventCreateSequences(tx);
                return tx.event.create(createArgs);
            });
        });

        return NextResponse.json({ message: "Event created successfully", event }, { status: 201 });

    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues }, { status: 422 });
        }
        console.error("Error creating event:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
