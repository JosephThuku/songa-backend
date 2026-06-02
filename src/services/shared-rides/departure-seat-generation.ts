import type { Prisma } from "@prisma/client";
import { generateDepartureSeatsFromVehicle } from "../../lib/shared-rides-seat-layout.js";

export function buildDepartureSeatRows(
  departureId: string,
  vehicle: { seats: number; seatLayout?: unknown },
): Prisma.SharedDepartureSeatCreateManyInput[] {
  return generateDepartureSeatsFromVehicle(vehicle).map((seat) => ({
    departureId,
    seatNumber: seat.seatNumber,
    seatLabel: seat.seatLabel,
    row: seat.row,
    col: seat.col,
    status: seat.status,
  }));
}
