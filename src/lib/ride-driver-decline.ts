import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

type Db = Prisma.TransactionClient | typeof prisma;

export type RideWithDeclines = {
  driverDeclines?: { driverId: string }[];
};

export function hasDriverDeclinedRide(ride: RideWithDeclines, driverId: string): boolean {
  return ride.driverDeclines?.some((row) => row.driverId === driverId) ?? false;
}

export async function recordRideDriverDecline(
  db: Db,
  rideId: string,
  driverId: string,
): Promise<void> {
  await db.rideDriverDecline.upsert({
    where: { rideId_driverId: { rideId, driverId } },
    create: { rideId, driverId },
    update: {},
  });
}

export async function declinedDriverIdsForRide(rideId: string): Promise<Set<string>> {
  const rows = await prisma.rideDriverDecline.findMany({
    where: { rideId },
    select: { driverId: true },
  });
  return new Set(rows.map((row) => row.driverId));
}
