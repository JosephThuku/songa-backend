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
  console.log("Demo open trip request (CBD):", result.demoTripRequest ?? "skipped");
  console.log("\n--- QA search routes ---");
  console.log("  WITH vans:   ", result.qa.withDepartures);
  console.log("  NO vans:     ", result.qa.withoutDepartures);
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
