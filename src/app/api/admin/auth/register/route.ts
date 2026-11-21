/**
 * If no admin is found, this route will be enabled (most likely due to setup)
 */

import prisma from "@/lib/prisma/prisma";
import { verifyTurnstile } from "@/lib/auth/turnstile";
import { registerSchema, type registerType } from "@/types/schemas/auth";
import { type NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    if (!await verifyTurnstile(req.headers)) {
        return NextResponse.json({ error: "Security check failed or expired. Please retry." }, { status: 403 });
    }

    const adminUser = await prisma.user.findFirst({
        where: {
            isAdmin: true
        }
    });

    if (adminUser) {
        return NextResponse.json({ error: "Admin user already exists" }, { status: 400 });
    }



    let body: registerType;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const result = registerSchema.safeParse(body);
    if (!result.success) {
        return NextResponse.json({ error: "Invalid request data", issues: result.error.issues }, { status: 400 });
    }

    const { email, password, name } = result.data;

    // Create admin user with credential account
    // Prisma auto-generates: id (cuid), accountId (cuid), userId (from relation), createdAt, updatedAt
    await prisma.user.create({
        data: {
            email,
            name,
            isAdmin: true,
            emailVerified: true,
            accounts: {
                create: {
                    providerId: "credential",
                    password: password
                }
            },
        }
    });

    return NextResponse.json({ message: "Admin user created successfully" }, { status: 201 });
}
