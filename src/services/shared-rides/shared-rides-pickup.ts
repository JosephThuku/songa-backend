import type { CorridorLocation } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";

export type PickupPinDto = {
  label: string;
  lat: number;
  lng: number;
};

export const SGR_CORRIDOR_SLUG = "sgr-miritini";

/** Corridor zone where the van collects or drops passengers (not the SGR terminus). */
export function neighborhoodCorridorLocation(departure: {
  pickupLocation: Pick<CorridorLocation, "slug" | "name" | "lat" | "lng">;
  dropoffLocation: Pick<CorridorLocation, "slug" | "name" | "lat" | "lng">;
}): Pick<CorridorLocation, "slug" | "name" | "lat" | "lng"> {
  if (departure.pickupLocation.slug === SGR_CORRIDOR_SLUG) {
    return departure.dropoffLocation;
  }
  return departure.pickupLocation;
}

export function pickupPinFromParts(parts: {
  label: string;
  lat: number | null;
  lng: number | null;
}): PickupPinDto | null {
  if (parts.lat == null || parts.lng == null) return null;
  return { label: parts.label, lat: parts.lat, lng: parts.lng };
}

export function pickupPinFromSeat(seat: {
  pickupLabel: string | null;
  pickupLat: number | null;
  pickupLng: number | null;
}): PickupPinDto | null {
  if (!seat.pickupLabel || seat.pickupLat == null || seat.pickupLng == null) return null;
  return {
    label: seat.pickupLabel,
    lat: seat.pickupLat,
    lng: seat.pickupLng,
  };
}

export async function findTripRequestPickupNote(
  passengerId: string,
  departureId: string,
): Promise<string | null> {
  const reservation = await prisma.sharedTripRequestReservation.findFirst({
    where: {
      passengerId,
      status: "active",
      tripRequest: { matchedDepartureId: departureId, status: "matched" },
    },
    select: { pickupNote: true },
  });
  return reservation?.pickupNote ?? null;
}

export function defaultNeighborhoodPickupPin(departure: {
  pickupLocation: Pick<CorridorLocation, "slug" | "name" | "lat" | "lng">;
  dropoffLocation: Pick<CorridorLocation, "slug" | "name" | "lat" | "lng">;
}): PickupPinDto | null {
  const zone = neighborhoodCorridorLocation(departure);
  return pickupPinFromParts({ label: zone.name, lat: zone.lat, lng: zone.lng });
}
