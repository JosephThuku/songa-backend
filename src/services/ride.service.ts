import cuid from "cuid";
import { BookingMode, Prisma, RideEventActor, RidePhase } from "@prisma/client";
import { AppError } from "../lib/errors.js";
import { requirePaidBooking } from "./booking.service.js";
import { getBookingMode } from "../lib/ride-booking-mode.js";
import { appendDeclinedBy, hasDeclined } from "../lib/ride-decline.js";
import {
  canDriverEndTrip,
  canDriverMarkArrived,
  canDriverStartTrip,
  canPassengerCancelTrip,
  isTerminalPhase,
} from "../lib/ride-machine.js";
import { prisma } from "../lib/prisma.js";
import { publishRideChanged, publishRideOffer } from "../lib/ride-events.js";
import { toRideDto, type PlaceDto, type RideDto } from "../lib/responses.js";
import { createNotification } from "./notification.service.js";

const rideInclude = {
  passenger: true,
  driver: { include: { driverProfile: { include: { vehicle: true } } } },
} as const;
const serializable = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;

const CANCEL_LABELS: Record<string, string> = {
  plans_changed: "Plans changed",
  wait_too_long: "Wait time is too long",
  found_another: "Found another ride",
  wrong_location: "Wrong pickup location",
  driver_asked: "Driver asked me to cancel",
  other: "Other",
};

export interface RequestRideInput {
  passengerId: string;
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

function serializeSeats(seats: number[] | undefined): string | null {
  return seats && seats.length > 0 ? seats.join(",") : null;
}

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthKm = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthKm * Math.asin(Math.sqrt(h));
}

function priceFor(input: RequestRideInput): number {
  return Math.max(200, Math.round(distanceKm(input.pickup, input.dropoff) * 100));
}

function placeJson(place: PlaceDto): Prisma.InputJsonObject {
  return {
    ...(place.placeId ? { placeId: place.placeId } : {}),
    label: place.label,
    lat: place.lat,
    lng: place.lng,
  };
}

function validateCancelReason(reasonId: string, reasonLabel: string, detail?: string | null) {
  const expected = CANCEL_LABELS[reasonId];
  if (!expected || expected !== reasonLabel) {
    throw new AppError("INVALID_INPUT", 400, "Invalid cancel reason.");
  }
  const trimmed = detail?.trim() ?? "";
  if (reasonId === "other" && trimmed.length < 3) {
    throw new AppError("INVALID_INPUT", 400, "Cancel detail is required for other.");
  }
  return {
    reasonId,
    reasonLabel,
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

  const ride = await prisma.$transaction(async (tx) => {
    const active = await tx.ride.findFirst({
      where: { passengerId: input.passengerId, phase: activePhaseFilter() },
    });
    if (active) throw new AppError("RIDE_ALREADY_ACTIVE", 409, "Passenger already has an active ride.");

    const created = await tx.ride.create({
      data: {
        id: `ride_${cuid()}`,
        tripId: input.tripId ?? input.listingId ?? null,
        passengerId: input.passengerId,
        bookingMode,
        prepaid: input.prepaid ?? false,
        bookingId: input.bookingId ?? null,
        paymentMethod: input.paymentMethod ?? null,
        price: priceFor(input),
        seats: serializeSeats(input.seats),
        pickup: placeJson(input.pickup),
        dropoff: placeJson(input.dropoff),
      },
    });
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
  await dispatchRideOffers(ride, input.preferredDriverId);
  return toRideDto(ride, viewer);
}

async function dispatchRideOffers(ride: Awaited<ReturnType<typeof loadRide>> & NonNullable<unknown>, preferredDriverId?: string) {
  const pickup = toPoint(ride.pickup);
  const freshSince = new Date(Date.now() - 60 * 1000);
  const profiles = await prisma.driverProfile.findMany({
    where: {
      isOnline: true,
      onboardingStatus: "approved",
      locationUpdatedAt: { gte: freshSince },
      ...(preferredDriverId ? { userId: preferredDriverId } : {}),
    },
    include: { user: true },
  });

  const candidates = [];
  for (const profile of profiles) {
    const active = await prisma.ride.findFirst({
      where: { driverId: profile.userId, phase: activePhaseFilter() },
      select: { id: true },
    });
    if (active) continue;
    const location = toPoint(profile.location);
    candidates.push({ profile, distance: pickup && location ? distanceKm(pickup, location) : Number.POSITIVE_INFINITY });
  }
  candidates.sort((a, b) => a.distance - b.distance);

  const expiresAt = new Date(Date.now() + 15 * 1000).toISOString();
  const pickupLabel = placeLabel(ride.pickup);
  const dropoffLabel = placeLabel(ride.dropoff);
  for (const { profile } of candidates.slice(0, preferredDriverId ? 1 : 5)) {
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
  return toRideDto(updated, viewer);
}

export async function acceptRide(rideId: string, driverId: string, viewer: Express.UserContext): Promise<RideDto> {
  const updated = await prisma.$transaction(async (tx) => {
    const profile = await tx.driverProfile.findUnique({ where: { userId: driverId } });
    if (!profile || profile.onboardingStatus !== "approved") {
      throw new AppError("DRIVER_NOT_APPROVED", 403, "Driver is not approved.");
    }
    const ride = await tx.ride.findUnique({ where: { id: rideId }, include: rideInclude });
    if (!ride) throw new AppError("RIDE_NOT_FOUND", 404, "Ride not found.");
    if (hasDeclined(ride.declinedBy, driverId)) {
      throw new AppError("OFFER_DECLINED", 409, "Driver already declined this offer.");
    }
    if (ride.phase !== RidePhase.finding_driver || ride.driverId) {
      throw new AppError("OFFER_EXPIRED", 409, "Ride offer is no longer available.");
    }
    const active = await tx.ride.findFirst({
      where: { driverId, phase: activePhaseFilter() },
    });
    if (active) throw new AppError("DRIVER_BUSY", 409, "Driver already has an active ride.");

    const write = await tx.ride.updateMany({
      where: { id: ride.id, phase: RidePhase.finding_driver, driverId: null },
      data: {
        driverId,
        phase: RidePhase.driver_accepted,
        etaMinutes: 8,
        distanceKm: 3.4,
      },
    });
    if (write.count !== 1) throw new AppError("OFFER_EXPIRED", 409, "Ride offer is no longer available.");
    await tx.rideEvent.create({
      data: {
        rideId: ride.id,
        actor: RideEventActor.driver,
        actorId: driverId,
        action: "driver.accepted",
        phase: RidePhase.driver_accepted,
      },
    });
    return tx.ride.findUniqueOrThrow({ where: { id: ride.id }, include: rideInclude });
  }, serializable);
  publishRideChanged({ rideId: updated.id, phase: updated.phase });
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
    await tx.ride.update({
      where: { id: ride.id },
      data: { declinedBy: appendDeclinedBy(ride.declinedBy, driverId) },
    });
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
    if (phase === RidePhase.trip_ended) {
      await tx.walletTransaction.create({
        data: {
          id: `tx_${cuid()}`,
          driverId,
          rideId,
          type: "credit",
          label: tripCreditLabel(currentRide.pickup, currentRide.dropoff),
          amount: Math.max(0, currentRide.price - 50),
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
    await createNotification({
      userId: updated.passengerId,
      title: "Trip completed",
      body: "Your trip has ended. Thanks for riding with Songa.",
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
