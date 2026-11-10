import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/prisma";
import type { Prisma } from "@/generated/prisma";
import { forbiddenResponse } from "@/lib/auth/admin";
import { checkEventAdminAuth } from "@/lib/auth/event-admin";
import { adminUpdateEventSchema } from "@/types/schemas/event/admin";
import { z } from "zod";

// GET /api/admin/event/[id] - Get full event details for admin
export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const id = Number((await params).id);
        if (Number.isNaN(id)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

        const authResult = await checkEventAdminAuth(id);
        if (!authResult.authorized) {
            return forbiddenResponse(authResult.error);
        }

        const event = await prisma.event.findUnique({
            where: { id },
            include: {
                location: true,
                products: {
                    orderBy: { createdAt: "asc" }
                },
                _count: {
                    select: { registrations: true }
                }
            }
        });

        if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

        return NextResponse.json({ event }, { status: 200 });
    } catch (error) {
        console.error("Error getting admin event:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

// PATCH /api/admin/event/[id] - Update an event
export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const id = Number((await params).id);
        if (Number.isNaN(id)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

        const authResult = await checkEventAdminAuth(id, req.headers, undefined, true);
        if (!authResult.authorized) {
            return forbiddenResponse(authResult.error);
        }

        const body = await req.json();
        const validatedData = adminUpdateEventSchema.parse(body);

        const { location, products, ...scalarFields } = validatedData;

        const event = await prisma.event.update({
            where: { id },
            data: {
                ...scalarFields,
                stayPolicy: validatedData.stayPolicy as Prisma.InputJsonValue,
                customFields: validatedData.customFields as Prisma.InputJsonValue,
                schedule: validatedData.schedule as Prisma.InputJsonValue,
                // Handle location update
                ...(location && {
                    location: {
                        upsert: {
                            create: location,
                            update: location
                        }
                    }
                }),
                // Handle products update - strategy: replace all for simplicity if provided
                // This can be refined later if needed
                ...(products && {
                    products: {
                        deleteMany: {},
                        create: products.map(p => ({
                            id: p.id,
                            name: p.name,
                            description: p.description,
                            price: p.price,
                            type: p.type as "TICKET" | "ACCOMMODATION" | "ADDON",
                            capacity: p.capacity
                        }))
                    }
                })
            },
            include: {
                location: true,
                products: {
                    orderBy: { createdAt: "asc" }
                }
            }
        });

        return NextResponse.json({ message: "Event updated successfully", event }, { status: 200 });

    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues }, { status: 422 });
        }
        console.error("Error updating event:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

// DELETE /api/admin/event/[id] - Delete an event
export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const id = Number((await params).id);
        if (Number.isNaN(id)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

        const authResult = await checkEventAdminAuth(id, req.headers, undefined, true);
        if (!authResult.authorized) {
            return forbiddenResponse(authResult.error);
        }

        // Check if event has registrations
        const registrationCount = await prisma.registration.count({
            where: { eventId: id }
        });

        if (registrationCount > 0) {
            return NextResponse.json({ 
                error: "Cannot delete event with active registrations. Cancel them first or mark event as CANCELLED." 
            }, { status: 409 });
        }

        await prisma.event.delete({
            where: { id }
        });

        return NextResponse.json({ message: "Event deleted successfully" }, { status: 200 });
    } catch (error) {
        console.error("Error deleting event:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
