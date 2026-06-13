import { driverLocationDtoFromRecord, type DriverLocationRecord } from "../../lib/driver-location.js";
import { toNairobiIso } from "../../lib/nairobi-time.js";

export type DriverLocationDto = {
  lat: number;
  lng: number;
  updatedAt: string;
};

function driverLocationFromDepartureColumns(departure: {
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

/** Prefer canonical DriverLocation; fall back to legacy departure columns. */
export function driverLocationFromDeparture(
  departure: {
    driverLat: number | null;
    driverLng: number | null;
    driverLocationUpdatedAt: Date | null;
  },
  driverLocation?: DriverLocationRecord | null,
): DriverLocationDto | null {
  const fromTable = driverLocationDtoFromRecord(driverLocation ?? null);
  if (fromTable) return fromTable;
  return driverLocationFromDepartureColumns(departure);
}
