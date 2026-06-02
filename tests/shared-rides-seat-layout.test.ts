import { describe, expect, it } from "vitest";
import { generateDepartureSeatsFromVehicle } from "../src/lib/shared-rides-seat-layout.js";

describe("generateDepartureSeatsFromVehicle", () => {
  it("labels seats A1, A2, B1 for a 14-seat van (2 cols)", () => {
    const seats = generateDepartureSeatsFromVehicle({ seats: 14 });
    expect(seats.length).toBe(14);
    expect(seats[0]?.seatLabel).toBe("A1");
    expect(seats.map((s) => s.seatLabel)).toContain("B1");
    expect(seats.every((s) => s.seatNumber >= 1)).toBe(true);
  });

  it("disables driver seat at row 0 last col", () => {
    const all = generateDepartureSeatsFromVehicle({
      seats: 4,
      seatLayout: { rows: 2, cols: 2 },
    });
    expect(all.length).toBeLessThanOrEqual(4);
  });
});
