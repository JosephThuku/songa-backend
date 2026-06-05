import { describe, expect, it } from "vitest";
import {
  suggestionTrainLabel,
  vanPickupPeriodLabel,
} from "../src/services/shared-rides/slot-labels.js";

describe("vanPickupPeriodLabel", () => {
  it("labels pre-dawn from_sgr pickups as Morning", () => {
    expect(vanPickupPeriodLabel("03:30")).toBe("Morning");
    expect(vanPickupPeriodLabel("08:00")).toBe("Morning");
  });

  it("labels afternoon and evening pickups", () => {
    expect(vanPickupPeriodLabel("14:00")).toBe("Afternoon");
    expect(vanPickupPeriodLabel("20:30")).toBe("Evening");
    expect(vanPickupPeriodLabel("22:30")).toBe("Night");
  });
});

describe("suggestionTrainLabel", () => {
  it("uses van pickup period for from_sgr instead of night train service", () => {
    expect(
      suggestionTrainLabel("from_sgr", "night", "03:35", "03:30"),
    ).toBe("Morning · arrives Miritini 3:35 AM");
  });

  it("keeps SGR train service labels for to_sgr", () => {
    expect(
      suggestionTrainLabel("to_sgr", "inter_county", "08:00", "06:00"),
    ).toBe("Inter-County · departs Miritini 8:00 AM");
  });
});
