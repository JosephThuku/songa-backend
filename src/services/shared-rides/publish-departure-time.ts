import { AppError } from "../../lib/errors.js";
import { getNairobiParts, nairobiLocalToUtc } from "../../lib/nairobi-time.js";
import { sharedRidesConfig } from "../../lib/shared-rides-config.js";

const MAX_EARLY_BEFORE_TIMETABLE_MIN = 180;
const TIMETABLE_LATE_GRACE_MS = 5 * 60_000;

/** Closest timetable van instant for the calendar day of `departureAt`. */
export function timetableVanInstantForDeparture(
  vanDepartureTimeHm: string,
  departureAt: Date,
): Date {
  const parts = getNairobiParts(departureAt);
  let best = nairobiLocalToUtc(parts, vanDepartureTimeHm, 0);
  let bestDiff = Math.abs(best.getTime() - departureAt.getTime());
  for (const dayOffset of [-1, 1]) {
    const candidate = nairobiLocalToUtc(parts, vanDepartureTimeHm, dayOffset);
    const diff = Math.abs(candidate.getTime() - departureAt.getTime());
    if (diff < bestDiff) {
      best = candidate;
      bestDiff = diff;
    }
  }
  return best;
}

export function assertDriverPublishDepartureAt(
  slot: { vanDepartureTime: string },
  departureAt: Date,
  now: Date = new Date(),
): void {
  if (departureAt.getTime() <= now.getTime()) {
    throw new AppError("DEPARTURE_IN_PAST", 400, "Departure must be in the future.");
  }

  const leadMs = sharedRidesConfig.bookingLeadMinutes * 60_000;
  if (departureAt.getTime() < now.getTime() + leadMs) {
    throw new AppError(
      "DEPARTURE_TOO_SOON",
      400,
      `Departure must be at least ${sharedRidesConfig.bookingLeadMinutes} minutes from now so passengers can book.`,
    );
  }

  const timetableVan = timetableVanInstantForDeparture(slot.vanDepartureTime, departureAt);

  if (departureAt.getTime() > timetableVan.getTime() + TIMETABLE_LATE_GRACE_MS) {
    throw new AppError(
      "DEPARTURE_TOO_LATE",
      400,
      "Van departure cannot be after the timetable slot time for this train.",
    );
  }

  const earlyMs = timetableVan.getTime() - departureAt.getTime();
  if (earlyMs > MAX_EARLY_BEFORE_TIMETABLE_MIN * 60_000) {
    throw new AppError(
      "DEPARTURE_TOO_EARLY",
      400,
      `Van cannot leave more than ${MAX_EARLY_BEFORE_TIMETABLE_MIN / 60} hours before the timetable van time.`,
    );
  }
}
