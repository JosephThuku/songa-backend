import cuid from "cuid";
import { Prisma } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { SHARED_SGR_PLATFORM_FEE_KES } from "../../config/shared-rides.js";
import { prisma } from "../../lib/prisma.js";
import { persistBookingSeats, seatNumbersFromBooking, serializeBookingSeats } from "../../lib/booking-seats.js";
import { persistPlacePair } from "../../lib/place-persist.js";
import { sharedBookingPlaceInputs } from "../../lib/shared-booking-places.js";
import type { PlaceDto } from "../../lib/responses.js";
import { toPlaceDto } from "../../lib/responses.js";
import { assertSeatsHeldForBooking, releaseExpiredSeatHolds } from "./departure-seats.service.js";
import {
  defaultNeighborhoodPickupPin,
  pickupPinFromSeat,
  SGR_CORRIDOR_SLUG,
} from "./shared-rides-pickup.js";

export type CreateSharedDepartureBookingInput = {
  seatNumbers: number[];
};

function placeFromLocation(loc: {
  name: string;
  lat: number | null;
  lng: number | null;
}): PlaceDto {
  return {
    label: loc.name,
    lat: loc.lat ?? 0,
    lng: loc.lng ?? 0,
  };
}

export type SharedDepartureBookingDto = {
  id: string;
  product: "shared_sgr";
  sharedDepartureId: string;
  status: string;
  seats: number[];
  subtotal: number;
  platformFee: number;
  total: number;
  currency: string;
  pickup: PlaceDto;
  dropoff: PlaceDto;
  createdAt: string;
};

export async function createSharedDepartureBooking(
  departureId: string,
  passengerId: string,
  input: CreateSharedDepartureBookingInput,
): Promise<{ booking: SharedDepartureBookingDto }> {
  await releaseExpiredSeatHolds(departureId);

  const unpaidBooking = await prisma.booking.findFirst({
    where: { passengerId, status: "pending_payment" },
    select: { id: true },
  });
  if (unpaidBooking) {
    throw new AppError(
      "UNPAID_BOOKING_PENDING",
      409,
      "Pay or cancel your pending booking before starting another.",
      { bookingId: unpaidBooking.id },
    );
  }

  const departure = await prisma.sharedDeparture.findUnique({
    where: { id: departureId },
    include: {
      pickupLocation: true,
      dropoffLocation: true,
    },
  });
  if (!departure || departure.status !== "scheduled") {
    throw new AppError("DEPARTURE_NOT_FOUND", 404, "Departure not found or not open for booking.");
  }
  if (departure.departureAt.getTime() <= Date.now()) {
    throw new AppError("DEPARTURE_CLOSED", 409, "This departure has already left.");
  }

  const seatNumbers = [...new Set(input.seatNumbers)].sort((a, b) => a - b);
  await assertSeatsHeldForBooking(departureId, passengerId, seatNumbers);

  const heldSeats = await prisma.sharedDepartureSeat.findMany({
    where: { departureId, seatNumber: { in: seatNumbers }, reservedById: passengerId },
    select: { pickupLabel: true, pickupLat: true, pickupLng: true },
  });
  const passengerPin =
    pickupPinFromSeat(heldSeats[0] ?? {}) ??
    defaultNeighborhoodPickupPin(departure) ??
    placeFromLocation(departure.pickupLocation);
  const isToSgr = departure.dropoffLocation.slug === SGR_CORRIDOR_SLUG;
  const sgrPlace = placeFromLocation(
    departure.pickupLocation.slug === SGR_CORRIDOR_SLUG
      ? departure.pickupLocation
      : departure.dropoffLocation,
  );
  const pickupPlace = isToSgr ? passengerPin : sgrPlace;
  const dropoffPlace = isToSgr ? placeFromLocation(departure.dropoffLocation) : passengerPin;

  const subtotal = departure.pricePerSeat * seatNumbers.length;
  const platformFee = SHARED_SGR_PLATFORM_FEE_KES;
  const total = subtotal + platformFee;
  const bookingId = `BKG-${cuid()}`;

  const placeInputs = sharedBookingPlaceInputs(
    departure,
    pickupPlace,
    dropoffPlace,
    isToSgr,
  );

  await prisma.$transaction(async (tx) => {
    const places = await persistPlacePair(tx, placeInputs.pickup, placeInputs.dropoff);
    await tx.booking.create({
      data: {
        id: bookingId,
        passengerId,
        product: "shared_sgr",
        sharedDepartureId: departureId,
        seats: serializeBookingSeats(seatNumbers),
        subtotal,
        platformFee,
        total,
        pickup: places.pickup,
        dropoff: places.dropoff,
        pickupPlaceId: places.pickupPlaceId,
        dropoffPlaceId: places.dropoffPlaceId,
        status: "pending_payment",
      },
    });
    await persistBookingSeats(tx, bookingId, seatNumbers, { departureId });

    await tx.sharedDepartureSeat.updateMany({
      where: {
        departureId,
        seatNumber: { in: seatNumbers },
        reservedById: passengerId,
        status: "reserved",
      },
      data: { bookingId },
    });
  });

  return {
    booking: {
      id: bookingId,
      product: "shared_sgr",
      sharedDepartureId: departureId,
      status: "pending_payment",
      seats: seatNumbers,
      subtotal,
      platformFee,
      total,
      currency: "KES",
      pickup: pickupPlace,
      dropoff: dropoffPlace,
      createdAt: new Date().toISOString(),
    },
  };
}

export type MySharedBookingItemDto = {
  booking: SharedDepartureBookingDto;
  departure: {
    id: string;
    departureAt: string;
    routeLabel: string;
    status: string;
  };
};

function bookingRowToDto(row: {
  id: string;
  product: string;
  sharedDepartureId: string | null;
  status: string;
  seats: string | null;
  seatRows?: { seatNumber: number }[];
  subtotal: number;
  platformFee: number;
  total: number;
  pickup: Prisma.JsonValue;
  dropoff: Prisma.JsonValue;
  createdAt: Date;
}): SharedDepartureBookingDto {
  const seatNumbers = seatNumbersFromBooking(row) ?? [];
  return {
    id: row.id,
    product: "shared_sgr",
    sharedDepartureId: row.sharedDepartureId ?? "",
    status: row.status,
    seats: seatNumbers,
    subtotal: row.subtotal,
    platformFee: row.platformFee,
    total: row.total,
    currency: "KES",
    pickup: toPlaceDto(row.pickup),
    dropoff: toPlaceDto(row.dropoff),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Upcoming and recent shared van bookings for the signed-in passenger (Trips tab). */
export async function listMySharedBookings(
  passengerId: string,
): Promise<{ bookings: MySharedBookingItemDto[] }> {
  const rows = await prisma.booking.findMany({
    where: {
      passengerId,
      product: "shared_sgr",
      status: { in: ["paid", "pending_payment"] },
      sharedDepartureId: { not: null },
      sharedDeparture: {
        status: { in: ["scheduled", "boarding"] },
        departureAt: { gte: new Date() },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: {
      seatRows: { orderBy: { seatNumber: "asc" } },
      sharedDeparture: {
        include: {
          pickupLocation: true,
          dropoffLocation: true,
        },
      },
    },
  });

  const bookings: MySharedBookingItemDto[] = [];
  for (const row of rows) {
    const departure = row.sharedDeparture;
    if (!departure || !row.sharedDepartureId) continue;
    bookings.push({
      booking: bookingRowToDto(row),
      departure: {
        id: departure.id,
        departureAt: departure.departureAt.toISOString(),
        routeLabel: `${departure.pickupLocation.name} → ${departure.dropoffLocation.name}`,
        status: departure.status,
      },
    });
  }

  return { bookings };
}
