import cuid from "cuid";
import { Prisma } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { PLATFORM_FEE_KES } from "../../lib/ride-pricing.js";
import { prisma } from "../../lib/prisma.js";
import type { PlaceDto } from "../../lib/responses.js";
import { assertSeatsHeldForBooking, releaseExpiredSeatHolds } from "./departure-seats.service.js";

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

function placeJson(place: PlaceDto): Prisma.InputJsonValue {
  return place as unknown as Prisma.InputJsonValue;
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

  const subtotal = departure.pricePerSeat * seatNumbers.length;
  const platformFee = PLATFORM_FEE_KES;
  const total = subtotal + platformFee;
  const bookingId = `BKG-${cuid()}`;

  await prisma.$transaction(async (tx) => {
    await tx.booking.create({
      data: {
        id: bookingId,
        passengerId,
        product: "shared_sgr",
        sharedDepartureId: departureId,
        seats: seatNumbers.join(","),
        subtotal,
        platformFee,
        total,
        pickup: placeJson(placeFromLocation(departure.pickupLocation)),
        dropoff: placeJson(placeFromLocation(departure.dropoffLocation)),
        status: "pending_payment",
      },
    });

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
      pickup: placeFromLocation(departure.pickupLocation),
      dropoff: placeFromLocation(departure.dropoffLocation),
      createdAt: new Date().toISOString(),
    },
  };
}
