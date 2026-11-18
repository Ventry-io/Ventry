import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma/prisma";
import { getSession } from "@/lib/auth/session";
import { AdminType } from "@/generated/prisma";
import { optionalCountryCodeSchema } from "@/types/schemas/country";
import { usernameSchema } from "@/types/schemas/signup";
import { importOAuthProfilePicture } from "@/lib/user/profilePicture";
import { isUsernameAvailable } from "@/lib/user/unique-name";
import { changeUsername } from "@/lib/user/change-username";

const schema = z
  .object({
    username: usernameSchema.optional(),
    importProfilePicture: z.boolean().optional(),
    legalName: z.string().trim().min(2).max(200).optional(),
    addressLine1: z.string().trim().min(2).max(200).optional(),
    addressLine2: z.string().trim().max(200).optional().nullable(),
    addressCity: z.string().trim().min(2).max(120).optional(),
    addressState: z.string().trim().max(120).optional().nullable(),
    addressPostalCode: z.string().trim().min(2).max(40).optional(),
    addressCountry: optionalCountryCodeSchema,
    path: z.enum(["ATTENDEE", "ORGANIZER"]),
    organizerType: z.enum(["INDIVIDUAL", "ORGANIZATION"]).optional(),
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
  .superRefine((data, ctx) => {
    if (data.path === "ORGANIZER") {
      for (const field of ["legalName", "addressLine1", "addressCity", "addressPostalCode", "addressCountry"] as const) {
        if (!data[field]) ctx.addIssue({ code: "custom", path: [field], message: "Required for organizers" });
      }
    }
  })
  .refine((d) => d.path !== "ORGANIZER" || !!d.organizerType, {
    message: "Organizer type is required",
  })
  .refine(
    (d) => d.organizerType !== "ORGANIZATION" || (d.orgName && d.orgSlug),
    { message: "Organization name and slug are required for organization accounts" },
  );

// POST: Choose a public profile after OAuth, add a check-in name when needed,
// add private booking details, or finish organizer setup.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
  const userId = session.user.id;

  if (data.organizerType === "ORGANIZATION" && data.orgSlug) {
    const slugTaken = await prisma.adminOrganization.findUnique({
      where: { slug: data.orgSlug },
      select: { id: true },
    });
    if (slugTaken) {
      return NextResponse.json({ error: "Organization slug already taken" }, { status: 409 });
    }
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true, image: true },
  });

  if (data.username && !(await isUsernameAvailable(data.username, userId))) {
    return NextResponse.json({ error: "Username already taken" }, { status: 409 });
  }

  if (data.username) {
    await changeUsername(userId, data.username);
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        legalName: data.legalName,
        addressLine1: data.addressLine1,
        addressLine2: data.addressLine2,
        addressCity: data.addressCity,
        addressState: data.addressState,
        addressPostalCode: data.addressPostalCode,
        addressCountry: data.addressCountry,
      },
    });

    if (data.path === "ORGANIZER") {
      const existingAdmin = await tx.admin.findUnique({ where: { userId } });

      await tx.user.update({ where: { id: userId }, data: { isAdmin: true } });

      const admin =
        existingAdmin ??
        (await tx.admin.create({
          data: {
            userId,
            type: data.organizerType === "INDIVIDUAL" ? AdminType.INDIVIDUAL : AdminType.ORGANIZATION,
          },
        }));

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
    }
  });

  let pictureImported = false;
  if (data.importProfilePicture && currentUser?.image) {
    try {
      await importOAuthProfilePicture(userId, currentUser.image);
      pictureImported = true;
    } catch (error) {
      // Non-fatal - onboarding must not fail just because the avatar
      // fetch/compression did. User can add a picture later from /profile.
      console.error("Failed to import OAuth profile picture:", error);
    }
  }

  return NextResponse.json({ success: true, pictureImported }, { status: 200 });
}
