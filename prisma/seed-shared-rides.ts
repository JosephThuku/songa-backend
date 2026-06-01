import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { seedSharedRidesCoast } from "./seeds/shared-rides-coast.js";

const prisma = new PrismaClient();

async function main() {
  const result = await seedSharedRidesCoast(prisma);
  console.log("\n=== Shared rides coast seed ===\n");
  console.log("SGR terminal:", result.sgrLocationId);
  console.log("Zones:", result.zoneSlugs.join(", "));
  console.log("Schedule slots:", result.slotCount);
  console.log("Demo departures:", result.demoDepartures);
  console.log("\nRun full seed: npm run db:seed\n");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
