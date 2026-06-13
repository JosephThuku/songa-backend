/**
 * Backfill DriverLocation from DriverProfile.location JSON.
 */
import { parseLatLngFromJson, persistDriverLocation } from "../src/lib/driver-location.js";
import { prisma } from "../src/lib/prisma.js";

async function main(): Promise<void> {
  const profiles = await prisma.driverProfile.findMany({
    where: { locationUpdatedAt: { not: null } },
    select: { userId: true, location: true, locationUpdatedAt: true },
  });

  let upserted = 0;
  for (const profile of profiles) {
    const point = parseLatLngFromJson(profile.location);
    if (!point || !profile.locationUpdatedAt) continue;
    await persistDriverLocation(prisma, profile.userId, {
      lat: point.lat,
      lng: point.lng,
      heading: point.heading,
      speedKmh: point.speedKmh,
      accuracyM: point.accuracyM,
      recordedAt: profile.locationUpdatedAt,
    });
    upserted++;
  }
  console.log(`Backfilled ${upserted} driver location row(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
