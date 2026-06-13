/**
 * Clear all passenger/driver bookings, rides, and related transactional data.
 * Preserves users, vehicles, driver profiles, corridor catalog, and places.
 *
 * Usage: npx tsx scripts/clear-bookings-rides.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { clearAllOfferTimeouts } from "../src/lib/offer-timeout.js";

const prisma = new PrismaClient();

async function countSnapshot() {
  const [
    rides,
    bookings,
    sharedDepartures,
    sharedTripRequests,
    payments,
    notifications,
    walletTransactions,
  ] = await Promise.all([
    prisma.ride.count(),
    prisma.booking.count(),
    prisma.sharedDeparture.count(),
    prisma.sharedTripRequest.count(),
    prisma.payment.count(),
    prisma.notification.count(),
    prisma.walletTransaction.count(),
  ]);
  return {
    rides,
    bookings,
    sharedDepartures,
    sharedTripRequests,
    payments,
    notifications,
    walletTransactions,
  };
}

async function clearBookingsAndRides() {
  clearAllOfferTimeouts();
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS=0");

  await prisma.sharedTripRequestReservation.deleteMany();
  await prisma.sharedTripRequest.deleteMany();
  await prisma.sharedDepartureSeat.deleteMany();
  await prisma.sharedDeparture.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.walletTransaction.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.bookingSeat.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.rideDriverDecline.deleteMany();
  await prisma.rideSeat.deleteMany();
  await prisma.rideEvent.deleteMany();
  await prisma.ride.deleteMany();

  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS=1");
}

async function main() {
  const before = await countSnapshot();
  console.log("Before:", before);

  if (
    before.rides === 0 &&
    before.bookings === 0 &&
    before.sharedDepartures === 0 &&
    before.sharedTripRequests === 0
  ) {
    console.log("Nothing to clear — bookings and rides are already empty.");
    return;
  }

  await clearBookingsAndRides();

  const after = await countSnapshot();
  console.log("After:", after);
  console.log("Cleared all passenger/driver bookings, rides, and related records.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
