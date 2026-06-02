/**
 * Van seat grid (Laravel TripController::generateSeats).
 * seatNumber = 1-based bookable index; seatLabel = A1, B2, …
 */

export type VehicleSeatLayout = {
  rows: number;
  cols: number;
  disabled_seats?: string[];
};

export type GeneratedDepartureSeat = {
  seatNumber: number;
  seatLabel: string;
  row: number;
  col: number;
  status: "available" | "disabled";
};

export function defaultVehicleSeatLayout(capacity: number): VehicleSeatLayout {
  const cols = 2;
  /** +1 row accounts for the non-bookable driver seat (Laravel: row 0, last col). */
  const rows = Math.max(1, Math.ceil((capacity + 1) / cols));
  return { rows, cols, disabled_seats: [] };
}

export function parseVehicleSeatLayout(raw: unknown, capacity: number): VehicleSeatLayout {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const rows = typeof o.rows === "number" ? o.rows : defaultVehicleSeatLayout(capacity).rows;
    const cols = typeof o.cols === "number" ? o.cols : 2;
    const disabled_seats = Array.isArray(o.disabled_seats)
      ? o.disabled_seats.filter((s): s is string => typeof s === "string")
      : [];
    return { rows: Math.max(1, rows), cols: Math.max(1, cols), disabled_seats };
  }
  return defaultVehicleSeatLayout(capacity);
}

export function generateDepartureSeatsFromVehicle(input: {
  seats: number;
  seatLayout?: unknown;
}): GeneratedDepartureSeat[] {
  const capacity = Math.max(1, input.seats);
  const layout = parseVehicleSeatLayout(input.seatLayout, capacity);
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const disabled = new Set(layout.disabled_seats ?? []);

  const grid: GeneratedDepartureSeat[] = [];
  for (let row = 0; row < layout.rows; row++) {
    for (let col = 1; col <= layout.cols; col++) {
      const seatLabel = `${letters[row] ?? "X"}${col}`;
      const isDriverSeat = row === 0 && col === layout.cols;
      let status: "available" | "disabled" = "available";
      if (isDriverSeat || disabled.has(seatLabel)) {
        status = "disabled";
      }
      grid.push({
        seatNumber: 0,
        seatLabel,
        row,
        col,
        status,
      });
    }
  }

  const bookable = grid.filter((s) => s.status === "available");
  const excess = bookable.length - capacity;
  if (excess > 0) {
    const toDisable = new Set(bookable.slice(-excess).map((s) => s.seatLabel));
    for (const seat of grid) {
      if (toDisable.has(seat.seatLabel)) {
        seat.status = "disabled";
      }
    }
  }

  let n = 0;
  for (const seat of grid) {
    if (seat.status === "available") {
      n += 1;
      seat.seatNumber = n;
    }
  }

  return grid.filter((s) => s.seatNumber > 0);
}
