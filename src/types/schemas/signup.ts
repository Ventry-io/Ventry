import { z } from "zod";
import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/user/display-name";
import { optionalCountryCodeSchema } from "@/types/schemas/country";

export const usernameSchema = z.string().trim()
  .min(3, "Use at least 3 characters")
  .max(DISPLAY_NAME_MAX_LENGTH, `Use at most ${DISPLAY_NAME_MAX_LENGTH} characters`)
  .regex(/^[\p{L}\p{N}_.-]+$/u, "Use letters, numbers, dots, hyphens or underscores");

// Guards the actual write boundary (better-auth's /sign-up/email), since
// client-side schemas only validate whichever form happened to submit the
// request and can be bypassed entirely.
export const signUpAdditionalFieldsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(DISPLAY_NAME_MAX_LENGTH, `Name must be ${DISPLAY_NAME_MAX_LENGTH} characters or fewer`),
  legalName: z.string().trim().max(200, "Legal name is too long").nullable().optional(),
  addressLine1: z.string().trim().max(200, "Address is too long").nullable().optional(),
  addressLine2: z.string().trim().max(200, "Address is too long").nullable().optional(),
  addressCity: z.string().trim().max(120, "City is too long").nullable().optional(),
  addressState: z.string().trim().max(120, "State is too long").nullable().optional(),
  addressPostalCode: z.string().trim().max(40, "Postal code is too long").nullable().optional(),
  addressCountry: optionalCountryCodeSchema,
});
