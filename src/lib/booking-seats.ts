import type { Prisma } from "@prisma/client";
import { AppError } from "./errors.js";
import { prisma } from "./prisma.js";

type Db = Prisma.TransactionClient | typeof prisma;

export const bookingSeatInclude = {
  seatRows: { orderBy: { seatNumber: "asc" as const } },
} as const;

export type BookingWithSeatRows = {
  seats: string | null;
  seatRows?: { seatNumber: number }[];
};

export function normalizeSeatNumbers(seatNumbers: number[]): number[] {
  const unique = [...new Set(seatNumbers)].filter((n) => Number.isInteger(n) && n > 0);
  return unique.sort((a, b) => a - b);
}

export function serializeBookingSeats(seatNumbers: number[]): string {
  return normalizeSeatNumbers(seatNumbers).join(",");
}

export function seatNumbersFromBooking(booking: BookingWithSeatRows): number[] | null {
  if (booking.seatRows && booking.seatRows.length > 0) {
    return booking.seatRows.map((row) => row.seatNumber);
  }
  if (!booking.seats) return null;
  const parsed = booking.seats
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0);
  const normalized = normalizeSeatNumbers(parsed);
  return normalized.length > 0 ? normalized : null;
}

export async function persistBookingSeats(
  db: Db,
  bookingId: string,
  seatNumbers: number[],
  opts?: { departureId?: string },
): Promise<void> {
  const normalized = normalizeSeatNumbers(seatNumbers);
  if (normalized.length === 0) {
    throw new AppError("INVALID_INPUT", 400, "At least one seat is required.");
  }

  for (const seatNumber of normalized) {
    let sharedDepartureSeatId: string | null = null;
    if (opts?.departureId) {
      const departureSeat = await db.sharedDepartureSeat.findUnique({
        where: {
          departureId_seatNumber: { departureId: opts.departureId, seatNumber },
        },
        select: { id: true },
      });
      sharedDepartureSeatId = departureSeat?.id ?? null;
    }

    await db.bookingSeat.create({
      data: {
        bookingId,
        seatNumber,
        sharedDepartureSeatId,
      },
    });
  }
}
