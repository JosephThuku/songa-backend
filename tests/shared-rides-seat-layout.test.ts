import { describe, expect, it } from "vitest";
import {
  defaultVehicleSeatLayout,
  generateDepartureSeatsFromVehicle,
  parseVehicleSeatLayout,
  type GeneratedDepartureSeat,
} from "../src/lib/shared-rides-seat-layout.js";

function expectValidSeatStatuses(seats: GeneratedDepartureSeat[]) {
  for (const seat of seats) {
    expect(seat.status === "available" || seat.status === "disabled").toBe(true);
  }
}

describe("parseVehicleSeatLayout", () => {
  it("fills missing rows and cols from capacity", () => {
    expect(parseVehicleSeatLayout({}, 14)).toEqual({
      rows: 8,
      cols: 2,
      row_pattern: undefined,
      preset: undefined,
      disabled_seats: [],
    });
  });

  it("derives cols from row_pattern when cols are omitted", () => {
    expect(parseVehicleSeatLayout({ row_pattern: [2, 3, 3] }, 7)).toMatchObject({
      rows: 4,
      cols: 3,
      row_pattern: [2, 3, 3],
    });
  });

  it("keeps explicit disabled seat labels", () => {
    expect(
      parseVehicleSeatLayout({ disabled_seats: ["B2", 42, null] }, 4).disabled_seats,
    ).toEqual(["B2"]);
  });
});

describe("defaultVehicleSeatLayout", () => {
  it("always returns concrete grid dimensions", () => {
    expect(defaultVehicleSeatLayout(7)).toEqual({ rows: 4, cols: 2, disabled_seats: [] });
  });
});

describe("generateDepartureSeatsFromVehicle", () => {
  it("labels seats A1, A2, B1 for a 14-seat van (2 cols)", () => {
    const seats = generateDepartureSeatsFromVehicle({ seats: 14 });
    expect(seats.length).toBe(14);
    expect(seats[0]?.seatLabel).toBe("A1");
    expect(seats.map((s) => s.seatLabel)).toContain("B1");
    expect(seats.every((s) => s.seatNumber >= 1)).toBe(true);
    expectValidSeatStatuses(seats);
  });

  it("generates seats when seatLayout omits rows and cols", () => {
    const seats = generateDepartureSeatsFromVehicle({ seats: 4, seatLayout: {} });
    expect(seats).toHaveLength(4);
    expect(seats.map((s) => s.seatNumber)).toEqual([1, 2, 3, 4]);
    expectValidSeatStatuses(seats);
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
    expectValidSeatStatuses(seats);
  });

  it("omits row-pattern seats listed in disabled_seats", () => {
    const seats = generateDepartureSeatsFromVehicle({
      seats: 3,
      seatLayout: {
        preset: "1+2",
        row_pattern: [2, 2],
        rows: 2,
        cols: 2,
        disabled_seats: ["A1"],
      },
    });
    expect(seats.map((s) => s.seatLabel)).toEqual(["B1", "B2"]);
    expect(seats.map((s) => s.seatNumber)).toEqual([2, 3]);
    expect(seats.every((s) => s.status === "available")).toBe(true);
  });
});
