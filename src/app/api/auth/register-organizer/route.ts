import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma/prisma";
import { auth } from "@/app/api/auth/auth";
import { AdminType } from "@/generated/prisma";
import { usernameSchema } from "@/types/schemas/signup";
import { requiredCountryCodeSchema } from "@/types/schemas/country";
import { getCallbackPath } from "@/lib/auth/callback";

const schema = z
  .object({
    email: z.string().trim().email(),
    callbackURL: z.string().max(2048).optional(),
    username: usernameSchema,
    password: z
      .string()
      .min(8)
      .regex(/[A-Z]/)
      .regex(/[0-9]/),
    legalName: z.string().trim().min(2).max(200),
    addressLine1: z.string().trim().min(2).max(200),
    addressLine2: z.string().trim().max(200).optional().nullable(),
    addressCity: z.string().trim().min(2).max(120),
    addressState: z.string().trim().max(120).optional().nullable(),
    addressPostalCode: z.string().trim().min(2).max(40),
    addressCountry: requiredCountryCodeSchema,
    organizerType: z.enum(["INDIVIDUAL", "ORGANIZATION"]),
    orgName: z.string().trim().min(2).max(100).optional(),
    orgSlug: z
      .string()
      .trim()
      .min(2)
      .max(50)
      .regex(/^[a-z0-9-]+$/)
      .optional(),
    orgDescription: z.string().trim().max(500).optional().nullable(),
  })
  .refine(
    (d) => d.organizerType !== "ORGANIZATION" || (d.orgName && d.orgSlug),
    { message: "Organization name and slug are required for organization accounts" },
  );

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const data = parsed.data;

  // Email uniqueness check (better-auth doesn't surface the exact error when
  // requireEmailVerification is enabled — mirrors what RegisterForm does)
  const existingUser = await prisma.user.findUnique({
    where: { email: data.email },
    select: { id: true },
  });
  if (existingUser) {
    return NextResponse.json(
      { error: "An account with this email already exists." },
      { status: 409 },
    );
  }

  // Org slug uniqueness check
  if (data.organizerType === "ORGANIZATION" && data.orgSlug) {
    const slugTaken = await prisma.adminOrganization.findUnique({
      where: { slug: data.orgSlug },
      select: { id: true },
    });
    if (slugTaken) {
      return NextResponse.json({ error: "Organization slug already taken" }, { status: 409 });
    }
  }

  // Create user account via better-auth (handles password hashing + email verification)
  const signUpResult = await (auth.api.signUpEmail as any)({
    body: {
      email: data.email,
      name: data.username,
      password: data.password,
      callbackURL: `/complete-profile?intent=organizer&callbackUrl=${encodeURIComponent(getCallbackPath(data.callbackURL))}`,
      legalName: data.legalName,
      addressLine1: data.addressLine1,
      addressLine2: data.addressLine2 ?? null,
      addressCity: data.addressCity,
      addressState: data.addressState ?? null,
      addressPostalCode: data.addressPostalCode,
      addressCountry: data.addressCountry,
    },
    headers: new Headers({ "content-type": "application/json" }),
  }) as { user?: { id: string } } | null;

  if (!signUpResult?.user?.id) {
    return NextResponse.json({ error: "Account creation failed" }, { status: 500 });
  }

  const userId = signUpResult.user.id;

  // Create admin profile + optionally organization in a single transaction
  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { isAdmin: true },
      });

      const admin = await tx.admin.create({
        data: {
          userId,
          type: data.organizerType === "INDIVIDUAL" ? AdminType.INDIVIDUAL : AdminType.ORGANIZATION,
        },
      });

      if (data.organizerType === "ORGANIZATION" && data.orgName && data.orgSlug) {
        await tx.adminOrganization.create({
          data: {
            name: data.orgName,
            slug: data.orgSlug,
            description: data.orgDescription ?? null,
            ownerId: admin.id,
            members: {
              create: { adminId: admin.id, permissions: [] },
            },
          },
        });
      }
    });
  } catch (error) {
    // The account and verification email already exist. Resume setup after
    // verification rather than asking the user to create the account again.
    console.error("Organizer setup deferred until email verification:", error);
    return NextResponse.json({ success: true, organizerSetupPending: true }, { status: 201 });
  }

  return NextResponse.json({ success: true }, { status: 201 });
}
