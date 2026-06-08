import type { Prisma } from "@prisma/client";
import type { PlaceDto } from "./responses.js";
import { prisma } from "./prisma.js";

export type PlacePersistInput = PlaceDto & {
  corridorLocationId?: string | null;
};

type Db = Prisma.TransactionClient | typeof prisma;

export function placeSnapshotJson(place: PlaceDto): Prisma.InputJsonObject {
  return {
    ...(place.placeId ? { placeId: place.placeId } : {}),
    label: place.label,
    lat: place.lat,
    lng: place.lng,
  };
}

export async function createPlaceSnapshot(
  db: Db,
  place: PlacePersistInput,
): Promise<string> {
  const row = await db.place.create({
    data: {
      label: place.label,
      lat: place.lat,
      lng: place.lng,
      externalPlaceId: place.placeId ?? null,
      corridorLocationId: place.corridorLocationId ?? null,
    },
  });
  return row.id;
}

/** Dual-write: immutable JSON snapshot + normalized Place FK for Ride/Booking. */
export async function persistPlacePair(
  db: Db,
  pickup: PlacePersistInput,
  dropoff: PlacePersistInput,
): Promise<{
  pickupPlaceId: string;
  dropoffPlaceId: string;
  pickup: Prisma.InputJsonObject;
  dropoff: Prisma.InputJsonObject;
}> {
  const [pickupPlaceId, dropoffPlaceId] = await Promise.all([
    createPlaceSnapshot(db, pickup),
    createPlaceSnapshot(db, dropoff),
  ]);

  return {
    pickupPlaceId,
    dropoffPlaceId,
    pickup: placeSnapshotJson(pickup),
    dropoff: placeSnapshotJson(dropoff),
  };
}
