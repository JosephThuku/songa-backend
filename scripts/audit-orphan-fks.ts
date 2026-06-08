/**
 * Reports rows that would block Ride/Seat/Wallet FK constraints.
 * Run: npx tsx scripts/audit-orphan-fks.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type OrphanRow = { id: string; foreignKey: string; missingTarget: string };

async function orphanRideBookings(): Promise<OrphanRow[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string; bookingId: string }>>`
    SELECT r.id, r.bookingId
    FROM Ride r
    LEFT JOIN Booking b ON b.id = r.bookingId
    WHERE r.bookingId IS NOT NULL AND b.id IS NULL
  `;
  return rows.map((row) => ({
    id: row.id,
    foreignKey: "bookingId",
    missingTarget: row.bookingId,
  }));
}

async function orphanSeatBookings(): Promise<OrphanRow[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string; bookingId: string }>>`
    SELECT s.id, s.bookingId
    FROM SharedDepartureSeat s
    LEFT JOIN Booking b ON b.id = s.bookingId
    WHERE s.bookingId IS NOT NULL AND b.id IS NULL
  `;
  return rows.map((row) => ({
    id: row.id,
    foreignKey: "bookingId",
    missingTarget: row.bookingId,
  }));
}

async function orphanWalletRides(): Promise<OrphanRow[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string; rideId: string }>>`
    SELECT w.id, w.rideId
    FROM WalletTransaction w
    LEFT JOIN Ride r ON r.id = w.rideId
    WHERE w.rideId IS NOT NULL AND r.id IS NULL
  `;
  return rows.map((row) => ({
    id: row.id,
    foreignKey: "rideId",
    missingTarget: row.rideId,
  }));
}

async function main() {
  const [rideBookings, seatBookings, walletRides] = await Promise.all([
    orphanRideBookings(),
    orphanSeatBookings(),
    orphanWalletRides(),
  ]);

  const sections = [
    { label: "Ride.bookingId → Booking", rows: rideBookings },
    { label: "SharedDepartureSeat.bookingId → Booking", rows: seatBookings },
    { label: "WalletTransaction.rideId → Ride", rows: walletRides },
  ];

  let total = 0;
  for (const section of sections) {
    console.log(`\n${section.label}: ${section.rows.length} orphan(s)`);
    for (const row of section.rows.slice(0, 20)) {
      console.log(`  - ${row.id} (${row.foreignKey}=${row.missingTarget})`);
    }
    if (section.rows.length > 20) {
      console.log(`  … and ${section.rows.length - 20} more`);
    }
    total += section.rows.length;
  }

  console.log(`\nTotal orphans: ${total}`);
  if (total > 0) {
    console.error(
      "\nRun scripts/repair-orphan-fks.ts to null invalid references before migrate deploy in production.",
    );
    process.exit(1);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
