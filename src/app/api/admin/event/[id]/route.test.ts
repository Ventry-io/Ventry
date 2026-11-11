import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";

vi.mock("@/types/schemas/event/admin", () => ({
    adminUpdateEventSchema: {
        parse: vi.fn()
    }
}));

vi.mock("@/lib/prisma/prisma", () => ({
    prisma: {
        event: {
            findUnique: vi.fn(),
            update: vi.fn(),
            delete: vi.fn()
        },
        product: { findMany: vi.fn() },
        registration: {
            count: vi.fn()
        }
    }
}));

vi.mock("@/lib/auth/admin", () => ({
    forbiddenResponse: vi.fn((error?: string) =>
        new Response(JSON.stringify({ error: error ?? "Forbidden" }), {
            status: 403,
            headers: {
                "content-type": "application/json"
            }
        })
    )
}));

vi.mock("@/lib/auth/event-admin", () => ({
    checkEventAdminAuth: vi.fn()
}));

import * as adminRoute from "@/app/api/admin/event/[id]/route";
import { prisma } from "@/lib/prisma/prisma";
import { forbiddenResponse } from "@/lib/auth/admin";
import { checkEventAdminAuth } from "@/lib/auth/event-admin";
import { adminUpdateEventSchema } from "@/types/schemas/event/admin";

const mockedCheckEventAdminAuth = checkEventAdminAuth as unknown as ReturnType<typeof vi.fn>;
const mockedForbiddenResponse = forbiddenResponse as unknown as ReturnType<typeof vi.fn>;
const mockedFindUnique = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedUpdate = prisma.event.update as unknown as ReturnType<typeof vi.fn>;
const mockedDelete = prisma.event.delete as unknown as ReturnType<typeof vi.fn>;
const mockedRegistrationCount = prisma.registration.count as unknown as ReturnType<typeof vi.fn>;
const mockedUpdateParse = adminUpdateEventSchema.parse as unknown as ReturnType<typeof vi.fn>;

function getRequest(url: string) {
    return new NextRequest(url, { method: "GET" });
}

function patchRequest(url: string, body: unknown) {
    return new NextRequest(url, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
    });
}

function deleteRequest(url: string) {
    return new NextRequest(url, { method: "DELETE" });
}

describe("App Router: /api/admin/event/[id]", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedCheckEventAdminAuth.mockResolvedValue({ authorized: true });
        vi.mocked(prisma.product.findMany).mockResolvedValue([]);
    });

    describe("GET", () => {
        it("returns 403 for unauthorized admins", async () => {
            mockedCheckEventAdminAuth.mockResolvedValue({ authorized: false, error: "Forbidden" });

            const response = await adminRoute.GET(
                getRequest("http://localhost/api/admin/event/7"),
                { params: Promise.resolve({ id: "7" }) }
            );

            expect(response.status).toBe(403);
            expect(mockedForbiddenResponse).toHaveBeenCalledWith("Forbidden");
        });

        it("returns 200 with the event", async () => {
            mockedFindUnique.mockResolvedValue({
                id: 7,
                name: "Furavia",
                location: null,
                products: [],
                _count: { registrations: 3 }
            });

            const response = await adminRoute.GET(
                getRequest("http://localhost/api/admin/event/7"),
                { params: Promise.resolve({ id: "7" }) }
            );

            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({
                event: {
                    id: 7,
                    name: "Furavia",
                    location: null,
                    products: [],
                    _count: { registrations: 3 }
                }
            });
            expect(mockedFindUnique).toHaveBeenCalled();
        });
    });

    describe("PATCH", () => {
        it("keeps booked products when a submitted layout omits them", async () => {
            mockedUpdateParse.mockReturnValue({ products: [] });
            vi.mocked(prisma.product.findMany).mockResolvedValue([{ id: "booked" }] as never);
            const response = await adminRoute.PATCH(patchRequest("http://localhost/api/admin/event/7", { products: [] }), { params: Promise.resolve({ id: "7" }) });
            expect(response.status).toBe(409);
            expect(mockedUpdate).not.toHaveBeenCalled();
        });

        it("returns 200 and updates the event", async () => {
            const input = {
                name: "Updated Event",
                description: "Desc",
                startDate: "2026-05-01T10:00:00.000Z",
                endDate: "2026-05-02T10:00:00.000Z",
                stayPolicy: {},
                customFields: [],
                schedule: [],
                scanOnce: true,
                location: {
                    name: "Venue",
                    address: "Street 1",
                    city: "Town",
                    state: "State",
                    country: "Germany",
                    postalCode: "12345"
                },
                products: [
                    {
                        id: "ticket-basic",
                        name: "Basic",
                        description: "Basic ticket",
                        price: 100,
                        type: "TICKET",
                        capacity: 50
                    },
                    {
                        id: "shirt",
                        name: "T-Shirt",
                        description: "Merch addon",
                        price: 25,
                        type: "ADDON",
                        capacity: 100
                    },
                    {
                        id: "room-standard",
                        name: "Standard Room",
                        description: "Hotel room",
                        price: 199,
                        type: "ACCOMMODATION",
                        capacity: 20
                    }
                ]
            };

            mockedUpdateParse.mockReturnValue(input);
            mockedUpdate.mockResolvedValue({ id: 7, name: "Updated Event" });

            const response = await adminRoute.PATCH(
                patchRequest("http://localhost/api/admin/event/7", input),
                { params: Promise.resolve({ id: "7" }) }
            );

            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({
                message: "Event updated successfully",
                event: { id: 7, name: "Updated Event" }
            });
            expect(mockedUpdateParse).toHaveBeenCalledWith(input);
            expect(mockedUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 7 },
                    data: expect.objectContaining({
                        name: "Updated Event",
                        scanOnce: true,
                        location: {
                            upsert: {
                                create: input.location,
                                update: input.location
                            }
                        },
                        products: {
                            deleteMany: { id: { notIn: ["ticket-basic", "shirt", "room-standard"] } },
                            upsert: input.products.map(product => {
                                const { id, ...data } = product;
                                return { where: { id }, create: { ...data, id }, update: data };
                            }),
                        }
                    })
                })
            );
        });

        it("returns 422 for schema errors", async () => {
            const zerr = new z.ZodError([
                {
                    code: "invalid_type",
                    expected: "string",
                    path: ["name"],
                    message: "Required",
                    input: undefined
                }
            ]);
            mockedUpdateParse.mockImplementation(() => {
                throw zerr;
            });

            const response = await adminRoute.PATCH(
                patchRequest("http://localhost/api/admin/event/7", {}),
                { params: Promise.resolve({ id: "7" }) }
            );

            expect(response.status).toBe(422);
            expect(await response.json()).toEqual({ error: zerr.issues });
            expect(mockedUpdate).not.toHaveBeenCalled();
        });
    });

    describe("DELETE", () => {
        it("returns 409 when registrations exist", async () => {
            mockedRegistrationCount.mockResolvedValue(2);

            const response = await adminRoute.DELETE(
                deleteRequest("http://localhost/api/admin/event/7"),
                { params: Promise.resolve({ id: "7" }) }
            );

            expect(response.status).toBe(409);
            expect(mockedDelete).not.toHaveBeenCalled();
        });

        it("returns 200 and deletes when no registrations exist", async () => {
            mockedRegistrationCount.mockResolvedValue(0);
            mockedDelete.mockResolvedValue({ id: 7 });

            const response = await adminRoute.DELETE(
                deleteRequest("http://localhost/api/admin/event/7"),
                { params: Promise.resolve({ id: "7" }) }
            );

            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ message: "Event deleted successfully" });
            expect(mockedDelete).toHaveBeenCalledWith({ where: { id: 7 } });
        });
    });
});
