/**
 * Coast corridor: Mtwapa, CBD, Nyali, Bamburi, Diani ↔ SGR Miritini.
 * Train times follow Madaraka Express (08:00 / 15:00 / 22:00 departures;
 * ~14:00 / ~20:08 / ~03:35 arrivals at Miritini).
 */

import type { PrismaClient } from "@prisma/client";
import type { SharedRideDirection, SgrTrainService } from "../../src/domain/shared-rides.js";
import { generateDepartureSeatsFromVehicle } from "../../src/lib/shared-rides-seat-layout.js";
import {
  COAST_CORRIDOR_ZONES,
  SGR_MIRITINI,
} from "./coast-corridor-locations.js";

const ZONE_PRICING: Record<
  (typeof COAST_CORRIDOR_ZONES)[number]["slug"],
  {
    toBase: number;
    toPremium: number;
    fromBase: number;
    expressTo: number;
    expressPremium: number;
  }
> = {
  mtwapa: { toBase: 350, toPremium: 600, fromBase: 350, expressTo: 500, expressPremium: 700 },
  nyali: { toBase: 350, toPremium: 600, fromBase: 350, expressTo: 500, expressPremium: 700 },
  bamburi: { toBase: 350, toPremium: 600, fromBase: 350, expressTo: 500, expressPremium: 700 },
  "mombasa-cbd": { toBase: 300, toPremium: 550, fromBase: 300, expressTo: 450, expressPremium: 650 },
  diani: { toBase: 500, toPremium: 800, fromBase: 500, expressTo: 700, expressPremium: 950 },
};

type ZonePricing = (typeof ZONE_PRICING)[keyof typeof ZONE_PRICING];

type SlotTemplate = {
  direction: SharedRideDirection;
  trainService: SgrTrainService;
  sgrEventTime: string;
  vanDepartureTime: string;
  sortOrder: number;
  priceKey: keyof ZonePricing;
};

const SLOT_TEMPLATES: SlotTemplate[] = [
  {
    direction: "to_sgr",
    trainService: "inter_county",
    sgrEventTime: "08:00",
    vanDepartureTime: "06:00",
    sortOrder: 10,
    priceKey: "toBase",
  },
  {
    direction: "to_sgr",
    trainService: "express",
    sgrEventTime: "15:00",
    vanDepartureTime: "12:00",
    sortOrder: 20,
    priceKey: "expressTo",
  },
  {
    direction: "to_sgr",
    trainService: "express",
    sgrEventTime: "15:00",
    vanDepartureTime: "13:00",
    sortOrder: 30,
    priceKey: "expressPremium",
  },
  {
    direction: "from_sgr",
    trainService: "inter_county",
    sgrEventTime: "14:00",
    vanDepartureTime: "14:00",
    sortOrder: 40,
    priceKey: "fromBase",
  },
  {
    direction: "to_sgr",
    trainService: "night",
    sgrEventTime: "22:00",
    vanDepartureTime: "18:00",
    sortOrder: 50,
    priceKey: "toBase",
  },
  {
    direction: "to_sgr",
    trainService: "night",
    sgrEventTime: "22:00",
    vanDepartureTime: "19:00",
    sortOrder: 60,
    priceKey: "toPremium",
  },
  {
    direction: "from_sgr",
    trainService: "express",
    sgrEventTime: "20:08",
    vanDepartureTime: "20:30",
    sortOrder: 70,
    priceKey: "fromBase",
  },
  {
    direction: "from_sgr",
    trainService: "night",
    sgrEventTime: "03:35",
    vanDepartureTime: "03:30",
    sortOrder: 80,
    priceKey: "fromBase",
  },
];

async function upsertLocation(
  prisma: PrismaClient,
  row: {
    slug: string;
    name: string;
    lat: number;
    lng: number;
    radiusM: number;
    sortOrder: number;
  },
) {
  return prisma.corridorLocation.upsert({
    where: { slug: row.slug },
    update: {
      name: row.name,
      lat: row.lat,
      lng: row.lng,
      radiusM: row.radiusM,
      sortOrder: row.sortOrder,
      isActive: true,
    },
    create: {
      slug: row.slug,
      name: row.name,
      lat: row.lat,
      lng: row.lng,
      radiusM: row.radiusM,
      sortOrder: row.sortOrder,
      isActive: true,
    },
  });
}

async function upsertSlot(
  prisma: PrismaClient,
  row: {
    pickupLocationId: string;
    dropoffLocationId: string;
    direction: SharedRideDirection;
    trainService: SgrTrainService;
    sgrEventTime: string;
    vanDepartureTime: string;
    suggestedPricePerSeat: number;
    sortOrder: number;
  },
) {
  return prisma.sgrScheduleSlot.upsert({
    where: {
      pickupLocationId_dropoffLocationId_trainService_direction_sgrEventTime_vanDepartureTime:
        {
          pickupLocationId: row.pickupLocationId,
          dropoffLocationId: row.dropoffLocationId,
          trainService: row.trainService,
          direction: row.direction,
          sgrEventTime: row.sgrEventTime,
          vanDepartureTime: row.vanDepartureTime,
        },
    },
    update: {
      suggestedPricePerSeat: row.suggestedPricePerSeat,
      sortOrder: row.sortOrder,
      isActive: true,
    },
    create: {
      pickupLocationId: row.pickupLocationId,
      dropoffLocationId: row.dropoffLocationId,
      direction: row.direction,
      trainService: row.trainService,
      sgrEventTime: row.sgrEventTime,
      vanDepartureTime: row.vanDepartureTime,
      suggestedPricePerSeat: row.suggestedPricePerSeat,
      sortOrder: row.sortOrder,
      isActive: true,
    },
  });
}

/** Idempotent seed for coast shared-rides catalog + optional demo departures. */
export async function seedSharedRidesCoast(prisma: PrismaClient) {
  const sgr = await upsertLocation(prisma, SGR_MIRITINI);
  let slotCount = 0;

  for (const zone of COAST_CORRIDOR_ZONES) {
    const location = await upsertLocation(prisma, zone);
    const pricing = ZONE_PRICING[zone.slug];

    for (const template of SLOT_TEMPLATES) {
      const price = pricing[template.priceKey];
      const toSgr = template.direction === "to_sgr";
      await upsertSlot(prisma, {
        pickupLocationId: toSgr ? location.id : sgr.id,
        dropoffLocationId: toSgr ? sgr.id : location.id,
        direction: template.direction,
        trainService: template.trainService,
        sgrEventTime: template.sgrEventTime,
        vanDepartureTime: template.vanDepartureTime,
        suggestedPricePerSeat: price,
        sortOrder: template.sortOrder,
      });
      slotCount += 1;
    }
  }

  const demoDepartures = await seedDemoDepartures(prisma, sgr.id);

  return {
    sgrLocationId: sgr.id,
    zoneSlugs: COAST_CORRIDOR_ZONES.map((z) => z.slug),
    slotCount,
    demoDepartures,
  };
}

/** A few upcoming vans so departures/search is non-empty in dev. */
async function seedDemoDepartures(prisma: PrismaClient, sgrId: string) {
  const nyali = await prisma.corridorLocation.findUnique({ where: { slug: "nyali" } });
  const mtwapa = await prisma.corridorLocation.findUnique({ where: { slug: "mtwapa" } });
  if (!nyali || !mtwapa) return 0;

  const morningSlot = await prisma.sgrScheduleSlot.findFirst({
    where: {
      pickupLocationId: nyali.id,
      dropoffLocationId: sgrId,
      direction: "to_sgr",
      trainService: "inter_county",
      sgrEventTime: "08:00",
    },
  });

  const fromSlot = await prisma.sgrScheduleSlot.findFirst({
    where: {
      pickupLocationId: sgrId,
      dropoffLocationId: mtwapa.id,
      direction: "from_sgr",
      trainService: "inter_county",
    },
  });

  const driver = await prisma.user.findFirst({
    where: { role: "driver", driverProfile: { isOnline: true } },
    select: { id: true },
  });

  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(3, 0, 0, 0); // ~06:00 EAT van Nyali → SGR

  const afternoon = new Date(tomorrow);
  afternoon.setUTCHours(9, 0, 0, 0); // ~12:00 EAT express van

  const rows = [
    {
      id: "dep_seed_nyali_sgr_morning",
      pickupLocationId: nyali.id,
      dropoffLocationId: sgrId,
      sgrScheduleSlotId: morningSlot?.id ?? null,
      departureAt: tomorrow,
      pricePerSeat: 350,
      driverId: driver?.id ?? null,
    },
    {
      id: "dep_seed_mtwapa_from_sgr",
      pickupLocationId: sgrId,
      dropoffLocationId: mtwapa.id,
      sgrScheduleSlotId: fromSlot?.id ?? null,
      departureAt: afternoon,
      pricePerSeat: 350,
      driverId: driver?.id ?? null,
    },
  ];

  let count = 0;
  for (const row of rows) {
    const dep = await prisma.sharedDeparture.upsert({
      where: { id: row.id },
      update: {
        departureAt: row.departureAt,
        pricePerSeat: row.pricePerSeat,
        driverId: row.driverId,
        status: "scheduled",
      },
      create: {
        id: row.id,
        pickupLocationId: row.pickupLocationId,
        dropoffLocationId: row.dropoffLocationId,
        sgrScheduleSlotId: row.sgrScheduleSlotId,
        departureAt: row.departureAt,
        pricePerSeat: row.pricePerSeat,
        capacity: 14,
        driverId: row.driverId,
        status: "scheduled",
      },
    });

    const existingSeats = await prisma.sharedDepartureSeat.count({
      where: { departureId: dep.id },
    });
    if (existingSeats === 0) {
      const layoutSeats = generateDepartureSeatsFromVehicle({ seats: 14 });
      await prisma.sharedDepartureSeat.createMany({
        data: layoutSeats.map((seat, i) => ({
          departureId: dep.id,
          seatNumber: seat.seatNumber,
          seatLabel: seat.seatLabel,
          row: seat.row,
          col: seat.col,
          status: i < 2 && seat.seatNumber <= 2 ? "paid" : seat.status,
        })),
      });
    }
    count += 1;
  }

  return count;
}
