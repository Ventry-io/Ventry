import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/prisma";
import { getSession } from "@/lib/auth/session";
import { cancelRegistrationAndReleaseCapacity, syncReleasedProductStocks } from "@/lib/events/registration-capacity";
import { type RoomNotice, sendNotices } from "@/lib/rooms/common";

export async function POST(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getSession();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const eventId = Number((await params).id);
        if (Number.isNaN(eventId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

        const roomNotices: RoomNotice[] = [];
        const releasedProductIds = await prisma.$transaction(async (tx) => {
            const registration = await tx.registration.findUnique({
                where: {
                    userId_eventId: {
                        userId: session.user.id,
                        eventId
                    }
                },
                select: {
                    id: true
                }
            });

            if (!registration) {
                return null;
            }

            return cancelRegistrationAndReleaseCapacity(tx, registration.id, roomNotices);
        });

        if (!releasedProductIds) {
            return NextResponse.json({ error: "Registration not found" }, { status: 404 });
        }

        await Promise.all([syncReleasedProductStocks(releasedProductIds), sendNotices(roomNotices)]);

        return NextResponse.json({ message: "Registration cancelled" }, { status: 200 });

    } catch (error) {
        console.error("Cancellation error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
