import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { sharedRidesConfig } from "../../lib/shared-rides-config.js";
import { toNairobiIso } from "../../lib/nairobi-time.js";
import { corridorLocationBriefSelect } from "./shared-rides-prisma.js";

function reserveExpiresAt(): Date {
  return new Date(Date.now() + sharedRidesConfig.seatReserveMinutes * 60_000);
}

/** Clear expired holds so seats return to available. */
export async function releaseExpiredSeatHolds(departureId: string): Promise<void> {
  const now = new Date();
  await prisma.sharedDepartureSeat.updateMany({
    where: {
      departureId,
      status: "reserved",
      expiresAt: { lt: now },
    },
    data: {
      status: "available",
      reservedById: null,
      reservedAt: null,
      expiresAt: null,
      bookingId: null,
    },
  });
}

async function loadBookableDeparture(departureId: string) {
  await releaseExpiredSeatHolds(departureId);
  const departure = await prisma.sharedDeparture.findUnique({
    where: { id: departureId },
    include: {
      pickupLocation: { select: corridorLocationBriefSelect },
      dropoffLocation: { select: corridorLocationBriefSelect },
      seats: { orderBy: { seatNumber: "asc" } },
    },
  });
  if (!departure || departure.status !== "scheduled") {
    throw new AppError("DEPARTURE_NOT_FOUND", 404, "Departure not found or not open for booking.");
  }
  if (departure.departureAt.getTime() <= Date.now()) {
    throw new AppError("DEPARTURE_CLOSED", 409, "This departure has already left.");
  }
  return departure;
}

export type DepartureSeatDto = {
  seatNumber: number;
  status: string;
  isMine: boolean;
  row: number | null;
  col: number | null;
};

export type SharedDepartureDetailDto = {
  id: string;
  departureAt: string;
  pricePerSeat: number;
  capacity: number;
  status: string;
  routeLabel: string;
  pickupLocation: { id: string; slug: string; name: string };
  dropoffLocation: { id: string; slug: string; name: string };
  seats: DepartureSeatDto[];
};

export async function getDepartureDetail(
  departureId: string,
  viewerId: string,
): Promise<{ departure: SharedDepartureDetailDto }> {
  const departure = await loadBookableDeparture(departureId);
  return {
    departure: {
      id: departure.id,
      departureAt: toNairobiIso(departure.departureAt),
      pricePerSeat: departure.pricePerSeat,
      capacity: departure.capacity,
      status: departure.status,
      routeLabel: `${departure.pickupLocation.name} → ${departure.dropoffLocation.name}`,
      pickupLocation: departure.pickupLocation,
      dropoffLocation: departure.dropoffLocation,
      seats: departure.seats.map((s) => ({
        seatNumber: s.seatNumber,
        status: s.status,
        isMine: s.reservedById === viewerId,
        row: s.row,
        col: s.col,
      })),
    },
  };
}

function normalizeSeatNumbers(seatNumbers: number[], capacity: number): number[] {
  const unique = [...new Set(seatNumbers)].sort((a, b) => a - b);
  if (unique.length === 0) {
    throw new AppError("INVALID_INPUT", 400, "At least one seat number is required.");
  }
  for (const n of unique) {
    if (!Number.isInteger(n) || n < 1 || n > capacity) {
      throw new AppError("INVALID_INPUT", 400, `Seat numbers must be between 1 and ${capacity}.`);
    }
  }
  return unique;
}

export async function reserveDepartureSeats(
  departureId: string,
  passengerId: string,
  seatNumbers: number[],
): Promise<{ departure: SharedDepartureDetailDto; reservedUntil: string }> {
  const departure = await loadBookableDeparture(departureId);
  const seats = normalizeSeatNumbers(seatNumbers, departure.capacity);
  const expiresAt = reserveExpiresAt();

  await prisma.$transaction(async (tx) => {
    const rows = await tx.sharedDepartureSeat.findMany({
      where: { departureId, seatNumber: { in: seats } },
    });
    if (rows.length !== seats.length) {
      throw new AppError("SEAT_NOT_FOUND", 404, "One or more seats do not exist on this departure.");
    }

    const now = new Date();
    for (const row of rows) {
      if (row.status === "paid" || row.status === "disabled") {
        throw new AppError("SEAT_NOT_AVAILABLE", 409, `Seat ${row.seatNumber} is not available.`);
      }
      if (row.status === "reserved") {
        const heldByOther =
          row.reservedById !== passengerId &&
          row.expiresAt &&
          row.expiresAt.getTime() > now.getTime();
        if (heldByOther) {
          throw new AppError("SEAT_NOT_AVAILABLE", 409, `Seat ${row.seatNumber} is held by another passenger.`);
        }
      }
    }

    await tx.sharedDepartureSeat.updateMany({
      where: { departureId, seatNumber: { in: seats } },
      data: {
        status: "reserved",
        reservedById: passengerId,
        reservedAt: now,
        expiresAt,
        bookingId: null,
      },
    });
  });

  const detail = await getDepartureDetail(departureId, passengerId);
  return { departure: detail.departure, reservedUntil: toNairobiIso(expiresAt) };
}

export async function releaseDepartureSeats(
  departureId: string,
  passengerId: string,
  seatNumbers?: number[],
): Promise<{ departure: SharedDepartureDetailDto }> {
  const departure = await loadBookableDeparture(departureId);
  const where = {
    departureId,
    reservedById: passengerId,
    status: "reserved" as const,
    bookingId: null,
    ...(seatNumbers?.length
      ? { seatNumber: { in: normalizeSeatNumbers(seatNumbers, departure.capacity) } }
      : {}),
  };

  await prisma.sharedDepartureSeat.updateMany({
    where,
    data: {
      status: "available",
      reservedById: null,
      reservedAt: null,
      expiresAt: null,
    },
  });

  const detail = await getDepartureDetail(departureId, passengerId);
  return { departure: detail.departure };
}

export async function assertSeatsHeldForBooking(
  departureId: string,
  passengerId: string,
  seatNumbers: number[],
): Promise<void> {
  const departure = await prisma.sharedDeparture.findUnique({
    where: { id: departureId },
    select: { capacity: true, status: true, departureAt: true },
  });
  if (!departure) {
    throw new AppError("DEPARTURE_NOT_FOUND", 404, "Departure not found.");
  }
  const seats = normalizeSeatNumbers(seatNumbers, departure.capacity);
  const now = new Date();
  const rows = await prisma.sharedDepartureSeat.findMany({
    where: { departureId, seatNumber: { in: seats } },
  });
  for (const row of rows) {
    if (
      row.status !== "reserved" ||
      row.reservedById !== passengerId ||
      !row.expiresAt ||
      row.expiresAt.getTime() <= now.getTime() ||
      row.bookingId
    ) {
      throw new AppError(
        "SEATS_NOT_HELD",
        409,
        "Reserve seats before creating a booking; holds expire after a few minutes.",
      );
    }
  }
}
