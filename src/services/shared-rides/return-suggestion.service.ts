import type { SgrScheduleSlotRef, SharedRideDirection } from "../../domain/shared-rides.js";
import { sharedRidesConfig } from "../../lib/shared-rides-config.js";
import {
  getNairobiParts,
  nairobiLocalToUtc,
  toNairobiIso,
  type NairobiParts,
} from "../../lib/nairobi-time.js";
import { prisma } from "../../lib/prisma.js";
import { tripRequestSlotWhereForZone } from "../../lib/trip-request-derived.js";
import { listScheduleSlots } from "./catalog.service.js";
import type { SgrScheduleSlotWithLocations } from "./shared-rides-prisma.js";
import {
  buildSuggestedTripRequest,
  type SuggestedTripRequestDto,
} from "./suggestions.service.js";

export type ReturnSuggestionDto = {
  eligible: boolean;
  reason: "passengers_waiting" | "round_trip" | null;
  seatsRequested: number;
  openTripRequests: number;
  /** When the outbound run reaches SGR (for round-trip copy). */
  outboundAtSgr: string | null;
  suggestedSlot: SuggestedTripRequestDto | null;
  /** Same timetable rows as GET /suggestions (up to SHARED_RIDES_MAX_SUGGESTIONS). */
  slotOptions: SuggestedTripRequestDto[];
  prefill: { departureAt: string; pricePerSeat: number; sgrScheduleSlotId: string } | null;
  driverAlreadyPublished: boolean;
};

const INELIGIBLE: ReturnSuggestionDto = {
  eligible: false,
  reason: null,
  seatsRequested: 0,
  openTripRequests: 0,
  outboundAtSgr: null,
  suggestedSlot: null,
  slotOptions: [],
  prefill: null,
  driverAlreadyPublished: false,
};

export function oppositeDirection(
  direction: SharedRideDirection,
): SharedRideDirection {
  return direction === "to_sgr" ? "from_sgr" : "to_sgr";
}

export function zoneForPublishedSlot(
  slot: SgrScheduleSlotRef,
  direction: SharedRideDirection,
) {
  return direction === "to_sgr" ? slot.pickupLocation : slot.dropoffLocation;
}

export function nairobiDayRange(at: Date): { start: Date; end: Date } {
  const parts = getNairobiParts(at);
  return {
    start: nairobiLocalToUtc(parts, "00:00", 0),
    end: nairobiLocalToUtc(parts, "00:00", 1),
  };
}

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

function outboundEndsAtSgr(
  slot: SgrScheduleSlotRef,
  direction: SharedRideDirection,
  departureAt: Date,
): Date {
  const parts = getNairobiParts(departureAt);
  if (direction === "to_sgr") {
    return nairobiLocalToUtc(parts, slot.sgrEventTime, 0);
  }
  return departureAt;
}

export function returnVanInstantOnOutboundDay(
  outboundParts: NairobiParts,
  vanDepartureTime: string,
): Date {
  return nairobiLocalToUtc(outboundParts, vanDepartureTime, 0);
}

export type ReturnSlotDemand = {
  openTripRequests: number;
  seatsRequested: number;
};

export type ReturnSlotCandidate = {
  slot: SgrScheduleSlotRef;
  vanAt: Date;
  demand: ReturnSlotDemand;
  driverAlreadyPublished: boolean;
};

export function rankReturnSlotCandidates(
  slots: SgrScheduleSlotRef[],
  returnDirection: SharedRideDirection,
  outboundDepartureAt: Date,
  demandBySlotId: Map<string, ReturnSlotDemand>,
  publishedSlotIds: Set<string>,
): ReturnSlotCandidate[] {
  const outboundParts = getNairobiParts(outboundDepartureAt);
  const minGapMs = sharedRidesConfig.returnSuggestionMinGapMinutes * 60_000;
  const earliestReturnAt = outboundDepartureAt.getTime() + minGapMs;

  const candidates: ReturnSlotCandidate[] = [];

  for (const slot of slots) {
    if (slot.direction !== returnDirection) continue;

    const vanAt = returnVanInstantOnOutboundDay(outboundParts, slot.vanDepartureTime);
    if (vanAt.getTime() <= earliestReturnAt) continue;

    const vanParts = getNairobiParts(vanAt);
    if (
      vanParts.year !== outboundParts.year ||
      vanParts.month !== outboundParts.month ||
      vanParts.day !== outboundParts.day
    ) {
      continue;
    }

    const demand = demandBySlotId.get(slot.id) ?? { openTripRequests: 0, seatsRequested: 0 };
    candidates.push({
      slot,
      vanAt,
      demand,
      driverAlreadyPublished: publishedSlotIds.has(slot.id),
    });
  }

  candidates.sort((a, b) => {
    const scoreA = a.demand.openTripRequests + a.demand.seatsRequested;
    const scoreB = b.demand.openTripRequests + b.demand.seatsRequested;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return a.vanAt.getTime() - b.vanAt.getTime();
  });

  return candidates;
}

function suggestedDtoForCandidate(
  candidate: ReturnSlotCandidate,
  returnDirection: SharedRideDirection,
  outboundParts: NairobiParts,
): SuggestedTripRequestDto {
  const { openTripRequests, seatsRequested } = candidate.demand;
  return buildSuggestedTripRequest(
    candidate.slot,
    returnDirection,
    candidate.vanAt,
    outboundParts,
    0,
    Math.max(seatsRequested, openTripRequests > 0 ? seatsRequested : 1),
  );
}

export function buildReturnSuggestionFromCandidate(
  candidate: ReturnSlotCandidate,
  outboundSlot: SgrScheduleSlotRef,
  outboundDirection: SharedRideDirection,
  outboundDepartureAt: Date,
  slotOptions: SuggestedTripRequestDto[],
): ReturnSuggestionDto {
  if (candidate.driverAlreadyPublished) {
    return {
      ...INELIGIBLE,
      driverAlreadyPublished: true,
    };
  }

  const returnDirection = oppositeDirection(outboundDirection);
  const outboundParts = getNairobiParts(outboundDepartureAt);
  const { openTripRequests, seatsRequested } = candidate.demand;
  const reason: ReturnSuggestionDto["reason"] =
    openTripRequests > 0 || seatsRequested > 0 ? "passengers_waiting" : "round_trip";

  const suggestedSlot =
    slotOptions.find((s) => s.sgrScheduleSlotId === candidate.slot.id) ??
    suggestedDtoForCandidate(candidate, returnDirection, outboundParts);

  const outboundAtSgr = toNairobiIso(
    outboundEndsAtSgr(outboundSlot, outboundDirection, outboundDepartureAt),
  );

  return {
    eligible: true,
    reason,
    seatsRequested,
    openTripRequests,
    outboundAtSgr,
    suggestedSlot,
    slotOptions,
    prefill: {
      departureAt: toNairobiIso(candidate.vanAt),
      pricePerSeat: candidate.slot.suggestedPricePerSeat,
      sgrScheduleSlotId: candidate.slot.id,
    },
    driverAlreadyPublished: false,
  };
}

export async function findReturnSuggestion(params: {
  driverId: string;
  slot: SgrScheduleSlotWithLocations;
  departureAt: Date;
  at?: Date;
}): Promise<ReturnSuggestionDto> {
  const { driverId, slot, departureAt } = params;
  const outboundSlot = toSlotRef(slot);
  const outboundDirection = slot.direction;
  const returnDirection = oppositeDirection(outboundDirection);
  const zone = zoneForPublishedSlot(outboundSlot, outboundDirection);

  const returnSlots = (await listScheduleSlots({
    direction: returnDirection,
    corridorLocationId: zone.id,
  })) as SgrScheduleSlotWithLocations[];

  if (returnSlots.length === 0) {
    return INELIGIBLE;
  }

  const { start, end } = nairobiDayRange(departureAt);

  const openRequests = await prisma.sharedTripRequest.findMany({
    where: {
      status: "open",
      matchedDepartureId: null,
      ...tripRequestSlotWhereForZone(returnDirection, zone.id),
      requestedDepartureAt: { gte: start, lt: end },
      seatsRequested: { gt: 0 },
      reservations: { some: { status: "active" } },
    },
    select: {
      sgrScheduleSlotId: true,
      seatsRequested: true,
    },
  });

  const demandBySlotId = new Map<string, ReturnSlotDemand>();
  for (const row of openRequests) {
    const existing = demandBySlotId.get(row.sgrScheduleSlotId) ?? {
      openTripRequests: 0,
      seatsRequested: 0,
    };
    demandBySlotId.set(row.sgrScheduleSlotId, {
      openTripRequests: existing.openTripRequests + 1,
      seatsRequested: existing.seatsRequested + row.seatsRequested,
    });
  }

  const driverDepartures = await prisma.sharedDeparture.findMany({
    where: {
      driverId,
      status: "scheduled",
      departureAt: { gte: start, lt: end },
      sgrScheduleSlotId: { in: returnSlots.map((s) => s.id) },
    },
    select: { sgrScheduleSlotId: true },
  });

  const publishedSlotIds = new Set(
    driverDepartures
      .map((d) => d.sgrScheduleSlotId)
      .filter((id): id is string => id != null),
  );

  const ranked = rankReturnSlotCandidates(
    returnSlots.map(toSlotRef),
    returnDirection,
    departureAt,
    demandBySlotId,
    publishedSlotIds,
  );

  const outboundParts = getNairobiParts(departureAt);
  const eligible = ranked
    .filter((c) => !c.driverAlreadyPublished)
    .slice(0, sharedRidesConfig.maxSuggestions);

  if (eligible.length === 0) {
    const anyPublished = ranked.some((c) => c.driverAlreadyPublished);
    return anyPublished ? { ...INELIGIBLE, driverAlreadyPublished: true } : INELIGIBLE;
  }

  const slotOptions = eligible.map((c) =>
    suggestedDtoForCandidate(c, returnDirection, outboundParts),
  );

  return buildReturnSuggestionFromCandidate(
    eligible[0]!,
    outboundSlot,
    outboundDirection,
    departureAt,
    slotOptions,
  );
}
