/**
 * Backfill BookingSeat rows from legacy Booking.seats comma strings.
 * Run: npm run db:backfill-booking-seats
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { persistBookingSeats, seatNumbersFromBooking, serializeBookingSeats } from "../src/lib/booking-seats.js";

const prisma = new PrismaClient();

async function main() {
  const bookings = await prisma.booking.findMany({
    where: { seats: { not: null } },
    include: { seatRows: true, sharedDeparture: { select: { id: true } } },
  });

  let created = 0;
  let skipped = 0;

  for (const booking of bookings) {
    if (booking.seatRows.length > 0) {
      skipped += 1;
      continue;
    }

    const seatNumbers = seatNumbersFromBooking(booking);
    if (!seatNumbers || seatNumbers.length === 0) {
      skipped += 1;
      continue;
    }

    await persistBookingSeats(prisma, booking.id, seatNumbers, {
      departureId: booking.sharedDepartureId ?? booking.sharedDeparture?.id ?? undefined,
    });

    if (!booking.seats) {
      await prisma.booking.update({
        where: { id: booking.id },
        data: { seats: serializeBookingSeats(seatNumbers) },
      });
    }

    created += 1;
  }

  console.log(`BookingSeat backfill: ${created} booking(s) updated, ${skipped} skipped.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
