"use client";

import { type ChangeEvent, type Dispatch, type SetStateAction, type SyntheticEvent, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Box,
  Button,
  TextField,
  Typography,
  Stack,
  Tabs,
  Tab,
  Paper,
  MenuItem,
  FormControlLabel,
  Switch,
  Grid,
  Divider,
  IconButton,
  Alert,
  CircularProgress,
  Checkbox,
} from "@mui/material";
import { Delete, Add, Save, CloudUpload, Error as ErrorIcon } from "@mui/icons-material";
import { adminCreateEventSchema, type AdminCreateEventInput } from "@/types/schemas/event/admin";
import type { Product as EventProduct } from "@/types/schemas/event/base";
import ImageCropper from "@/components/profile/ImageCropper";
import Image from "next/image";
import EventPageEditor from "./EventPageEditor";
import { normalizeEventPage, type EventPage } from "@/types/schemas/event/page";
import ScheduleCalendarBuilder, { type ScheduleItem } from "./ScheduleCalendarBuilder";
import { SortableProductItem } from "./SortableProductItem";
import {
  cloneHotelStayPolicy,
  createDefaultHotelStayPolicy,
  normalizeStayPolicy,
} from "@/lib/events/accommodation";
import type { SerializedHotelStayPolicy, SerializedProduct } from "@/types/event";

export interface InitialData {
  id?: number;
  name?: string;
  description?: string;
  startDate?: string | Date;
  endDate?: string | Date;
  publishAt?: string | Date | null;
  registrationOpensAt?: string | Date | null;
  maxRegistrations?: number | null;
  requiresHotel?: boolean;
  requireApproval?: boolean;
  scanOnce?: boolean;
  communityEnabled?: boolean;
  communityOpenAfterEnd?: boolean;
  communityModerated?: boolean;
  communityModerateComments?: boolean;
  communityAttendeesOnly?: boolean;
  paymentDeadline?: string | Date | null;
  status?: "DRAFT" | "PUBLISHED" | "CANCELLED";
  imageUrl?: string | null;
  location?: unknown;
  stayPolicy?: unknown;
  products?: unknown[];
  customFields?: unknown[];
  schedule?: unknown[];
  pageDesign?: unknown;
}

interface EventFormProps {
  initialData?: InitialData;
  onSubmit: (data: AdminCreateEventInput) => Promise<void>;
  loading?: boolean;
}

type ProductDraft = {
  id: string;
  name: string;
  description: string;
  price: number;
  capacity: number | null;
};

type EventFormProduct = EventProduct & { id: string };

type HotelDraft = {
  id: string;
  name: string;
  isPrimary: boolean;
  roomTypes: ProductDraft[];
  stayPolicy: SerializedHotelStayPolicy;
};

type CustomFieldDraft = NonNullable<AdminCreateEventInput["customFields"]>[number];

function createDraftId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function createProductDraft(prefix: string): ProductDraft {
  return {
    id: createDraftId(prefix),
    name: "",
    description: "",
    price: 0,
    capacity: null,
  };
}

function toProductDraft(product: EventFormProduct): ProductDraft {
  return {
    id: product.id || createDraftId("product"),
    name: product.name || "",
    description: product.description || "",
    price: Number(product.price || 0),
    capacity: product.capacity ?? null,
  };
}

function createHotelDraft(
  name: string,
  isPrimary: boolean,
  startDate?: Date | string,
  endDate?: Date | string,
): HotelDraft {
  return {
    id: createDraftId("hotel"),
    name,
    isPrimary,
    roomTypes: [createProductDraft("room")],
    stayPolicy: createDefaultHotelStayPolicy(startDate, endDate),
  };
}

function syncPrimaryHotel(hotels: HotelDraft[]) {
  if (hotels.length === 0) {
    return hotels;
  }

  const hasPrimary = hotels.some(hotel => hotel.isPrimary);
  return hotels.map((hotel, index) => ({
    ...hotel,
    isPrimary: hasPrimary ? hotel.isPrimary : index === 0,
  }));
}

function toSerializedProducts(products: EventFormProduct[]): SerializedProduct[] {
  return products.map(product => ({
    id: product.id || createDraftId("product"),
    name: product.name,
    price: Number(product.price || 0),
    description: product.description || null,
    type: product.type,
    capacity: product.capacity ?? null,
    soldCount: 0,
  }));
}

function normalizeCustomFields(
  customFields: unknown[] | undefined,
): AdminCreateEventInput["customFields"] {
  if (!Array.isArray(customFields)) {
    return [];
  }

  return customFields.map((field, index) => {
    const candidate = (field && typeof field === "object" ? field : {}) as Partial<CustomFieldDraft>;
    const type = candidate.type;

    return {
      id: candidate.id || createDraftId(`custom-field-${index + 1}`),
      label: candidate.label || "",
      type:
        type === "text" || type === "number" || type === "boolean" || type === "select"
          ? type
          : "text",
      required: Boolean(candidate.required),
      options: Array.isArray(candidate.options) ? candidate.options.filter(option => typeof option === "string") : [],
    };
  });
}

export default function EventForm({ initialData, onSubmit, loading: externalLoading }: EventFormProps) {
  const [tabValue, setTabValue] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const initialProducts: EventFormProduct[] = ((initialData?.products as EventProduct[]) || []).map(product => ({
    ...product,
    id: product.id || createDraftId("product"),
  }));
  const initialSerializedProducts = toSerializedProducts(initialProducts);
  const normalizedStayPolicy = normalizeStayPolicy(
    initialData?.stayPolicy,
    initialSerializedProducts,
    (initialData?.location as Record<string, string> | undefined)?.name || initialData?.name || "Main Hotel",
    initialData?.startDate,
    initialData?.endDate,
  );

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isValid, isSubmitting },
  } = useForm<AdminCreateEventInput>({
    resolver: zodResolver(adminCreateEventSchema),
    defaultValues: {
      pageDesign: normalizeEventPage(initialData?.pageDesign),
      name: initialData?.name || "",
      description: initialData?.description || "",
      startDate: initialData?.startDate ? new Date(initialData.startDate) : new Date(),
      endDate: initialData?.endDate ? new Date(initialData.endDate) : new Date(),
      publishAt: initialData?.publishAt ? new Date(initialData.publishAt) : null,
      registrationOpensAt: initialData?.registrationOpensAt ? new Date(initialData.registrationOpensAt) : null,
      maxRegistrations: initialData?.maxRegistrations || null,
      requiresHotel: initialData?.requiresHotel || false,
      requireApproval: initialData?.requireApproval || false,
      scanOnce: initialData?.scanOnce || false,
      communityEnabled: initialData?.communityEnabled || false,
      communityOpenAfterEnd: initialData?.communityOpenAfterEnd ?? true,
      communityModerated: initialData?.communityModerated ?? true,
      communityModerateComments: initialData?.communityModerateComments ?? false,
      communityAttendeesOnly: initialData?.communityAttendeesOnly ?? true,
      paymentDeadline: initialData?.paymentDeadline ? new Date(initialData.paymentDeadline) : null,
      status: initialData?.status || "DRAFT",
      imageUrl: initialData?.imageUrl || null,
      location: {
        name: (initialData?.location as Record<string, string>)?.name || "",
        address: (initialData?.location as Record<string, string>)?.address || "",
        city: (initialData?.location as Record<string, string>)?.city || "",
        state: (initialData?.location as Record<string, string>)?.state || "",
        country: (initialData?.location as Record<string, string>)?.country || "",
        postalCode: (initialData?.location as Record<string, string>)?.postalCode || "",
      },
      stayPolicy: normalizedStayPolicy,
      products: initialProducts,
      customFields: normalizeCustomFields(initialData?.customFields),
      schedule: (initialData?.schedule as AdminCreateEventInput["schedule"]) || [],
    },
  });

  const [advanced, setAdvanced] = useState(!!initialData?.id);
  const [ticketProducts, setTicketProducts] = useState<ProductDraft[]>(
    initialProducts.filter(product => product.type === "TICKET").map(toProductDraft).length > 0
      ? initialProducts.filter(product => product.type === "TICKET").map(toProductDraft)
      : [],
  );
  const [addonProducts, setAddonProducts] = useState<ProductDraft[]>(
    initialProducts.filter(product => product.type === "ADDON").map(toProductDraft),
  );
  const [mainLocationIsAccommodation, setMainLocationIsAccommodation] = useState(
    normalizedStayPolicy.mainLocationIsAccommodation,
  );
  const [allowOverflowHotels, setAllowOverflowHotels] = useState(normalizedStayPolicy.allowOverflowHotels);
  const [samePolicyAcrossHotels, setSamePolicyAcrossHotels] = useState(normalizedStayPolicy.samePolicyAcrossHotels);
  const [hotels, setHotels] = useState<HotelDraft[]>(
    syncPrimaryHotel(
      normalizedStayPolicy.hotels.map(hotel => ({
        id: hotel.id,
        name: hotel.name,
        isPrimary: hotel.isPrimary,
        roomTypes: hotel.roomTypeProductIds
          .map(productId => initialProducts.find(product => product.id === productId))
          .filter((product): product is EventFormProduct => Boolean(product))
          .map(toProductDraft),
        stayPolicy: hotel.stayPolicy,
      })),
    ),
  );

  const { fields: customFields, append: addCustomField, remove: removeCustomField } = useFieldArray({
    control,
    name: "customFields",
  });

  const watchStartDate = watch("startDate") as Date | string | undefined;
  const watchEndDate = watch("endDate") as Date | string | undefined;
  const watchImageUrl = watch("imageUrl");
  const watchRequiresHotel = watch("requiresHotel") as boolean | undefined;
  const watchCommunityEnabled = watch("communityEnabled") as boolean | undefined;
  const watchCommunityModerated = watch("communityModerated") as boolean | undefined;
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleTabChange = (_: SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const hasTabError = (index: number) => {
    switch (index) {
      case 0:
        return !!(
          errors.name ||
          errors.description ||
          errors.startDate ||
          errors.endDate ||
          errors.status ||
          errors.imageUrl ||
          errors.publishAt ||
          errors.registrationOpensAt ||
          errors.maxRegistrations ||
          errors.paymentDeadline
        );
      case 1:
        return !!errors.location;
      case 2:
        return false;
      case 3:
        return !!errors.customFields;
      case 4:
        return !!errors.schedule;
      default:
        return false;
    }
  };

  const formatDateForInput = (date: Date | string | undefined | null, type: "datetime-local" | "date") => {
    if (!date) return "";
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return "";

    const offset = d.getTimezoneOffset() * 60000;
    const localDate = new Date(d.getTime() - offset);
    const iso = localDate.toISOString();

    return type === "datetime-local" ? iso.slice(0, 16) : iso.slice(0, 10);
  };

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      setCropImageSrc(reader.result?.toString() || null);
      setCropOpen(true);
    });
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const handleCropComplete = async (croppedBlob: Blob) => {
    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", croppedBlob);

      const response = await fetch("/api/admin/media/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) throw new Error("Upload failed");

      const data = await response.json();
      setValue("imageUrl", data.url);
      setCropOpen(false);
    } catch (_err) {
      setError("Failed to upload image");
    } finally {
      setUploading(false);
    }
  };

  const updateProducts = (
    setter: Dispatch<SetStateAction<ProductDraft[]>>,
    index: number,
    field: keyof ProductDraft,
    value: string | number | null,
  ) => {
    setter(current =>
      current.map((product, currentIndex) => {
        if (currentIndex !== index) {
          return product;
        }

        if (field === "price") {
          return {
            ...product,
            price: Number(value || 0),
          };
        }

        if (field === "capacity") {
          return {
            ...product,
            capacity: value === "" || value === null ? null : Number(value),
          };
        }

        return {
          ...product,
          [field]: value,
        };
      }),
    );
  };

  const reorderProducts = (
    setter: Dispatch<SetStateAction<ProductDraft[]>>,
    event: DragEndEvent,
  ) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    setter((current) => {
      const oldIndex = current.findIndex((product) => product.id === active.id);
      const newIndex = current.findIndex((product) => product.id === over.id);

      if (oldIndex < 0 || newIndex < 0) {
        return current;
      }

      return arrayMove(current, oldIndex, newIndex);
    });
  };

  const ensureHotelsVisible = (main: boolean, overflow: boolean) => {
    if ((main || overflow) && hotels.length === 0) {
      setHotels([createHotelDraft(main ? "Main Hotel" : "Overflow Hotel 1", true, watchStartDate, watchEndDate)]);
    }

    if (!main && !overflow) {
      setHotels([]);
      setSamePolicyAcrossHotels(false);
    }

    if (!overflow && main && hotels.length > 1) {
      setHotels(current => current.filter(hotel => hotel.isPrimary || current.indexOf(hotel) === 0).map((hotel, index) => ({
        ...hotel,
        isPrimary: index === 0,
      })));
      setSamePolicyAcrossHotels(false);
    }
  };

  const updateHotel = (index: number, updater: (hotel: HotelDraft) => HotelDraft) => {
    setHotels(current =>
      syncPrimaryHotel(
        current.map((hotel, currentIndex) => {
          if (currentIndex !== index) {
            return hotel;
          }

          return updater(hotel);
        }),
      ),
    );
  };

  const updateHotelPolicy = (
    index: number,
    updater: (policy: HotelDraft["stayPolicy"]) => HotelDraft["stayPolicy"],
  ) => {
    setHotels(current => {
      const updated = current.map((hotel, currentIndex) => {
        if (currentIndex !== index) {
          return hotel;
        }

        return {
          ...hotel,
          stayPolicy: updater(hotel.stayPolicy),
        };
      });

      if (!samePolicyAcrossHotels) {
        return updated;
      }

      const sharedPolicy = cloneHotelStayPolicy(updated[index]?.stayPolicy || updated[0].stayPolicy);
      return updated.map(hotel => ({
        ...hotel,
        stayPolicy: cloneHotelStayPolicy(sharedPolicy),
      }));
    });
  };

  const addHotel = () => {
    setAllowOverflowHotels(true);
    setHotels(current =>
      syncPrimaryHotel([
        ...current,
        {
          ...createHotelDraft(`Overflow Hotel ${current.length + 1}`, false, watchStartDate, watchEndDate),
          stayPolicy:
            samePolicyAcrossHotels && current[0]
              ? cloneHotelStayPolicy(current[0].stayPolicy)
              : createDefaultHotelStayPolicy(watchStartDate, watchEndDate),
        },
      ]),
    );
  };

  const removeHotel = (index: number) => {
    setHotels(current => syncPrimaryHotel(current.filter((_, currentIndex) => currentIndex !== index)));
  };

  const setPrimaryHotel = (index: number) => {
    setHotels(current =>
      current.map((hotel, currentIndex) => ({
        ...hotel,
        isPrimary: currentIndex === index,
      })),
    );
  };

  const addHotelRoomType = (hotelIndex: number) => {
    updateHotel(hotelIndex, hotel => ({
      ...hotel,
      roomTypes: [...hotel.roomTypes, createProductDraft("room")],
    }));
  };

  const updateHotelRoomType = (
    hotelIndex: number,
    roomIndex: number,
    field: keyof ProductDraft,
    value: string | number | null,
  ) => {
    updateHotel(hotelIndex, hotel => ({
      ...hotel,
      roomTypes: hotel.roomTypes.map((roomType, currentIndex) => {
        if (currentIndex !== roomIndex) {
          return roomType;
        }

        if (field === "price") {
          return {
            ...roomType,
            price: Number(value || 0),
          };
        }

        if (field === "capacity") {
          return {
            ...roomType,
            capacity: value === "" || value === null ? null : Number(value),
          };
        }

        return {
          ...roomType,
          [field]: value,
        };
      }),
    }));
  };

  const removeHotelRoomType = (hotelIndex: number, roomIndex: number) => {
    updateHotel(hotelIndex, hotel => ({
      ...hotel,
      roomTypes: hotel.roomTypes.filter((_, currentIndex) => currentIndex !== roomIndex),
    }));
  };

  const reorderHotelRoomTypes = (hotelIndex: number, event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    updateHotel(hotelIndex, (hotel) => {
      const oldIndex = hotel.roomTypes.findIndex((roomType) => roomType.id === active.id);
      const newIndex = hotel.roomTypes.findIndex((roomType) => roomType.id === over.id);

      if (oldIndex < 0 || newIndex < 0) {
        return hotel;
      }

      return {
        ...hotel,
        roomTypes: arrayMove(hotel.roomTypes, oldIndex, newIndex),
      };
    });
  };

  const buildPayload = (formValues: AdminCreateEventInput): AdminCreateEventInput => {
    const trimmedTickets = ticketProducts.map((product, index) => ({
      id: product.id,
      name: product.name.trim(),
      description: product.description.trim() || null,
      price: product.price,
      type: "TICKET" as const,
      capacity: product.capacity,
      order: index,
    }));
    const trimmedAddons = addonProducts.map((product, index) => ({
      id: product.id,
      name: product.name.trim(),
      description: product.description.trim() || null,
      price: product.price,
      type: "ADDON" as const,
      capacity: product.capacity,
      order: trimmedTickets.length + index,
    }));

    const sharedPolicy = samePolicyAcrossHotels && hotels.length > 0 ? cloneHotelStayPolicy(hotels[0].stayPolicy) : null;
    let orderCursor = trimmedTickets.length + trimmedAddons.length;

    const accommodationProducts = hotels.flatMap(hotel =>
      hotel.roomTypes.map(roomType => ({
        id: roomType.id,
        name: roomType.name.trim(),
        description: roomType.description.trim() || null,
        price: roomType.price,
        type: "ACCOMMODATION" as const,
        capacity: roomType.capacity,
        order: orderCursor++,
      })),
    );

    return {
      ...formValues,
      products: [...trimmedTickets, ...trimmedAddons, ...accommodationProducts],
      stayPolicy: {
        version: 2,
        mainLocationIsAccommodation,
        allowOverflowHotels,
        samePolicyAcrossHotels,
        hotels: syncPrimaryHotel(hotels).map(hotel => ({
          id: hotel.id,
          name: hotel.name.trim(),
          isPrimary: hotel.isPrimary,
          roomTypeProductIds: hotel.roomTypes.map(roomType => roomType.id),
          stayPolicy: sharedPolicy ? cloneHotelStayPolicy(sharedPolicy) : cloneHotelStayPolicy(hotel.stayPolicy),
        })),
      },
    };
  };

  const onFormSubmit = async (formValues: AdminCreateEventInput) => {
    try {
      setError(null);

      if ((mainLocationIsAccommodation || allowOverflowHotels) && hotels.length === 0) {
        setError("Add at least one hotel when accommodation is enabled.");
        return;
      }

      const invalidHotel = hotels.find(hotel => hotel.roomTypes.length === 0 || !hotel.name.trim());
      if (invalidHotel) {
        setError("Each hotel needs a name and at least one room type.");
        return;
      }

      const payload = buildPayload(formValues);
      const parsed = adminCreateEventSchema.safeParse(payload);

      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message || "Please correct the highlighted fields before saving.");
        return;
      }

      await onSubmit(parsed.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    }
  };

  const renderHotelPolicyEditor = (hotel: HotelDraft, hotelIndex: number) => (
    <Stack spacing={3}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <TextField
            fullWidth
            type="date"
            label="Check-in"
            InputLabelProps={{ shrink: true }}
            value={formatDateForInput(hotel.stayPolicy.main.checkIn as Date | string | undefined, "date")}
            onChange={event =>
              updateHotelPolicy(hotelIndex, policy => ({
                ...policy,
                main: {
                  ...policy.main,
                  checkIn: event.target.value ? new Date(event.target.value) : policy.main.checkIn,
                },
              }))
            }
          />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <TextField
            fullWidth
            type="date"
            label="Check-out"
            InputLabelProps={{ shrink: true }}
            value={formatDateForInput(hotel.stayPolicy.main.checkOut as Date | string | undefined, "date")}
            onChange={event =>
              updateHotelPolicy(hotelIndex, policy => ({
                ...policy,
                main: {
                  ...policy.main,
                  checkOut: event.target.value ? new Date(event.target.value) : policy.main.checkOut,
                },
              }))
            }
          />
        </Grid>
      </Grid>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={2}>
          <FormControlLabel
            control={
              <Checkbox
                checked={hotel.stayPolicy.earlyArrival.enabled}
                onChange={event =>
                  updateHotelPolicy(hotelIndex, policy => ({
                    ...policy,
                    earlyArrival: {
                      ...policy.earlyArrival,
                      enabled: event.target.checked,
                    },
                  }))
                }
              />
            }
            label="Offer early arrival"
          />

          {hotel.stayPolicy.earlyArrival.enabled && (
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 4 }}>
                <TextField
                  fullWidth
                  type="date"
                  label="Available From"
                  InputLabelProps={{ shrink: true }}
                  value={formatDateForInput(hotel.stayPolicy.earlyArrival.from as Date | string | undefined, "date")}
                  onChange={event =>
                    updateHotelPolicy(hotelIndex, policy => ({
                      ...policy,
                      earlyArrival: {
                        ...policy.earlyArrival,
                        from: event.target.value ? new Date(event.target.value) : undefined,
                      },
                    }))
                  }
                />
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <TextField
                  fullWidth
                  select
                  label="Fee Mode"
                  value={hotel.stayPolicy.earlyArrival.pricingMode}
                  onChange={event =>
                    updateHotelPolicy(hotelIndex, policy => ({
                      ...policy,
                      earlyArrival: {
                        ...policy.earlyArrival,
                        pricingMode: event.target.value as "AUTO" | "CUSTOM",
                      },
                    }))
                  }
                >
                  <MenuItem value="AUTO">Use selected room price</MenuItem>
                  <MenuItem value="CUSTOM">Custom fee</MenuItem>
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <TextField
                  fullWidth
                  type="number"
                  label="Custom Fee"
                  disabled={hotel.stayPolicy.earlyArrival.pricingMode !== "CUSTOM"}
                  value={hotel.stayPolicy.earlyArrival.feePerNight ?? ""}
                  onChange={event =>
                    updateHotelPolicy(hotelIndex, policy => ({
                      ...policy,
                      earlyArrival: {
                        ...policy.earlyArrival,
                        feePerNight: event.target.value ? Number(event.target.value) : undefined,
                      },
                    }))
                  }
                />
              </Grid>
            </Grid>
          )}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={2}>
          <FormControlLabel
            control={
              <Checkbox
                checked={hotel.stayPolicy.lateDeparture.enabled}
                onChange={event =>
                  updateHotelPolicy(hotelIndex, policy => ({
                    ...policy,
                    lateDeparture: {
                      ...policy.lateDeparture,
                      enabled: event.target.checked,
                    },
                  }))
                }
              />
            }
            label="Offer late departure"
          />

          {hotel.stayPolicy.lateDeparture.enabled && (
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 4 }}>
                <TextField
                  fullWidth
                  type="date"
                  label="Available Until"
                  InputLabelProps={{ shrink: true }}
                  value={formatDateForInput(hotel.stayPolicy.lateDeparture.until as Date | string | undefined, "date")}
                  onChange={event =>
                    updateHotelPolicy(hotelIndex, policy => ({
                      ...policy,
                      lateDeparture: {
                        ...policy.lateDeparture,
                        until: event.target.value ? new Date(event.target.value) : undefined,
                      },
                    }))
                  }
                />
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <TextField
                  fullWidth
                  select
                  label="Fee Mode"
                  value={hotel.stayPolicy.lateDeparture.pricingMode}
                  onChange={event =>
                    updateHotelPolicy(hotelIndex, policy => ({
                      ...policy,
                      lateDeparture: {
                        ...policy.lateDeparture,
                        pricingMode: event.target.value as "AUTO" | "CUSTOM",
                      },
                    }))
                  }
                >
                  <MenuItem value="AUTO">Use selected room price</MenuItem>
                  <MenuItem value="CUSTOM">Custom fee</MenuItem>
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <TextField
                  fullWidth
                  type="number"
                  label="Custom Fee"
                  disabled={hotel.stayPolicy.lateDeparture.pricingMode !== "CUSTOM"}
                  value={hotel.stayPolicy.lateDeparture.feePerNight ?? ""}
                  onChange={event =>
                    updateHotelPolicy(hotelIndex, policy => ({
                      ...policy,
                      lateDeparture: {
                        ...policy.lateDeparture,
                        feePerNight: event.target.value ? Number(event.target.value) : undefined,
                      },
                    }))
                  }
                />
              </Grid>
            </Grid>
          )}
        </Stack>
      </Paper>
    </Stack>
  );

  return (
    <Box component="form" onSubmit={event => { void handleSubmit(onFormSubmit, invalid => {
      setError("Please correct the highlighted fields before saving.");
      const tab = invalid.location ? 1 : invalid.pageDesign ? 5 : invalid.customFields ? 3 : invalid.schedule ? 4 : 0;
      if (tab === 3 || tab === 4) setAdvanced(true);
      setTabValue(tab);
    })(event); }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">{initialData?.id ? "Edit Event" : "Create New Event"}</Typography>
        <Button
          type="submit"
          variant="contained"
          startIcon={externalLoading || isSubmitting ? <CircularProgress size={20} color="inherit" /> : <Save />}
          disabled={externalLoading || uploading || isSubmitting}
        >
          {initialData?.id ? "Update Event" : "Create Event"}
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      {!isValid && isSubmitting && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Please correct the errors in the form before submitting.
        </Alert>
      )}

      <FormControlLabel control={<Switch checked={advanced} onChange={event => { setAdvanced(event.target.checked); setTabValue(0); }} />} label="Advanced settings, tickets and additional features" />
      {!advanced && <Alert severity="info" sx={{ mb: 2 }}>Create a simple event with basic details and a location. No ticket, price or payment provider is required.</Alert>}
      <Paper sx={{ mb: 3 }}>
        <Tabs value={tabValue} onChange={handleTabChange} variant="scrollable" scrollButtons="auto">
          <Tab
            label={
              <Stack direction="row" alignItems="center" gap={1}>
                General Info
                {hasTabError(0) && <ErrorIcon color="error" fontSize="small" />}
              </Stack>
            }
          />
          <Tab
            label={
              <Stack direction="row" alignItems="center" gap={1}>
                Location
                {hasTabError(1) && <ErrorIcon color="error" fontSize="small" />}
              </Stack>
            }
          />
          <Tab sx={{ display: advanced ? undefined : "none" }}
            label={
              <Stack direction="row" alignItems="center" gap={1}>
                Products
                {hasTabError(2) && <ErrorIcon color="error" fontSize="small" />}
              </Stack>
            }
          />
          <Tab sx={{ display: advanced ? undefined : "none" }}
            label={
              <Stack direction="row" alignItems="center" gap={1}>
                Custom Fields
                {hasTabError(3) && <ErrorIcon color="error" fontSize="small" />}
              </Stack>
            }
          />
          <Tab sx={{ display: advanced ? undefined : "none" }}
            label={
              <Stack direction="row" alignItems="center" gap={1}>
                Schedule
                {hasTabError(4) && <ErrorIcon color="error" fontSize="small" />}
              </Stack>
            }
          />
          <Tab label="Page designer" />
        </Tabs>

        <Box sx={{ p: 3 }}>
          {tabValue === 0 && (
            <Stack spacing={3}>
              <Grid container spacing={2}>
                <Grid size={{ xs: 12, md: 8 }}>
                  <TextField
                    fullWidth
                    label="Event Name"
                    {...register("name")}
                    error={!!errors.name}
                    helperText={errors.name?.message}
                  />
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                  <TextField
                    fullWidth
                    select
                    label="Status"
                    {...register("status")}
                    defaultValue={initialData?.status || "DRAFT"}
                  >
                    <MenuItem value="DRAFT">Draft</MenuItem>
                    <MenuItem value="PUBLISHED">Published</MenuItem>
                    <MenuItem value="CANCELLED">Cancelled</MenuItem>
                  </TextField>
                </Grid>
              </Grid>

              <TextField
                fullWidth
                multiline
                rows={4}
                label="Description"
                {...register("description")}
                error={!!errors.description}
                helperText={errors.description?.message}
              />

              <Grid container spacing={2}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Controller
                    control={control}
                    name="startDate"
                    render={({ field }) => (
                      <TextField
                        fullWidth
                        type="datetime-local"
                        label="Start Date"
                        InputLabelProps={{ shrink: true }}
                        value={formatDateForInput(field.value as Date | string | undefined, "datetime-local")}
                        onChange={event => field.onChange(event.target.value ? new Date(event.target.value) : undefined)}
                        error={!!errors.startDate}
                        helperText={errors.startDate?.message}
                      />
                    )}
                  />
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Controller
                    control={control}
                    name="endDate"
                    render={({ field }) => (
                      <TextField
                        fullWidth
                        type="datetime-local"
                        label="End Date"
                        InputLabelProps={{ shrink: true }}
                        value={formatDateForInput(field.value as Date | string | undefined, "datetime-local")}
                        onChange={event => field.onChange(event.target.value ? new Date(event.target.value) : undefined)}
                        error={!!errors.endDate}
                        helperText={errors.endDate?.message}
                      />
                    )}
                  />
                </Grid>
              </Grid>

              <Stack spacing={3} sx={{ display: advanced ? undefined : "none" }}>
              <Divider />
              <Typography variant="h6">Publishing & Registration</Typography>

              <Grid container spacing={2}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Controller
                    control={control}
                    name="publishAt"
                    render={({ field }) => (
                      <TextField
                        fullWidth
                        type="datetime-local"
                        label="Auto-Publish At"
                        helperText="Schedule when this event becomes visible to everyone."
                        InputLabelProps={{ shrink: true }}
                        value={formatDateForInput(field.value as Date | string | undefined, "datetime-local")}
                        onChange={event => field.onChange(event.target.value ? new Date(event.target.value) : null)}
                        error={!!errors.publishAt}
                      />
                    )}
                  />
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Controller
                    control={control}
                    name="registrationOpensAt"
                    render={({ field }) => (
                      <TextField
                        fullWidth
                        type="datetime-local"
                        label="Registration Opens At"
                        helperText="When users can start creating registrations."
                        InputLabelProps={{ shrink: true }}
                        value={formatDateForInput(field.value as Date | string | undefined, "datetime-local")}
                        onChange={event => field.onChange(event.target.value ? new Date(event.target.value) : null)}
                        error={!!errors.registrationOpensAt}
                      />
                    )}
                  />
                </Grid>
              </Grid>

              <Grid container spacing={2}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <TextField
                    fullWidth
                    type="number"
                    label="Registration Limit"
                    placeholder="Unlimited"
                    {...register("maxRegistrations", { setValueAs: value => value === "" || value == null ? null : Number(value) })}
                    error={!!errors.maxRegistrations}
                    helperText={errors.maxRegistrations?.message || "Max number of participants."}
                  />
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Controller
                    control={control}
                    name="paymentDeadline"
                    render={({ field }) => (
                      <TextField
                        fullWidth
                        type="datetime-local"
                        label="Payment Deadline"
                        helperText="Final deadline for all payments."
                        InputLabelProps={{ shrink: true }}
                        value={formatDateForInput(field.value as Date | string | undefined, "datetime-local")}
                        onChange={event => field.onChange(event.target.value ? new Date(event.target.value) : null)}
                        error={!!errors.paymentDeadline}
                      />
                    )}
                  />
                </Grid>
              </Grid>

              <Box>
                <FormControlLabel
                  control={
                    <Controller
                      name="requiresHotel"
                      control={control}
                      render={({ field }) => (
                        <Switch checked={field.value} onChange={event => field.onChange(event.target.checked)} />
                      )}
                    />
                  }
                  label="Require hotel selection during registration"
                />
                <Typography variant="caption" display="block" color="text.secondary">
                  If enabled, attendees must choose one of the configured hotel room types.
                </Typography>
              </Box>

              <Box>
                <FormControlLabel
                  control={
                    <Controller
                      name="requireApproval"
                      control={control}
                      render={({ field }) => (
                        <Switch checked={field.value} onChange={event => field.onChange(event.target.checked)} />
                      )}
                    />
                  }
                  label="Require admin approval before payment"
                />
                <Typography variant="caption" display="block" color="text.secondary">
                  If enabled, attendees can submit registration but payment remains locked until an admin approves it.
                </Typography>
              </Box>

              <Box>
                <FormControlLabel
                  control={
                    <Controller
                      name="scanOnce"
                      control={control}
                      render={({ field }) => (
                        <Switch checked={field.value} onChange={event => field.onChange(event.target.checked)} />
                      )}
                    />
                  }
                  label="Expire tickets after first check-in scan"
                />
                <Typography variant="caption" display="block" color="text.secondary">
                  If enabled, repeat scans of a checked-in ticket will be rejected at the door.
                </Typography>
                <Typography variant="caption" display="block" color="text.secondary">
                  Regardless of this setting, the UI will always show how many times a ticket has been scanned.
                </Typography>
              </Box>

              <Divider />
              <Typography variant="h6">Community</Typography>

              <Box>
                <FormControlLabel
                  control={
                    <Controller
                      name="communityEnabled"
                      control={control}
                      render={({ field }) => (
                        <Switch checked={field.value} onChange={event => field.onChange(event.target.checked)} />
                      )}
                    />
                  }
                  label="Enable community feed"
                />
                <Typography variant="caption" display="block" color="text.secondary">
                  Adds a community section to the event page where attendees and organizers can post updates.
                </Typography>
              </Box>

              <Grid container spacing={2}>
                <Grid size={{ xs: 12, md: 4 }}>
                  <FormControlLabel
                    control={
                      <Controller
                        name="communityModerated"
                        control={control}
                        render={({ field }) => (
                          <Switch
                            checked={field.value}
                            disabled={!watchCommunityEnabled}
                            onChange={event => field.onChange(event.target.checked)}
                          />
                        )}
                      />
                    }
                    label="Moderate new posts"
                  />
                  <Typography variant="caption" display="block" color="text.secondary">
                    New posts stay pending until approved by a future moderation workflow.
                  </Typography>
                  <FormControlLabel
                    sx={{ mt: 1 }}
                    control={
                      <Controller
                        name="communityModerateComments"
                        control={control}
                        render={({ field }) => (
                          <Switch
                            checked={field.value}
                            disabled={!watchCommunityEnabled || !watchCommunityModerated}
                            onChange={event => field.onChange(event.target.checked)}
                          />
                        )}
                      />
                    }
                    label="Also moderate comments"
                  />
                  <Typography variant="caption" display="block" color="text.secondary">
                    Requires post moderation to be enabled. Comments will also need approval before appearing.
                  </Typography>
                </Grid>

                <Grid size={{ xs: 12, md: 4 }}>
                  <FormControlLabel
                    control={
                      <Controller
                        name="communityAttendeesOnly"
                        control={control}
                        render={({ field }) => (
                          <Switch
                            checked={field.value}
                            disabled={!watchCommunityEnabled}
                            onChange={event => field.onChange(event.target.checked)}
                          />
                        )}
                      />
                    }
                    label="Attendees only"
                  />
                  <Typography variant="caption" display="block" color="text.secondary">
                    Restricts posting and reactions to active attendees, event owners, and admins.
                  </Typography>
                </Grid>

                <Grid size={{ xs: 12, md: 4 }}>
                  <FormControlLabel
                    control={
                      <Controller
                        name="communityOpenAfterEnd"
                        control={control}
                        render={({ field }) => (
                          <Switch
                            checked={field.value}
                            disabled={!watchCommunityEnabled}
                            onChange={event => field.onChange(event.target.checked)}
                          />
                        )}
                      />
                    }
                    label="Open after event ends"
                  />
                  <Typography variant="caption" display="block" color="text.secondary">
                    Allows new posts and reactions after the event end date.
                  </Typography>
                </Grid>
              </Grid>

              </Stack>
              <Box>
                <Typography variant="subtitle2" gutterBottom>Event Banner</Typography>
                {watchImageUrl && (
                  <Box sx={{ mb: 2, position: "relative", width: "100%", maxWidth: 480, aspectRatio: "1200 / 630" }}>
                    <Image
                      src={watchImageUrl}
                      alt="Preview"
                      fill
                      sizes="(min-width: 900px) 480px, 100vw"
                      style={{ objectFit: "cover", borderRadius: 8 }}
                    />
                  </Box>
                )}
                <Button variant="outlined" component="label" startIcon={<CloudUpload />} disabled={uploading}>
                  {uploading ? "Uploading..." : "Upload Image"}
                  <input type="file" hidden accept="image/*" onChange={handleFileSelect} />
                </Button>
              </Box>
            </Stack>
          )}

          {tabValue === 1 && (
            <Stack spacing={3}>
              <TextField
                fullWidth
                label="Venue Name"
                {...register("location.name")}
                error={!!errors.location?.name}
                helperText={errors.location?.name?.message}
              />
              <TextField
                fullWidth
                label="Address"
                {...register("location.address")}
                error={!!errors.location?.address}
                helperText={errors.location?.address?.message}
              />
              <Grid container spacing={2}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <TextField
                    fullWidth
                    label="City"
                    {...register("location.city")}
                    error={!!errors.location?.city}
                    helperText={errors.location?.city?.message}
                  />
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <TextField
                    fullWidth
                    label="Postal Code"
                    {...register("location.postalCode")}
                    error={!!errors.location?.postalCode}
                    helperText={errors.location?.postalCode?.message}
                  />
                </Grid>
              </Grid>
              <Grid container spacing={2}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <TextField
                    fullWidth
                    label="State/Region"
                    {...register("location.state")}
                    error={!!errors.location?.state}
                    helperText={errors.location?.state?.message}
                  />
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <TextField
                    fullWidth
                    label="Country"
                    {...register("location.country")}
                    error={!!errors.location?.country}
                    helperText={errors.location?.country?.message}
                  />
                </Grid>
              </Grid>

              <Stack spacing={3} sx={{ display: advanced ? undefined : "none" }}>
              <Divider />
              <Typography variant="h6">Accommodation Setup</Typography>

              <Stack spacing={1}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={mainLocationIsAccommodation}
                      onChange={event => {
                        const checked = event.target.checked;
                        setMainLocationIsAccommodation(checked);
                        ensureHotelsVisible(checked, allowOverflowHotels);
                      }}
                    />
                  }
                  label="Main location is an accommodation"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={allowOverflowHotels}
                      onChange={event => {
                        const checked = event.target.checked;
                        setAllowOverflowHotels(checked);
                        ensureHotelsVisible(mainLocationIsAccommodation, checked);
                      }}
                    />
                  }
                  label="Add overflow hotels"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={samePolicyAcrossHotels}
                      disabled={hotels.length < 2}
                      onChange={event => {
                        const checked = event.target.checked;
                        setSamePolicyAcrossHotels(checked);
                        if (checked && hotels.length > 1) {
                          const sharedPolicy = cloneHotelStayPolicy(hotels[0].stayPolicy);
                          setHotels(current =>
                            current.map(hotel => ({
                              ...hotel,
                              stayPolicy: cloneHotelStayPolicy(sharedPolicy),
                            })),
                          );
                        }
                      }}
                    />
                  }
                  label="Stay policy is consistent through main and all overflow hotels"
                />
              </Stack>

              {(mainLocationIsAccommodation || allowOverflowHotels) && (
                <Stack spacing={3}>
                  <Alert severity="info">
                    Room types live here now. Each hotel can define its own room types, availability, and early/late pricing.
                  </Alert>

                  {hotels.map((hotel, hotelIndex) => (
                    <Paper key={hotel.id} variant="outlined" sx={{ p: 3 }}>
                      <Stack spacing={3}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center">
                          <Typography variant="h6">{hotel.isPrimary ? "Primary Hotel" : "Overflow Hotel"}</Typography>
                          <Stack direction="row" spacing={1}>
                            <FormControlLabel
                              control={
                                <Checkbox
                                  checked={hotel.isPrimary}
                                  onChange={() => setPrimaryHotel(hotelIndex)}
                                />
                              }
                              label="Primary"
                            />
                            {hotels.length > 1 && (
                              <IconButton color="error" onClick={() => removeHotel(hotelIndex)}>
                                <Delete />
                              </IconButton>
                            )}
                          </Stack>
                        </Stack>

                        <TextField
                          fullWidth
                          label="Hotel Name"
                          value={hotel.name}
                          onChange={event => updateHotel(hotelIndex, current => ({ ...current, name: event.target.value }))}
                        />

                        <Divider />
                        <Stack spacing={2}>
                          <Stack direction="row" justifyContent="space-between" alignItems="center">
                            <Typography variant="subtitle1">Room Types</Typography>
                            <Button startIcon={<Add />} onClick={() => addHotelRoomType(hotelIndex)}>
                              Add Room Type
                            </Button>
                          </Stack>
                          <Typography variant="caption" color="text.secondary">
                            Drag the handle to control the room order shown during registration.
                          </Typography>
                          <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragEnd={(event) => reorderHotelRoomTypes(hotelIndex, event)}
                          >
                            <SortableContext
                              items={hotel.roomTypes.map((roomType) => roomType.id)}
                              strategy={verticalListSortingStrategy}
                            >
                              <Stack spacing={2}>
                                {hotel.roomTypes.map((roomType, roomIndex) => (
                                  <SortableProductItem
                                    key={roomType.id}
                                    id={roomType.id}
                                    product={roomType}
                                    nameLabel="Room Type"
                                    priceLabel="Cost"
                                    onChange={(field, value) => updateHotelRoomType(hotelIndex, roomIndex, field, value)}
                                    onRemove={() => removeHotelRoomType(hotelIndex, roomIndex)}
                                  />
                                ))}
                              </Stack>
                            </SortableContext>
                          </DndContext>
                        </Stack>

                        <Divider />
                        <Typography variant="subtitle1">Stay Policy</Typography>
                        {renderHotelPolicyEditor(hotel, hotelIndex)}
                      </Stack>
                    </Paper>
                  ))}

                  <Button variant="outlined" startIcon={<Add />} onClick={addHotel}>
                    Add Another Hotel
                  </Button>
                </Stack>
              )}

              {!mainLocationIsAccommodation && !allowOverflowHotels && (
                <Alert severity="info">
                  Enable one of the accommodation switches above if this event needs hotel or overflow room options.
                </Alert>
              )}
              </Stack>
            </Stack>
          )}

          {tabValue === 2 && (
            <Stack spacing={4}>
              <Alert severity="info">
                Tickets are optional. Leave this empty for an event without booking. Tickets can be added later. Room inventory is managed in the Location tab.
              </Alert>

              <Stack spacing={2}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="h6">Ticket Types</Typography>
                  <Button startIcon={<Add />} onClick={() => setTicketProducts(current => [...current, createProductDraft("ticket")])}>
                    Add Ticket
                  </Button>
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  Drag tickets to set the order shown in the registration badge step.
                </Typography>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={(event) => reorderProducts(setTicketProducts, event)}
                >
                  <SortableContext
                    items={ticketProducts.map((product) => product.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <Stack spacing={2}>
                      {ticketProducts.map((product, index) => (
                        <SortableProductItem
                          key={product.id}
                          id={product.id}
                          product={product}
                          nameLabel="Ticket Name"
                          onChange={(field, value) => updateProducts(setTicketProducts, index, field, value)}
                          onRemove={() =>
                            setTicketProducts((current) => current.filter((_, currentIndex) => currentIndex !== index))
                          }
                        />
                      ))}
                    </Stack>
                  </SortableContext>
                </DndContext>

                {ticketProducts.length === 0 && (
                  <Alert severity="info">No ticket or booking is required. You can add tickets later.</Alert>
                )}
              </Stack>

              <Divider />

              <Stack spacing={2}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="h6">Add-ons</Typography>
                  <Button startIcon={<Add />} onClick={() => setAddonProducts(current => [...current, createProductDraft("addon")])}>
                    Add Add-on
                  </Button>
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  Drag add-ons to control the order shown in the extras step.
                </Typography>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={(event) => reorderProducts(setAddonProducts, event)}
                >
                  <SortableContext
                    items={addonProducts.map((product) => product.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <Stack spacing={2}>
                      {addonProducts.map((product, index) => (
                        <SortableProductItem
                          key={product.id}
                          id={product.id}
                          product={product}
                          nameLabel="Add-on Name"
                          onChange={(field, value) => updateProducts(setAddonProducts, index, field, value)}
                          onRemove={() =>
                            setAddonProducts((current) => current.filter((_, currentIndex) => currentIndex !== index))
                          }
                        />
                      ))}
                    </Stack>
                  </SortableContext>
                </DndContext>

                {addonProducts.length === 0 && (
                  <Alert severity="info">No add-ons configured yet.</Alert>
                )}
              </Stack>
            </Stack>
          )}

          {tabValue === 3 && (
            <Stack spacing={3}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="h6">Additional Registration Questions</Typography>
                <Button
                  startIcon={<Add />}
                  onClick={() =>
                    addCustomField({
                      id: Math.random().toString(36).substring(7),
                      label: "",
                      type: "text",
                      required: false,
                    })
                  }
                >
                  Add Field
                </Button>
              </Stack>

              {customFields.map((field, index) => {
                const customFieldType = watch(`customFields.${index}.type`) ?? "text";

                return (
                  <Paper key={field.id} variant="outlined" sx={{ p: 2, position: "relative" }}>
                    <IconButton
                      size="small"
                      color="error"
                      sx={{ position: "absolute", top: 8, right: 8 }}
                      onClick={() => removeCustomField(index)}
                    >
                      <Delete />
                    </IconButton>
                    <Grid container spacing={2}>
                      <Grid size={{ xs: 12, md: 5 }}>
                        <TextField
                          fullWidth
                          size="small"
                          label="Question Label"
                          {...register(`customFields.${index}.label` as const)}
                        />
                      </Grid>
                      <Grid size={{ xs: 12, md: 3 }}>
                        <Controller
                          control={control}
                          name={`customFields.${index}.type` as const}
                          render={({ field: controllerField }) => (
                            <TextField
                              fullWidth
                              size="small"
                              select
                              label="Input Type"
                              value={controllerField.value ?? "text"}
                              onChange={controllerField.onChange}
                              onBlur={controllerField.onBlur}
                              inputRef={controllerField.ref}
                              name={controllerField.name}
                            >
                              <MenuItem value="text">Text</MenuItem>
                              <MenuItem value="number">Number</MenuItem>
                              <MenuItem value="boolean">Checkbox</MenuItem>
                              <MenuItem value="select">Dropdown</MenuItem>
                            </TextField>
                          )}
                        />
                      </Grid>
                      <Grid size={{ xs: 12, md: 3 }}>
                        <FormControlLabel
                          control={<Switch {...register(`customFields.${index}.required` as const)} />}
                          label="Required"
                        />
                      </Grid>

                      {customFieldType === "select" && (
                        <Grid size={{ xs: 12 }}>
                          <Box sx={{ mt: 1, pl: 2, borderLeft: "2px solid", borderColor: "primary.light" }}>
                            <Typography variant="subtitle2" gutterBottom>Dropdown Options</Typography>
                            <Stack spacing={1}>
                              {(watch(`customFields.${index}.options`) || []).map((option: string, optionIndex: number) => (
                                // biome-ignore lint/suspicious/noArrayIndexKey: rows are plain controlled TextFields (no per-item local state), and a content-derived key here was the actual bug (remounted + lost focus on every keystroke)
                                <Stack key={`custom-field-option-${optionIndex}`} direction="row" spacing={1} alignItems="center">
                                  <TextField
                                    size="small"
                                    placeholder={`Option ${optionIndex + 1}`}
                                    value={option}
                                    onChange={event => {
                                      // eslint-disable-next-line react-hooks/incompatible-library -- react-hook-form watch() is intentional
                                      const currentOptions = [...(watch(`customFields.${index}.options`) || [])];
                                      currentOptions[optionIndex] = event.target.value;
                                      setValue(`customFields.${index}.options`, currentOptions);
                                    }}
                                  />
                                  <IconButton
                                    size="small"
                                    color="error"
                                    onClick={() => {
                                      const currentOptions = [...(watch(`customFields.${index}.options`) || [])];
                                      currentOptions.splice(optionIndex, 1);
                                      setValue(`customFields.${index}.options`, currentOptions);
                                    }}
                                  >
                                    <Delete fontSize="small" />
                                  </IconButton>
                                </Stack>
                              ))}
                              <Button
                                size="small"
                                startIcon={<Add />}
                                onClick={() => {
                                  const currentOptions = [...(watch(`customFields.${index}.options`) || [])];
                                  setValue(`customFields.${index}.options`, [...currentOptions, ""]);
                                }}
                                sx={{ alignSelf: "flex-start" }}
                              >
                                Add Option
                              </Button>
                            </Stack>
                          </Box>
                        </Grid>
                      )}
                    </Grid>
                  </Paper>
                );
              })}

              {customFields.length === 0 && (
                <Alert severity="info">No custom questions added yet.</Alert>
              )}
            </Stack>
          )}

          {tabValue === 4 && (
            <Stack spacing={3}>
              <Typography variant="h6">Schedule Builder</Typography>
              <Typography variant="body2" color="text.secondary">
                Click to add a session. Drag and drop to move sessions. Click an existing session to edit it.
              </Typography>

              <Controller
                control={control}
                name="schedule"
                render={({ field }) => (
                  <ScheduleCalendarBuilder
                    items={(field.value ?? []) as ScheduleItem[]}
                    onChange={newItems => field.onChange(newItems)}
                    eventStartDate={watchStartDate as Date | undefined}
                  />
                )}
              />
            </Stack>
          )}
          {tabValue === 5 && <Controller control={control} name="pageDesign" render={({ field }) => <EventPageEditor value={(field.value || normalizeEventPage({})) as EventPage} onChange={field.onChange} onUploadingChange={setUploading} eventId={initialData?.id} name={watch("name")} description={watch("description")} location={watch("location")} imageUrl={watchImageUrl} schedule={watch("schedule")} />} />}
        </Box>
      </Paper>

      {watchRequiresHotel && hotels.length === 0 && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          Hotel selection is required, but no hotel room types are configured yet.
        </Alert>
      )}

      <ImageCropper
        open={cropOpen}
        imageSrc={cropImageSrc}
        onCancel={() => {
          setCropOpen(false);
          setCropImageSrc(null);
        }}
        onCropComplete={handleCropComplete}
        aspect={1200 / 630}
      />
    </Box>
  );
}
