import { findHotelByRoomProductId, type ResolvedAccommodationHotel } from "@/lib/events/accommodation";
import type { SerializedProduct } from "@/types/event";

export type StayWindow = { checkIn: Date; checkOut: Date };
export type MemberStay = StayWindow & { earlyArrival: boolean; lateDeparture: boolean };
export type Occupancy = "UNDER" | "OK" | "OVER";

export type StayEventContext = {
  name: string;
  startDate: Date;
  endDate: Date;
  stayPolicy: unknown;
  products: SerializedProduct[];
};

export function hotelForRoomType(event: StayEventContext, productId: string): ResolvedAccommodationHotel | null {
  return findHotelByRoomProductId(event.stayPolicy, productId, event.products, event.name, event.startDate, event.endDate);
}

/** Stay dates of one guest: the hotel's main window, widened by approved early arrival / late departure. */
export function resolveMemberStay(hotel: ResolvedAccommodationHotel | null, preferences: unknown): MemberStay | null {
  if (!hotel) return null;
  const prefs = (preferences ?? {}) as { earlyArrival?: unknown; lateDeparture?: unknown };
  const { main, earlyArrival, lateDeparture } = hotel.stayPolicy;
  const early = Boolean(prefs.earlyArrival && earlyArrival.enabled && earlyArrival.from);
  const late = Boolean(prefs.lateDeparture && lateDeparture.enabled && lateDeparture.until);

  return {
    checkIn: new Date(early ? (earlyArrival.from as Date | string) : main.checkIn),
    checkOut: new Date(late ? (lateDeparture.until as Date | string) : main.checkOut),
    earlyArrival: early,
    lateDeparture: late,
  };
}

/** Nights a shared room is needed: from the earliest arrival to the latest departure. */
export function mergeStays(stays: Array<StayWindow | null>): StayWindow | null {
  const known = stays.filter((stay): stay is StayWindow => Boolean(stay));
  if (known.length === 0) return null;
  return {
    checkIn: new Date(Math.min(...known.map((stay) => stay.checkIn.getTime()))),
    checkOut: new Date(Math.max(...known.map((stay) => stay.checkOut.getTime()))),
  };
}

/** Half-open night ranges [checkIn, checkOut) overlap. */
export function staysOverlap(a: StayWindow, b: StayWindow): boolean {
  return a.checkIn < b.checkOut && b.checkIn < a.checkOut;
}

export function withinAvailability(stay: StayWindow, from: Date | null, until: Date | null): boolean {
  return (!from || from <= stay.checkIn) && (!until || stay.checkOut <= until);
}

export function occupancyOf(count: number, minOccupants: number, maxOccupants: number): Occupancy {
  if (count > maxOccupants) return "OVER";
  if (count < minOccupants) return "UNDER";
  return "OK";
}
