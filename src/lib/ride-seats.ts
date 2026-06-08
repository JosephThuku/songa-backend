import type { Prisma } from "@prisma/client";
import { normalizeSeatNumbers, serializeBookingSeats as serializeSeatList } from "./booking-seats.js";
import { prisma } from "./prisma.js";

type Db = Prisma.TransactionClient | typeof prisma;

export const rideSeatInclude = {
  seatRows: { orderBy: { seatNumber: "asc" as const } },
} as const;

export type RideWithSeatRows = {
  seats: string | null;
  seatRows?: { seatNumber: number }[];
};

export function serializeRideSeats(seatNumbers: number[]): string | null {
  const normalized = normalizeSeatNumbers(seatNumbers);
  return normalized.length > 0 ? serializeSeatList(normalized) : null;
}

export function seatNumbersFromRide(ride: RideWithSeatRows): number[] | null {
  if (ride.seatRows && ride.seatRows.length > 0) {
    return ride.seatRows.map((row) => row.seatNumber);
  }
  if (!ride.seats) return null;
  const parsed = ride.seats
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0);
  const normalized = normalizeSeatNumbers(parsed);
  return normalized.length > 0 ? normalized : null;
}

export async function persistRideSeats(
  db: Db,
  rideId: string,
  seatNumbers: number[] | undefined,
): Promise<void> {
  if (!seatNumbers || seatNumbers.length === 0) return;
  const normalized = normalizeSeatNumbers(seatNumbers);
  for (const seatNumber of normalized) {
    await db.rideSeat.create({
      data: { rideId, seatNumber },
    });
  }
}
