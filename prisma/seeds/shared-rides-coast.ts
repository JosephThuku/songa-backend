/**
 * Coast corridor: Mtwapa, CBD, Nyali, Bamburi, Diani ↔ SGR Miritini.
 * Train times follow Madaraka Express (08:00 / 15:00 / 22:00 departures;
 * ~14:00 / ~20:08 / ~03:35 arrivals at Miritini).
 */

import type { PrismaClient } from "@prisma/client";
import type { SharedRideDirection, SgrTrainService } from "../../src/domain/shared-rides.js";
import {
  COAST_CORRIDOR_ZONES,
  SGR_MIRITINI,
} from "./coast-corridor-locations.js";
import { seedNyaliMorningBoardingPassengers } from "./shared-rides-nyali-morning-boarding.js";
import {
  driverVanDepartureSummary,
  seedDriverVanDepartures,
} from "./shared-rides-driver-departures.js";

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

export type SeedSharedRidesCoastOptions = {
  /** Dev-only demo departures, trip pools, and QA passengers. Default true. */
  includeDemoData?: boolean;
};

/** Idempotent seed for coast shared-rides catalog + optional demo departures. */
export async function seedSharedRidesCoast(
  prisma: PrismaClient,
  options: SeedSharedRidesCoastOptions = {},
) {
  const includeDemoData = options.includeDemoData ?? true;
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

  const demoDepartures = includeDemoData ? await seedDriverVanDepartures(prisma, sgr.id) : [];
  const demoTripRequest = includeDemoData ? await seedDemoOpenTripRequest(prisma, sgr.id) : null;
  const nyaliMorningBoarding = includeDemoData
    ? await seedNyaliMorningBoardingPassengers(prisma)
    : { passengerCount: 0 };

  return {
    sgrLocationId: sgr.id,
    zoneSlugs: COAST_CORRIDOR_ZONES.map((z) => z.slug),
    slotCount,
    demoDepartures,
    driverVanDepartures: includeDemoData ? driverVanDepartureSummary() : [],
    demoTripRequest,
    nyaliMorningBoarding,
    qa: {
      withDepartures: "GET departures/search?direction=to_sgr&corridorLocationSlug=nyali",
      withDeparturesBamburi: "GET departures/search?direction=to_sgr&corridorLocationSlug=bamburi",
      fromSgrNyali: "GET departures/search?direction=from_sgr&corridorLocationSlug=nyali",
      fromSgrBamburi: "GET departures/search?direction=from_sgr&corridorLocationSlug=bamburi",
      withoutDepartures: "GET departures/search?direction=to_sgr&corridorLocationSlug=mombasa-cbd",
    },
  };
}

/**
 * Open passenger pool on Mombasa CBD (no demo departure) — for driver board + Path B QA.
 */
async function seedDemoOpenTripRequest(prisma: PrismaClient, sgrId: string) {
  const cbd = await prisma.corridorLocation.findUnique({ where: { slug: "mombasa-cbd" } });
  const passenger = await prisma.user.findFirst({
    where: { phone: "+254712000001", role: "passenger" },
    select: { id: true },
  });
  if (!cbd || !passenger) return null;

  const slot = await prisma.sgrScheduleSlot.findFirst({
    where: {
      pickupLocationId: cbd.id,
      dropoffLocationId: sgrId,
      direction: "to_sgr",
      trainService: "express",
      sgrEventTime: "15:00",
      vanDepartureTime: "12:00",
    },
  });
  if (!slot) return null;

  const departureAt = new Date();
  departureAt.setUTCDate(departureAt.getUTCDate() + 1);
  departureAt.setUTCHours(9, 0, 0, 0); // ~12:00 EAT van

  const tripRequest = await prisma.sharedTripRequest.upsert({
    where: { id: "trip_req_seed_cbd_express" },
    update: {
      status: "open",
      requestedDepartureAt: departureAt,
      seatsRequested: 2,
      matchedDepartureId: null,
    },
    create: {
      id: "trip_req_seed_cbd_express",
      sgrScheduleSlotId: slot.id,
      requestedDepartureAt: departureAt,
      seatsRequested: 2,
      status: "open",
    },
  });

  await prisma.sharedTripRequestReservation.upsert({
    where: {
      tripRequestId_passengerId: {
        tripRequestId: tripRequest.id,
        passengerId: passenger.id,
      },
    },
    update: {
      seatsRequested: 2,
      status: "active",
      pickupNote: "Makadara Road near stage",
    },
    create: {
      tripRequestId: tripRequest.id,
      passengerId: passenger.id,
      seatsRequested: 2,
      status: "active",
      pickupNote: "Makadara Road near stage",
    },
  });

  return tripRequest.id;
}
