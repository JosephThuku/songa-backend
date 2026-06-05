import type { SharedDepartureStatus } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { toNairobiIso } from "../../lib/nairobi-time.js";
import { prisma } from "../../lib/prisma.js";
import { getDepartureDetailForViewer, type SharedDepartureDetailDto } from "./departure-seats.service.js";
import { corridorLocationBriefSelect } from "./shared-rides-prisma.js";

export type DriverDepartureListItemDto = {
  id: string;
  departureAt: string;
  pricePerSeat: number;
  capacity: number;
  status: string;
  routeLabel: string;
  seatSummary: {
    paid: number;
    reserved: number;
    available: number;
  };
};

const ACTIVE_DRIVER_STATUSES: SharedDepartureStatus[] = ["scheduled", "boarding"];

function assertDriverOwnsDeparture(
  departure: { driverId: string | null },
  driverId: string,
): void {
  if (departure.driverId !== driverId) {
    throw new AppError("FORBIDDEN", 403, "This departure belongs to another driver.");
  }
}

function seatSummaryFromRows(seats: { status: string }[]) {
  let paid = 0;
  let reserved = 0;
  let available = 0;
  for (const s of seats) {
    if (s.status === "paid") paid += 1;
    else if (s.status === "reserved") reserved += 1;
    else if (s.status === "available") available += 1;
  }
  return { paid, reserved, available };
}

export async function listDriverDepartures(driverId: string): Promise<{ departures: DriverDepartureListItemDto[] }> {
  const rows = await prisma.sharedDeparture.findMany({
    where: {
      driverId,
      status: { in: ACTIVE_DRIVER_STATUSES },
      departureAt: { gte: new Date() },
    },
    include: {
      pickupLocation: { select: corridorLocationBriefSelect },
      dropoffLocation: { select: corridorLocationBriefSelect },
      seats: { select: { status: true } },
    },
    orderBy: { departureAt: "asc" },
    take: 50,
  });

  const departures = rows.map((row) => ({
    id: row.id,
    departureAt: toNairobiIso(row.departureAt),
    pricePerSeat: row.pricePerSeat,
    capacity: row.capacity,
    status: row.status,
    routeLabel: `${row.pickupLocation.name} → ${row.dropoffLocation.name}`,
    seatSummary: seatSummaryFromRows(row.seats),
  }));

  return { departures };
}

export async function getDriverDepartureDetail(
  driverId: string,
  departureId: string,
): Promise<{ departure: SharedDepartureDetailDto }> {
  const departure = await prisma.sharedDeparture.findUnique({
    where: { id: departureId },
    select: { driverId: true, status: true },
  });
  if (!departure) {
    throw new AppError("DEPARTURE_NOT_FOUND", 404, "Departure not found.");
  }
  assertDriverOwnsDeparture(departure, driverId);

  return getDepartureDetailForViewer(departureId, { id: driverId, role: "driver" });
}

export async function updateDriverDepartureStatus(
  driverId: string,
  departureId: string,
  status: "boarding" | "completed" | "cancelled",
): Promise<{ departure: SharedDepartureDetailDto }> {
  const existing = await prisma.sharedDeparture.findUnique({
    where: { id: departureId },
    select: { driverId: true, status: true },
  });
  if (!existing) {
    throw new AppError("DEPARTURE_NOT_FOUND", 404, "Departure not found.");
  }
  assertDriverOwnsDeparture(existing, driverId);

  const allowed: Record<SharedDepartureStatus, SharedDepartureStatus[]> = {
    scheduled: ["boarding", "cancelled", "completed"],
    boarding: ["completed", "cancelled"],
    completed: [],
    cancelled: [],
  };

  const nextAllowed = allowed[existing.status] ?? [];
  if (!nextAllowed.includes(status)) {
    throw new AppError(
      "INVALID_DEPARTURE_STATUS",
      409,
      `Cannot change departure from ${existing.status} to ${status}.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.sharedDeparture.update({
      where: { id: departureId },
      data: { status },
    });

    if (status === "cancelled") {
      await tx.sharedDepartureSeat.updateMany({
        where: {
          departureId,
          status: { in: ["reserved", "paid"] },
        },
        data: {
          status: "available",
          reservedById: null,
          reservedAt: null,
          expiresAt: null,
          bookingId: null,
          pickupLabel: null,
          pickupLat: null,
          pickupLng: null,
        },
      });

      await tx.booking.updateMany({
        where: {
          sharedDepartureId: departureId,
          status: { in: ["pending_payment", "paid"] },
        },
        data: { status: "cancelled" },
      });
    }
  });

  return getDepartureDetailForViewer(departureId, { id: driverId, role: "driver" });
}
