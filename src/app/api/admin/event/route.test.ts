import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";

vi.mock("@/types/schemas/event/admin", () => ({
    adminCreateEventSchema: {
        parse: vi.fn()
    }
}));

vi.mock("@/lib/prisma/prisma", () => ({
    prisma: {
        event: {
            findMany: vi.fn(),
            create: vi.fn()
        },
        adminOrganization: {
            findFirst: vi.fn()
        },
        $transaction: vi.fn()
    }
}));

vi.mock("@/lib/auth/admin", () => ({
    checkAdminAuth: vi.fn(),
    adminEventFilter: vi.fn(),
    forbiddenResponse: vi.fn((error?: string) =>
        new Response(JSON.stringify({ error: error ?? "Forbidden" }), {
            status: 403,
            headers: {
                "content-type": "application/json"
            }
        })
    )
}));

import * as adminRoute from "@/app/api/admin/event/route";
import { prisma } from "@/lib/prisma/prisma";
import { checkAdminAuth, adminEventFilter, forbiddenResponse } from "@/lib/auth/admin";
import { adminCreateEventSchema } from "@/types/schemas/event/admin";
import { Prisma } from "@/generated/prisma";

const mockedCheckAdminAuth = checkAdminAuth as unknown as ReturnType<typeof vi.fn>;
const mockedAdminEventFilter = adminEventFilter as unknown as ReturnType<typeof vi.fn>;
const mockedForbiddenResponse = forbiddenResponse as unknown as ReturnType<typeof vi.fn>;
const mockedCreate = prisma.event.create as unknown as ReturnType<typeof vi.fn>;
const mockedTransaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;
const mockedCreateParse = adminCreateEventSchema.parse as unknown as ReturnType<typeof vi.fn>;
const mockedOrgFindFirst = prisma.adminOrganization.findFirst as unknown as ReturnType<typeof vi.fn>;

function postRequest(url: string, body: unknown) {
    return new NextRequest(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
    });
}

function eventInput(overrides: Record<string, unknown> = {}) {
    return {
        name: "Updated Event",
        description: "Desc",
        startDate: "2026-05-01T10:00:00.000Z",
        endDate: "2026-05-02T10:00:00.000Z",
        stayPolicy: {},
        customFields: [],
        schedule: [],
        status: "DRAFT",
        requireApproval: false,
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
        ],
        ...overrides
    };
}

describe("App Router: /api/admin/event", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedCheckAdminAuth.mockResolvedValue({ authorized: true, adminId: "admin-1" });
        mockedAdminEventFilter.mockResolvedValue({ OR: [{ ownerId: "admin-1" }] });
        mockedOrgFindFirst.mockResolvedValue(null);
    });

    it("returns 403 for unauthorized admins", async () => {
        mockedCheckAdminAuth.mockResolvedValue({ authorized: false, error: "Forbidden" });

        const response = await adminRoute.POST(postRequest("http://localhost/api/admin/event", {}));

        expect(response.status).toBe(403);
        expect(mockedForbiddenResponse).toHaveBeenCalledWith("Forbidden");
    });

    it("creates an event and preserves mixed product types", async () => {
        const input = eventInput({
            stayPolicy: {
                version: 2,
                hotels: [
                    {
                        id: "hotel-1",
                        name: "Hotel",
                        isPrimary: true,
                        roomTypeProductIds: ["room-standard"],
                        stayPolicy: {}
                    }
                ]
            }
        });

        mockedCreateParse.mockReturnValue(input);
        mockedCreate.mockResolvedValue({ id: 7, name: "Updated Event" });

        const response = await adminRoute.POST(
            postRequest("http://localhost/api/admin/event", input)
        );

        expect(response.status).toBe(201);
        expect(await response.json()).toEqual({
            message: "Event created successfully",
            event: { id: 7, name: "Updated Event" }
        });
        const createArgs = mockedCreate.mock.calls[0][0];
        const products = createArgs.data.products.create;
        expect(createArgs.data).toEqual(
            expect.objectContaining({
                ownerId: "admin-1",
                scanOnce: true,
                products: {
                    create: [
                        expect.objectContaining({
                            id: expect.any(String),
                            name: "Basic",
                            description: "Basic ticket",
                            price: 100,
                            type: "TICKET",
                            capacity: 50
                        }),
                        expect.objectContaining({
                            id: expect.any(String),
                            name: "T-Shirt",
                            description: "Merch addon",
                            price: 25,
                            type: "ADDON",
                            capacity: 100
                        }),
                        expect.objectContaining({
                            id: expect.any(String),
                            name: "Standard Room",
                            description: "Hotel room",
                            price: 199,
                            type: "ACCOMMODATION",
                            capacity: 20
                        })
                    ]
                }
            })
        );
        expect(products.map((product: { id: string }) => product.id)).not.toEqual(["ticket-basic", "shirt", "room-standard"]);
        expect(createArgs.data.stayPolicy.hotels[0].roomTypeProductIds).toEqual([products[2].id]);
        expect(mockedTransaction).not.toHaveBeenCalled();
    });

    it("creates a ticket-only event without accommodation using real validation", async () => {
        const { adminCreateEventSchema: realSchema } = await vi.importActual<typeof import("@/types/schemas/event/admin")>("@/types/schemas/event/admin");
        const input = eventInput({ stayPolicy: undefined });
        input.products = input.products.filter(product => product.type === "TICKET");
        mockedCreateParse.mockImplementationOnce(body => realSchema.parse(body));
        mockedCreate.mockResolvedValue({ id: 9, name: input.name });

        const response = await adminRoute.POST(postRequest("http://localhost/api/admin/event", input));

        expect(response.status).toBe(201);
        const { data } = mockedCreate.mock.calls[0][0];
        expect(data.ownerId).toBe("admin-1");
        expect(data.stayPolicy).toEqual({
            version: 2,
            mainLocationIsAccommodation: false,
            allowOverflowHotels: false,
            samePolicyAcrossHotels: false,
            hotels: [],
        });
        expect(data.products.create).toEqual([expect.objectContaining({ type: "TICKET", price: 100 })]);
    });

    it("repairs a drifted Event id sequence and retries event creation once", async () => {
        const input = eventInput();
        const sequenceError = new Prisma.PrismaClientKnownRequestError(
            "Unique constraint failed on the fields: (`id`)",
            {
                code: "P2002",
                clientVersion: "7.8.0",
                meta: {
                    modelName: "Event",
                    target: ["id"]
                }
            }
        );
        const tx = {
            $executeRaw: vi.fn().mockResolvedValue(undefined),
            event: {
                create: vi.fn().mockResolvedValue({ id: 8, name: "Updated Event" })
            }
        };

        mockedCreateParse.mockReturnValue(input);
        mockedCreate.mockRejectedValue(sequenceError);
        mockedTransaction.mockImplementation((callback) => callback(tx));

        const response = await adminRoute.POST(
            postRequest("http://localhost/api/admin/event", input)
        );

        expect(response.status).toBe(201);
        expect(await response.json()).toEqual({
            message: "Event created successfully",
            event: { id: 8, name: "Updated Event" }
        });
        expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
        expect(tx.event.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    ownerId: "admin-1",
                    name: "Updated Event"
                })
            })
        );
        expect(mockedTransaction).toHaveBeenCalledTimes(1);
    });

    it("repairs a drifted Event id sequence when Prisma adapter omits target metadata", async () => {
        const input = eventInput();
        const sequenceError = new Prisma.PrismaClientKnownRequestError(
            "Unique constraint failed on the fields: (`id`)",
            {
                code: "P2002",
                clientVersion: "7.8.0",
                meta: {
                    modelName: "Event"
                }
            }
        );
        const tx = {
            $executeRaw: vi.fn().mockResolvedValue(undefined),
            event: {
                create: vi.fn().mockResolvedValue({ id: 9, name: "Updated Event" })
            }
        };

        mockedCreateParse.mockReturnValue(input);
        mockedCreate.mockRejectedValue(sequenceError);
        mockedTransaction.mockImplementation((callback) => callback(tx));

        const response = await adminRoute.POST(
            postRequest("http://localhost/api/admin/event", input)
        );

        expect(response.status).toBe(201);
        expect(await response.json()).toEqual({
            message: "Event created successfully",
            event: { id: 9, name: "Updated Event" }
        });
        expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
        expect(tx.event.create).toHaveBeenCalledTimes(1);
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
        mockedCreateParse.mockImplementation(() => {
            throw zerr;
        });

        const response = await adminRoute.POST(postRequest("http://localhost/api/admin/event", {}));

        expect(response.status).toBe(422);
        expect(await response.json()).toEqual({ error: zerr.issues });
        expect(mockedCreate).not.toHaveBeenCalled();
    });
});
