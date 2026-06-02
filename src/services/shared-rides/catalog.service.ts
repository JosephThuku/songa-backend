import type { Prisma } from "@prisma/client";
import type { SgrScheduleSlotRef } from "../../domain/shared-rides.js";
import { haversineDistanceKm } from "../../lib/geo.js";
import { AppError } from "../../lib/errors.js";
import { toNairobiIso } from "../../lib/nairobi-time.js";
import { prisma } from "../../lib/prisma.js";
import { buildSuggestionsFromSlots } from "./suggestions.service.js";

const locationSelect = {
  id: true,
  slug: true,
  name: true,
  lat: true,
  lng: true,
  radiusM: true,
  sortOrder: true,
} satisfies Prisma.CorridorLocationSelect;

export async function listCorridorLocations() {
  return prisma.corridorLocation.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: locationSelect,
  });
}

export async function getCorridorLocationBySlug(slug: string) {
  return prisma.corridorLocation.findFirst({
    where: { slug, isActive: true },
    select: locationSelect,
  });
}

/** Map GPS to the nearest corridor zone (prefer zones whose radius contains the point). */
export async function resolveCorridorLocationFromGps(lat: number, lng: number) {
  const locations = await listCorridorLocations();
  const withCoords = locations.filter((loc) => loc.lat != null && loc.lng != null);
  if (withCoords.length === 0) {
    throw new AppError("CORRIDOR_CATALOG_EMPTY", 503, "No corridor locations configured.");
  }

  const point = { lat, lng };
  const scored = withCoords.map((loc) => {
    const distanceM = Math.round(
      haversineDistanceKm(point, { lat: loc.lat as number, lng: loc.lng as number }) * 1000,
    );
    return { location: loc, distanceM, insideRadius: distanceM <= loc.radiusM };
  });

  const inside = scored.filter((s) => s.insideRadius).sort((a, b) => a.distanceM - b.distanceM);
  const best = inside[0] ?? [...scored].sort((a, b) => a.distanceM - b.distanceM)[0]!;

  return {
    location: best.location,
    distanceM: best.distanceM,
    insideRadius: best.insideRadius,
  };
}

export async function listScheduleSlots(filters: {
  direction?: "to_sgr" | "from_sgr";
  corridorLocationId?: string;
  corridorLocationSlug?: string;
}) {
  const location =
    filters.corridorLocationId || filters.corridorLocationSlug
      ? await prisma.corridorLocation.findFirst({
          where: {
            isActive: true,
            ...(filters.corridorLocationId
              ? { id: filters.corridorLocationId }
              : { slug: filters.corridorLocationSlug }),
          },
        })
      : null;

  const sgr = await prisma.corridorLocation.findFirst({
    where: { slug: "sgr-miritini", isActive: true },
  });
  if (!sgr) return [];

  const where: Prisma.SgrScheduleSlotWhereInput = { isActive: true };
  if (filters.direction) where.direction = filters.direction;

  if (location && location.slug !== "sgr-miritini") {
    if (filters.direction === "to_sgr") {
      where.pickupLocationId = location.id;
      where.dropoffLocationId = sgr.id;
    } else if (filters.direction === "from_sgr") {
      where.pickupLocationId = sgr.id;
      where.dropoffLocationId = location.id;
    } else {
      where.OR = [
        { pickupLocationId: location.id },
        { dropoffLocationId: location.id },
      ];
    }
  }

  return prisma.sgrScheduleSlot.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { vanDepartureTime: "asc" }],
    include: {
      pickupLocation: { select: locationSelect },
      dropoffLocation: { select: locationSelect },
    },
  });
}

export async function getSuggestions(filters: {
  direction: "to_sgr" | "from_sgr";
  corridorLocationId?: string;
  corridorLocationSlug?: string;
  at?: Date;
}) {
  const slots = await listScheduleSlots({
    direction: filters.direction,
    corridorLocationId: filters.corridorLocationId,
    corridorLocationSlug: filters.corridorLocationSlug,
  });
  const suggestedTripRequests = buildSuggestionsFromSlots(
    slots as SgrScheduleSlotRef[],
    filters.direction,
    filters.at,
  );
  return { suggestedTripRequests };
}

export async function searchDepartures(filters: {
  direction: "to_sgr" | "from_sgr";
  corridorLocationId?: string;
  corridorLocationSlug?: string;
  date?: string;
  at?: Date;
}) {
  const location =
    filters.corridorLocationId || filters.corridorLocationSlug
      ? await prisma.corridorLocation.findFirst({
          where: {
            isActive: true,
            ...(filters.corridorLocationId
              ? { id: filters.corridorLocationId }
              : { slug: filters.corridorLocationSlug }),
          },
        })
      : null;

  const sgr = await prisma.corridorLocation.findFirst({
    where: { slug: "sgr-miritini", isActive: true },
  });

  const locations = await listCorridorLocations();
  const { suggestedTripRequests } = await getSuggestions({
    direction: filters.direction,
    corridorLocationId: location?.id,
    corridorLocationSlug: location?.slug,
    at: filters.at,
  });

  if (!sgr || !location || location.slug === "sgr-miritini") {
    return {
      exactDepartures: [],
      otherDepartures: [],
      locations,
      suggestedTripRequests,
    };
  }

  const pickupId = filters.direction === "to_sgr" ? location.id : sgr.id;
  const dropoffId = filters.direction === "to_sgr" ? sgr.id : location.id;

  const dayStart = filters.date ? new Date(`${filters.date}T00:00:00.000Z`) : new Date();
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 2);

  const departures = await prisma.sharedDeparture.findMany({
    where: {
      status: "scheduled",
      pickupLocationId: pickupId,
      dropoffLocationId: dropoffId,
      departureAt: { gte: new Date(), lt: dayEnd },
    },
    orderBy: [{ departureAt: "asc" }],
    include: {
      pickupLocation: { select: locationSelect },
      dropoffLocation: { select: locationSelect },
      driver: { select: { id: true, name: true, phone: true, rating: true } },
      seats: { select: { status: true } },
      sgrScheduleSlot: true,
    },
  });

  const exactDepartures = departures.map((d) => {
    const booked = d.seats.filter((s) => s.status === "paid" || s.status === "reserved").length;
    const capacity = d.capacity;
    return {
      id: d.id,
      departureAt: toNairobiIso(d.departureAt),
      pricePerSeat: d.pricePerSeat,
      capacity,
      bookedSeatsCount: booked,
      availableSeats: capacity - booked,
      routeLabel: `${d.pickupLocation.name} → ${d.dropoffLocation.name}`,
      driver: d.driver
        ? { id: d.driver.id, name: d.driver.name, rating: d.driver.rating }
        : null,
      sgrScheduleSlotId: d.sgrScheduleSlotId,
    };
  });

  return {
    exactDepartures,
    otherDepartures: [] as typeof exactDepartures,
    locations,
    suggestedTripRequests,
  };
}
