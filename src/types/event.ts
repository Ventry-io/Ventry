export interface SerializedLocation {
  name: string;
  address: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
}

export interface SerializedProduct {
  id: string;
  name: string;
  price: number;
  description: string | null;
  type?: 'TICKET' | 'ACCOMMODATION' | 'ADDON';
  capacity?: number | null;
  soldCount?: number;
}

export type SerializedStayFeeMode = 'AUTO' | 'CUSTOM';

export interface SerializedHotelStayPolicy {
  main: {
    checkIn: string | Date;
    checkOut: string | Date;
  };
  earlyArrival: {
    enabled: boolean;
    from?: string | Date;
    pricingMode: SerializedStayFeeMode;
    feePerNight?: number;
  };
  lateDeparture: {
    enabled: boolean;
    until?: string | Date;
    pricingMode: SerializedStayFeeMode;
    feePerNight?: number;
  };
}

export interface SerializedHotel {
  id: string;
  name: string;
  isPrimary: boolean;
  roomTypeProductIds: string[];
  stayPolicy: SerializedHotelStayPolicy;
}

export interface SerializedStayPolicy {
  version: 2;
  mainLocationIsAccommodation: boolean;
  allowOverflowHotels: boolean;
  samePolicyAcrossHotels: boolean;
  hotels: SerializedHotel[];
}

export interface SerializedScheduleItem {
  id?: string;
  title: string;
  startTime: string;
  endTime?: string;
  location?: string;
  description?: string;
}

export interface SerializedEvent {
  id: number;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  imageUrl: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
  scanOnce?: boolean;
  communityEnabled?: boolean;
  communityOpenAfterEnd?: boolean;
  communityModerated?: boolean;
  communityAttendeesOnly?: boolean;
  stayPolicy: SerializedStayPolicy;
  schedule: SerializedScheduleItem[];
  pageDesign?: unknown;
  location?: SerializedLocation | null;
  products: SerializedProduct[];
  _count?: {
    registrations: number;
  };
}
