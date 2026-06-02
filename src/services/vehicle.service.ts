import cuid from "cuid";
import type { Prisma } from "@prisma/client";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { toVehicleEmbedDto, type VehicleEmbedDto } from "../lib/responses.js";

export interface RegisterVehicleInput {
  type: string;
  make: string;
  model: string;
  registration: string;
  color: string;
  year?: string;
  seats: number;
  seatLayout?: { rows: number; cols: number; disabled_seats?: string[] };
}

export async function registerDriverVehicle(
  driverId: string,
  input: RegisterVehicleInput,
): Promise<{ vehicle: VehicleEmbedDto }> {
  const profile = await prisma.driverProfile.findUnique({ where: { userId: driverId } });
  if (!profile || profile.onboardingStatus !== "approved") {
    throw new AppError("DRIVER_NOT_APPROVED", 403, "Driver is not approved.");
  }

  const registration = input.registration.trim().toUpperCase();
  const seatLayoutJson = input.seatLayout
    ? (input.seatLayout as Prisma.InputJsonValue)
    : undefined;
  const existing = await prisma.vehicle.findUnique({ where: { registration } });
  const vehicle =
    existing ??
    (await prisma.vehicle.create({
      data: {
        id: `veh_${cuid()}`,
        type: input.type,
        make: input.make,
        model: input.model,
        registration,
        color: input.color,
        year: input.year ?? null,
        seats: input.seats,
        seatLayout: seatLayoutJson,
        status: "Activated",
      },
    }));

  if (existing && existing.id !== profile.vehicleId) {
    const linkedElsewhere = await prisma.driverProfile.findFirst({
      where: { vehicleId: existing.id, userId: { not: driverId } },
    });
    if (linkedElsewhere) {
      throw new AppError("VEHICLE_IN_USE", 409, "Registration is linked to another driver.");
    }
  }

  const updatedVehicle = await prisma.vehicle.update({
    where: { id: vehicle.id },
    data: {
      type: input.type,
      make: input.make,
      model: input.model,
      color: input.color,
      year: input.year ?? null,
      seats: input.seats,
      ...(seatLayoutJson !== undefined ? { seatLayout: seatLayoutJson } : {}),
      status: "Activated",
    },
  });

  await prisma.driverProfile.update({
    where: { userId: driverId },
    data: { vehicleId: updatedVehicle.id },
  });

  const dto = toVehicleEmbedDto(updatedVehicle);
  if (!dto) throw new AppError("INTERNAL_ERROR", 500, "Vehicle registration failed.");
  return { vehicle: dto };
}
