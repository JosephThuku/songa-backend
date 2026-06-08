import { RidePhase } from "@prisma/client";
import type { DriverLocationPayload } from "./driver-location.js";
import { DRIVER_ARRIVING_KM, haversineDistanceKm } from "./geo.js";
import { etaMinutesForDistance } from "./routing.js";
import { prisma } from "./prisma.js";
import { publishRideChanged } from "./ride-events.js";

const PICKUP_TRACKING_PHASES: RidePhase[] = [
  RidePhase.driver_accepted,
  RidePhase.driver_en_route,
  RidePhase.driver_arriving,
  RidePhase.driver_arrived,
];

const TRIP_TRACKING_PHASES: RidePhase[] = [RidePhase.trip_in_progress];

// Emit at most ~once per ride every 3s for live pin/ETA tracking; phase
// transitions bypass the throttle so the passenger/driver always see them.
const LOCATION_UPDATE_THROTTLE_MS = 3000;
const lastRideUpdatePublishedAt = new Map<string, number>();

function parseLatLng(value: unknown): { lat: number; lng: number } | null {
  const object = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  if (!object || typeof object.lat !== "number" || typeof object.lng !== "number") return null;
  return { lat: object.lat, lng: object.lng };
}

export function phaseFromPickupDistance(
  pickupDistanceKm: number,
  currentPhase: RidePhase,
): RidePhase | null {
  if (!PICKUP_TRACKING_PHASES.includes(currentPhase)) return null;
  // Driver explicitly marked arrived; GPS must not regress phase until trip starts.
  if (currentPhase === RidePhase.driver_arrived) return null;
  if (pickupDistanceKm <= DRIVER_ARRIVING_KM) return RidePhase.driver_arriving;
  if (currentPhase === RidePhase.driver_accepted) return RidePhase.driver_en_route;
  return RidePhase.driver_en_route;
}

export async function syncActiveRideFromDriverLocation(
  rideId: string,
  location: DriverLocationPayload,
): Promise<void> {
  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride) return;

  const driverPoint = parseLatLng(location);
  if (!driverPoint) return;

  const pickup = parseLatLng(ride.pickup);
  const dropoff = parseLatLng(ride.dropoff);
  if (!pickup) return;

  const trackingPickup = PICKUP_TRACKING_PHASES.includes(ride.phase);
  const trackingTrip = TRIP_TRACKING_PHASES.includes(ride.phase);
  if (!trackingPickup && !trackingTrip) return;

  let nextPhase = ride.phase;
  let distanceKm = ride.distanceKm ?? 0;
  let etaMinutes = ride.etaMinutes ?? 1;

  if (trackingPickup) {
    const pickupDistanceKm = haversineDistanceKm(pickup, driverPoint);
    const phaseUpdate = phaseFromPickupDistance(pickupDistanceKm, ride.phase);
    if (phaseUpdate) nextPhase = phaseUpdate;
    try {
      const routed = await etaMinutesForDistance(driverPoint, pickup);
      distanceKm = routed.distanceKm;
      etaMinutes = routed.etaMinutes;
    } catch {
      distanceKm = Math.round(pickupDistanceKm * 10) / 10;
      etaMinutes = Math.max(1, Math.round(pickupDistanceKm / 0.45));
    }
  } else if (trackingTrip && dropoff) {
    try {
      const routed = await etaMinutesForDistance(driverPoint, dropoff);
      distanceKm = routed.distanceKm;
      etaMinutes = routed.etaMinutes;
    } catch {
      const tripDistanceKm = haversineDistanceKm(dropoff, driverPoint);
      distanceKm = Math.round(tripDistanceKm * 10) / 10;
      etaMinutes = Math.max(1, Math.round(tripDistanceKm / 0.5));
    }
  }

  const updated = await prisma.ride.update({
    where: { id: rideId },
    data: {
      etaMinutes,
      ...(nextPhase !== ride.phase ? { phase: nextPhase } : {}),
      distanceKm,
    },
  });

  // Live pin / live ETA: every active-ride GPS ping should reach both ends.
  // Emit on every sync, throttled to ~3s per ride, but always emit immediately
  // on a phase transition (driver_accepted → en_route → arriving → arrived).
  const phaseChanged = updated.phase !== ride.phase;
  const now = Date.now();
  const lastPublished = lastRideUpdatePublishedAt.get(rideId) ?? 0;
  if (phaseChanged || now - lastPublished >= LOCATION_UPDATE_THROTTLE_MS) {
    publishRideChanged({ rideId: updated.id, phase: updated.phase });
    lastRideUpdatePublishedAt.set(rideId, now);
  }
}
