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

  it("returns up to two from_sgr suggestions sorted by van time", () => {
    /** 10:00 Nairobi — afternoon and evening arrivals still bookable */
    const midMorning = new Date("2026-06-06T07:00:00.000Z");
    const slots: SgrScheduleSlotRef[] = [
      slot({
        id: "afternoon",
        direction: "from_sgr",
        trainService: "inter_county",
        sgrEventTime: "14:00",
        vanDepartureTime: "14:00",
        pickupLocation: { id: "s", slug: "sgr-miritini", name: "SGR Miritini" },
        dropoffLocation: { id: "z", slug: "nyali", name: "Nyali" },
      }),
      slot({
        id: "evening",
        direction: "from_sgr",
        trainService: "express",
        sgrEventTime: "20:08",
        vanDepartureTime: "20:30",
        pickupLocation: { id: "s", slug: "sgr-miritini", name: "SGR Miritini" },
        dropoffLocation: { id: "z", slug: "nyali", name: "Nyali" },
      }),
      slot({
        id: "night",
        direction: "from_sgr",
        trainService: "night",
        sgrEventTime: "03:35",
        vanDepartureTime: "03:30",
        pickupLocation: { id: "s", slug: "sgr-miritini", name: "SGR Miritini" },
        dropoffLocation: { id: "z", slug: "nyali", name: "Nyali" },
      }),
    ];

    const suggestions = buildSuggestionsFromSlots(slots, "from_sgr", midMorning);

    expect(suggestions).toHaveLength(2);
    expect(suggestions.every((s) => s.direction === "from_sgr")).toBe(true);
    expect(suggestions[0]?.sgrScheduleSlotId).toBe("afternoon");
    expect(suggestions[1]?.sgrScheduleSlotId).toBe("evening");
    expect(suggestions[0]?.headline).toMatch(/arrival/i);
    expect(suggestions[0]?.trainLabel).toBe("Afternoon · arrives Miritini 2:00 PM");
    expect(suggestions[1]?.trainLabel).toBe("Evening · arrives Miritini 8:08 PM");
  });

  it("labels early-morning from_sgr arrivals as Morning, not Night", () => {
    const earlyMorning = new Date("2026-06-06T00:30:00.000Z"); // 03:30 Nairobi
    const slots: SgrScheduleSlotRef[] = [
      slot({
        id: "overnight-arrival",
        direction: "from_sgr",
        trainService: "night",
        sgrEventTime: "03:35",
        vanDepartureTime: "03:30",
        pickupLocation: { id: "s", slug: "sgr-miritini", name: "SGR Miritini" },
        dropoffLocation: { id: "z", slug: "nyali", name: "Nyali" },
      }),
    ];

    const suggestions = buildSuggestionsFromSlots(slots, "from_sgr", earlyMorning);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.trainLabel).toBe("Morning · arrives Miritini 3:35 AM");
  });

  it("returns from_sgr suggestions in the evening when daytime slots have passed", () => {
    /** 20:41 Nairobi — 14:00 and 20:30 today are closed; next are tomorrow */
    const evening = new Date("2026-06-05T17:41:00.000Z");
    const slots: SgrScheduleSlotRef[] = [
      slot({
        id: "afternoon",
        direction: "from_sgr",
        sgrEventTime: "14:00",
        vanDepartureTime: "14:00",
        pickupLocation: { id: "s", slug: "sgr-miritini", name: "SGR Miritini" },
        dropoffLocation: { id: "z", slug: "nyali", name: "Nyali" },
      }),
      slot({
        id: "evening",
        direction: "from_sgr",
        trainService: "express",
        sgrEventTime: "20:08",
        vanDepartureTime: "20:30",
        pickupLocation: { id: "s", slug: "sgr-miritini", name: "SGR Miritini" },
        dropoffLocation: { id: "z", slug: "nyali", name: "Nyali" },
      }),
    ];

    const suggestions = buildSuggestionsFromSlots(slots, "from_sgr", evening);

    expect(suggestions).toHaveLength(2);
    expect(suggestions[0]?.departureDate).toBe("2026-06-06");
    expect(suggestions[0]?.vanDepartureAt).toContain("T14:00:00");
    expect(suggestions[1]?.vanDepartureAt).toContain("T20:30:00");
  });

  it("rolls to_sgr suggestions to the next day when van is within 20 minutes", () => {
    const slots: SgrScheduleSlotRef[] = [
      slot({
        id: "noon",
        direction: "to_sgr",
        sgrEventTime: "15:00",
        vanDepartureTime: "12:00",
      }),
    ];
    /** 11:45 Nairobi → 08:45 UTC, 15 min before noon van */
    const fifteenMinBefore = new Date("2026-06-06T08:45:00.000Z");
    const suggestions = buildSuggestionsFromSlots(slots, "to_sgr", fifteenMinBefore);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.departureDate).toBe("2026-06-07");
    expect(suggestions[0]?.vanDepartureAt).toBe("2026-06-07T12:00:00+03:00");
  });

  it("keeps todays to_sgr suggestion when van is more than 20 minutes away", () => {
    const slots: SgrScheduleSlotRef[] = [
      slot({
        id: "noon",
        direction: "to_sgr",
        sgrEventTime: "15:00",
        vanDepartureTime: "12:00",
      }),
    ];
    /** 11:30 Nairobi → 08:30 UTC, 30 min before noon van */
    const thirtyMinBefore = new Date("2026-06-06T08:30:00.000Z");
    const suggestions = buildSuggestionsFromSlots(slots, "to_sgr", thirtyMinBefore);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.departureDate).toBe("2026-06-06");
    expect(suggestions[0]?.vanDepartureAt).toBe("2026-06-06T12:00:00+03:00");
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
