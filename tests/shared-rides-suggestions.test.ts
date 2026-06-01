import { describe, expect, it } from "vitest";
import type { SgrScheduleSlotRef } from "../src/domain/shared-rides.js";
import { buildSuggestionsFromSlots } from "../src/services/shared-rides/suggestions.service.js";

function slot(
  partial: Partial<SgrScheduleSlotRef> & Pick<SgrScheduleSlotRef, "id" | "direction" | "vanDepartureTime" | "sgrEventTime">,
): SgrScheduleSlotRef {
  return {
    trainService: "inter_county",
    suggestedPricePerSeat: 350,
    pickupLocation: { id: "zone-1", slug: "nyali", name: "Nyali" },
    dropoffLocation: { id: "sgr-1", slug: "sgr-miritini", name: "SGR Miritini" },
    ...partial,
  };
}

/** 10:00 Nairobi — late vans same day are still bookable with default 120 min lead. */
const NAIROBI_MID_MORNING = new Date("2026-06-02T07:00:00.000Z");

describe("buildSuggestionsFromSlots", () => {
  it("only returns slots matching the requested direction", () => {
    const slots: SgrScheduleSlotRef[] = [
      slot({
        id: "to",
        direction: "to_sgr",
        sgrEventTime: "15:00",
        vanDepartureTime: "22:00",
      }),
      slot({
        id: "from",
        direction: "from_sgr",
        sgrEventTime: "14:00",
        vanDepartureTime: "14:00",
        pickupLocation: { id: "sgr-1", slug: "sgr-miritini", name: "SGR Miritini" },
        dropoffLocation: { id: "zone-1", slug: "nyali", name: "Nyali" },
      }),
    ];

    const suggestions = buildSuggestionsFromSlots(slots, "to_sgr", NAIROBI_MID_MORNING);

    expect(suggestions.every((s) => s.direction === "to_sgr")).toBe(true);
    expect(suggestions.map((s) => s.sgrScheduleSlotId)).toEqual(["to"]);
  });

  it("returns at most two suggestions (SHARED_RIDES_MAX_SUGGESTIONS default)", () => {
    const slots: SgrScheduleSlotRef[] = ["20:00", "21:00", "22:00", "23:00"].map((van, i) =>
      slot({
        id: `slot-${i}`,
        direction: "to_sgr",
        sgrEventTime: "22:00",
        vanDepartureTime: van,
      }),
    );

    const suggestions = buildSuggestionsFromSlots(slots, "to_sgr", NAIROBI_MID_MORNING);

    expect(suggestions.length).toBeLessThanOrEqual(2);
    expect(suggestions.length).toBe(2);
  });

  it("sorts suggestions by van departure time ascending", () => {
    const slots: SgrScheduleSlotRef[] = [
      slot({ id: "late", direction: "to_sgr", sgrEventTime: "22:00", vanDepartureTime: "23:00" }),
      slot({ id: "early", direction: "to_sgr", sgrEventTime: "15:00", vanDepartureTime: "20:00" }),
    ];

    const suggestions = buildSuggestionsFromSlots(slots, "to_sgr", NAIROBI_MID_MORNING);

    expect(suggestions.map((s) => s.sgrScheduleSlotId)).toEqual(["early", "late"]);
  });

  it("includes from_sgr slots within arrival grace and lookahead", () => {
    /** 13:30 Nairobi → 10:30 UTC */
    const beforeAfternoonArrival = new Date("2026-06-02T10:30:00.000Z");
    const slots: SgrScheduleSlotRef[] = [
      slot({
        id: "arrival",
        direction: "from_sgr",
        trainService: "inter_county",
        sgrEventTime: "14:00",
        vanDepartureTime: "14:00",
        pickupLocation: { id: "s", slug: "sgr-miritini", name: "SGR Miritini" },
        dropoffLocation: { id: "z", slug: "nyali", name: "Nyali" },
      }),
    ];

    const suggestions = buildSuggestionsFromSlots(slots, "from_sgr", beforeAfternoonArrival);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      direction: "from_sgr",
      corridorLocationSlug: "nyali",
      pricePerSeat: 350,
      seatsRequested: 1,
    });
    expect(suggestions[0]?.headline).toMatch(/arrival/i);
  });

  it("serializes vanDepartureAt in EAT (+03:00)", () => {
    const slots: SgrScheduleSlotRef[] = [
      slot({ id: "morning", direction: "to_sgr", sgrEventTime: "08:00", vanDepartureTime: "06:00" }),
    ];
    const suggestions = buildSuggestionsFromSlots(slots, "to_sgr", NAIROBI_MID_MORNING);
    expect(suggestions[0]?.vanDepartureAt).toMatch(/\+03:00$/);
    expect(suggestions[0]?.vanDepartureAt).toContain("T06:00:00");
  });
});
