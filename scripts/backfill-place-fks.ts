/**
 * Backfill Place rows + pickupPlaceId/dropoffPlaceId for legacy Ride/Booking JSON snapshots.
 * Run once after Phase 2 migration: npx tsx scripts/backfill-place-fks.ts
 */
import "dotenv/config";
import type { Prisma } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import { createPlaceSnapshot } from "../src/lib/place-persist.js";
import { toPlaceDto } from "../src/lib/responses.js";

const prisma = new PrismaClient();

function jsonPlace(value: Prisma.JsonValue) {
  return toPlaceDto(value);
}

async function backfillRides(): Promise<number> {
  const rides = await prisma.ride.findMany({
    where: {
      OR: [{ pickupPlaceId: null }, { dropoffPlaceId: null }],
    },
    select: { id: true, pickup: true, dropoff: true, pickupPlaceId: true, dropoffPlaceId: true },
  });

  let updated = 0;
  for (const ride of rides) {
    const pickupPlaceId =
      ride.pickupPlaceId ?? (await createPlaceSnapshot(prisma, jsonPlace(ride.pickup)));
    const dropoffPlaceId =
      ride.dropoffPlaceId ?? (await createPlaceSnapshot(prisma, jsonPlace(ride.dropoff)));

    await prisma.ride.update({
      where: { id: ride.id },
      data: { pickupPlaceId, dropoffPlaceId },
    });
    updated += 1;
  }
  return updated;
}

async function backfillBookings(): Promise<number> {
  const bookings = await prisma.booking.findMany({
    where: {
      OR: [{ pickupPlaceId: null }, { dropoffPlaceId: null }],
    },
    select: { id: true, pickup: true, dropoff: true, pickupPlaceId: true, dropoffPlaceId: true },
  });

  let updated = 0;
  for (const booking of bookings) {
    const pickupPlaceId =
      booking.pickupPlaceId ??
      (await createPlaceSnapshot(prisma, jsonPlace(booking.pickup)));
    const dropoffPlaceId =
      booking.dropoffPlaceId ??
      (await createPlaceSnapshot(prisma, jsonPlace(booking.dropoff)));

    await prisma.booking.update({
      where: { id: booking.id },
      data: { pickupPlaceId, dropoffPlaceId },
    });
    updated += 1;
  }
  return updated;
}

async function main() {
  const rides = await backfillRides();
  const bookings = await backfillBookings();
  console.log(`Backfilled ${rides} ride(s) and ${bookings} booking(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
