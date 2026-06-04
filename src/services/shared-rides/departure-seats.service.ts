import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { sharedRidesConfig } from "../../lib/shared-rides-config.js";
import { toNairobiIso } from "../../lib/nairobi-time.js";
import { toDriverEmbedDto } from "../../lib/responses.js";
import { driverLocationFromDeparture, type DriverLocationDto } from "./departure-driver-location.js";
import { corridorLocationBriefSelect } from "./shared-rides-prisma.js";
import {
  defaultNeighborhoodPickupPin,
  findTripRequestPickupNote,
  pickupPinFromSeat,
  SGR_CORRIDOR_SLUG,
  type PickupPinDto,
} from "./shared-rides-pickup.js";

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
      pickupLabel: null,
      pickupLat: null,
      pickupLng: null,
    },
  });
}

export type DepartureSeatOccupantDto = {
  passengerId: string;
  name: string | null;
  phone: string | null;
  status: string;
  reservedUntil: string | null;
  pickupPin: PickupPinDto | null;
};

export type DepartureSeatDto = {
  seatNumber: number;
  seatLabel: string;
  status: string;
  isMine: boolean;
  row: number | null;
  col: number | null;
  occupant?: DepartureSeatOccupantDto;
};

export type SharedDepartureDriverDto = {
  id: string;
  name: string | null;
  phone: string | null;
  rating: number;
  vehicle: {
    type: string;
    registration: string;
    color: string;
    make: string;
    model: string;
  } | null;
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
  driverLocation: DriverLocationDto | null;
  /** Shown when the viewer has a seat; phone only after seats are paid. */
  driver: SharedDepartureDriverDto | null;
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
          reservedBy: { select: { id: true, name: true, phone: true } },
        },
      },
      driver: {
        select: {
          id: true,
          name: true,
          phone: true,
          rating: true,
          driverProfile: {
            select: {
              vehicle: {
                select: {
                  type: true,
                  registration: true,
                  color: true,
                  make: true,
                  model: true,
                },
              },
            },
          },
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
    seatLabel: string;
    status: string;
    row: number | null;
    col: number | null;
    reservedById: string | null;
    expiresAt: Date | null;
    pickupLabel: string | null;
    pickupLat: number | null;
    pickupLng: number | null;
    reservedBy: { id: string; name: string | null; phone: string | null } | null;
  }>,
  viewer: Viewer,
): DepartureSeatDto[] {
  return seats.map((s) => {
    const base: DepartureSeatDto = {
      seatNumber: s.seatNumber,
      seatLabel: s.seatLabel || String(s.seatNumber),
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
        phone: s.reservedBy?.phone ?? null,
        status: s.status,
        reservedUntil:
          s.status === "reserved" && s.expiresAt ? toNairobiIso(s.expiresAt) : null,
        pickupPin: pickupPinFromSeat(s),
      };
    }
    return base;
  });
}

function toDepartureDto(
  departure: Awaited<ReturnType<typeof loadDepartureForView>>,
  viewer: Viewer,
): SharedDepartureDetailDto {
  const showDriverLocation =
    (departure.status === "boarding" || departure.status === "scheduled") &&
    (viewer.role === "driver" ||
      (viewer.role === "passenger" && passengerHasSeat(departure.seats, viewer.id)));
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
    driverLocation: showDriverLocation ? driverLocationFromDeparture(departure) : null,
    driver: driverContactForViewer(departure, viewer),
  };
}

async function resolvePickupPinForReserve(
  departure: Awaited<ReturnType<typeof loadDepartureForPassengerBooking>>,
  passengerId: string,
  pickup?: PickupPinDto,
): Promise<PickupPinDto | null> {
  if (pickup) return pickup;

  const isToSgr = departure.dropoffLocation.slug === SGR_CORRIDOR_SLUG;

  const note = await findTripRequestPickupNote(passengerId, departure.id);
  if (note) {
    const fromNote = defaultNeighborhoodPickupPin({
      pickupLocation: departure.pickupLocation,
      dropoffLocation: departure.dropoffLocation,
    });
    if (fromNote) {
      return { ...fromNote, label: note };
    }
  }

  if (!isToSgr) {
    return null;
  }

  const fallback = defaultNeighborhoodPickupPin({
    pickupLocation: departure.pickupLocation,
    dropoffLocation: departure.dropoffLocation,
  });
  if (!fallback) {
    throw new AppError(
      "PICKUP_LOCATION_REQUIRED",
      400,
      "Send pickup coordinates (lat/lng + label) when reserving seats for trips to SGR.",
    );
  }
  return fallback;
}

export async function getDepartureDetailForViewer(
  departureId: string,
  viewer: Viewer,
): Promise<{ departure: SharedDepartureDetailDto }> {
  const departure = await loadDepartureForView(departureId, viewer);
  return { departure: toDepartureDto(departure, viewer) };
}

function passengerHasSeat(
  seats: Array<{ reservedById: string | null; status: string }>,
  passengerId: string,
): boolean {
  return seats.some(
    (s) =>
      s.reservedById === passengerId && (s.status === "reserved" || s.status === "paid"),
  );
}

function passengerHasPaidSeat(
  seats: Array<{ reservedById: string | null; status: string }>,
  passengerId: string,
): boolean {
  return seats.some((s) => s.reservedById === passengerId && s.status === "paid");
}

function driverContactForViewer(
  departure: Awaited<ReturnType<typeof loadDepartureForView>>,
  viewer: Viewer,
): SharedDepartureDriverDto | null {
  if (viewer.role !== "passenger" || !departure.driver) return null;
  if (!passengerHasSeat(departure.seats, viewer.id)) return null;

  const embed = toDriverEmbedDto(
    departure.driver,
    passengerHasPaidSeat(departure.seats, viewer.id),
  );
  if (!embed) return null;

  const vehicle = departure.driver.driverProfile?.vehicle ?? null;
  return {
    id: embed.id,
    name: embed.name,
    phone: embed.phone,
    rating: embed.rating,
    vehicle: vehicle
      ? {
          type: vehicle.type,
          registration: vehicle.registration,
          color: vehicle.color,
          make: vehicle.make,
          model: vehicle.model,
        }
      : null,
  };
}

/** Passenger seat map: booking while scheduled, or track van after reserve/pay through boarding. */
export async function getDepartureDetail(
  departureId: string,
  passengerId: string,
): Promise<{ departure: SharedDepartureDetailDto }> {
  await releaseExpiredSeatHolds(departureId);
  const departure = await loadDepartureForView(departureId, { id: passengerId, role: "passenger" });
  const now = Date.now();
  const bookingOpen =
    departure.status === "scheduled" && departure.departureAt.getTime() > now;
  const canTrack =
    passengerHasSeat(departure.seats, passengerId) &&
    (departure.status === "scheduled" || departure.status === "boarding");

  if (bookingOpen) {
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
  if (canTrack) {
    return { departure: toDepartureDto(departure, { id: passengerId, role: "passenger" }) };
  }

  throw new AppError("DEPARTURE_NOT_FOUND", 404, "Departure not found or not available to you.");
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
  pickup?: PickupPinDto,
): Promise<{ departure: SharedDepartureDetailDto; reservedUntil: string }> {
  const departure = await loadDepartureForPassengerBooking(departureId);
  const seats = normalizeSeatNumbers(seatNumbers, departure.capacity);
  const expiresAt = reserveExpiresAt();
  const pickupPin = await resolvePickupPinForReserve(departure, passengerId, pickup);
  const pickupData = pickupPin
    ? { pickupLabel: pickupPin.label, pickupLat: pickupPin.lat, pickupLng: pickupPin.lng }
    : { pickupLabel: null, pickupLat: null, pickupLng: null };

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
        ...pickupData,
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
      pickupLabel: null,
      pickupLat: null,
      pickupLng: null,
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
