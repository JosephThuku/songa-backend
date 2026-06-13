/**
 * Van seat grid (Laravel TripController::generateSeats).
 * seatNumber = 1-based bookable index; seatLabel = A1, B2, …
 */

export type VehicleSeatLayout = {
  rows?: number;
  cols?: number;
  /** e.g. [2, 2, 3] — Kenyan bench rows behind the driver. */
  row_pattern?: number[];
  preset?: string;
  disabled_seats?: string[];
};

export type GeneratedDepartureSeat = {
  seatNumber: number;
  seatLabel: string;
  row: number;
  col: number;
  status: "available" | "disabled";
};

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function resolveGridDimensions(
  layout: Pick<VehicleSeatLayout, "rows" | "cols">,
  capacity: number,
): { rows: number; cols: number } {
  const cols = layout.cols ?? 2;
  const rows = layout.rows ?? Math.max(1, Math.ceil((capacity + 1) / cols));
  return { rows, cols };
}

export function defaultVehicleSeatLayout(capacity: number): VehicleSeatLayout {
  const { rows, cols } = resolveGridDimensions({}, capacity);
  return { rows, cols, disabled_seats: [] };
}

export function parseVehicleSeatLayout(raw: unknown, capacity: number): VehicleSeatLayout {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const row_pattern = Array.isArray(o.row_pattern)
      ? o.row_pattern.filter((n): n is number => typeof n === "number" && n > 0)
      : undefined;
    const fallback = resolveGridDimensions(defaultVehicleSeatLayout(capacity), capacity);
    const rows = typeof o.rows === "number" ? o.rows : fallback.rows;
    const cols =
      typeof o.cols === "number"
        ? o.cols
        : row_pattern
          ? Math.max(...row_pattern)
          : fallback.cols;
    const disabled_seats = Array.isArray(o.disabled_seats)
      ? o.disabled_seats.filter((s): s is string => typeof s === "string")
      : [];
    const preset = typeof o.preset === "string" ? o.preset : undefined;
    return {
      rows: Math.max(1, rows),
      cols: Math.max(1, cols),
      row_pattern,
      preset,
      disabled_seats,
    };
  }
  return defaultVehicleSeatLayout(capacity);
}

function generateFromRowPattern(
  rowPattern: number[],
  capacity: number,
  disabled: Set<string>,
): GeneratedDepartureSeat[] {
  const maxCols = Math.max(...rowPattern, 2);
  const positions: { row: number; col: number }[] = [];
  let assigned = 0;

  const frontPassengerSlots = Math.max(0, (rowPattern[0] ?? 2) - 1);
  for (let col = 0; col < frontPassengerSlots && assigned < capacity; col += 1) {
    positions.push({ row: 0, col });
    assigned += 1;
  }

  for (let patternIndex = 1; patternIndex < rowPattern.length; patternIndex += 1) {
    const width = rowPattern[patternIndex]!;
    const twinMiddle =
      width === 2 && maxCols >= 3 && patternIndex === 1 && rowPattern.length >= 3;

    if (twinMiddle) {
      if (assigned < capacity) {
        positions.push({ row: patternIndex, col: 0 });
        assigned += 1;
      }
      if (assigned < capacity) {
        positions.push({ row: patternIndex, col: maxCols - 1 });
        assigned += 1;
      }
      continue;
    }

    for (let col = 0; col < width && assigned < capacity; col += 1) {
      positions.push({ row: patternIndex, col });
      assigned += 1;
    }
  }

  return positions
    .map((pos, index) => {
      const seatLabel = `${LETTERS[pos.row] ?? "X"}${pos.col + 1}`;
      const blocked = disabled.has(seatLabel);
      const status: GeneratedDepartureSeat["status"] = blocked ? "disabled" : "available";
      return {
        seatNumber: blocked ? 0 : index + 1,
        seatLabel,
        row: pos.row,
        col: pos.col,
        status,
      };
    })
    .filter((s) => s.seatNumber > 0);
}

export function generateDepartureSeatsFromVehicle(input: {
  seats: number;
  seatLayout?: unknown;
}): GeneratedDepartureSeat[] {
  const capacity = Math.max(1, input.seats);
  const layout = parseVehicleSeatLayout(input.seatLayout, capacity);
  const disabled = new Set(layout.disabled_seats ?? []);

  if (layout.row_pattern && layout.row_pattern.length > 0) {
    return generateFromRowPattern(layout.row_pattern, capacity, disabled);
  }

  const { rows, cols } = resolveGridDimensions(layout, capacity);

  const grid: GeneratedDepartureSeat[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 1; col <= cols; col++) {
      const seatLabel = `${LETTERS[row] ?? "X"}${col}`;
      const isDriverSeat = row === 0 && col === cols;
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
