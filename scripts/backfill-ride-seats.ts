/**
 * Backfill RideSeat from legacy Ride.seats comma-separated string.
 */
import { persistRideSeats, seatNumbersFromRide } from "../src/lib/ride-seats.js";
import { prisma } from "../src/lib/prisma.js";

async function main(): Promise<void> {
  const rides = await prisma.ride.findMany({
    where: { seats: { not: null } },
    select: { id: true, seats: true },
  });

  let created = 0;
  for (const ride of rides) {
    const seatNumbers = seatNumbersFromRide(ride);
    if (!seatNumbers || seatNumbers.length === 0) continue;
    const existing = await prisma.rideSeat.count({ where: { rideId: ride.id } });
    if (existing > 0) continue;
    await persistRideSeats(prisma, ride.id, seatNumbers);
    created += seatNumbers.length;
  }
  console.log(`Backfilled ${created} ride seat row(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
