/**
 * Production-safe idempotent seed: shared-rides catalog only (zones + SGR schedule slots).
 * No demo users, drivers, departures, or QA passengers.
 *
 * Optional: set SEED_ADMIN_PASSWORD to upsert the ops admin account on first deploy.
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password.js";
import { SEED_ADMIN, seedAdminUser } from "./seeds/admin-user.js";
import { seedSharedRidesCoast } from "./seeds/shared-rides-coast.js";

const prisma = new PrismaClient();

async function main() {
  const sharedRides = await seedSharedRidesCoast(prisma, { includeDemoData: false });

  const adminPassword = process.env.SEED_ADMIN_PASSWORD?.trim();
  let adminSeeded = false;
  if (adminPassword) {
    await seedAdminUser(prisma, await hashPassword(adminPassword));
    adminSeeded = true;
  }

  console.log("\n=== Songa production seed ===\n");
  console.log("Shared rides catalog:", {
    zones: sharedRides.zoneSlugs,
    scheduleSlots: sharedRides.slotCount,
    sgrLocationId: sharedRides.sgrLocationId,
  });
  if (adminSeeded) {
    console.log("Admin user upserted:", {
      phone: SEED_ADMIN.phone,
      email: SEED_ADMIN.email,
    });
  } else {
    console.log("Admin user skipped (set SEED_ADMIN_PASSWORD to upsert ops admin).");
  }
  console.log("\nProduction seed complete.\n");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
