/**
 * Nulls invalid FK references so integrity constraints can be applied safely.
 * Run: npx tsx scripts/repair-orphan-fks.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const rideResult = await prisma.$executeRaw`
    UPDATE Ride r
    LEFT JOIN Booking b ON b.id = r.bookingId
    SET r.bookingId = NULL
    WHERE r.bookingId IS NOT NULL AND b.id IS NULL
  `;

  const seatResult = await prisma.$executeRaw`
    UPDATE SharedDepartureSeat s
    LEFT JOIN Booking b ON b.id = s.bookingId
    SET s.bookingId = NULL
    WHERE s.bookingId IS NOT NULL AND b.id IS NULL
  `;

  const walletResult = await prisma.$executeRaw`
    UPDATE WalletTransaction w
    LEFT JOIN Ride r ON r.id = w.rideId
    SET w.rideId = NULL
    WHERE w.rideId IS NOT NULL AND r.id IS NULL
  `;

  console.log("Repaired orphan references:");
  console.log(`  Ride.bookingId cleared: ${rideResult}`);
  console.log(`  SharedDepartureSeat.bookingId cleared: ${seatResult}`);
  console.log(`  WalletTransaction.rideId cleared: ${walletResult}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
