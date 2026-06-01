import type { Prisma } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import type {
  AdminCreateCorridorLocationSchema,
  AdminCreateSgrScheduleSlotSchema,
  AdminUpdateCorridorLocationSchema,
  AdminUpdateSgrScheduleSlotSchema,
} from "../../schemas/shared-rides-admin.schema.js";
import type { z } from "zod";

const locationSelect = {
  id: true,
  slug: true,
  name: true,
  lat: true,
  lng: true,
  radiusM: true,
  sortOrder: true,
  isActive: true,
} satisfies Prisma.CorridorLocationSelect;

type CreateLocationInput = z.infer<typeof AdminCreateCorridorLocationSchema>;
type UpdateLocationInput = z.infer<typeof AdminUpdateCorridorLocationSchema>;
type CreateSlotInput = z.infer<typeof AdminCreateSgrScheduleSlotSchema>;
type UpdateSlotInput = z.infer<typeof AdminUpdateSgrScheduleSlotSchema>;

export async function adminCreateCorridorLocation(data: CreateLocationInput) {
  const existing = await prisma.corridorLocation.findUnique({ where: { slug: data.slug } });
  if (existing) {
    throw new AppError("CORRIDOR_SLUG_TAKEN", 409, "Corridor slug already exists.");
  }

  const location = await prisma.corridorLocation.create({
    data: {
      slug: data.slug,
      name: data.name,
      lat: data.lat ?? null,
      lng: data.lng ?? null,
      radiusM: data.radiusM ?? 2500,
      sortOrder: data.sortOrder ?? 0,
      isActive: data.isActive ?? true,
    },
    select: locationSelect,
  });

  return { location };
}

export async function adminUpdateCorridorLocation(id: string, data: UpdateLocationInput) {
  const current = await prisma.corridorLocation.findUnique({ where: { id } });
  if (!current) {
    throw new AppError("CORRIDOR_LOCATION_NOT_FOUND", 404, "Corridor location not found.");
  }

  if (data.slug && data.slug !== current.slug) {
    const taken = await prisma.corridorLocation.findUnique({ where: { slug: data.slug } });
    if (taken) {
      throw new AppError("CORRIDOR_SLUG_TAKEN", 409, "Corridor slug already exists.");
    }
  }

  if (current.slug === "sgr-miritini" && data.isActive === false) {
    throw new AppError("CORRIDOR_PROTECTED", 409, "SGR Miritini cannot be deactivated.");
  }

  const location = await prisma.corridorLocation.update({
    where: { id },
    data: {
      ...(data.slug !== undefined ? { slug: data.slug } : {}),
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.lat !== undefined ? { lat: data.lat } : {}),
      ...(data.lng !== undefined ? { lng: data.lng } : {}),
      ...(data.radiusM !== undefined ? { radiusM: data.radiusM } : {}),
      ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    },
    select: locationSelect,
  });

  return { location };
}

export async function adminDeactivateCorridorLocation(id: string) {
  return adminUpdateCorridorLocation(id, { isActive: false });
}

async function assertLocationsExist(pickupLocationId: string, dropoffLocationId: string) {
  if (pickupLocationId === dropoffLocationId) {
    throw new AppError("INVALID_INPUT", 400, "Pickup and dropoff must be different locations.");
  }
  const [pickup, dropoff] = await Promise.all([
    prisma.corridorLocation.findFirst({ where: { id: pickupLocationId, isActive: true } }),
    prisma.corridorLocation.findFirst({ where: { id: dropoffLocationId, isActive: true } }),
  ]);
  if (!pickup || !dropoff) {
    throw new AppError("CORRIDOR_LOCATION_NOT_FOUND", 404, "Pickup or dropoff location not found.");
  }
}

function slotUniqueWhere(row: {
  pickupLocationId: string;
  dropoffLocationId: string;
  trainService: string;
  direction: string;
  sgrEventTime: string;
  vanDepartureTime: string;
}) {
  return {
    pickupLocationId_dropoffLocationId_trainService_direction_sgrEventTime_vanDepartureTime:
      {
        pickupLocationId: row.pickupLocationId,
        dropoffLocationId: row.dropoffLocationId,
        trainService: row.trainService as "inter_county" | "express" | "night",
        direction: row.direction as "to_sgr" | "from_sgr",
        sgrEventTime: row.sgrEventTime,
        vanDepartureTime: row.vanDepartureTime,
      },
  };
}

export async function adminCreateSgrScheduleSlot(data: CreateSlotInput) {
  await assertLocationsExist(data.pickupLocationId, data.dropoffLocationId);

  const conflict = await prisma.sgrScheduleSlot.findUnique({
    where: slotUniqueWhere(data),
  });
  if (conflict) {
    throw new AppError("SGR_SLOT_CONFLICT", 409, "An identical schedule slot already exists.");
  }

  const slot = await prisma.sgrScheduleSlot.create({
    data: {
      pickupLocationId: data.pickupLocationId,
      dropoffLocationId: data.dropoffLocationId,
      direction: data.direction,
      trainService: data.trainService,
      sgrEventTime: data.sgrEventTime,
      vanDepartureTime: data.vanDepartureTime,
      suggestedPricePerSeat: data.suggestedPricePerSeat,
      sortOrder: data.sortOrder ?? 0,
      isActive: data.isActive ?? true,
    },
    include: {
      pickupLocation: { select: locationSelect },
      dropoffLocation: { select: locationSelect },
    },
  });

  return { slot };
}

export async function adminUpdateSgrScheduleSlot(id: string, data: UpdateSlotInput) {
  const current = await prisma.sgrScheduleSlot.findUnique({ where: { id } });
  if (!current) {
    throw new AppError("SGR_SLOT_NOT_FOUND", 404, "SGR schedule slot not found.");
  }

  const merged = {
    pickupLocationId: data.pickupLocationId ?? current.pickupLocationId,
    dropoffLocationId: data.dropoffLocationId ?? current.dropoffLocationId,
    direction: data.direction ?? current.direction,
    trainService: data.trainService ?? current.trainService,
    sgrEventTime: data.sgrEventTime ?? current.sgrEventTime,
    vanDepartureTime: data.vanDepartureTime ?? current.vanDepartureTime,
    suggestedPricePerSeat: data.suggestedPricePerSeat ?? current.suggestedPricePerSeat,
    sortOrder: data.sortOrder ?? current.sortOrder,
    isActive: data.isActive ?? current.isActive,
  };

  await assertLocationsExist(merged.pickupLocationId, merged.dropoffLocationId);

  const conflict = await prisma.sgrScheduleSlot.findFirst({
    where: {
      pickupLocationId: merged.pickupLocationId,
      dropoffLocationId: merged.dropoffLocationId,
      trainService: merged.trainService,
      direction: merged.direction,
      sgrEventTime: merged.sgrEventTime,
      vanDepartureTime: merged.vanDepartureTime,
      NOT: { id },
    },
  });
  if (conflict) {
    throw new AppError("SGR_SLOT_CONFLICT", 409, "An identical schedule slot already exists.");
  }

  const slot = await prisma.sgrScheduleSlot.update({
    where: { id },
    data: {
      ...(data.pickupLocationId !== undefined ? { pickupLocationId: data.pickupLocationId } : {}),
      ...(data.dropoffLocationId !== undefined ? { dropoffLocationId: data.dropoffLocationId } : {}),
      ...(data.direction !== undefined ? { direction: data.direction } : {}),
      ...(data.trainService !== undefined ? { trainService: data.trainService } : {}),
      ...(data.sgrEventTime !== undefined ? { sgrEventTime: data.sgrEventTime } : {}),
      ...(data.vanDepartureTime !== undefined ? { vanDepartureTime: data.vanDepartureTime } : {}),
      ...(data.suggestedPricePerSeat !== undefined
        ? { suggestedPricePerSeat: data.suggestedPricePerSeat }
        : {}),
      ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    },
    include: {
      pickupLocation: { select: locationSelect },
      dropoffLocation: { select: locationSelect },
    },
  });

  return { slot };
}

export async function adminDeactivateSgrScheduleSlot(id: string) {
  return adminUpdateSgrScheduleSlot(id, { isActive: false });
}
