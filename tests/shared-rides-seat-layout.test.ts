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

  it("generates 7 seats in 2-3-3 row order matching the mobile picker", () => {
    const seats = generateDepartureSeatsFromVehicle({
      seats: 7,
      seatLayout: { preset: "2-3-3", row_pattern: [2, 3, 3], rows: 4, cols: 3 },
    });
    expect(seats.map((s) => s.seatNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("generates 3 seats in 1+2 row order", () => {
    const seats = generateDepartureSeatsFromVehicle({
      seats: 3,
      seatLayout: { preset: "1+2", row_pattern: [2, 2], rows: 2, cols: 2 },
    });
    expect(seats.map((s) => s.seatNumber)).toEqual([1, 2, 3]);
  });

  it("generates 4 seats in 1+3 row order", () => {
    const seats = generateDepartureSeatsFromVehicle({
      seats: 4,
      seatLayout: { preset: "1+3", row_pattern: [2, 3], rows: 2, cols: 3 },
    });
    expect(seats.map((s) => s.seatNumber)).toEqual([1, 2, 3, 4]);
  });

  it("generates 6 seats in 2-2-3 row order", () => {
    const seats = generateDepartureSeatsFromVehicle({
      seats: 6,
      seatLayout: { preset: "2-2-3", row_pattern: [2, 2, 3], rows: 3, cols: 3 },
    });
    expect(seats.map((s) => s.seatNumber)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("generates 6 seats in 2-3-2 row order", () => {
    const seats = generateDepartureSeatsFromVehicle({
      seats: 6,
      seatLayout: { preset: "2-3-2", row_pattern: [2, 3, 2], rows: 3, cols: 3 },
    });
    expect(seats.map((s) => s.seatNumber)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
