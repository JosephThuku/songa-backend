import cuid from "cuid";
import { BookingMode, Prisma, RideEventActor, RidePhase } from "@prisma/client";
import { driverLocationFreshSince } from "../lib/driver-location-freshness.js";
import { AppError } from "../lib/errors.js";
import { requirePaidBooking } from "./booking.service.js";
import { getBookingMode } from "../lib/ride-booking-mode.js";
import { hasDriverDeclinedRide, recordRideDriverDecline } from "../lib/ride-driver-decline.js";
import { persistRideSeats, rideSeatInclude, seatNumbersFromRide, serializeRideSeats } from "../lib/ride-seats.js";
import {
  canDriverEndTrip,
  canDriverMarkArrived,
  canDriverStartTrip,
  canPassengerCancelTrip,
  isTerminalPhase,
} from "../lib/ride-machine.js";
import { prisma } from "../lib/prisma.js";
import { haversineDistanceKm, estimatePickupEtaMinutes } from "../lib/geo.js";
import { publishRideChanged, publishRideOffer } from "../lib/ride-events.js";
import { computeFare } from "../lib/ride-pricing.js";
import { getRideProduct } from "../lib/ride-products.js";
import { persistPlacePair } from "../lib/place-persist.js";
import { toRideDto, type PlaceDto, type RideDto } from "../lib/responses.js";
import { withDispatchLock } from "../lib/dispatch-lock.js";
import { cancelOfferTimeout, scheduleOfferTimeout } from "../lib/offer-timeout.js";
import { createNotification } from "./notification.service.js";

const rideInclude = {
  passenger: true,
  driver: {
    include: {
      driverProfile: { include: { vehicle: true } },
      driverLocation: true,
    },
  },
  driverDeclines: { select: { driverId: true } },
  ...rideSeatInclude,
} as const;
const serializable = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;

const CANCEL_LABELS: Record<string, string> = {
  plans_changed: "My plans changed",
  wait_too_long: "Wait time is too long",
  found_another: "Found another ride",
  wrong_location: "Wrong pickup or drop-off",
  driver_asked: "Driver asked me to cancel",
  other: "Other",
};

export interface RequestRideInput {
  passengerId: string;
  optionId?: string;
  tripId?: string;
  listingId?: string;
  preferredDriverId?: string;
  pickup: PlaceDto;
  dropoff: PlaceDto;
  seats?: number[];
  prepaid?: boolean;
  bookingId?: string;
  paymentMethod?: string | null;
}

export interface CancelRideInput {
  rideId: string;
  passengerId: string;
  reasonId: string;
  reasonLabel: string;
  detail?: string | null;
}

function activePhaseFilter() {
  return { notIn: [RidePhase.trip_ended, RidePhase.cancelled] };
}

function resolveProduct(input: RequestRideInput) {
  const optionId = input.optionId ?? "car";
  const product = getRideProduct(optionId);
  if (!product) {
    throw new AppError("INVALID_INPUT", 400, "Unknown ride option.");
  }
  return product;
}

function validateCancelReason(reasonId: string, reasonLabel: string, detail?: string | null) {
  const canonicalLabel = CANCEL_LABELS[reasonId];
  if (!canonicalLabel) {
    throw new AppError("INVALID_INPUT", 400, "Invalid cancel reason.");
  }
  if (reasonLabel !== canonicalLabel) {
    throw new AppError("INVALID_INPUT", 400, "Invalid cancel reason.");
  }
  const trimmed = detail?.trim() ?? "";
  if (reasonId === "other" && trimmed.length < 3) {
    throw new AppError("INVALID_INPUT", 400, "Cancel detail is required for other.");
  }
  return {
    reasonId,
    reasonLabel: canonicalLabel,
    detail: reasonId === "other" ? trimmed : trimmed.length > 0 ? trimmed : null,
  };
}

async function loadRide(rideId: string) {
  return prisma.ride.findUnique({ where: { id: rideId }, include: rideInclude });
}

async function requireRideForPassenger(rideId: string, passengerId: string) {
  const ride = await loadRide(rideId);
  if (!ride || ride.passengerId !== passengerId) {
    throw new AppError("RIDE_NOT_FOUND", 404, "Ride not found.");
  }
  return ride;
}

async function requireRideForDriver(rideId: string, driverId: string) {
  const ride = await loadRide(rideId);
  if (!ride || ride.driverId !== driverId) {
    throw new AppError("RIDE_NOT_FOUND", 404, "Ride not found.");
  }
  return ride;
}

async function ensureDriverApproved(driverId: string) {
  const profile = await prisma.driverProfile.findUnique({ where: { userId: driverId } });
  if (!profile || profile.onboardingStatus !== "approved") {
    throw new AppError("DRIVER_NOT_APPROVED", 403, "Driver is not approved.");
  }
  return profile;
}

async function ensureDriverNotBusy(driverId: string) {
  const active = await prisma.ride.findFirst({
    where: { driverId, phase: activePhaseFilter() },
  });
  if (active) throw new AppError("DRIVER_BUSY", 409, "Driver already has an active ride.");
}

export async function requestRide(input: RequestRideInput, viewer: Express.UserContext): Promise<RideDto> {
  const product = resolveProduct(input);
  const fare = computeFare(input.pickup, input.dropoff);
  const price = Math.round(fare.total * product.priceMultiplier);
  const bookingMode: BookingMode = getBookingMode(input.pickup.label, input.dropoff.label);
  if (bookingMode === "seat_selection" && (!input.seats || input.seats.length === 0)) {
    throw new AppError("SEATS_REQUIRED", 409, "Seats are required for terminal trips.");
  }
  if (bookingMode === "pay_on_arrival" && input.seats && input.seats.length > 0) {
    throw new AppError("INVALID_INPUT", 400, "Seats are only valid for terminal trips.");
  }
  if (input.prepaid && !input.bookingId) {
    throw new AppError("INVALID_INPUT", 400, "bookingId is required when prepaid is true.");
  }
  if (input.prepaid && input.bookingId) {
    await requirePaidBooking(input.bookingId, input.passengerId);
  }

  // Bug 5.1 — block a new trip plan when the passenger still has an outstanding
  // unpaid booking from a previous attempt. Exclude the booking that this very
  // request is paying through (prepaid + bookingId) so that flow still works.
  const unpaidBooking = await prisma.booking.findFirst({
    where: {
      passengerId: input.passengerId,
      status: "pending_payment",
      ...(input.bookingId ? { id: { not: input.bookingId } } : {}),
    },
    select: { id: true },
  });
  if (unpaidBooking) {
    throw new AppError(
      "UNPAID_TRIP_PENDING",
      409,
      "Pay for your pending trip before requesting a new one.",
      { bookingId: unpaidBooking.id },
    );
  }

  const ride = await prisma.$transaction(async (tx) => {
    const active = await tx.ride.findFirst({
      where: { passengerId: input.passengerId, phase: activePhaseFilter() },
    });
    if (active) throw new AppError("RIDE_ALREADY_ACTIVE", 409, "Passenger already has an active ride.");

    const places = await persistPlacePair(tx, input.pickup, input.dropoff);
    const created = await tx.ride.create({
      data: {
        id: `ride_${cuid()}`,
        tripId: input.tripId ?? input.listingId ?? null,
        vehicleType: product.vehicleType,
        passengerId: input.passengerId,
        bookingMode,
        prepaid: input.prepaid ?? false,
        bookingId: input.bookingId ?? null,
        paymentMethod: input.paymentMethod ?? null,
        price,
        distanceKm: fare.distanceKm,
        etaMinutes: fare.durationMinutes,
        seats: serializeRideSeats(input.seats ?? []),
        pickup: places.pickup,
        dropoff: places.dropoff,
        pickupPlaceId: places.pickupPlaceId,
        dropoffPlaceId: places.dropoffPlaceId,
      },
    });
    await persistRideSeats(tx, created.id, input.seats);
    await tx.rideEvent.create({
      data: {
        rideId: created.id,
        actor: RideEventActor.passenger,
        actorId: input.passengerId,
        action: "ride.requested",
        phase: RidePhase.finding_driver,
      },
    });
    return tx.ride.findUniqueOrThrow({ where: { id: created.id }, include: rideInclude });
  }, serializable);

  publishRideChanged({ rideId: ride.id, phase: ride.phase });
  await dispatchRideOffers(ride, {
    preferredDriverId: input.preferredDriverId,
    vehicleType: product.vehicleType,
  });
  scheduleOfferTimeout(ride.id);
  return toRideDto(ride, viewer);
}

/** Re-offer to the next eligible drivers when the batch offer TTL expires. */
export async function redispatchRideIfPending(rideId: string): Promise<void> {
  await withDispatchLock(rideId, async () => {
    const ride = await loadRide(rideId);
    if (!ride || ride.phase !== RidePhase.finding_driver || ride.driverId) return;
    await dispatchRideOffers(ride, { vehicleType: ride.vehicleType });
    scheduleOfferTimeout(rideId);
  });
}

async function dispatchRideOffers(
  ride: Awaited<ReturnType<typeof loadRide>> & NonNullable<unknown>,
  options: { preferredDriverId?: string; vehicleType?: string | null },
) {
  const pickup = toPoint(ride.pickup);
  const freshSince = driverLocationFreshSince();
  const profiles = await prisma.driverProfile.findMany({
    where: {
      isOnline: true,
      onboardingStatus: "approved",
      locationUpdatedAt: { gte: freshSince },
      vehicleId: { not: null },
      ...(options.preferredDriverId ? { userId: options.preferredDriverId } : {}),
      ...(options.vehicleType ? { vehicle: { type: options.vehicleType } } : {}),
    },
    include: { user: true, vehicle: true },
  });

  const candidates = [];
  for (const profile of profiles) {
    if (hasDriverDeclinedRide(ride, profile.userId)) continue;
    const active = await prisma.ride.findFirst({
      where: { driverId: profile.userId, phase: activePhaseFilter() },
      select: { id: true },
    });
    if (active) continue;
    const location = toPoint(profile.location);
    candidates.push({ profile, distance: pickup && location ? haversineDistanceKm(pickup, location) : Number.POSITIVE_INFINITY });
  }
  candidates.sort((a, b) => a.distance - b.distance);

  const expiresAt = new Date(Date.now() + 15 * 1000).toISOString();
  const pickupLabel = placeLabel(ride.pickup);
  const dropoffLabel = placeLabel(ride.dropoff);
  for (const { profile } of candidates.slice(0, options.preferredDriverId ? 1 : 5)) {
    publishRideOffer({
      driverId: profile.userId,
      offer: {
        rideId: ride.id,
        pickup: ride.pickup,
        dropoff: ride.dropoff,
        price: ride.price,
        currency: ride.currency,
        bookingMode: ride.bookingMode,
        passengerName: ride.passenger.name ?? null,
        expiresAt,
      },
    });
    await createNotification({
      userId: profile.userId,
      title: "New ride request",
      body: `${pickupLabel} → ${dropoffLabel}`,
      type: "ride_offer",
      deepLink: `songa://rides/${ride.id}`,
      metadata: { rideId: ride.id, expiresAt },
    });
  }
}

function toPoint(value: unknown): { lat: number; lng: number } | null {
  const object = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  if (!object || typeof object.lat !== "number" || typeof object.lng !== "number") return null;
  return { lat: object.lat, lng: object.lng };
}

export async function getActiveRide(user: Express.UserContext): Promise<RideDto | null> {
  const where =
    user.role === "passenger"
      ? { passengerId: user.id, phase: activePhaseFilter() }
      : { driverId: user.id, phase: activePhaseFilter() };
  const ride = await prisma.ride.findFirst({ where, include: rideInclude, orderBy: { createdAt: "desc" } });
  return ride ? toRideDto(ride, user) : null;
}

export async function getRideById(rideId: string, user: Express.UserContext): Promise<RideDto> {
  const ride = await loadRide(rideId);
  if (!ride || (ride.passengerId !== user.id && ride.driverId !== user.id)) {
    throw new AppError("RIDE_NOT_FOUND", 404, "Ride not found.");
  }
  return toRideDto(ride, user);
}

export async function cancelRide(input: CancelRideInput, viewer: Express.UserContext): Promise<RideDto> {
  const reason = validateCancelReason(input.reasonId, input.reasonLabel, input.detail);
  const ride = await requireRideForPassenger(input.rideId, input.passengerId);
  if (!canPassengerCancelTrip(ride.phase)) {
    throw new AppError("RIDE_NOT_CANCELLABLE", 409, "Ride cannot be cancelled in this phase.", {
      phase: ride.phase,
    });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const write = await tx.ride.updateMany({
      where: {
        id: ride.id,
        passengerId: input.passengerId,
        phase: { in: [RidePhase.finding_driver, RidePhase.driver_accepted, RidePhase.driver_en_route, RidePhase.driver_arriving] },
      },
      data: {
        phase: RidePhase.cancelled,
        cancelReason: reason,
        cancelledByRole: RideEventActor.passenger,
      },
    });
    if (write.count !== 1) {
      throw new AppError("RIDE_NOT_CANCELLABLE", 409, "Ride cannot be cancelled in this phase.", {
        phase: ride.phase,
      });
    }
    await tx.rideEvent.create({
      data: {
        rideId: ride.id,
        actor: RideEventActor.passenger,
        actorId: input.passengerId,
        action: "ride.cancelled",
        phase: RidePhase.cancelled,
        metadata: reason,
      },
    });
    return tx.ride.findUniqueOrThrow({ where: { id: ride.id }, include: rideInclude });
  }, serializable);
  publishRideChanged({ rideId: updated.id, phase: updated.phase });
  cancelOfferTimeout(updated.id);
  return toRideDto(updated, viewer);
}

export async function acceptRide(rideId: string, driverId: string, viewer: Express.UserContext): Promise<RideDto> {
  const updated = await prisma.$transaction(async (tx) => {
    const profile = await tx.driverProfile.findUnique({
      where: { userId: driverId },
      include: { vehicle: true },
    });
    if (!profile || profile.onboardingStatus !== "approved") {
      throw new AppError("DRIVER_NOT_APPROVED", 403, "Driver is not approved.");
    }
    if (!profile.vehicle) {
      throw new AppError("VEHICLE_REQUIRED", 409, "Driver has no registered vehicle.");
    }
    const ride = await tx.ride.findUnique({ where: { id: rideId }, include: rideInclude });
    if (!ride) throw new AppError("RIDE_NOT_FOUND", 404, "Ride not found.");
    if (hasDriverDeclinedRide(ride, driverId)) {
      throw new AppError("OFFER_DECLINED", 409, "Driver already declined this offer.");
    }
    if (ride.phase !== RidePhase.finding_driver || ride.driverId) {
      throw new AppError("OFFER_EXPIRED", 409, "Ride offer is no longer available.");
    }
    if (ride.vehicleType && profile.vehicle.type !== ride.vehicleType) {
      throw new AppError("INVALID_VEHICLE_TYPE", 409, "Driver vehicle does not match this ride option.");
    }
    const seatNumbers = seatNumbersFromRide(ride) ?? [];
    if (seatNumbers.length > 0 && seatNumbers.length > profile.vehicle.seats) {
      throw new AppError("SEATS_EXCEED_CAPACITY", 409, "Requested seats exceed vehicle capacity.");
    }
    const active = await tx.ride.findFirst({
      where: { driverId, phase: activePhaseFilter() },
    });
    if (active) throw new AppError("DRIVER_BUSY", 409, "Driver already has an active ride.");

    const driverPoint = toPoint(profile.location);
    const pickupPoint = toPoint(ride.pickup);
    const pickupDistanceKm =
      driverPoint && pickupPoint ? haversineDistanceKm(pickupPoint, driverPoint) : null;
    const pickupEta = pickupDistanceKm !== null ? estimatePickupEtaMinutes(pickupDistanceKm) : 8;

    const write = await tx.ride.updateMany({
      where: { id: ride.id, phase: RidePhase.finding_driver, driverId: null },
      data: {
        driverId,
        phase: RidePhase.driver_en_route,
        etaMinutes: pickupEta,
        ...(pickupDistanceKm !== null ? { distanceKm: Math.round(pickupDistanceKm * 10) / 10 } : {}),
      },
    });
    if (write.count !== 1) throw new AppError("OFFER_EXPIRED", 409, "Ride offer is no longer available.");
    await tx.rideEvent.create({
      data: {
        rideId: ride.id,
        actor: RideEventActor.driver,
        actorId: driverId,
        action: "driver.accepted",
        phase: RidePhase.driver_en_route,
      },
    });
    return tx.ride.findUniqueOrThrow({ where: { id: ride.id }, include: rideInclude });
  }, serializable);
  publishRideChanged({ rideId: updated.id, phase: updated.phase });
  cancelOfferTimeout(updated.id);
  const driverName = updated.driver?.name ?? "Your driver";
  await createNotification({
    userId: updated.passengerId,
    title: "Driver accepted",
    body: `${driverName} is on the way.`,
    type: "ride_update",
    deepLink: `songa://rides/${updated.id}`,
    metadata: { rideId: updated.id, phase: updated.phase },
  });
  return toRideDto(updated, viewer);
}

export async function declineRide(rideId: string, driverId: string): Promise<{ ok: true }> {
  await prisma.$transaction(async (tx) => {
    const profile = await tx.driverProfile.findUnique({ where: { userId: driverId } });
    if (!profile || profile.onboardingStatus !== "approved") {
      throw new AppError("DRIVER_NOT_APPROVED", 403, "Driver is not approved.");
    }
    const ride = await tx.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new AppError("RIDE_NOT_FOUND", 404, "Ride not found.");
    if (ride.phase !== RidePhase.finding_driver || ride.driverId) {
      throw new AppError("OFFER_EXPIRED", 409, "Ride offer is no longer available.");
    }
    await recordRideDriverDecline(tx, ride.id, driverId);
    await tx.rideEvent.create({
      data: {
        rideId: ride.id,
        actor: RideEventActor.driver,
        actorId: driverId,
        action: "driver.declined",
        phase: ride.phase,
      },
    });
  }, serializable);
  publishRideChanged({ rideId, phase: RidePhase.finding_driver });
  return { ok: true };
}

export async function markArrived(rideId: string, driverId: string, viewer: Express.UserContext): Promise<RideDto> {
  const ride = await requireRideForDriver(rideId, driverId);
  if (!canDriverMarkArrived(ride.phase)) {
    throw new AppError("INVALID_PHASE", 409, "Invalid ride phase.", {
      from: ride.phase,
      allowed: ["driver_accepted", "driver_en_route", "driver_arriving"],
    });
  }
  return transitionDriverRide(ride.id, driverId, RidePhase.driver_arrived, "driver.arrived", viewer, {
    etaMinutes: 0,
    distanceKm: 0,
  });
}

export async function startRide(rideId: string, driverId: string, viewer: Express.UserContext): Promise<RideDto> {
  const ride = await requireRideForDriver(rideId, driverId);
  if (!canDriverStartTrip(ride.phase)) {
    throw new AppError("INVALID_PHASE", 409, "Invalid ride phase.", {
      from: ride.phase,
      allowed: ["driver_arrived"],
    });
  }
  return transitionDriverRide(ride.id, driverId, RidePhase.trip_in_progress, "trip.started", viewer, {
    passengerBoarded: true,
  });
}

export async function rateDriverForRide(
  rideId: string,
  passengerId: string,
  stars: number,
  viewer: Express.UserContext,
): Promise<RideDto> {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw new AppError("INVALID_INPUT", 400, "Rating must be between 1 and 5 stars.");
  }

  const ride = await requireRideForPassenger(rideId, passengerId);
  if (ride.phase !== RidePhase.trip_ended) {
    throw new AppError("INVALID_PHASE", 409, "You can only rate after the trip ends.", {
      phase: ride.phase,
    });
  }
  if (!ride.driverId) {
    throw new AppError("INVALID_INPUT", 400, "No driver assigned to this ride.");
  }
  if (ride.passengerDriverRating != null) {
    throw new AppError("ALREADY_RATED", 409, "You already rated this trip.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const write = await tx.ride.updateMany({
      where: {
        id: rideId,
        passengerId,
        phase: RidePhase.trip_ended,
        passengerDriverRating: null,
      },
      data: { passengerDriverRating: stars },
    });
    if (write.count !== 1) {
      throw new AppError("ALREADY_RATED", 409, "You already rated this trip.");
    }

    await tx.rideEvent.create({
      data: {
        rideId,
        actor: RideEventActor.passenger,
        actorId: passengerId,
        action: "ride.driver_rated",
        phase: RidePhase.trip_ended,
        metadata: { stars },
      },
    });

    const avg = await tx.ride.aggregate({
      where: { driverId: ride.driverId, passengerDriverRating: { not: null } },
      _avg: { passengerDriverRating: true },
    });
    const nextRating = avg._avg.passengerDriverRating ?? stars;
    if (ride.driverId) {
      await tx.user.update({
        where: { id: ride.driverId },
        data: { rating: Math.round(nextRating * 10) / 10 },
      });
    }

    return tx.ride.findUniqueOrThrow({ where: { id: rideId }, include: rideInclude });
  }, serializable);

  return toRideDto(updated, viewer);
}

export async function completeRide(rideId: string, driverId: string, viewer: Express.UserContext): Promise<RideDto> {
  const ride = await requireRideForDriver(rideId, driverId);
  if (!canDriverEndTrip(ride.phase)) {
    throw new AppError("INVALID_PHASE", 409, "Invalid ride phase.", {
      from: ride.phase,
      allowed: ["trip_in_progress"],
    });
  }
  return transitionDriverRide(ride.id, driverId, RidePhase.trip_ended, "trip.ended", viewer, {
    driverProgress: 1,
  });
}

async function transitionDriverRide(
  rideId: string,
  driverId: string,
  phase: RidePhase,
  action: string,
  viewer: Express.UserContext,
  data: Record<string, unknown>,
): Promise<RideDto> {
  const updated = await prisma.$transaction(async (tx) => {
    const write = await tx.ride.updateMany({ where: { id: rideId, driverId, phase: previousPhaseFor(phase) }, data: { ...data, phase } });
    if (write.count !== 1) throw new AppError("INVALID_PHASE", 409, "Invalid ride phase.");
    const currentRide = await tx.ride.findUniqueOrThrow({ where: { id: rideId } });
    if (phase === RidePhase.trip_ended && currentRide.prepaid) {
      // Only in-app collected rides become withdrawable wallet balance.
      // Pay-on-drop rides are paid directly to the driver and remain ride earnings/history.
      await tx.walletTransaction.create({
        data: {
          id: `tx_${cuid()}`,
          driverId,
          rideId,
          type: "credit",
          label: tripCreditLabel(currentRide.pickup, currentRide.dropoff),
          amount: currentRide.price,
          status: "posted",
        },
      });
    }
    await tx.rideEvent.create({
      data: {
        rideId,
        actor: RideEventActor.driver,
        actorId: driverId,
        action,
        phase,
      },
    });
    return tx.ride.findUniqueOrThrow({ where: { id: rideId }, include: rideInclude });
  }, serializable);
  publishRideChanged({ rideId: updated.id, phase: updated.phase });
  if (phase === RidePhase.driver_arrived) {
    await createNotification({
      userId: updated.passengerId,
      title: "Driver arrived",
      body: "Your driver has arrived at the pickup point.",
      type: "ride_update",
      deepLink: `songa://rides/${updated.id}`,
      metadata: { rideId: updated.id, phase: updated.phase },
    });
  }
  if (phase === RidePhase.trip_ended) {
    const payHint = updated.prepaid
      ? "Your fare was paid in the app."
      : `Pay KSh ${updated.price.toLocaleString("en-KE")} to your driver in cash.`;
    await createNotification({
      userId: updated.passengerId,
      title: "Trip completed",
      body: `${payHint} Please rate your driver in the app.`,
      type: "ride_update",
      deepLink: `songa://rides/${updated.id}`,
      metadata: { rideId: updated.id, phase: updated.phase },
    });
  }
  return toRideDto(updated, viewer);
}

function tripCreditLabel(pickup: unknown, dropoff: unknown): string {
  const from = placeLabel(pickup);
  const to = placeLabel(dropoff);
  return `Trip · ${from} → ${to}`;
}

function placeLabel(value: unknown): string {
  const object = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const label = typeof object.label === "string" ? object.label : "Ride";
  return label.split(",")[0] ?? label;
}

export function isRideTerminal(phase: RidePhase): boolean {
  return isTerminalPhase(phase);
}

function previousPhaseFor(phase: RidePhase): RidePhase | { in: RidePhase[] } {
  if (phase === RidePhase.driver_arrived) {
    return { in: [RidePhase.driver_accepted, RidePhase.driver_en_route, RidePhase.driver_arriving] };
  }
  if (phase === RidePhase.trip_in_progress) return RidePhase.driver_arrived;
  if (phase === RidePhase.trip_ended) return RidePhase.trip_in_progress;
  return phase;
}
