import type { SharedRideDirection } from "../domain/shared-rides.js";
import { getNairobiParts } from "./nairobi-time.js";

export type TripRequestZoneLocation = {
  id: string;
  slug: string;
  name: string;
};

export type TripRequestSlotLocations = {
  direction: SharedRideDirection;
  pickupLocation: TripRequestZoneLocation;
  dropoffLocation: TripRequestZoneLocation;
};

/** Neighborhood zone for a trip request (pickup when to_sgr, dropoff when from_sgr). */
export function zoneForTripDirection(
  slot: TripRequestSlotLocations,
  direction: SharedRideDirection = slot.direction,
): TripRequestZoneLocation {
  return direction === "to_sgr" ? slot.pickupLocation : slot.dropoffLocation;
}

/** Nairobi calendar day (YYYY-MM-DD) from a van departure instant. */
export function derivedDepartureDate(requestedDepartureAt: Date): string {
  const p = getNairobiParts(requestedDepartureAt);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Prisma filter: open trip requests in a corridor for a direction (slot-derived). */
export function tripRequestSlotWhereForZone(
  direction: SharedRideDirection,
  zoneId: string,
): { sgrScheduleSlot: { direction: SharedRideDirection; pickupLocationId?: string; dropoffLocationId?: string } } {
  return {
    sgrScheduleSlot: {
      direction,
      ...(direction === "to_sgr"
        ? { pickupLocationId: zoneId }
        : { dropoffLocationId: zoneId }),
    },
  };
}

/** Prisma filter for driver board (optional direction and/or corridor slug resolution). */
export function tripRequestSlotWhereForBoard(filters: {
  direction?: SharedRideDirection;
  corridorId?: string;
}): { sgrScheduleSlot?: Record<string, unknown> } {
  const { direction, corridorId } = filters;
  if (!direction && !corridorId) return {};

  const slotWhere: Record<string, unknown> = {};
  if (direction) slotWhere.direction = direction;
  if (corridorId) {
    if (direction === "to_sgr") {
      slotWhere.pickupLocationId = corridorId;
    } else if (direction === "from_sgr") {
      slotWhere.dropoffLocationId = corridorId;
    } else {
      slotWhere.OR = [
        { pickupLocationId: corridorId },
        { dropoffLocationId: corridorId },
      ];
    }
  }
  return { sgrScheduleSlot: slotWhere };
}
