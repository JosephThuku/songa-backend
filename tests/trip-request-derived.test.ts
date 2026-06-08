import { describe, expect, it } from "vitest";
import {
  derivedDepartureDate,
  tripRequestSlotWhereForBoard,
  tripRequestSlotWhereForZone,
  zoneForTripDirection,
} from "../src/lib/trip-request-derived.js";
import { nairobiLocalToUtc } from "../src/lib/nairobi-time.js";

const nyali = { id: "zone-nyali", slug: "nyali", name: "Nyali" };
const sgr = { id: "sgr-miritini", slug: "sgr-miritini", name: "SGR Miritini" };

describe("trip-request-derived", () => {
  it("derives Nairobi calendar day from van departure instant", () => {
    const at = nairobiLocalToUtc(
      { year: 2026, month: 6, day: 5, hour: 6, minute: 0 },
      "06:00",
      0,
    );
    expect(derivedDepartureDate(at)).toBe("2026-06-05");
  });

  it("picks pickup zone for to_sgr and dropoff zone for from_sgr", () => {
    const slot = {
      direction: "to_sgr" as const,
      pickupLocation: nyali,
      dropoffLocation: sgr,
    };
    expect(zoneForTripDirection(slot, "to_sgr")).toEqual(nyali);
    expect(zoneForTripDirection(slot, "from_sgr")).toEqual(sgr);
  });

  it("builds slot filter for return-demand by direction and zone", () => {
    expect(tripRequestSlotWhereForZone("to_sgr", nyali.id)).toEqual({
      sgrScheduleSlot: { direction: "to_sgr", pickupLocationId: nyali.id },
    });
    expect(tripRequestSlotWhereForZone("from_sgr", nyali.id)).toEqual({
      sgrScheduleSlot: { direction: "from_sgr", dropoffLocationId: nyali.id },
    });
  });

  it("builds driver board slot filter with optional direction and corridor", () => {
    expect(tripRequestSlotWhereForBoard({ direction: "to_sgr", corridorId: nyali.id })).toEqual({
      sgrScheduleSlot: { direction: "to_sgr", pickupLocationId: nyali.id },
    });
    expect(tripRequestSlotWhereForBoard({ corridorId: nyali.id })).toEqual({
      sgrScheduleSlot: {
        OR: [{ pickupLocationId: nyali.id }, { dropoffLocationId: nyali.id }],
      },
    });
    expect(tripRequestSlotWhereForBoard({})).toEqual({});
  });
});
