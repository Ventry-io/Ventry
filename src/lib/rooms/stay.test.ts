import { describe, expect, it } from "vitest";
import { createDefaultHotelStayPolicy } from "@/lib/events/accommodation";
import { mergeStays, occupancyOf, resolveMemberStay, staysOverlap, withinAvailability } from "@/lib/rooms/stay";

const d = (value: string) => new Date(value);
const hotel = {
  id: "h1",
  name: "Hotel",
  isPrimary: true,
  roomTypeProductIds: ["double"],
  roomTypes: [],
  stayPolicy: {
    ...createDefaultHotelStayPolicy("2026-12-01T14:00:00Z", "2026-12-03T10:00:00Z"),
    earlyArrival: { enabled: true, from: "2026-11-30T14:00:00Z", pricingMode: "AUTO" as const },
    lateDeparture: { enabled: false, until: "2026-12-04T10:00:00Z", pricingMode: "AUTO" as const },
  },
};

describe("room stay rules", () => {
  it("widens the stay only for enabled, booked options", () => {
    expect(resolveMemberStay(hotel, { earlyArrival: true, lateDeparture: true })).toEqual({
      checkIn: d("2026-11-30T14:00:00Z"),
      checkOut: d("2026-12-03T10:00:00Z"),
      earlyArrival: true,
      lateDeparture: false,
    });
    expect(resolveMemberStay(null, {})).toBeNull();
  });

  it("merges group stays and detects night overlaps as half-open ranges", () => {
    const a = { checkIn: d("2026-12-01"), checkOut: d("2026-12-03") };
    const b = { checkIn: d("2026-12-03"), checkOut: d("2026-12-05") };
    expect(mergeStays([a, null, b])).toEqual({ checkIn: a.checkIn, checkOut: b.checkOut });
    expect(staysOverlap(a, b)).toBe(false);
    expect(staysOverlap(a, { checkIn: d("2026-12-02"), checkOut: d("2026-12-04") })).toBe(true);
    expect(withinAvailability(a, d("2026-12-01"), d("2026-12-02"))).toBe(false);
    expect(withinAvailability(a, null, null)).toBe(true);
  });

  it("classifies room occupancy", () => {
    expect(occupancyOf(1, 2, 3)).toBe("UNDER");
    expect(occupancyOf(2, 2, 3)).toBe("OK");
    expect(occupancyOf(4, 2, 3)).toBe("OVER");
  });
});
