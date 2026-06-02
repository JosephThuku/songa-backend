import type { SgrScheduleSlotRef, SharedRideDirection } from "../../domain/shared-rides.js";
import { AppError } from "../../lib/errors.js";
import { getNairobiParts, nairobiLocalToUtc, toNairobiIso, type NairobiParts } from "../../lib/nairobi-time.js";
import { sharedRidesConfig } from "../../lib/shared-rides-config.js";
import { prisma } from "../../lib/prisma.js";
import {
  corridorLocationBriefSelect,
  sgrSlotWithLocationsInclude,
  type SharedTripRequestWithRelations,
  type SgrScheduleSlotWithLocations,
} from "./shared-rides-prisma.js";
import { slotDetail, slotHeadline, trainServiceLabel } from "./slot-labels.js";

const tripRequestInclude = {
  corridorLocation: { select: corridorLocationBriefSelect },
  sgrScheduleSlot: { include: sgrSlotWithLocationsInclude },
} as const;

export type CreateTripRequestInput = {
  sgrScheduleSlotId: string;
  direction: SharedRideDirection;
  corridorLocationId: string;
  departureDate: string;
  vanDepartureAt: string;
  seatsRequested: number;
  notes?: string;
  pickupNote?: string;
};

function toSlotRef(slot: SgrScheduleSlotWithLocations): SgrScheduleSlotRef {
  return {
    id: slot.id,
    direction: slot.direction,
    trainService: slot.trainService,
    sgrEventTime: slot.sgrEventTime,
    vanDepartureTime: slot.vanDepartureTime,
    suggestedPricePerSeat: slot.suggestedPricePerSeat,
    pickupLocation: slot.pickupLocation,
    dropoffLocation: slot.dropoffLocation,
  };
}

function zoneForSlot(slot: SgrScheduleSlotRef, direction: SharedRideDirection) {
  return direction === "to_sgr" ? slot.pickupLocation : slot.dropoffLocation;
}

function assertSlotMatchesCorridor(
  slot: SgrScheduleSlotRef,
  direction: SharedRideDirection,
  corridorLocationId: string,
): void {
  if (slot.direction !== direction) {
    throw new AppError("SLOT_DIRECTION_MISMATCH", 400, "Schedule slot direction does not match request.");
  }
  const zone = zoneForSlot(slot, direction);
  if (zone.id !== corridorLocationId) {
    throw new AppError(
      "CORRIDOR_MISMATCH",
      400,
      "Corridor location does not match this schedule slot for the given direction.",
    );
  }
}

function vanInstant(parts: NairobiParts, vanDepartureTime: string, dayOffset: number): Date {
  return nairobiLocalToUtc(parts, vanDepartureTime, dayOffset);
}

function assertBookable(
  slot: SgrScheduleSlotRef,
  direction: SharedRideDirection,
  requestedDepartureAt: Date,
  at: Date = new Date(),
): void {
  const parts = getNairobiParts(at);
  let matchedTimetable = false;

  for (let dayOffset = 0; dayOffset <= 2; dayOffset++) {
    const vanAt = vanInstant(parts, slot.vanDepartureTime, dayOffset);
    if (vanAt.getTime() !== requestedDepartureAt.getTime()) continue;
    matchedTimetable = true;

    if (direction === "to_sgr") {
      const leadMs = sharedRidesConfig.bookingLeadMinutes * 60_000;
      if (vanAt.getTime() <= at.getTime() + leadMs) {
        throw new AppError(
          "SLOT_NOT_BOOKABLE",
          400,
          "This van departure is not bookable (within booking lead time).",
        );
      }
      return;
    }

    const graceMs = sharedRidesConfig.fromSgrGraceMinutes * 60_000;
    const lookaheadMs = sharedRidesConfig.fromSgrLookaheadHours * 60 * 60_000;
    if (
      vanAt.getTime() < at.getTime() - graceMs ||
      vanAt.getTime() > at.getTime() + lookaheadMs
    ) {
      throw new AppError(
        "SLOT_NOT_BOOKABLE",
        400,
        "This van departure is not bookable (outside arrival grace / lookahead window).",
      );
    }
    return;
  }

  if (!matchedTimetable) {
    throw new AppError(
      "INVALID_INPUT",
      400,
      "vanDepartureAt does not match this schedule slot's van departure time.",
    );
  }

  throw new AppError(
    "SLOT_NOT_BOOKABLE",
    400,
    "This van departure is not bookable (past lead time or outside the arrival window).",
  );
}

export type TripRequestDto = {
  id: string;
  status: string;
  poolSeatsTotal: number;
  requestedDepartureAt: string;
  departureDate: string;
  direction: SharedRideDirection;
  corridorLocation: { id: string; slug: string; name: string };
  sgrScheduleSlotId: string;
  headline: string;
  detail: string;
  trainLabel: string;
  pricePerSeat: number;
  notes: string | null;
};

export type TripRequestReservationDto = {
  id: string;
  seatsRequested: number;
  status: string;
  pickupNote: string | null;
};

export type CreateTripRequestResult = {
  tripRequest: TripRequestDto;
  reservation: TripRequestReservationDto;
};

export type MyTripRequestItemDto = CreateTripRequestResult;

export function toTripRequestDto(tripRequest: SharedTripRequestWithRelations): TripRequestDto {
  const slot = toSlotRef(tripRequest.sgrScheduleSlot);
  const zone = tripRequest.corridorLocation;
  return {
    id: tripRequest.id,
    status: tripRequest.status,
    poolSeatsTotal: tripRequest.seatsRequested,
    requestedDepartureAt: toNairobiIso(tripRequest.requestedDepartureAt),
    departureDate: tripRequest.departureDate,
    direction: tripRequest.direction,
    corridorLocation: { id: zone.id, slug: zone.slug, name: zone.name },
    sgrScheduleSlotId: tripRequest.sgrScheduleSlotId,
    headline: slotHeadline(tripRequest.direction, slot.trainService, slot.sgrEventTime),
    detail: slotDetail(zone.name, tripRequest.direction, slot.vanDepartureTime, slot.suggestedPricePerSeat),
    trainLabel: `${trainServiceLabel(slot.trainService)} · ${tripRequest.direction === "to_sgr" ? "departs Miritini" : "arrives Miritini"} ${slot.sgrEventTime}`,
    pricePerSeat: slot.suggestedPricePerSeat,
    notes: tripRequest.notes,
  };
}

export async function createTripRequest(
  passengerId: string,
  input: CreateTripRequestInput,
): Promise<CreateTripRequestResult> {
  const requestedDepartureAt = new Date(input.vanDepartureAt);
  if (Number.isNaN(requestedDepartureAt.getTime())) {
    throw new AppError("INVALID_INPUT", 400, "vanDepartureAt must be a valid ISO datetime.");
  }

  if (requestedDepartureAt.getTime() <= Date.now()) {
    throw new AppError("DEPARTURE_IN_PAST", 400, "Van departure must be in the future.");
  }

  const slotRow = await prisma.sgrScheduleSlot.findFirst({
    where: { id: input.sgrScheduleSlotId, isActive: true },
    include: sgrSlotWithLocationsInclude,
  });
  if (!slotRow) {
    throw new AppError("SGR_SLOT_NOT_FOUND", 404, "Schedule slot not found.");
  }

  const slot = toSlotRef(slotRow as SgrScheduleSlotWithLocations);
  assertSlotMatchesCorridor(slot, input.direction, input.corridorLocationId);
  assertBookable(slot, input.direction, requestedDepartureAt);

  const departureDate = input.departureDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(departureDate)) {
    throw new AppError("INVALID_INPUT", 400, "departureDate must be YYYY-MM-DD.");
  }

  const result = await prisma.$transaction(async (tx) => {
    let tripRequest = await tx.sharedTripRequest.findFirst({
      where: {
        sgrScheduleSlotId: input.sgrScheduleSlotId,
        requestedDepartureAt,
        status: "open",
        matchedDepartureId: null,
      },
      include: tripRequestInclude,
    });

    if (!tripRequest) {
      tripRequest = await tx.sharedTripRequest.create({
        data: {
          sgrScheduleSlotId: input.sgrScheduleSlotId,
          corridorLocationId: input.corridorLocationId,
          direction: input.direction,
          requestedDepartureAt,
          departureDate,
          seatsRequested: 0,
          status: "open",
          notes: input.notes ?? null,
        },
        include: tripRequestInclude,
      });
    } else if (input.notes && !tripRequest.notes) {
      tripRequest = await tx.sharedTripRequest.update({
        where: { id: tripRequest.id },
        data: { notes: input.notes },
        include: tripRequestInclude,
      });
    }

    const reservation = await tx.sharedTripRequestReservation.upsert({
      where: {
        tripRequestId_passengerId: {
          tripRequestId: tripRequest.id,
          passengerId,
        },
      },
      create: {
        tripRequestId: tripRequest.id,
        passengerId,
        seatsRequested: input.seatsRequested,
        status: "active",
        pickupNote: input.pickupNote ?? null,
      },
      update: {
        seatsRequested: input.seatsRequested,
        status: "active",
        pickupNote: input.pickupNote ?? null,
      },
    });

    const poolSeats = await tx.sharedTripRequestReservation.aggregate({
      where: { tripRequestId: tripRequest.id, status: "active" },
      _sum: { seatsRequested: true },
    });

    const poolTotal = poolSeats._sum.seatsRequested ?? 0;

    tripRequest = await tx.sharedTripRequest.update({
      where: { id: tripRequest.id },
      data: { seatsRequested: poolTotal },
      include: tripRequestInclude,
    });

    return { tripRequest, reservation };
  });

  return {
    tripRequest: toTripRequestDto(result.tripRequest as SharedTripRequestWithRelations),
    reservation: {
      id: result.reservation.id,
      seatsRequested: result.reservation.seatsRequested,
      status: result.reservation.status,
      pickupNote: result.reservation.pickupNote,
    },
  };
}

export async function listMyTripRequests(passengerId: string): Promise<{ items: MyTripRequestItemDto[] }> {
  const reservations = await prisma.sharedTripRequestReservation.findMany({
    where: {
      passengerId,
      status: "active",
      tripRequest: {
        status: { in: ["open", "matched"] },
        requestedDepartureAt: { gt: new Date() },
      },
    },
    include: {
      tripRequest: { include: tripRequestInclude },
    },
    orderBy: { createdAt: "desc" },
  });

  const items = reservations.map((row) => ({
    tripRequest: toTripRequestDto(row.tripRequest as SharedTripRequestWithRelations),
    reservation: {
      id: row.id,
      seatsRequested: row.seatsRequested,
      status: row.status,
      pickupNote: row.pickupNote,
    },
  }));

  return { items };
}
