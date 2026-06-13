import { RidePhase } from "@prisma/client";
import { AppError } from "../lib/errors.js";
import type { LatLng } from "../lib/geo.js";
import { getDrivingRoute, type RoutePlan } from "../lib/routing.js";
import { parseLatLngFromJson, resolveDriverLocationRecord } from "../lib/driver-location.js";
import { prisma } from "../lib/prisma.js";

async function resolveDriverPoint(
  driverId: string | null,
  driverLocation: unknown,
): Promise<LatLng | null> {
  const onRide = parseLatLng(driverLocation);
  if (onRide) return onRide;
  if (!driverId) return null;

  const canonical = await resolveDriverLocationRecord(driverId);
  if (canonical) return { lat: canonical.lat, lng: canonical.lng };

  const profile = await prisma.driverProfile.findUnique({
    where: { userId: driverId },
    select: { location: true },
  });
  return parseLatLngFromJson(profile?.location);
}

export type NavigationTarget = "pickup" | "dropoff";

function parseLatLng(value: unknown): LatLng | null {
  const object = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  if (!object || typeof object.lat !== "number" || typeof object.lng !== "number") return null;
  return { lat: object.lat, lng: object.lng };
}

function navigationTargetForPhase(phase: RidePhase): NavigationTarget | null {
  if (
    phase === RidePhase.driver_accepted ||
    phase === RidePhase.driver_en_route ||
    phase === RidePhase.driver_arriving ||
    phase === RidePhase.driver_arrived
  ) {
    return "pickup";
  }
  if (phase === RidePhase.trip_in_progress) return "dropoff";
  return null;
}

export type RideNavigationDto = {
  rideId: string;
  phase: RidePhase;
  target: NavigationTarget;
  distanceKm: number;
  etaMinutes: number;
  durationMinutes: number;
  durationInTrafficMinutes: number;
  summary: string;
  provider: RoutePlan["provider"];
  traffic: RoutePlan["traffic"];
  polyline: RoutePlan["polyline"];
  origin: LatLng;
  destination: LatLng;
  mapsUrl: string;
};

function buildMapsUrl(origin: LatLng, destination: LatLng): string {
  const o = `${origin.lat},${origin.lng}`;
  const d = `${destination.lat},${destination.lng}`;
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(o)}&destination=${encodeURIComponent(d)}&travelmode=driving`;
}

export async function getRideNavigation(
  rideId: string,
  userId: string,
  role: "passenger" | "driver",
): Promise<RideNavigationDto> {
  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride || (ride.passengerId !== userId && ride.driverId !== userId)) {
    throw new AppError("RIDE_NOT_FOUND", 404, "Ride not found.");
  }

  const target = navigationTargetForPhase(ride.phase);
  if (!target) {
    throw new AppError("INVALID_PHASE", 409, "Navigation is not available for this trip phase.", {
      phase: ride.phase,
    });
  }

  const pickup = parseLatLng(ride.pickup);
  const dropoff = parseLatLng(ride.dropoff);
  if (!pickup || !dropoff) {
    throw new AppError("INVALID_INPUT", 400, "Ride is missing pickup or dropoff coordinates.");
  }

  const driverPoint = await resolveDriverPoint(ride.driverId, ride.driverLocation);
  if (!driverPoint) {
    throw new AppError("LOCATION_UNAVAILABLE", 409, "Driver location is not available yet.");
  }

  const destination = target === "pickup" ? pickup : dropoff;
  const routeOrigin = driverPoint;

  const plan = await getDrivingRoute(routeOrigin, destination);
  const etaMinutes = plan.durationInTrafficMinutes;

  return {
    rideId: ride.id,
    phase: ride.phase,
    target,
    distanceKm: plan.distanceKm,
    etaMinutes,
    durationMinutes: plan.durationMinutes,
    durationInTrafficMinutes: plan.durationInTrafficMinutes,
    summary: plan.summary,
    provider: plan.provider,
    traffic: plan.traffic,
    polyline: plan.polyline,
    origin: routeOrigin,
    destination,
    mapsUrl: buildMapsUrl(routeOrigin, destination),
  };
}
