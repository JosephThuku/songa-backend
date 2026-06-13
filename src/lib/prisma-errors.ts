import { Prisma } from "@prisma/client";
import { AppError } from "./errors.js";

const FK_FIELD_LABELS: Record<string, string> = {
  bookingId: "booking",
  rideId: "ride",
  passengerId: "passenger",
  driverId: "driver",
  sharedDepartureId: "departure",
  departureId: "departure",
};

function fieldFromMeta(
  meta: Record<string, unknown> | undefined,
): string | undefined {
  const field = meta?.field_name;
  return typeof field === "string" ? field : undefined;
}

/**
 * Maps Prisma integrity errors to AppError so clients never see raw SQL exceptions.
 */
export function mapPrismaError(error: unknown): AppError | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;

  if (error.code === "P2003") {
    const field = fieldFromMeta(error.meta as Record<string, unknown> | undefined);
    const label = field ? (FK_FIELD_LABELS[field] ?? field) : "related record";
    return new AppError(
      "REFERENCE_NOT_FOUND",
      409,
      `Invalid reference: ${label} does not exist.`,
      field ? { field } : undefined,
    );
  }

  if (error.code === "P2002") {
    return new AppError("CONFLICT", 409, "A record with this value already exists.");
  }

  if (error.code === "P2025") {
    return new AppError("NOT_FOUND", 404, "Record not found.");
  }

  return null;
}
