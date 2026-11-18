import { z } from "zod";
import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/user/display-name";
import { optionalCountryCodeSchema } from "@/types/schemas/country";
import { optionalBirthDateSchema } from "@/types/schemas/birthdate";

// Define user validation schema
const userSchema = z.object({
  name: z.string().min(2).max(DISPLAY_NAME_MAX_LENGTH).optional(),
  email: z.email().optional(),
  password: z.string().min(8).optional(),
  profilePicture: z.url().nullable().optional(),
  country: optionalCountryCodeSchema,
  legalName: z.string().max(200).nullable().optional(),
  addressLine1: z.string().max(200).nullable().optional(),
  addressLine2: z.string().max(200).nullable().optional(),
  addressCity: z.string().max(120).nullable().optional(),
  addressState: z.string().max(120).nullable().optional(),
  addressPostalCode: z.string().max(40).nullable().optional(),
  addressCountry: optionalCountryCodeSchema,
  bio: z.string().max(500).optional(),
  dateOfBirth: optionalBirthDateSchema,
  pronouns: z.string().max(50).optional(),
  showAge: z.boolean().optional(),
  showConventions: z.boolean().optional(),
  showExactBirthdate: z.boolean().optional(),
  socialLinks: z.object({
    telegram: z.string().max(100).optional(),
    twitter: z.string().max(100).optional(),
    instagram: z.string().max(100).optional(),
  }).optional(),
});

const createUserSchema = userSchema.extend({
  name: z.string().min(2).max(DISPLAY_NAME_MAX_LENGTH),
  email: z.email(),
  password: z.string().min(8),
}).strict();


export { userSchema, createUserSchema };
