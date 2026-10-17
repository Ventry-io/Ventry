import { type NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma/prisma";
import { getSession } from "@/lib/auth/session";

import { userSchema, createUserSchema } from "@/types/user";
import { hashPassword } from "@/lib/bcrypt";
import { checkPasswordStrength } from "@/lib/auth/password-strength";
import { z } from "zod";

// GET: Retrieve user(s)
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const userId = url.searchParams.get("userId");

    // If userId provided, return specific user
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
        id: true,
        name: true,
        email: true,
        country: true,
        legalName: true,
        addressLine1: true,
        addressLine2: true,
        addressCity: true,
        addressState: true,
        addressPostalCode: true,
        addressCountry: true,
        profilePictures: {
          orderBy: [
            { order: 'asc' },
            { isPrimary: 'desc' },
            { createdAt: 'desc' }
          ]
        },
        bio: true,
        dateOfBirth: true,
        pronouns: true,
        showAge: true,
        showExactBirthdate: true,
        showConventions: true,
        socialLinks: true,
        createdAt: true,
        updatedAt: true,
      }
      });

      if (!user) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      return NextResponse.json(user, { status: 200 });
    }

    // Return all users (with pagination)
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const limit = parseInt(url.searchParams.get("limit") || "10", 10);
    const skip = (page - 1) * limit;

    const users = await prisma.user.findMany({
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        email: true,
        country: true,
        legalName: true,
        profilePictures: {
          orderBy: [
            { order: 'asc' },
            { isPrimary: 'desc' },
            { createdAt: 'desc' }
          ]
        },
        createdAt: true,
        updatedAt: true,
      }
    });

    const total = await prisma.user.count();

    return NextResponse.json({
      users,
      meta: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    }, { status: 200 });
  } catch (error) {
    console.error("Error retrieving user(s):", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST: Create a new user
export async function POST(req: NextRequest) {
  try {
    if (!req.headers.get("content-type")?.includes("application/json")) {
      return NextResponse.json({ error: "Invalid content type" }, { status: 400 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = createUserSchema.safeParse(body);
    
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
    }

    // Check if email is already in use
    const existingUser = await prisma.user.findUnique({
      where: { email: parsed.data.email }
    });

    if (existingUser) {
      return NextResponse.json({ error: "Email is already in use" }, { status: 409 });
    }

    // Check password strength
    const { password } = parsed.data;
    // const userInputs = [email, name]; // Include user info to check for similarities
    const userInputs = Object.entries(parsed.data).filter(([key]) => !["password"].includes(key)).map(([, value]) => String(value));
    const strengthResult = checkPasswordStrength(password, userInputs, 2);
    
    if (!strengthResult.isStrong) {
      return NextResponse.json({ 
        error: "Password is too weak", 
        feedback: strengthResult.feedback,
        strength: strengthResult.strengthText,
        score: strengthResult.score
      }, { status: 400 });
    }

    // Hash the password before storing it
    const hashedPassword = await hashPassword(parsed.data.password);

    // Create new user with credential account
    // Prisma auto-generates accountId with cuid(2)
    const newUser = await prisma.user.create({
      data: { 
        name: parsed.data.name,
        email: parsed.data.email,
        legalName: parsed.data.legalName,
        addressLine1: parsed.data.addressLine1,
        addressLine2: parsed.data.addressLine2,
        addressCity: parsed.data.addressCity,
        addressState: parsed.data.addressState,
        addressPostalCode: parsed.data.addressPostalCode,
        addressCountry: parsed.data.addressCountry,
        emailVerified: false,
        accounts: {
          create: {
            providerId: 'credential',
            password: hashedPassword,
          }
        }
      },
      select: {
        id: true,
        name: true,
        email: true,
        country: true,
        legalName: true,
        addressLine1: true,
        addressLine2: true,
        addressCity: true,
        addressState: true,
        addressPostalCode: true,
        addressCountry: true,
        profilePictures: true,
        createdAt: true,
        updatedAt: true,
      }
    });

    return NextResponse.json(newUser, { status: 201 });
  } catch (error) {
    console.error("Error creating user:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// PATCH: Update user
export async function PATCH(req: NextRequest) {
  try {
    // Check authentication
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!req.headers.get("content-type")?.includes("application/json")) {
      return NextResponse.json({ error: "Invalid content type" }, { status: 400 });
    }

    let body: { id?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    // We need userId in the request body for PATCH
    if (!body.id) {
      return NextResponse.json({ error: "User ID is required" }, { status: 400 });
    }

    const userId = body.id;
    
    // Users can only update their own profile
    if (userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden - You can only update your own profile" }, { status: 403 });
    }

    const { id: _, ...updateData } = body;

    if ("email" in updateData) {
      return NextResponse.json({ error: "Use the verified email change flow to update your email address" }, { status: 400 });
    }

    const parsed = userSchema.safeParse(updateData);
    if (!parsed.success) {
      return NextResponse.json({ error: z.treeifyError(parsed.error) }, { status: 400 });
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        accounts: {
          where: { providerId: 'credential' }
        }
      }
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Handle password update separately (in accounts table)
    if (parsed.data.password) {
      const hashedPassword = await hashPassword(parsed.data.password);
      
      // Find or create credential account
      const credentialAccount = user.accounts.find(acc => acc.providerId === 'credential');
      
      if (credentialAccount) {
        // Update existing credential account
        await prisma.account.update({
          where: { 
            id_providerId: {
              id: credentialAccount.id,
              providerId: 'credential'
            }
          },
          data: { password: hashedPassword }
        });
      } else {
        // Create new credential account if it doesn't exist
        // Prisma auto-generates accountId with cuid(2)
        await prisma.account.create({
          data: {
            providerId: 'credential',
            userId: userId,
            password: hashedPassword,
          }
        });
      }
      
      // Remove password from update data (it's not in user table)
      delete parsed.data.password;
    }

    // Update user (without password)
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: parsed.data,
      select: {
        id: true,
        name: true,
        email: true,
        country: true,
        legalName: true,
        addressLine1: true,
        addressLine2: true,
        addressCity: true,
        addressState: true,
        addressPostalCode: true,
        addressCountry: true,
        profilePictures: true,
        showAge: true,
        showExactBirthdate: true,
        showConventions: true,
        socialLinks: true,
        createdAt: true,
        updatedAt: true,
      }
    });

    return NextResponse.json(updatedUser, { status: 200 });
  } catch (error) {
    console.error("Error updating user:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// DELETE: Delete user
export async function DELETE(req: NextRequest) {
  try {
    // Check authentication
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const userId = url.searchParams.get("userId");

    if (!userId) {
      return NextResponse.json({ error: "User ID is required" }, { status: 400 });
    }

    // Users can only delete their own account
    if (userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden - You can only delete your own account" }, { status: 403 });
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Delete user
    await prisma.user.delete({
      where: { id: userId }
    });

    return NextResponse.json({ message: "User deleted successfully" }, { status: 200 });
  } catch (error) {
    console.error("Error deleting user:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
