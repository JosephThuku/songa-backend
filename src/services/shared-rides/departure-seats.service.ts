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

export type DepartureSeatOccupantDto = {
  passengerId: string;
  name: string | null;
  status: string;
  reservedUntil: string | null;
};

export type DepartureSeatDto = {
  seatNumber: number;
  status: string;
  isMine: boolean;
  row: number | null;
  col: number | null;
  occupant?: DepartureSeatOccupantDto;
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
  seatSummary: { paid: number; reserved: number; available: number };
  seats: DepartureSeatDto[];
};

type Viewer = { id: string; role: "passenger" | "driver" };

async function loadDepartureForPassengerBooking(departureId: string) {
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

async function loadDepartureForView(departureId: string, viewer: Viewer) {
  await releaseExpiredSeatHolds(departureId);
  const departure = await prisma.sharedDeparture.findUnique({
    where: { id: departureId },
    include: {
      pickupLocation: { select: corridorLocationBriefSelect },
      dropoffLocation: { select: corridorLocationBriefSelect },
      seats: {
        orderBy: { seatNumber: "asc" },
        include: {
          reservedBy: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!departure) {
    throw new AppError("DEPARTURE_NOT_FOUND", 404, "Departure not found.");
  }
  if (viewer.role === "driver" && departure.driverId !== viewer.id) {
    throw new AppError("FORBIDDEN", 403, "This departure belongs to another driver.");
  }
  return departure;
}

function seatSummary(seats: { status: string }[]) {
  let paid = 0;
  let reserved = 0;
  let available = 0;
  for (const s of seats) {
    if (s.status === "paid") paid += 1;
    else if (s.status === "reserved") reserved += 1;
    else if (s.status === "available") available += 1;
  }
  return { paid, reserved, available };
}

function mapSeats(
  seats: Array<{
    seatNumber: number;
    status: string;
    row: number | null;
    col: number | null;
    reservedById: string | null;
    expiresAt: Date | null;
    reservedBy: { id: string; name: string | null } | null;
  }>,
  viewer: Viewer,
): DepartureSeatDto[] {
  return seats.map((s) => {
    const base: DepartureSeatDto = {
      seatNumber: s.seatNumber,
      status: s.status,
      isMine: viewer.role === "passenger" && s.reservedById === viewer.id,
      row: s.row,
      col: s.col,
    };
    if (
      viewer.role === "driver" &&
      s.reservedById &&
      (s.status === "reserved" || s.status === "paid")
    ) {
      base.occupant = {
        passengerId: s.reservedById,
        name: s.reservedBy?.name ?? null,
        status: s.status,
        reservedUntil:
          s.status === "reserved" && s.expiresAt ? toNairobiIso(s.expiresAt) : null,
      };
    }
    return base;
  });
}

function toDepartureDto(
  departure: Awaited<ReturnType<typeof loadDepartureForView>>,
  viewer: Viewer,
): SharedDepartureDetailDto {
  return {
    id: departure.id,
    departureAt: toNairobiIso(departure.departureAt),
    pricePerSeat: departure.pricePerSeat,
    capacity: departure.capacity,
    status: departure.status,
    routeLabel: `${departure.pickupLocation.name} → ${departure.dropoffLocation.name}`,
    pickupLocation: departure.pickupLocation,
    dropoffLocation: departure.dropoffLocation,
    seatSummary: seatSummary(departure.seats),
    seats: mapSeats(departure.seats, viewer),
  };
}

export async function getDepartureDetailForViewer(
  departureId: string,
  viewer: Viewer,
): Promise<{ departure: SharedDepartureDetailDto }> {
  const departure = await loadDepartureForView(departureId, viewer);
  return { departure: toDepartureDto(departure, viewer) };
}

/** Passenger booking flow — scheduled departures only. */
export async function getDepartureDetail(
  departureId: string,
  passengerId: string,
): Promise<{ departure: SharedDepartureDetailDto }> {
  const departure = await loadDepartureForPassengerBooking(departureId);
  return {
    departure: toDepartureDto(
      {
        ...departure,
        seats: departure.seats.map((s) => ({ ...s, reservedBy: null })),
      },
      { id: passengerId, role: "passenger" },
    ),
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
  const departure = await loadDepartureForPassengerBooking(departureId);
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
  const departure = await loadDepartureForPassengerBooking(departureId);
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

  return getDepartureDetail(departureId, passengerId);
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
