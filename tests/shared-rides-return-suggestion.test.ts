import { describe, expect, it } from "vitest";
import type { SgrScheduleSlotRef } from "../src/domain/shared-rides.js";
import { nairobiLocalToUtc } from "../src/lib/nairobi-time.js";
import {
  buildReturnSuggestionFromCandidate,
  computePrefillDepartureAt,
  oppositeDirection,
  rankReturnSlotCandidates,
  returnVanInstantOnOutboundDay,
} from "../src/services/shared-rides/return-suggestion.service.js";

function slot(
  partial: Partial<SgrScheduleSlotRef> & Pick<SgrScheduleSlotRef, "id" | "direction" | "vanDepartureTime" | "sgrEventTime">,
): SgrScheduleSlotRef {
  return {
    trainService: "inter_county",
    suggestedPricePerSeat: 350,
    pickupLocation: { id: "zone-nyali", slug: "nyali", name: "Nyali" },
    dropoffLocation: { id: "sgr-1", slug: "sgr-miritini", name: "SGR Miritini" },
    ...partial,
  };
}

function fromSgrSlot(
  partial: Partial<SgrScheduleSlotRef> & Pick<SgrScheduleSlotRef, "id" | "vanDepartureTime" | "sgrEventTime">,
): SgrScheduleSlotRef {
  return slot({
    direction: "from_sgr",
    pickupLocation: { id: "sgr-1", slug: "sgr-miritini", name: "SGR Miritini" },
    dropoffLocation: { id: "zone-nyali", slug: "nyali", name: "Nyali" },
    ...partial,
  });
}

describe("return suggestion pairing", () => {
  it("flips to_sgr outbound to from_sgr return direction", () => {
    expect(oppositeDirection("to_sgr")).toBe("from_sgr");
    expect(oppositeDirection("from_sgr")).toBe("to_sgr");
  });

  it("Nyali to_sgr 4am outbound suggests from_sgr return same Nairobi day", () => {
    const outboundParts = { year: 2026, month: 6, day: 5, hour: 3, minute: 30 };
    const outboundAt = nairobiLocalToUtc(outboundParts, "04:00", 0);
    const outboundSlot = slot({
      id: "nyali-to-4",
      direction: "to_sgr",
      sgrEventTime: "06:00",
      vanDepartureTime: "04:00",
    });

    const returnSlots = [
      fromSgrSlot({ id: "early-return", sgrEventTime: "05:30", vanDepartureTime: "05:30" }),
      fromSgrSlot({ id: "later-return", sgrEventTime: "14:00", vanDepartureTime: "14:00" }),
    ];

    const ranked = rankReturnSlotCandidates(
      returnSlots,
      "from_sgr",
      outboundAt,
      new Map(),
      new Set(),
    );

    expect(ranked.map((c) => c.slot.id)).toEqual(["early-return", "later-return"]);
    const suggestion = buildReturnSuggestionFromCandidate(
      ranked[0]!,
      outboundSlot,
      "to_sgr",
      outboundAt,
    );
    expect(suggestion).toMatchObject({
      eligible: true,
      reason: "round_trip",
      suggestedSlot: {
        direction: "from_sgr",
        corridorLocationSlug: "nyali",
        sgrScheduleSlotId: "early-return",
      },
    });
    expect(suggestion.prefill?.sgrScheduleSlotId).toBe("early-return");
  });

  it("excludes return when driver already published that slot today", () => {
    const outboundParts = { year: 2026, month: 6, day: 5, hour: 5, minute: 0 };
    const outboundAt = nairobiLocalToUtc(outboundParts, "06:00", 0);
    const outboundSlot = slot({
      id: "nyali-to",
      direction: "to_sgr",
      sgrEventTime: "08:00",
      vanDepartureTime: "06:00",
    });
    const returnSlots = [
      fromSgrSlot({ id: "return-14", sgrEventTime: "14:00", vanDepartureTime: "14:00" }),
    ];

    const ranked = rankReturnSlotCandidates(
      returnSlots,
      "from_sgr",
      outboundAt,
      new Map(),
      new Set(["return-14"]),
    );

    expect(ranked[0]?.driverAlreadyPublished).toBe(true);
    const suggestion = buildReturnSuggestionFromCandidate(
      ranked[0]!,
      outboundSlot,
      "to_sgr",
      outboundAt,
    );
    expect(suggestion.eligible).toBe(false);
    expect(suggestion.driverAlreadyPublished).toBe(true);
  });

  it("from_sgr outbound suggests to_sgr return in opposite direction", () => {
    const outboundParts = { year: 2026, month: 6, day: 5, hour: 13, minute: 45 };
    const outboundAt = nairobiLocalToUtc(outboundParts, "14:00", 0);
    const outboundSlot = fromSgrSlot({
      id: "nyali-from-14",
      sgrEventTime: "14:00",
      vanDepartureTime: "14:00",
    });

    const returnSlots = [
      slot({
        id: "nyali-to-night",
        direction: "to_sgr",
        trainService: "night",
        sgrEventTime: "22:00",
        vanDepartureTime: "18:00",
      }),
    ];

    const ranked = rankReturnSlotCandidates(
      returnSlots,
      "to_sgr",
      outboundAt,
      new Map(),
      new Set(),
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.slot.direction).toBe("to_sgr");
    const suggestion = buildReturnSuggestionFromCandidate(
      ranked[0]!,
      outboundSlot,
      "from_sgr",
      outboundAt,
    );
    expect(suggestion.eligible).toBe(true);
    expect(suggestion.suggestedSlot?.direction).toBe("to_sgr");
  });

  it("ranks return slots with more open trip demand higher", () => {
    const outboundParts = { year: 2026, month: 6, day: 5, hour: 5, minute: 0 };
    const outboundAt = nairobiLocalToUtc(outboundParts, "06:00", 0);
    const returnSlots = [
      fromSgrSlot({ id: "low-demand", sgrEventTime: "14:00", vanDepartureTime: "14:00" }),
      fromSgrSlot({ id: "high-demand", sgrEventTime: "20:08", vanDepartureTime: "20:30" }),
    ];

    const demand = new Map([
      ["low-demand", { openTripRequests: 1, seatsRequested: 2 }],
      ["high-demand", { openTripRequests: 3, seatsRequested: 5 }],
    ]);

    const ranked = rankReturnSlotCandidates(
      returnSlots,
      "from_sgr",
      outboundAt,
      demand,
      new Set(),
    );

    expect(ranked[0]?.slot.id).toBe("high-demand");
    const suggestion = buildReturnSuggestionFromCandidate(
      ranked[0]!,
      slot({
        id: "out",
        direction: "to_sgr",
        sgrEventTime: "08:00",
        vanDepartureTime: "06:00",
      }),
      "to_sgr",
      outboundAt,
    );
    expect(suggestion.reason).toBe("passengers_waiting");
    expect(suggestion.openTripRequests).toBe(3);
    expect(suggestion.seatsRequested).toBe(5);
  });

  it("requires return van after outbound plus minimum gap", () => {
    const outboundParts = { year: 2026, month: 6, day: 5, hour: 5, minute: 0 };
    const outboundAt = nairobiLocalToUtc(outboundParts, "06:00", 0);
    const returnSlots = [
      fromSgrSlot({ id: "too-soon", sgrEventTime: "06:30", vanDepartureTime: "06:30" }),
      fromSgrSlot({ id: "ok", sgrEventTime: "14:00", vanDepartureTime: "14:00" }),
    ];

    const ranked = rankReturnSlotCandidates(
      returnSlots,
      "from_sgr",
      outboundAt,
      new Map(),
      new Set(),
    );

    expect(ranked.map((c) => c.slot.id)).toEqual(["ok"]);
    expect(returnVanInstantOnOutboundDay(outboundParts, "06:30").getTime()).toBeLessThanOrEqual(
      outboundAt.getTime() + 45 * 60_000,
    );
  });

  it("prefill uses slot van time when later than ideal return after SGR", () => {
    const outboundParts = { year: 2026, month: 6, day: 5, hour: 5, minute: 0 };
    const outboundAt = nairobiLocalToUtc(outboundParts, "06:00", 0);
    const outboundSlot = slot({
      id: "to",
      direction: "to_sgr",
      sgrEventTime: "08:00",
      vanDepartureTime: "06:00",
    });
    const candidateVanAt = nairobiLocalToUtc(outboundParts, "14:00", 0);

    const prefillAt = computePrefillDepartureAt(
      outboundSlot,
      "to_sgr",
      outboundAt,
      candidateVanAt,
    );

    expect(prefillAt.getTime()).toBe(candidateVanAt.getTime());
  });

  it("prefill uses ideal return when earlier than slot van time", () => {
    const outboundParts = { year: 2026, month: 6, day: 5, hour: 3, minute: 0 };
    const outboundAt = nairobiLocalToUtc(outboundParts, "04:00", 0);
    const outboundSlot = slot({
      id: "to-early",
      direction: "to_sgr",
      sgrEventTime: "06:00",
      vanDepartureTime: "04:00",
    });
    const candidateVanAt = nairobiLocalToUtc(outboundParts, "07:00", 0);

    const prefillAt = computePrefillDepartureAt(
      outboundSlot,
      "to_sgr",
      outboundAt,
      candidateVanAt,
    );

    const idealAt = nairobiLocalToUtc(outboundParts, "06:00", 0).getTime() + 75 * 60_000;
    expect(prefillAt.getTime()).toBe(idealAt);
  });
});
