import cuid from "cuid";
import { AppError } from "../../lib/errors.js";
import { callInHoldExpiresAt, callInHoldExpiresInSeconds } from "../../lib/call-in-hold.js";
import { payInviteLink, signBookingPayInvite } from "../../lib/booking-pay-invite.js";
import { SHARED_SGR_PLATFORM_FEE_KES } from "../../config/shared-rides.js";
import { prisma } from "../../lib/prisma.js";
import { getSmsProvider } from "../../lib/sms.js";
import { logger } from "../../lib/logger.js";
import { toNairobiIso } from "../../lib/nairobi-time.js";
import { persistBookingSeats, serializeBookingSeats } from "../../lib/booking-seats.js";
import { persistPlacePair } from "../../lib/place-persist.js";
import { sharedBookingPlaceInputs } from "../../lib/shared-booking-places.js";
import type { PickupPinDto } from "./shared-rides-pickup.js";
import {
  defaultNeighborhoodPickupPin,
  pickupPinFromSeat,
  SGR_CORRIDOR_SLUG,
} from "./shared-rides-pickup.js";
import { findOrCreatePassengerByPhone } from "./passenger-provision.service.js";
import { releaseExpiredSeatHolds } from "./departure-seats.service.js";

export type CreateCallInBookingInput = {
  phone: string;
  passengerName?: string;
  seatNumbers: number[];
  pickup?: PickupPinDto;
};

export type CallInBookingResult = {
  bookingId: string;
  passengerId: string;
  payInviteToken: string;
  payInviteUrl: string;
  reservedUntil: string;
  smsSent: boolean;
};

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

function isToSgrDeparture(departure: {
  dropoffLocation: { slug: string };
}): boolean {
  return departure.dropoffLocation.slug === SGR_CORRIDOR_SLUG;
}

async function assertDriverOwnsScheduledDeparture(driverId: string, departureId: string) {
  const departure = await prisma.sharedDeparture.findUnique({
    where: { id: departureId },
    include: {
      pickupLocation: true,
      dropoffLocation: true,
    },
  });
  if (!departure || departure.driverId !== driverId) {
    throw new AppError("FORBIDDEN", 403, "This departure belongs to another driver.");
  }
  if (departure.status !== "scheduled" && departure.status !== "boarding") {
    throw new AppError(
      "DEPARTURE_NOT_ACTIVE",
      409,
      "Call-in booking is only allowed while the van is scheduled or boarding.",
    );
  }
  if (departure.departureAt.getTime() <= Date.now()) {
    throw new AppError("DEPARTURE_CLOSED", 409, "This departure has already left.");
  }
  return departure;
}

/**
 * Driver call-in: create passenger (if needed), hold seats with trip-aware expiry, pending booking, SMS pay link.
 * Passenger does not log in — pays via signed link (M-Pesa STK). No temp password in SMS.
 */
export async function createCallInBooking(
  driverId: string,
  departureId: string,
  input: CreateCallInBookingInput,
): Promise<CallInBookingResult> {
  await releaseExpiredSeatHolds(departureId);
  const departure = await assertDriverOwnsScheduledDeparture(driverId, departureId);
  const seatNumbers = normalizeSeatNumbers(input.seatNumbers, departure.capacity);
  const passenger = await findOrCreatePassengerByPhone(input.phone, input.passengerName);

  const isToSgr = isToSgrDeparture(departure);
  if (isToSgr && !input.pickup) {
    throw new AppError(
      "PICKUP_LOCATION_REQUIRED",
      400,
      "Neighborhood pickup (lat/lng + label) is required for trips to SGR.",
    );
  }

  const expiresAt = callInHoldExpiresAt(departure.departureAt);
  const now = new Date();

  const bookingId = `BKG-${cuid()}`;
  const subtotal = departure.pricePerSeat * seatNumbers.length;
  const platformFee = SHARED_SGR_PLATFORM_FEE_KES;
  const total = subtotal + platformFee;

  await prisma.$transaction(async (tx) => {
    const rows = await tx.sharedDepartureSeat.findMany({
      where: { departureId, seatNumber: { in: seatNumbers } },
    });
    if (rows.length !== seatNumbers.length) {
      throw new AppError("SEAT_NOT_FOUND", 404, "One or more seats do not exist on this departure.");
    }

    for (const row of rows) {
      if (row.status === "paid" || row.status === "disabled") {
        throw new AppError("SEAT_NOT_AVAILABLE", 409, `Seat ${row.seatLabel ?? row.seatNumber} is not available.`);
      }
      if (row.status === "reserved") {
        const heldByOther =
          row.reservedById !== passenger.id &&
          row.expiresAt &&
          row.expiresAt.getTime() > now.getTime();
        if (heldByOther) {
          throw new AppError(
            "SEAT_NOT_AVAILABLE",
            409,
            `Seat ${row.seatLabel ?? row.seatNumber} is held by another passenger.`,
          );
        }
      }
    }

    const pickupData = input.pickup
      ? {
          pickupLabel: input.pickup.label,
          pickupLat: input.pickup.lat,
          pickupLng: input.pickup.lng,
        }
      : {
          pickupLabel: null,
          pickupLat: null,
          pickupLng: null,
        };

    await tx.sharedDepartureSeat.updateMany({
      where: { departureId, seatNumber: { in: seatNumbers } },
      data: {
        status: "reserved",
        reservedById: passenger.id,
        reservedAt: now,
        expiresAt,
        bookingId: null,
        ...pickupData,
      },
    });

    const held = await tx.sharedDepartureSeat.findFirst({
      where: { departureId, seatNumber: seatNumbers[0] },
    });

    const passengerPin =
      input.pickup ??
      (held ? pickupPinFromSeat(held) : null) ??
      (isToSgr ? defaultNeighborhoodPickupPin(departure) : null);

    if (isToSgr && !passengerPin) {
      throw new AppError(
        "PICKUP_LOCATION_REQUIRED",
        400,
        "Neighborhood pickup (lat/lng + label) is required for trips to SGR.",
      );
    }

    const sgrLoc =
      departure.pickupLocation.slug === SGR_CORRIDOR_SLUG
        ? departure.pickupLocation
        : departure.dropoffLocation;
    const sgrPlace = {
      label: sgrLoc.name,
      lat: sgrLoc.lat ?? 0,
      lng: sgrLoc.lng ?? 0,
    };
    const neighborhoodPlace =
      passengerPin ??
      defaultNeighborhoodPickupPin(departure) ?? {
        label: departure.dropoffLocation.name,
        lat: departure.dropoffLocation.lat ?? 0,
        lng: departure.dropoffLocation.lng ?? 0,
      };

    const pickupPlace = isToSgr ? passengerPin! : sgrPlace;
    const dropoffPlace = isToSgr
      ? {
          label: departure.dropoffLocation.name,
          lat: departure.dropoffLocation.lat ?? 0,
          lng: departure.dropoffLocation.lng ?? 0,
        }
      : neighborhoodPlace;

    const placeInputs = sharedBookingPlaceInputs(
      departure,
      pickupPlace,
      dropoffPlace,
      isToSgr,
    );
    const places = await persistPlacePair(tx, placeInputs.pickup, placeInputs.dropoff);

    await tx.booking.create({
      data: {
        id: bookingId,
        passengerId: passenger.id,
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
      where: { departureId, seatNumber: { in: seatNumbers }, reservedById: passenger.id },
      data: { bookingId },
    });
  });

  const expiresInSeconds = callInHoldExpiresInSeconds(expiresAt);
  const payInviteToken = signBookingPayInvite({
    bookingId,
    passengerId: passenger.id,
    expiresInSeconds,
  });
  const payInviteUrl = payInviteLink(payInviteToken);

  const routeLabel = `${departure.pickupLocation.name} → ${departure.dropoffLocation.name}`;
  const smsBody =
    `Songa: ${routeLabel} · departs ${toNairobiIso(departure.departureAt)}. ` +
    `Pay KSh ${total} for your seat: ${payInviteUrl}`;

  let smsSent = false;
  try {
    const result = await getSmsProvider().send({ to: passenger.phone, body: smsBody });
    smsSent = result.ok;
    if (!result.ok) {
      logger.warn({ bookingId, error: result.error }, "call-in: pay invite SMS failed");
    }
  } catch (err) {
    logger.warn({ err, bookingId }, "call-in: pay invite SMS error");
  }

  return {
    bookingId,
    passengerId: passenger.id,
    payInviteToken,
    payInviteUrl,
    reservedUntil: toNairobiIso(expiresAt),
    smsSent,
  };
}
