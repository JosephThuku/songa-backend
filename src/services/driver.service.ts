import { Prisma } from "@prisma/client";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { publishRideChanged } from "../lib/ride-events.js";

export interface DriverOnlineResult {
  isOnline: boolean;
  onlineSince: string | null;
}

export async function setDriverOnline(driverId: string, isOnline: boolean): Promise<DriverOnlineResult> {
  const profile = await prisma.driverProfile.findUnique({ where: { userId: driverId } });
  if (!profile || profile.onboardingStatus !== "approved") {
    throw new AppError("DRIVER_NOT_APPROVED", 403, "Driver is not approved.");
  }

  const onlineSince = isOnline ? profile.onlineSince ?? new Date() : null;
  const updated = await prisma.driverProfile.update({
    where: { userId: driverId },
    data: { isOnline, onlineSince },
  });
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

function locationJson(input: DriverLocationInput, updatedAt: Date): Prisma.InputJsonObject {
  return {
    lat: input.lat,
    lng: input.lng,
    ...(input.heading !== undefined ? { heading: input.heading } : {}),
    ...(input.speedKmh !== undefined ? { speedKmh: input.speedKmh } : {}),
    ...(input.accuracyM !== undefined ? { accuracyM: input.accuracyM } : {}),
    updatedAt: updatedAt.toISOString(),
  };
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

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
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

export async function updateDriverLocation(driverId: string, input: DriverLocationInput): Promise<void> {
  const profile = await prisma.driverProfile.findUnique({ where: { userId: driverId } });
  if (!profile || profile.onboardingStatus !== "approved") {
    throw new AppError("DRIVER_NOT_APPROVED", 403, "Driver is not approved.");
  }
  if (!profile.isOnline) throw new AppError("DRIVER_OFFLINE", 409, "Driver must be online to post location.");

  const updatedAt = input.recordedAt ? new Date(input.recordedAt) : new Date();
  if (Number.isNaN(updatedAt.getTime())) throw new AppError("INVALID_INPUT", 400, "recordedAt is invalid.");
  const location = locationJson(input, updatedAt);

  await prisma.driverProfile.update({
    where: { userId: driverId },
    data: { location, locationUpdatedAt: updatedAt },
  });

  const activeRide = await prisma.ride.findFirst({
    where: { driverId, phase: { notIn: ["trip_ended", "cancelled"] } },
  });
  if (activeRide) {
    await prisma.ride.update({
      where: { id: activeRide.id },
      data: { driverLocation: location },
    });
    publishRideChanged({ rideId: activeRide.id, phase: activeRide.phase });
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
  const freshSince = new Date(Date.now() - 60 * 1000);
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
