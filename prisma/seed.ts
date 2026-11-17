import "dotenv/config";
import { seedDevelopmentData } from "./seed-dev";
import { createPrismaClient } from "../src/lib/prisma/client";
import fs from "fs";
import path from "path";

const prisma = createPrismaClient();

async function main() {
  const dataPath = path.join(process.cwd(), "backups", "json", "latest.json");
  
  if (fs.existsSync(dataPath)) {
    console.log("🚀 Found latest JSON backup. Restoring from backup instead of default seed...");
    const data = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

    // 1. Restore Users
    console.log("👤 Restoring users...");
    for (const u of data.users) {
      await prisma.user.create({
        data: {
          id: u.id,
          name: u.name,
          email: u.email,
          bio: u.bio,
          dateOfBirth: u.dateOfBirth ? new Date(u.dateOfBirth) : null,
          pronouns: u.pronouns,
          showAge: u.showAge,
          isAdmin: u.isAdmin,
          emailVerified: u.emailVerified,
          image: u.image,
          createdAt: new Date(u.createdAt),
          updatedAt: new Date(u.updatedAt),
        }
      });

      if (u.adminProfile) {
        await prisma.admin.create({
          data: {
            ...u.adminProfile,
            createdAt: new Date(u.adminProfile.createdAt),
            updatedAt: new Date(u.adminProfile.updatedAt),
          }
        });
      }

      if (u.accounts) {
        for (const acc of u.accounts) {
          await prisma.account.create({
            data: {
              ...acc,
              accessTokenExpiresAt: acc.accessTokenExpiresAt ? new Date(acc.accessTokenExpiresAt) : null,
              refreshTokenExpiresAt: acc.refreshTokenExpiresAt ? new Date(acc.refreshTokenExpiresAt) : null,
              createdAt: new Date(acc.createdAt),
              updatedAt: new Date(acc.updatedAt),
            }
          });
        }
      }
    }

    // 2. Restore Events
    console.log("📅 Restoring events...");
    for (const e of data.events) {
      await prisma.event.create({
        data: {
          ...e,
          requireApproval: Boolean(e.requireApproval),
          startDate: new Date(e.startDate),
          endDate: new Date(e.endDate),
          publishAt: e.publishAt ? new Date(e.publishAt) : null,
          registrationOpensAt: e.registrationOpensAt ? new Date(e.registrationOpensAt) : null,
          paymentDeadline: e.paymentDeadline ? new Date(e.paymentDeadline) : null,
          createdAt: new Date(e.createdAt),
          updatedAt: new Date(e.updatedAt),
          location: e.location ? { create: { ...e.location } } : undefined,
          products: {
            create: e.products.map((p: any) => ({
              ...p,
              createdAt: undefined, // Let DB handle if present
              updatedAt: undefined
            }))
          }
        }
      });
    }

    // 3. Restore Registrations
    console.log("📝 Restoring registrations...");
    for (const r of data.registrations) {
      await prisma.registration.create({
        data: {
          ...r,
          expiresAt: r.expiresAt ? new Date(r.expiresAt) : null,
          createdAt: new Date(r.createdAt),
          updatedAt: new Date(r.updatedAt),
          payments: {
            create: r.payments.map((p: any) => ({
              ...p,
              createdAt: new Date(p.createdAt),
              updatedAt: new Date(p.updatedAt)
            }))
          }
        }
      });
    }
    console.log("✅ Data restoration complete!");

  } else {
    console.log("🌱 No backup found. Seeding development data...");
    await seedDevelopmentData(prisma);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
