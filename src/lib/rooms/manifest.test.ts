import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma/prisma", () => ({ prisma: {} }));
import { buildManifestRows, manifestToCsv } from "@/lib/rooms/manifest";
import type { RoomEventContext } from "@/lib/rooms/common";

const event = {
  id: 1,
  name: "Con",
  startDate: new Date("2026-12-01"),
  endDate: new Date("2026-12-03"),
  roomGroupCutoffAt: null,
  stayPolicy: {
    hotels: [
      { id: "h1", name: "Hotel A", isPrimary: true, roomTypeProductIds: ["double"], stayPolicy: { main: { checkIn: "2026-12-01T14:00:00Z", checkOut: "2026-12-03T10:00:00Z" }, earlyArrival: { enabled: true, from: "2026-11-30T14:00:00Z" } } },
      { id: "h2", name: "Hotel B", roomTypeProductIds: ["single"], stayPolicy: { main: { checkIn: "2026-12-01T14:00:00Z", checkOut: "2026-12-03T10:00:00Z" } } },
    ],
  },
  products: [
    { id: "double", name: "Double", price: 100, description: null, type: "ACCOMMODATION", capacity: 4, soldCount: 2, minOccupants: 2, maxOccupants: 2 },
    { id: "single", name: "Single", price: 80, description: null, type: "ACCOMMODATION", capacity: 4, soldCount: 1, minOccupants: 1, maxOccupants: 1 },
  ],
} as unknown as RoomEventContext;

const guest = (ticketId: number, status: "CONFIRMED" | "CANCELLED" | "PENDING", productId: string, legalName: string, preferences = {}) => ({
  ticketId,
  status,
  preferences,
  registrationItems: [{ productId }],
  user: { legalName, name: "Display" },
});

describe("hotel manifest", () => {
  it("lists only confirmed guests with their real stay dates", () => {
    const rows = buildManifestRows(event, [
      {
        productId: "double",
        groupId: "g1",
        roomReference: "101",
        guests: [
          guest(1, "CONFIRMED", "double", "Ada Lovelace", { earlyArrival: true }),
          guest(2, "CANCELLED", "double", "Gone Guest"),
          guest(3, "PENDING", "double", "Unpaid Guest"),
        ],
      },
      { productId: "single", groupId: null, roomReference: null, guests: [guest(4, "CONFIRMED", "single", "Bob")] },
    ]);

    expect(rows.map((row) => row.guestName)).toEqual(["Ada Lovelace", "Bob"]);
    expect(rows[0]).toMatchObject({ hotel: "Hotel A", roomReference: "101", arrival: "2026-11-30", departure: "2026-12-03", earlyArrival: true });
    expect(rows[1]).toMatchObject({ hotel: "Hotel B", roomReference: "", arrival: "2026-12-01" });
  });

  it("lists roommates without own room item only when a confirmed member booked the room", () => {
    const roommate = { ...guest(5, "CONFIRMED", "double", "Roommate Ohne Zimmer"), registrationItems: [{ productId: "ticket" }] };
    const booked = buildManifestRows(event, [{ productId: "double", groupId: "g1", roomReference: "102", guests: [guest(6, "CONFIRMED", "double", "Booker"), roommate] }]);
    expect(booked.map((row) => row.guestName)).toEqual(["Booker", "Roommate Ohne Zimmer"]);

    const unpaidBooker = buildManifestRows(event, [{ productId: "double", groupId: "g2", roomReference: null, guests: [guest(7, "PENDING", "double", "Unpaid"), roommate] }]);
    expect(unpaidBooker).toEqual([]);
  });

  it("filters by hotel", () => {
    const rows = buildManifestRows(event, [{ productId: "single", groupId: null, roomReference: null, guests: [guest(4, "CONFIRMED", "single", "Bob")] }], "h1");
    expect(rows).toEqual([]);
  });

  it("escapes CSV and neutralizes spreadsheet formulas", () => {
    const csv = manifestToCsv([
      { hotel: "A, B", roomReference: "=HYPERLINK(1)", roomType: 'Say "hi"', arrival: "2026-12-01", departure: "2026-12-02", guestName: "Ada", earlyArrival: false, lateDeparture: true, ticketId: 7, roomGroup: "g" },
    ]);
    expect(csv.split("\r\n")[1]).toBe(`"A, B",'=HYPERLINK(1),"Say ""hi""",2026-12-01,2026-12-02,Ada,no,yes,7,g`);
  });
});
