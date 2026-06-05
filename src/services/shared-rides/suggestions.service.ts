import type { SgrScheduleSlotRef, SharedRideDirection } from "../../domain/shared-rides.js";
import { sharedRidesConfig } from "../../lib/shared-rides-config.js";
import {
  getNairobiParts,
  nairobiLocalToUtc,
  toNairobiIso,
  type NairobiParts,
} from "../../lib/nairobi-time.js";
import { slotDetail, slotHeadline, suggestionTrainLabel } from "./slot-labels.js";

export type SuggestedTripRequestDto = {
  sgrScheduleSlotId: string;
  direction: SharedRideDirection;
  corridorLocationId: string;
  corridorLocationSlug: string;
  departureDate: string;
  headline: string;
  detail: string;
  trainLabel: string;
  vanDepartureAt: string;
  pricePerSeat: number;
  seatsRequested: number;
};

function zoneForSlot(slot: SgrScheduleSlotRef, direction: SharedRideDirection) {
  return direction === "to_sgr" ? slot.pickupLocation : slot.dropoffLocation;
}

function vanUtcAt(
  parts: NairobiParts,
  vanDepartureTime: string,
  dayOffset: number,
): Date {
  return nairobiLocalToUtc(parts, vanDepartureTime, dayOffset);
}

/** Next bookable van instant for a timetable row (to_sgr and from_sgr use the same rules). */
function nextBookableVanInstant(
  now: Date,
  parts: NairobiParts,
  slot: SgrScheduleSlotRef,
): { ok: boolean; vanAt: Date; dayOffset: number } {
  const rolloverMs = sharedRidesConfig.suggestionRolloverMinutes * 60_000;
  for (const dayOffset of [0, 1, 2]) {
    const vanAt = vanUtcAt(parts, slot.vanDepartureTime, dayOffset);
    if (vanAt.getTime() > now.getTime() + rolloverMs) {
      return { ok: true, vanAt, dayOffset };
    }
  }
  return { ok: false, vanAt: vanUtcAt(parts, slot.vanDepartureTime, 1), dayOffset: 1 };
}

export function buildSuggestedTripRequest(
  slot: SgrScheduleSlotRef,
  direction: SharedRideDirection,
  vanAt: Date,
  parts: NairobiParts,
  dayOffset: number,
  seatsRequested = 1,
): SuggestedTripRequestDto {
  const zone = zoneForSlot(slot, direction);
  const depDate = nairobiLocalToUtc(
    { ...parts, day: parts.day + dayOffset },
    slot.vanDepartureTime,
    0,
  );
  const departureDate = depDate.toISOString().slice(0, 10);

  return {
    sgrScheduleSlotId: slot.id,
    direction,
    corridorLocationId: zone.id,
    corridorLocationSlug: zone.slug,
    departureDate,
    headline: slotHeadline(direction, slot.trainService, slot.sgrEventTime),
    detail: slotDetail(zone.name, direction, slot.vanDepartureTime, slot.suggestedPricePerSeat),
    trainLabel: suggestionTrainLabel(
      direction,
      slot.trainService,
      slot.sgrEventTime,
      slot.vanDepartureTime,
    ),
    vanDepartureAt: toNairobiIso(vanAt),
    pricePerSeat: slot.suggestedPricePerSeat,
    seatsRequested,
  };
}

export function buildSuggestionsFromSlots(
  slots: SgrScheduleSlotRef[],
  direction: SharedRideDirection,
  at: Date = new Date(),
): SuggestedTripRequestDto[] {
  const parts = getNairobiParts(at);
  const now = at;
  const ranked: { slot: SgrScheduleSlotRef; vanAt: Date; dayOffset: number }[] = [];

  for (const slot of slots) {
    if (slot.direction !== direction) continue;
    const { ok, vanAt, dayOffset } = nextBookableVanInstant(now, parts, slot);
    if (ok) ranked.push({ slot, vanAt, dayOffset });
  }

  ranked.sort((a, b) => a.vanAt.getTime() - b.vanAt.getTime());

  return ranked
    .slice(0, sharedRidesConfig.maxSuggestions)
    .map(({ slot, vanAt, dayOffset }) =>
      buildSuggestedTripRequest(slot, direction, vanAt, parts, dayOffset),
    );
}
