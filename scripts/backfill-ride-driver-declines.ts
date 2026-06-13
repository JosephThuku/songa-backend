/**
 * Backfill RideDriverDecline from legacy Ride.declinedBy JSON (run before phase-5 migration on existing DBs).
 */
import { prisma } from "../src/lib/prisma.js";
import { parseDeclinedBy } from "../src/lib/ride-decline.js";

async function main(): Promise<void> {
  const rides = await prisma.$queryRawUnsafe<Array<{ id: string; declinedBy: string }>>(
    "SELECT id, declinedBy FROM Ride WHERE declinedBy IS NOT NULL AND declinedBy != '[]'",
  );

  let created = 0;
  for (const ride of rides) {
    const driverIds = parseDeclinedBy(ride.declinedBy);
    for (const driverId of driverIds) {
      await prisma.rideDriverDecline.upsert({
        where: { rideId_driverId: { rideId: ride.id, driverId } },
        create: { rideId: ride.id, driverId },
        update: {},
      });
      created++;
    }
  }
  console.log(`Backfilled ${created} ride driver decline row(s) from ${rides.length} ride(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
