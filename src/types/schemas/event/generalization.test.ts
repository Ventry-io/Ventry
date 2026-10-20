import { describe, expect, it } from "vitest";
import { adminCreateEventSchema, adminUpdateEventSchema } from "./admin";
import { StayPolicySchema } from "./accommodation";
import { normalizeStayPolicy, resolveAccommodationHotels, resolveStayFee } from "@/lib/events/accommodation";

const event = {
  name: "Community workshop",
  description: "A workshop without accommodation",
  startDate: "2027-05-01T10:00:00Z",
  endDate: "2027-05-01T18:00:00Z",
  location: { name: "Hall", address: "Street 1", city: "Berlin", state: "Berlin", country: "DE", postalCode: "10115" },
};

const hotel = {
  id: "main-hotel",
  name: "Main Hotel",
  isPrimary: true,
  roomTypeProductIds: ["room"],
  stayPolicy: {
    main: { checkIn: "2027-05-01", checkOut: "2027-05-02" },
    earlyArrival: { enabled: true, from: "2027-04-30", pricingMode: "CUSTOM", feePerNight: 25 },
    lateDeparture: { enabled: false, pricingMode: "AUTO" },
  },
};

describe("Event configuration independent of convention format", () => {
  it("creates a same-day event without hotel configuration", () => {
    const parsed = adminCreateEventSchema.parse(event);
    expect(parsed.requiresHotel).toBe(false);
    expect(parsed.communityEnabled).toBe(false);
    expect(parsed.stayPolicy).toEqual(normalizeStayPolicy({}));
    expect(parsed.stayPolicy.hotels).toEqual([]);
  });

  it("preserves hotel configuration and fee rules", () => {
    const parsed = adminCreateEventSchema.parse({ ...event, requiresHotel: true, stayPolicy: { hotels: [hotel] } });
    expect(parsed.requiresHotel).toBe(true);
    expect(parsed.stayPolicy.hotels[0]).toMatchObject({ ...hotel, stayPolicy: {
      ...hotel.stayPolicy,
      main: { checkIn: new Date("2027-05-01"), checkOut: new Date("2027-05-02") },
      earlyArrival: { ...hotel.stayPolicy.earlyArrival, from: new Date("2027-04-30") },
    } });
    expect(resolveStayFee(parsed.stayPolicy.hotels[0].stayPolicy.earlyArrival, 100)).toBe(25);
  });

  it("does not inject a hotel policy into partial updates", () => {
    const parsed = adminUpdateEventSchema.parse({ name: "New name" });
    expect(parsed.name).toBe("New name");
    expect(parsed).not.toHaveProperty("stayPolicy");
    expect(adminUpdateEventSchema.parse({})).not.toHaveProperty("stayPolicy");
  });

  it.each([
    null,
    { mainLocationIsAccommodation: true },
    { allowOverflowHotels: true },
    { hotels: [{ ...hotel, isPrimary: false }] },
    { hotels: [{ ...hotel, roomTypeProductIds: [] }] },
    { hotels: [{ ...hotel, stayPolicy: { ...hotel.stayPolicy, main: { checkIn: "2027-05-02", checkOut: "2027-05-01" } } }] },
    { hotels: [{ ...hotel, stayPolicy: { ...hotel.stayPolicy, earlyArrival: { enabled: true } } }] },
    { hotels: [{ ...hotel, stayPolicy: { ...hotel.stayPolicy, lateDeparture: { enabled: true } } }] },
  ])("still rejects invalid explicit hotel configuration: %j", stayPolicy => {
    expect(adminCreateEventSchema.safeParse({ ...event, stayPolicy }).success).toBe(false);
  });

  it("accepts the existing explicit empty configuration", () => {
    expect(adminCreateEventSchema.parse({ ...event, stayPolicy: {} }).stayPolicy).toEqual(StayPolicySchema.parse({}));
  });

  it("continues resolving legacy hotel policies and booked room references", () => {
    const products = [{ id: "room", name: "Room", price: 100, description: null, type: "ACCOMMODATION" as const }];
    const hotels = resolveAccommodationHotels(hotel.stayPolicy, products, "Legacy Hotel");
    expect(hotels[0].name).toBe("Legacy Hotel");
    expect(hotels[0].roomTypeProductIds).toEqual(["room"]);
    expect(hotels[0].roomTypes).toEqual(products);
    expect(resolveStayFee(hotels[0].stayPolicy.earlyArrival, 100)).toBe(25);
  });
});
