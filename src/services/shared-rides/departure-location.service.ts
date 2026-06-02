import { AppError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { getDepartureDetailForViewer } from "./departure-seats.service.js";

const LOCATION_ACTIVE_STATUSES = ["scheduled", "boarding"] as const;

function assertDriverOwnsDeparture(
  departure: { driverId: string | null },
  driverId: string,
): void {
  if (departure.driverId !== driverId) {
    throw new AppError("FORBIDDEN", 403, "This departure belongs to another driver.");
  }
}

export async function updateDepartureDriverLocation(
  driverId: string,
  departureId: string,
  lat: number,
  lng: number,
): Promise<{ departure: Awaited<ReturnType<typeof getDepartureDetailForViewer>>["departure"] }> {
  const existing = await prisma.sharedDeparture.findUnique({
    where: { id: departureId },
    select: { driverId: true, status: true },
  });
  if (!existing) {
    throw new AppError("DEPARTURE_NOT_FOUND", 404, "Departure not found.");
  }
  assertDriverOwnsDeparture(existing, driverId);
  if (!LOCATION_ACTIVE_STATUSES.includes(existing.status as (typeof LOCATION_ACTIVE_STATUSES)[number])) {
    throw new AppError(
      "DEPARTURE_NOT_ACTIVE",
      409,
      "Driver location can only be updated while the departure is scheduled or boarding.",
    );
  }

  const now = new Date();
  await prisma.sharedDeparture.update({
    where: { id: departureId },
    data: {
      driverLat: lat,
      driverLng: lng,
      driverLocationUpdatedAt: now,
    },
  });

  return getDepartureDetailForViewer(departureId, { id: driverId, role: "driver" });
}
