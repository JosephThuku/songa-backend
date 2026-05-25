export interface LatLng {
  lat: number;
  lng: number;
}

export const MIN_TRIP_DISTANCE = 0.1; // km — minimum meaningful trip length
export const DRIVER_ARRIVING_KM = 2; // km — distance at which phase switches to driver_arriving

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Haversine great-circle distance between two lat/lng points in kilometres. */
export function haversineDistanceKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * Pickup ETA in minutes assuming ~27 km/h average speed (0.45 km/min).
 * Minimum 1 minute.
 */
export function estimatePickupEtaMinutes(distanceKm: number): number {
  return Math.max(1, Math.round(distanceKm / 0.45));
}

/**
 * Driving duration in minutes assuming ~30 km/h average urban speed (0.5 km/min).
 * Minimum 1 minute.
 */
export function estimateDrivingMinutes(distanceKm: number): number {
  return Math.max(1, Math.round(distanceKm / 0.5));
}
