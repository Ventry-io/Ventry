import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/prisma";
import { checkAdminAuth, adminEventFilter, forbiddenResponse } from "@/lib/auth/admin";
import type { RegistrationStatus } from "@/generated/prisma";
import { rethrowIfExpectedPrerenderInterruption } from "@/lib/next/prerender";

// GET /api/admin/registrations - List all registrations for admins
export async function GET(req: NextRequest) {
    try {
        const authResult = await checkAdminAuth(req.headers);
        if (!authResult.authorized) {
            return forbiddenResponse(authResult.error);
        }

        const url = new URL(req.url);
        const eventId = url.searchParams.get("eventId");
        const status = url.searchParams.get("status");

        if (!authResult.adminId) {
            return NextResponse.json({ error: "Admin profile incomplete" }, { status: 403 });
        }

        const eventFilter = await adminEventFilter(authResult.adminId);

        const registrations = await prisma.registration.findMany({
            where: {
                event: eventFilter,
                ...(eventId && { eventId: Number(eventId) }),
                ...(status && { status: status as RegistrationStatus }),
            },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        image: true,
                        isAdmin: true,
                        adminProfile: { select: { organizationMemberships: { select: { organizationId: true, role: true, department: { select: { name: true } } } } } }
                    }
                },
                event: {
                    select: {
                        id: true,
                        name: true,
                        ownerId: true,
                        organizationId: true,
                        organization: { select: { ownerId: true, members: { where: { adminId: authResult.adminId }, select: { accessLevel: true, permissions: true } } } }
                    }
                },
                registrationItems: {
                    include: {
                        product: {
                            select: {
                                id: true,
                                name: true,
                                price: true,
                                type: true
                            }
                        }
                    },
                    orderBy: {
                        createdAt: 'asc'
                    }
                },
                waitlistEntries: {
                    include: {
                        product: {
                            select: {
                                id: true,
                                name: true,
                                price: true,
                                type: true
                            }
                        }
                    },
                    orderBy: {
                        createdAt: 'asc'
                    }
                },
                payments: {
                    orderBy: { createdAt: 'desc' },
                    take: 1
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        return NextResponse.json({ registrations: registrations.map(registration => {
            const crew = registration.user.isAdmin ? registration.user.adminProfile?.organizationMemberships.find(m => m.organizationId === registration.event.organizationId) : null;
            const membership = registration.event.organization?.members[0];
            const owner = registration.event.ownerId === authResult.adminId || registration.event.organization?.ownerId === authResult.adminId;
            const canWrite = owner || membership?.accessLevel === "WRITE";
            const { adminProfile: _adminProfile, isAdmin: _isAdmin, ...user } = registration.user;
            return { ...registration, user, event: { id: registration.event.id, name: registration.event.name }, crewDepartment: crew?.department?.name || null, crewRole: crew?.role || null, canWrite, canApprove: canWrite && (owner || membership?.permissions.includes("EVENT_APPROVAL")), canManageFinances: canWrite && (owner || membership?.permissions.includes("STRIPE_FINANCES")) };
        }) }, { status: 200 });
    } catch (error) {
        rethrowIfExpectedPrerenderInterruption(error);
        console.error("Error listing admin registrations:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
