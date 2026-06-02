import { toNairobiIso } from "../../lib/nairobi-time.js";

export type DriverLocationDto = {
  lat: number;
  lng: number;
  updatedAt: string;
};

export function driverLocationFromDeparture(departure: {
  driverLat: number | null;
  driverLng: number | null;
  driverLocationUpdatedAt: Date | null;
}): DriverLocationDto | null {
  if (departure.driverLat == null || departure.driverLng == null || !departure.driverLocationUpdatedAt) {
    return null;
  }
  return {
    lat: departure.driverLat,
    lng: departure.driverLng,
    updatedAt: toNairobiIso(departure.driverLocationUpdatedAt),
  };
}
