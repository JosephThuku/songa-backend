import { RidePhase, type Prisma } from "@prisma/client";
import { DRIVER_ARRIVING_KM, estimatePickupEtaMinutes, haversineDistanceKm } from "./geo.js";
import { prisma } from "./prisma.js";
import { publishRideChanged } from "./ride-events.js";

const TRACKING_PHASES: RidePhase[] = [
  RidePhase.driver_accepted,
  RidePhase.driver_en_route,
  RidePhase.driver_arriving,
];

const LOCATION_UPDATE_THROTTLE_MS = 5000;
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
  if (!TRACKING_PHASES.includes(currentPhase)) return null;
  if (pickupDistanceKm <= DRIVER_ARRIVING_KM) return RidePhase.driver_arriving;
  if (currentPhase === RidePhase.driver_accepted) return RidePhase.driver_en_route;
  return RidePhase.driver_en_route;
}

export async function syncActiveRideFromDriverLocation(
  rideId: string,
  location: Prisma.InputJsonObject,
): Promise<void> {
  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride || !ride.driverId || !TRACKING_PHASES.includes(ride.phase)) return;

  const pickup = parseLatLng(ride.pickup);
  const driverPoint = parseLatLng(location);
  if (!pickup || !driverPoint) return;

  const pickupDistanceKm = haversineDistanceKm(pickup, driverPoint);
  const nextPhase = phaseFromPickupDistance(pickupDistanceKm, ride.phase);
  const etaMinutes = estimatePickupEtaMinutes(pickupDistanceKm);

  const updated = await prisma.ride.update({
    where: { id: rideId },
    data: {
      driverLocation: location,
      etaMinutes,
      ...(nextPhase && nextPhase !== ride.phase ? { phase: nextPhase } : {}),
      distanceKm: Math.round(pickupDistanceKm * 10) / 10,
    },
  });

  const phaseChanged = updated.phase !== ride.phase;
  const etaChanged = updated.etaMinutes !== ride.etaMinutes;
  if (!phaseChanged && !etaChanged) return;

  const now = Date.now();
  const lastPublished = lastRideUpdatePublishedAt.get(rideId) ?? 0;
  if (phaseChanged || now - lastPublished >= LOCATION_UPDATE_THROTTLE_MS) {
    publishRideChanged({ rideId: updated.id, phase: updated.phase });
    lastRideUpdatePublishedAt.set(rideId, now);
  }
}
