import { z } from "zod";
import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/user/display-name";
import { optionalCountryCodeSchema } from "@/types/schemas/country";
import { optionalBirthDateSchema } from "@/types/schemas/birthdate";

// Enhanced user schema with new profile fields
export const enhancedUserSchema = z.object({
  name: z.string().min(2).max(DISPLAY_NAME_MAX_LENGTH).optional(),
  email: z.email().optional(),
  bio: z.string().max(500).optional(),
  dateOfBirth: optionalBirthDateSchema,
  pronouns: z.string().max(50).optional(),
  legalName: z.string().max(200).optional().nullable(),
  addressLine1: z.string().max(200).optional().nullable(),
  addressLine2: z.string().max(200).optional().nullable(),
  addressCity: z.string().max(120).optional().nullable(),
  addressState: z.string().max(120).optional().nullable(),
  addressPostalCode: z.string().max(40).optional().nullable(),
  addressCountry: optionalCountryCodeSchema,
  profilePictures: z.array(z.object({
    id: z.string(),
    signedUrl: z.string().url().nullable(),
    storagePath: z.string().nullable(),
    isPrimary: z.boolean(),
    createdAt: z.date()
  })).optional(),
  // Privacy settings
  showAge: z.boolean().optional(),
  showConventions: z.boolean().optional(),
});

export const profileUpdateSchema = enhancedUserSchema.partial();

export type EnhancedUser = z.infer<typeof enhancedUserSchema> & {
  id: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

// GDPR data export type
export type UserDataExport = {
  profile: EnhancedUser;
  registrations?: Record<string, unknown>[];
  payments?: Record<string, unknown>[];
  events?: Record<string, unknown>[];
  exportedAt: string;
};
