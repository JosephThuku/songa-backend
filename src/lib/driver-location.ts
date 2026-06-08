import type { Prisma } from "@prisma/client";
import { toNairobiIso } from "./nairobi-time.js";
import { prisma } from "./prisma.js";

type Db = Prisma.TransactionClient | typeof prisma;

export type DriverLocationPayload = {
  lat: number;
  lng: number;
  heading?: number;
  speedKmh?: number;
  accuracyM?: number;
  updatedAt: Date;
};

export type DriverLocationRecord = {
  lat: number;
  lng: number;
  heading: number | null;
  speedKmh: number | null;
  accuracyM: number | null;
  updatedAt: Date;
};

export function driverLocationToJson(payload: DriverLocationPayload): Prisma.InputJsonObject {
  return {
    lat: payload.lat,
    lng: payload.lng,
    ...(payload.heading !== undefined ? { heading: payload.heading } : {}),
    ...(payload.speedKmh !== undefined ? { speedKmh: payload.speedKmh } : {}),
    ...(payload.accuracyM !== undefined ? { accuracyM: payload.accuracyM } : {}),
    updatedAt: payload.updatedAt.toISOString(),
  };
}

export function driverLocationDtoFromRecord(
  record: DriverLocationRecord | null | undefined,
): { lat: number; lng: number; updatedAt: string } | null {
  if (!record) return null;
  return {
    lat: record.lat,
    lng: record.lng,
    updatedAt: toNairobiIso(record.updatedAt),
  };
}

/** Canonical writer: DriverLocation table + DriverProfile.location (dispatch/geo index). */
export async function persistDriverLocation(
  db: Db,
  driverId: string,
  input: {
    lat: number;
    lng: number;
    heading?: number;
    speedKmh?: number;
    accuracyM?: number;
    recordedAt?: Date;
  },
): Promise<DriverLocationPayload> {
  const updatedAt = input.recordedAt ?? new Date();
  const payload: DriverLocationPayload = {
    lat: input.lat,
    lng: input.lng,
    updatedAt,
    ...(input.heading !== undefined ? { heading: input.heading } : {}),
    ...(input.speedKmh !== undefined ? { speedKmh: input.speedKmh } : {}),
    ...(input.accuracyM !== undefined ? { accuracyM: input.accuracyM } : {}),
  };

  await db.driverLocation.upsert({
    where: { driverId },
    create: {
      driverId,
      lat: payload.lat,
      lng: payload.lng,
      heading: payload.heading ?? null,
      speedKmh: payload.speedKmh ?? null,
      accuracyM: payload.accuracyM ?? null,
      updatedAt: payload.updatedAt,
    },
    update: {
      lat: payload.lat,
      lng: payload.lng,
      heading: payload.heading ?? null,
      speedKmh: payload.speedKmh ?? null,
      accuracyM: payload.accuracyM ?? null,
      updatedAt: payload.updatedAt,
    },
  });

  await db.driverProfile.update({
    where: { userId: driverId },
    data: {
      location: driverLocationToJson(payload),
      locationUpdatedAt: payload.updatedAt,
    },
  });

  return payload;
}

export async function resolveDriverLocationRecord(
  driverId: string,
): Promise<DriverLocationRecord | null> {
  const row = await prisma.driverLocation.findUnique({ where: { driverId } });
  if (row) return row;

  const profile = await prisma.driverProfile.findUnique({
    where: { userId: driverId },
    select: { location: true, locationUpdatedAt: true },
  });
  const loc = parseLatLngFromJson(profile?.location);
  if (!loc || !profile?.locationUpdatedAt) return null;
  return {
    lat: loc.lat,
    lng: loc.lng,
    heading: loc.heading ?? null,
    speedKmh: loc.speedKmh ?? null,
    accuracyM: loc.accuracyM ?? null,
    updatedAt: profile.locationUpdatedAt,
  };
}

export function parseLatLngFromJson(
  value: unknown,
): { lat: number; lng: number; heading?: number; speedKmh?: number; accuracyM?: number } | null {
  const object = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  if (!object || typeof object.lat !== "number" || typeof object.lng !== "number") return null;
  return {
    lat: object.lat,
    lng: object.lng,
    ...(typeof object.heading === "number" ? { heading: object.heading } : {}),
    ...(typeof object.speedKmh === "number" ? { speedKmh: object.speedKmh } : {}),
    ...(typeof object.accuracyM === "number" ? { accuracyM: object.accuracyM } : {}),
  };
}
