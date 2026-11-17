import { prisma } from "@/lib/prisma/prisma";
import { clearProductStock } from "@/lib/redis";
import type { Prisma } from "@/generated/prisma";
import { releaseRoomGroupForCancelledRegistration } from "@/lib/rooms/attendee";
import { type RoomNotice, sendNotices } from "@/lib/rooms/common";

const ACTIVE_REGISTRATION_STATUSES = ["PENDING", "APPROVED", "CONFIRMED"] as const;

type RegistrationCapacitySnapshot = {
    id: string;
    registrationItems: Array<{
        productId: string;
        product: {
            capacity: number | null;
        };
    }>;
};

type TransactionClient = Prisma.TransactionClient;

export async function countActiveRegistrations(
    tx: TransactionClient,
    eventId: number
) {
    return tx.registration.count({
        where: {
            eventId,
            status: {
                in: [...ACTIVE_REGISTRATION_STATUSES]
            }
        }
    });
}

async function releaseRegistrationInventory(
    tx: TransactionClient,
    registration: RegistrationCapacitySnapshot
) {
    const releaseCounts = new Map<string, { count: number; hasCapacityLimit: boolean }>();

    for (const item of registration.registrationItems) {
        const current = releaseCounts.get(item.productId);
        releaseCounts.set(item.productId, {
            count: (current?.count || 0) + 1,
            hasCapacityLimit: item.product.capacity !== null
        });
    }

    const releasedProductIds = new Set<string>();

    for (const [productId, release] of releaseCounts.entries()) {
        const updated = await tx.product.updateMany({
            where: {
                id: productId,
                soldCount: {
                    gte: release.count
                }
            },
            data: {
                soldCount: {
                    decrement: release.count
                }
            }
        });

        if (updated.count > 0 && release.hasCapacityLimit) {
            releasedProductIds.add(productId);
        }
    }

    return Array.from(releasedProductIds);
}

export async function syncReleasedProductStocks(productIds: string[]) {
    const uniqueProductIds = Array.from(new Set(productIds));

    if (uniqueProductIds.length === 0) {
        return;
    }

    await Promise.allSettled(uniqueProductIds.map((productId) => clearProductStock(productId)));
}

/** `roomNotices` collects roommate notifications; send them with sendNotices after the transaction commits. */
export async function cancelRegistrationAndReleaseCapacity(
    tx: TransactionClient,
    registrationId: string,
    roomNotices?: RoomNotice[]
) {
    const registration = await tx.registration.findUnique({
        where: {
            id: registrationId
        },
        select: {
            id: true,
            eventId: true,
            registrationItems: {
                select: {
                    productId: true,
                    product: {
                        select: {
                            capacity: true
                        }
                    }
                }
            }
        }
    });

    if (!registration) {
        throw new Error("Registration not found");
    }

    const releasedProductIds = await releaseRegistrationInventory(tx, registration);

    await tx.payment.updateMany({
        where: {
            registrationId,
            paymentStatus: "PENDING"
        },
        data: {
            paymentStatus: "FAILED"
        }
    });

    await tx.registrationItem.deleteMany({
        where: {
            registrationId
        }
    });

    await tx.waitlistEntry.deleteMany({
        where: {
            registrationId
        }
    });

    roomNotices?.push(...await releaseRoomGroupForCancelledRegistration(tx, registrationId, registration.eventId));

    await tx.registration.update({
        where: {
            id: registrationId
        },
        data: {
            status: "CANCELLED",
            expiresAt: null
        }
    });

    return releasedProductIds;
}

export async function releaseExpiredPendingRegistrations(eventId: number) {
    const now = new Date();
    const roomNotices: RoomNotice[] = [];

    const releasedProductIds = await prisma.$transaction(async (tx) => {
        const expiredRegistrations = await tx.registration.findMany({
            where: {
                eventId,
                status: {
                    in: ["PENDING", "APPROVED"]
                },
                expiresAt: {
                    lt: now
                },
                payments: {
                    none: {
                        paymentStatus: "COMPLETED"
                    }
                }
            },
            include: {
                registrationItems: {
                    select: {
                        productId: true,
                        product: {
                            select: {
                                capacity: true
                            }
                        }
                    }
                }
            }
        });

        if (expiredRegistrations.length === 0) {
            return [] as string[];
        }

        const releasedIds = new Set<string>();

        for (const registration of expiredRegistrations) {
            const cancelledProductIds = await cancelRegistrationAndReleaseCapacity(tx, registration.id, roomNotices);
            for (const productId of cancelledProductIds) {
                releasedIds.add(productId);
            }
        }

        return Array.from(releasedIds);
    });

    await Promise.all([syncReleasedProductStocks(releasedProductIds), sendNotices(roomNotices)]);

    return releasedProductIds.length;
}
