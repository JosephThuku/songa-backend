/**
 * Dev shared departures assigned to seeded 4- and 7-seat drivers
 * on Nyali / Bamburi ↔ SGR Miritini routes.
 */

import type { PrismaClient } from "@prisma/client";
import type { SharedRideDirection, SgrTrainService } from "../../src/domain/shared-rides.js";
import { generateDepartureSeatsFromVehicle } from "../../src/lib/shared-rides-seat-layout.js";
import { NYALI_MORNING_DEPARTURE_ID } from "./shared-rides-nyali-morning-boarding.js";

/** Matches prisma/seed.ts driver phones. */
export const SEED_DRIVER_PHONES = {
  peter: "+254712345680",
  grace: "+254712345679",
  hassan: "+254712345683",
  amina: "+254712345684",
  faith: "+254712345681",
  david: "+254712345682",
} as const;

type CorridorSlug = "nyali" | "bamburi" | "mtwapa";

type DriverDepartureSeed = {
  id: string;
  corridorSlug: CorridorSlug;
  direction: SharedRideDirection;
  driverPhone: string;
  capacity: number;
  pricePerSeat: number;
  /** Departure time on seed day (UTC). EAT = UTC+3. */
  departureAtUtc: { hour: number; minute?: number };
  slot: {
    trainService: SgrTrainService;
    sgrEventTime: string;
    vanDepartureTime: string;
  };
};

/** Idempotent demo vans — mix of to_sgr and from_sgr for Nyali & Bamburi. */
export const DRIVER_VAN_DEPARTURE_SEEDS: DriverDepartureSeed[] = [
  {
    id: NYALI_MORNING_DEPARTURE_ID,
    corridorSlug: "nyali",
    direction: "to_sgr",
    driverPhone: SEED_DRIVER_PHONES.faith,
    capacity: 14,
    pricePerSeat: 350,
    departureAtUtc: { hour: 3, minute: 0 },
    slot: {
      trainService: "inter_county",
      sgrEventTime: "08:00",
      vanDepartureTime: "06:00",
    },
  },
  {
    id: "dep_seed_nyali_sgr_night",
    corridorSlug: "nyali",
    direction: "to_sgr",
    driverPhone: SEED_DRIVER_PHONES.grace,
    capacity: 7,
    pricePerSeat: 350,
    departureAtUtc: { hour: 15, minute: 0 },
    slot: {
      trainService: "night",
      sgrEventTime: "22:00",
      vanDepartureTime: "18:00",
    },
  },
  {
    id: "dep_seed_bamburi_sgr_morning",
    corridorSlug: "bamburi",
    direction: "to_sgr",
    driverPhone: SEED_DRIVER_PHONES.amina,
    capacity: 7,
    pricePerSeat: 350,
    departureAtUtc: { hour: 3, minute: 30 },
    slot: {
      trainService: "inter_county",
      sgrEventTime: "08:00",
      vanDepartureTime: "06:00",
    },
  },
  {
    id: "dep_seed_nyali_sgr_van_express",
    corridorSlug: "nyali",
    direction: "to_sgr",
    driverPhone: SEED_DRIVER_PHONES.grace,
    capacity: 7,
    pricePerSeat: 500,
    departureAtUtc: { hour: 9, minute: 0 },
    slot: {
      trainService: "express",
      sgrEventTime: "15:00",
      vanDepartureTime: "12:00",
    },
  },
  {
    id: "dep_seed_bamburi_sgr_van_express",
    corridorSlug: "bamburi",
    direction: "to_sgr",
    driverPhone: SEED_DRIVER_PHONES.amina,
    capacity: 7,
    pricePerSeat: 500,
    departureAtUtc: { hour: 9, minute: 30 },
    slot: {
      trainService: "express",
      sgrEventTime: "15:00",
      vanDepartureTime: "12:00",
    },
  },
  {
    id: "dep_seed_nyali_sgr_car",
    corridorSlug: "nyali",
    direction: "to_sgr",
    driverPhone: SEED_DRIVER_PHONES.hassan,
    capacity: 4,
    pricePerSeat: 600,
    departureAtUtc: { hour: 16, minute: 0 },
    slot: {
      trainService: "night",
      sgrEventTime: "22:00",
      vanDepartureTime: "19:00",
    },
  },
  {
    id: "dep_seed_bamburi_sgr_car",
    corridorSlug: "bamburi",
    direction: "to_sgr",
    driverPhone: SEED_DRIVER_PHONES.peter,
    capacity: 4,
    pricePerSeat: 600,
    departureAtUtc: { hour: 16, minute: 30 },
    slot: {
      trainService: "night",
      sgrEventTime: "22:00",
      vanDepartureTime: "19:00",
    },
  },
  {
    id: "dep_seed_sgr_nyali_van",
    corridorSlug: "nyali",
    direction: "from_sgr",
    driverPhone: SEED_DRIVER_PHONES.grace,
    capacity: 7,
    pricePerSeat: 350,
    departureAtUtc: { hour: 11, minute: 0 },
    slot: {
      trainService: "inter_county",
      sgrEventTime: "14:00",
      vanDepartureTime: "14:00",
    },
  },
  {
    id: "dep_seed_sgr_bamburi_van",
    corridorSlug: "bamburi",
    direction: "from_sgr",
    driverPhone: SEED_DRIVER_PHONES.amina,
    capacity: 7,
    pricePerSeat: 350,
    departureAtUtc: { hour: 11, minute: 30 },
    slot: {
      trainService: "inter_county",
      sgrEventTime: "14:00",
      vanDepartureTime: "14:00",
    },
  },
  {
    id: "dep_seed_sgr_nyali_car",
    corridorSlug: "nyali",
    direction: "from_sgr",
    driverPhone: SEED_DRIVER_PHONES.hassan,
    capacity: 4,
    pricePerSeat: 350,
    departureAtUtc: { hour: 17, minute: 30 },
    slot: {
      trainService: "express",
      sgrEventTime: "20:08",
      vanDepartureTime: "20:30",
    },
  },
  {
    id: "dep_seed_sgr_bamburi_car",
    corridorSlug: "bamburi",
    direction: "from_sgr",
    driverPhone: SEED_DRIVER_PHONES.peter,
    capacity: 4,
    pricePerSeat: 350,
    departureAtUtc: { hour: 18, minute: 0 },
    slot: {
      trainService: "express",
      sgrEventTime: "20:08",
      vanDepartureTime: "20:30",
    },
  },
  {
    id: "dep_seed_mtwapa_from_sgr",
    corridorSlug: "mtwapa",
    direction: "from_sgr",
    driverPhone: SEED_DRIVER_PHONES.david,
    capacity: 4,
    pricePerSeat: 350,
    departureAtUtc: { hour: 11, minute: 0 },
    slot: {
      trainService: "inter_county",
      sgrEventTime: "14:00",
      vanDepartureTime: "14:00",
    },
  },
];

function seedDayBase(): Date {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + 1);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}

function departureAtFromSeed(base: Date, utc: { hour: number; minute?: number }): Date {
  const at = new Date(base);
  at.setUTCHours(utc.hour, utc.minute ?? 0, 0, 0);
  return at;
}

async function findScheduleSlot(
  prisma: PrismaClient,
  input: {
    sgrId: string;
    corridorLocationId: string;
    direction: SharedRideDirection;
    trainService: SgrTrainService;
    sgrEventTime: string;
    vanDepartureTime: string;
  },
) {
  const toSgr = input.direction === "to_sgr";
  return prisma.sgrScheduleSlot.findFirst({
    where: {
      pickupLocationId: toSgr ? input.corridorLocationId : input.sgrId,
      dropoffLocationId: toSgr ? input.sgrId : input.corridorLocationId,
      direction: input.direction,
      trainService: input.trainService,
      sgrEventTime: input.sgrEventTime,
      vanDepartureTime: input.vanDepartureTime,
    },
  });
}

async function ensureDepartureSeats(
  prisma: PrismaClient,
  departureId: string,
  capacity: number,
) {
  const occupied = await prisma.sharedDepartureSeat.count({
    where: {
      departureId,
      status: { in: ["reserved", "paid"] },
    },
  });
  if (occupied > 0) return;

  const layoutSeats = generateDepartureSeatsFromVehicle({ seats: capacity });
  const currentCount = await prisma.sharedDepartureSeat.count({
    where: { departureId },
  });

  if (currentCount === layoutSeats.length) return;

  await prisma.sharedDepartureSeat.deleteMany({ where: { departureId } });
  await prisma.sharedDepartureSeat.createMany({
    data: layoutSeats.map((seat) => ({
      departureId,
      seatNumber: seat.seatNumber,
      seatLabel: seat.seatLabel,
      row: seat.row,
      col: seat.col,
      status: seat.status,
    })),
  });
}

export async function seedDriverVanDepartures(prisma: PrismaClient, sgrId: string) {
  const baseDay = seedDayBase();
  let count = 0;

  for (const row of DRIVER_VAN_DEPARTURE_SEEDS) {
    const corridor = await prisma.corridorLocation.findUnique({
      where: { slug: row.corridorSlug },
    });
    if (!corridor) continue;

    const driver = await prisma.user.findFirst({
      where: { phone: row.driverPhone, role: "driver" },
      select: {
        id: true,
        driverProfile: {
          select: {
            vehicleId: true,
          },
        },
      },
    });
    const driverId = driver?.id ?? null;
    const vehicleId = driver?.driverProfile?.vehicleId ?? null;

    const slot = await findScheduleSlot(prisma, {
      sgrId,
      corridorLocationId: corridor.id,
      direction: row.direction,
      trainService: row.slot.trainService,
      sgrEventTime: row.slot.sgrEventTime,
      vanDepartureTime: row.slot.vanDepartureTime,
    });

    const toSgr = row.direction === "to_sgr";
    const pickupLocationId = toSgr ? corridor.id : sgrId;
    const dropoffLocationId = toSgr ? sgrId : corridor.id;
    const departureAt = departureAtFromSeed(baseDay, row.departureAtUtc);

    await prisma.sharedDeparture.upsert({
      where: { id: row.id },
      update: {
        pickupLocationId,
        dropoffLocationId,
        sgrScheduleSlotId: slot?.id ?? null,
        departureAt,
        pricePerSeat: row.pricePerSeat,
        capacity: row.capacity,
        driverId,
        vehicleId,
        status: "scheduled",
      },
      create: {
        id: row.id,
        pickupLocationId,
        dropoffLocationId,
        sgrScheduleSlotId: slot?.id ?? null,
        departureAt,
        pricePerSeat: row.pricePerSeat,
        capacity: row.capacity,
        driverId,
        vehicleId,
        status: "scheduled",
      },
    });

    await ensureDepartureSeats(prisma, row.id, row.capacity);
    count += 1;
  }

  return count;
}

export function driverVanDepartureSummary(): Array<{
  id: string;
  route: string;
  driver: string;
  seats: number;
}> {
  const names: Record<string, string> = {
    [SEED_DRIVER_PHONES.peter]: "Peter Otieno (4-seat car)",
    [SEED_DRIVER_PHONES.grace]: "Grace Wanjiru (7-seat van)",
    [SEED_DRIVER_PHONES.hassan]: "Hassan Ali (4-seat car)",
    [SEED_DRIVER_PHONES.amina]: "Amina Said (7-seat van)",
    [SEED_DRIVER_PHONES.faith]: "Faith Njoki (14-seat minibus)",
    [SEED_DRIVER_PHONES.david]: "David Kamau (4-seat car)",
  };

  return DRIVER_VAN_DEPARTURE_SEEDS.map((row) => {
    const route =
      row.direction === "to_sgr"
        ? `${row.corridorSlug} → SGR`
        : `SGR → ${row.corridorSlug}`;
    return {
      id: row.id,
      route,
      driver: names[row.driverPhone] ?? row.driverPhone,
      seats: row.capacity,
    };
  });
}
