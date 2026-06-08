import { RidePhase } from "@prisma/client";
import { driverLocationFreshSince } from "../lib/driver-location-freshness.js";
import { AppError } from "../lib/errors.js";
import { estimatePickupEtaMinutes, haversineDistanceKm, type LatLng } from "../lib/geo.js";
import { indexDriverLocation, removeDriverFromGeoIndex } from "../lib/driver-geo.js";
import { prisma } from "../lib/prisma.js";
import { publishRideChanged } from "../lib/ride-events.js";
import { persistDriverLocation } from "../lib/driver-location.js";
import { syncActiveRideFromDriverLocation } from "../lib/ride-location-sync.js";

export interface DriverOnlineResult {
  isOnline: boolean;
  onlineSince: string | null;
}

export async function setDriverOnline(driverId: string, isOnline: boolean): Promise<DriverOnlineResult> {
  const profile = await prisma.driverProfile.findUnique({
    where: { userId: driverId },
    include: { vehicle: true },
  });
  if (!profile || profile.onboardingStatus !== "approved") {
    throw new AppError("DRIVER_NOT_APPROVED", 403, "Driver is not approved.");
  }
  if (isOnline) {
    if (!profile.vehicleId || !profile.vehicle) {
      throw new AppError("VEHICLE_REQUIRED", 409, "Register a vehicle before going online.");
    }
    if (profile.vehicle.status !== "Activated") {
      throw new AppError("VEHICLE_NOT_ACTIVATED", 409, "Vehicle is not activated.");
    }
  }

  const onlineSince = isOnline ? profile.onlineSince ?? new Date() : null;
  const updated = await prisma.driverProfile.update({
    where: { userId: driverId },
    data: { isOnline, onlineSince },
  });
  if (isOnline && profile.location && typeof profile.location === "object") {
    const loc = profile.location as Record<string, unknown>;
    if (typeof loc.lat === "number" && typeof loc.lng === "number") {
      await indexDriverLocation(driverId, loc.lng, loc.lat);
    }
  } else if (!isOnline) {
    await removeDriverFromGeoIndex(driverId);
  }
  return {
    isOnline: updated.isOnline,
    onlineSince: updated.onlineSince ? updated.onlineSince.toISOString() : null,
  };
}

export interface DriverLocationInput {
  lat: number;
  lng: number;
  heading?: number;
  speedKmh?: number;
  accuracyM?: number;
  recordedAt?: string;
}

export interface NearbyDriverDto {
  driverId: string;
  name: string | null;
  avatar: string;
  avatarUrl: string | null;
  rating: number;
  distanceKm: number;
  etaMinutes: number;
  vehicle: {
    type: string;
    label: string;
    registration: string;
    color: string;
    capacity: number;
    seatsAvailable: number;
  } | null;
  location: { lat: number; lng: number; heading?: number; speedKmh?: number; updatedAt: string };
  dailyRoute: null;
  estimatedFare: { amount: number; currency: "KES"; bookingMode: "pay_on_arrival" };
  listingId: null;
}

function parseLocation(value: unknown): { lat: number; lng: number; heading?: number; speedKmh?: number } | null {
  const object = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  if (!object || typeof object.lat !== "number" || typeof object.lng !== "number") return null;
  return {
    lat: object.lat,
    lng: object.lng,
    ...(typeof object.heading === "number" ? { heading: object.heading } : {}),
    ...(typeof object.speedKmh === "number" ? { speedKmh: object.speedKmh } : {}),
  };
}

/** @deprecated Prefer `haversineDistanceKm` from `lib/geo.js`. */
export function distanceKm(a: LatLng, b: LatLng): number {
  return haversineDistanceKm(a, b);
}

export interface DriverNearPickup {
  driverId: string;
  name: string | null;
  avatar: string;
  avatarUrl: string | null;
  rating: number;
  pickupDistanceKm: number;
  pickupEtaMinutes: number;
  vehicle: NearbyDriverDto["vehicle"];
  location: NearbyDriverDto["location"];
}

const ACTIVE_RIDE_PHASES = {
  notIn: [RidePhase.trip_ended, RidePhase.cancelled],
};

async function loadEligibleDriverProfiles(vehicleType?: string) {
  const freshSince = driverLocationFreshSince();
  return prisma.driverProfile.findMany({
    where: {
      isOnline: true,
      onboardingStatus: "approved",
      locationUpdatedAt: { gte: freshSince },
      vehicleId: { not: null },
      ...(vehicleType && vehicleType !== "All" ? { vehicle: { type: vehicleType } } : {}),
    },
    include: { user: true, vehicle: true },
  });
}

/** Online, fresh-location drivers sorted by distance to pickup (Uber-style supply search). */
export async function findDriversNearPickup(input: {
  pickup: LatLng;
  vehicleType?: string;
  radiusKm?: number;
  limit?: number;
}): Promise<DriverNearPickup[]> {
  const radiusKm = input.radiusKm ?? 25;
  const profiles = await loadEligibleDriverProfiles(input.vehicleType);
  const candidates: DriverNearPickup[] = [];

  for (const profile of profiles) {
    const location = parseLocation(profile.location);
    if (!location || !profile.locationUpdatedAt) continue;

    const busy = await prisma.ride.findFirst({
      where: { driverId: profile.userId, phase: ACTIVE_RIDE_PHASES },
      select: { id: true },
    });
    if (busy) continue;

    const pickupDistanceKm = haversineDistanceKm(input.pickup, location);
    if (pickupDistanceKm > radiusKm) continue;

    candidates.push({
      driverId: profile.userId,
      name: profile.user.name ?? null,
      avatar: initials(profile.user.name),
      avatarUrl: profile.user.avatarUrl ?? null,
      rating: profile.user.rating,
      pickupDistanceKm: Math.round(pickupDistanceKm * 10) / 10,
      pickupEtaMinutes: estimatePickupEtaMinutes(pickupDistanceKm),
      vehicle: profile.vehicle
        ? {
            type: profile.vehicle.type,
            label: `${profile.vehicle.make} ${profile.vehicle.model}`,
            registration: profile.vehicle.registration,
            color: profile.vehicle.color,
            capacity: profile.vehicle.seats,
            seatsAvailable: Math.max(1, profile.vehicle.seats - 1),
          }
        : null,
      location: { ...location, updatedAt: profile.locationUpdatedAt.toISOString() },
    });
  }

  candidates.sort((a, b) => a.pickupDistanceKm - b.pickupDistanceKm);
  const limit = input.limit ?? candidates.length;
  return candidates.slice(0, limit);
}

export async function updateDriverLocation(driverId: string, input: DriverLocationInput): Promise<void> {
  const profile = await prisma.driverProfile.findUnique({ where: { userId: driverId } });
  if (!profile || profile.onboardingStatus !== "approved") {
    throw new AppError("DRIVER_NOT_APPROVED", 403, "Driver is not approved.");
  }

  const recordedAt = input.recordedAt ? new Date(input.recordedAt) : new Date();
  if (Number.isNaN(recordedAt.getTime())) throw new AppError("INVALID_INPUT", 400, "recordedAt is invalid.");

  const payload = await persistDriverLocation(prisma, driverId, {
    lat: input.lat,
    lng: input.lng,
    heading: input.heading,
    speedKmh: input.speedKmh,
    accuracyM: input.accuracyM,
    recordedAt,
  });

  const activeRide = await prisma.ride.findFirst({
    where: { driverId, phase: { notIn: ["trip_ended", "cancelled"] } },
  });
  if (profile.isOnline) {
    await indexDriverLocation(driverId, input.lng, input.lat);
  }

  if (activeRide) {
    await syncActiveRideFromDriverLocation(activeRide.id, payload);
  }
}

export async function getNearbyDrivers(input: {
  lat: number;
  lng: number;
  vehicleType?: string;
  radiusKm?: number;
}): Promise<NearbyDriverDto[]> {
  const origin = { lat: input.lat, lng: input.lng };
  const radiusKm = input.radiusKm ?? 25;
  const freshSince = driverLocationFreshSince();
  const profiles = await prisma.driverProfile.findMany({
    where: {
      isOnline: true,
      onboardingStatus: "approved",
      locationUpdatedAt: { gte: freshSince },
      ...(input.vehicleType && input.vehicleType !== "All"
        ? { vehicle: { type: input.vehicleType } }
        : {}),
    },
    include: { user: true, vehicle: true },
  });

  return profiles
    .map((profile) => {
      const location = parseLocation(profile.location);
      if (!location || !profile.locationUpdatedAt) return null;
      const distance = distanceKm(origin, location);
      if (distance > radiusKm) return null;
      return {
        driverId: profile.userId,
        name: profile.user.name ?? null,
        avatar: initials(profile.user.name),
        avatarUrl: profile.user.avatarUrl ?? null,
        rating: profile.user.rating,
        distanceKm: Math.round(distance * 10) / 10,
        etaMinutes: Math.max(1, Math.round(distance / 0.45)),
        vehicle: profile.vehicle
          ? {
              type: profile.vehicle.type,
              label: `${profile.vehicle.make} ${profile.vehicle.model}`,
              registration: profile.vehicle.registration,
              color: profile.vehicle.color,
              capacity: profile.vehicle.seats,
              seatsAvailable: Math.max(1, profile.vehicle.seats - 1),
            }
          : null,
        location: { ...location, updatedAt: profile.locationUpdatedAt.toISOString() },
        dailyRoute: null,
        estimatedFare: { amount: Math.max(200, Math.round(distance * 100)), currency: "KES", bookingMode: "pay_on_arrival" },
        listingId: null,
      } satisfies NearbyDriverDto;
    })
    .filter((driver): driver is NearbyDriverDto => Boolean(driver))
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

function initials(name: string | null): string {
  if (!name) return "DR";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "DR";
}
