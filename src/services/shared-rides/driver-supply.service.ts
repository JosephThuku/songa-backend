import cuid from "cuid";
import { AppError } from "../../lib/errors.js";
import { toNairobiIso } from "../../lib/nairobi-time.js";
import { prisma } from "../../lib/prisma.js";
import { notifyPassengersTripRequestMatched } from "./shared-rides-notify.js";
import {
  corridorLocationBriefSelect,
  sgrSlotWithLocationsInclude,
  type SgrScheduleSlotWithLocations,
} from "./shared-rides-prisma.js";
import { toTripRequestDto, type TripRequestDto } from "./trip-request.service.js";

const tripRequestInclude = {
  corridorLocation: { select: corridorLocationBriefSelect },
  sgrScheduleSlot: { include: sgrSlotWithLocationsInclude },
  reservations: {
    where: { status: "active" as const },
    select: { id: true, passengerId: true, seatsRequested: true },
  },
} as const;

const MIN_DEPARTURE_CAPACITY = 4;

export type DriverTripRequestBoardItemDto = {
  tripRequest: TripRequestDto;
  poolSeatsTotal: number;
  passengerCount: number;
};

export type SharedDepartureBriefDto = {
  id: string;
  departureAt: string;
  pricePerSeat: number;
  capacity: number;
  status: string;
  routeLabel: string;
  driverId: string;
  sgrScheduleSlotId: string | null;
};

export type JoinTripRequestResult = {
  tripRequest: TripRequestDto;
  departure: SharedDepartureBriefDto;
};

export type PublishDepartureInput = {
  sgrScheduleSlotId: string;
  departureAt: string;
  pricePerSeat?: number;
};

async function loadDriverWithVehicle(driverId: string) {
  const profile = await prisma.driverProfile.findUnique({
    where: { userId: driverId },
    include: { vehicle: true },
  });
  if (!profile) {
    throw new AppError("DRIVER_PROFILE_REQUIRED", 403, "Complete driver onboarding before shared rides.");
  }
  if (!profile.vehicle) {
    throw new AppError("VEHICLE_REQUIRED", 403, "Register a vehicle before publishing or joining shared vans.");
  }
  return profile;
}

function departureCapacity(vehicleSeats: number, poolSeats: number): number {
  const base = Math.max(vehicleSeats, MIN_DEPARTURE_CAPACITY);
  return Math.max(base, poolSeats, 1);
}

function routeLabelFromSlot(slot: SgrScheduleSlotWithLocations): string {
  return `${slot.pickupLocation.name} → ${slot.dropoffLocation.name}`;
}

function toDepartureBrief(dep: {
  id: string;
  departureAt: Date;
  pricePerSeat: number;
  capacity: number;
  status: string;
  driverId: string | null;
  sgrScheduleSlotId: string | null;
  pickupLocation: { name: string };
  dropoffLocation: { name: string };
}): SharedDepartureBriefDto {
  return {
    id: dep.id,
    departureAt: toNairobiIso(dep.departureAt),
    pricePerSeat: dep.pricePerSeat,
    capacity: dep.capacity,
    status: dep.status,
    routeLabel: `${dep.pickupLocation.name} → ${dep.dropoffLocation.name}`,
    driverId: dep.driverId!,
    sgrScheduleSlotId: dep.sgrScheduleSlotId,
  };
}

export async function listDriverTripRequests(filters: {
  direction?: "to_sgr" | "from_sgr";
  corridorLocationSlug?: string;
}): Promise<{ items: DriverTripRequestBoardItemDto[] }> {
  const corridor =
    filters.corridorLocationSlug != null
      ? await prisma.corridorLocation.findFirst({
          where: { slug: filters.corridorLocationSlug, isActive: true },
        })
      : null;

  if (filters.corridorLocationSlug && !corridor) {
    throw new AppError("CORRIDOR_LOCATION_NOT_FOUND", 404, "Corridor location not found.");
  }

  const rows = await prisma.sharedTripRequest.findMany({
    where: {
      status: "open",
      matchedDepartureId: null,
      requestedDepartureAt: { gt: new Date() },
      seatsRequested: { gt: 0 },
      ...(filters.direction ? { direction: filters.direction } : {}),
      ...(corridor ? { corridorLocationId: corridor.id } : {}),
      reservations: { some: { status: "active" } },
    },
    include: tripRequestInclude,
    orderBy: [{ requestedDepartureAt: "asc" }, { seatsRequested: "desc" }],
    take: 50,
  });

  const items = rows.map((row) => ({
    tripRequest: toTripRequestDto(row),
    poolSeatsTotal: row.seatsRequested,
    passengerCount: row.reservations.length,
  }));

  return { items };
}

export async function joinTripRequest(
  driverId: string,
  tripRequestId: string,
): Promise<JoinTripRequestResult> {
  const profile = await loadDriverWithVehicle(driverId);
  const vehicleSeats = profile.vehicle!.seats;

  const result = await prisma.$transaction(async (tx) => {
    const tripRequest = await tx.sharedTripRequest.findUnique({
      where: { id: tripRequestId },
      include: tripRequestInclude,
    });

    if (!tripRequest) {
      throw new AppError("TRIP_REQUEST_NOT_FOUND", 404, "Trip request not found.");
    }
    if (tripRequest.status !== "open" || tripRequest.matchedDepartureId) {
      throw new AppError(
        "TRIP_REQUEST_NOT_OPEN",
        409,
        "This trip request is no longer open for drivers.",
      );
    }
    if (tripRequest.requestedDepartureAt.getTime() <= Date.now()) {
      throw new AppError("DEPARTURE_IN_PAST", 409, "Van departure time has passed.");
    }
    if (tripRequest.seatsRequested <= 0 || tripRequest.reservations.length === 0) {
      throw new AppError("TRIP_REQUEST_EMPTY", 409, "No active passenger reservations on this pool.");
    }

    const slot = tripRequest.sgrScheduleSlot as SgrScheduleSlotWithLocations;
    const capacity = departureCapacity(vehicleSeats, tripRequest.seatsRequested);
    const departureId = `dep_${cuid()}`;

    const departure = await tx.sharedDeparture.create({
      data: {
        id: departureId,
        driverId,
        pickupLocationId: slot.pickupLocation.id,
        dropoffLocationId: slot.dropoffLocation.id,
        sgrScheduleSlotId: slot.id,
        departureAt: tripRequest.requestedDepartureAt,
        pricePerSeat: slot.suggestedPricePerSeat,
        capacity,
        status: "scheduled",
      },
      include: {
        pickupLocation: { select: { name: true } },
        dropoffLocation: { select: { name: true } },
      },
    });

    await tx.sharedDepartureSeat.createMany({
      data: Array.from({ length: capacity }, (_, i) => ({
        departureId,
        seatNumber: i + 1,
        status: "available" as const,
      })),
    });

    const claimed = await tx.sharedTripRequest.updateMany({
      where: { id: tripRequestId, status: "open", matchedDepartureId: null },
      data: { status: "matched", matchedDepartureId: departureId },
    });
    if (claimed.count === 0) {
      throw new AppError(
        "TRIP_REQUEST_ALREADY_CLAIMED",
        409,
        "Another driver already claimed this trip request.",
      );
    }

    const updated = await tx.sharedTripRequest.findUniqueOrThrow({
      where: { id: tripRequestId },
      include: tripRequestInclude,
    });

    return { tripRequest: updated, departure };
  });

  const routeLabel = routeLabelFromSlot(result.tripRequest.sgrScheduleSlot as SgrScheduleSlotWithLocations);
  const departureAtIso = toNairobiIso(result.departure.departureAt);

  const slot = result.tripRequest.sgrScheduleSlot as SgrScheduleSlotWithLocations;
  const destinationName =
    result.tripRequest.direction === "to_sgr"
      ? slot.dropoffLocation.name
      : slot.pickupLocation.name;

  await notifyPassengersTripRequestMatched({
    tripRequestId,
    departureId: result.departure.id,
    routeLabel,
    departureAtIso,
    destinationName,
  });

  return {
    tripRequest: toTripRequestDto(result.tripRequest),
    departure: toDepartureBrief(result.departure),
  };
}

export async function publishDeparture(
  driverId: string,
  input: PublishDepartureInput,
): Promise<{ departure: SharedDepartureBriefDto }> {
  const profile = await loadDriverWithVehicle(driverId);
  const departureAt = new Date(input.departureAt);
  if (Number.isNaN(departureAt.getTime())) {
    throw new AppError("INVALID_INPUT", 400, "departureAt must be a valid ISO datetime.");
  }
  if (departureAt.getTime() <= Date.now()) {
    throw new AppError("DEPARTURE_IN_PAST", 400, "Departure must be in the future.");
  }

  const slot = await prisma.sgrScheduleSlot.findFirst({
    where: { id: input.sgrScheduleSlotId, isActive: true },
    include: sgrSlotWithLocationsInclude,
  });
  if (!slot) {
    throw new AppError("SGR_SLOT_NOT_FOUND", 404, "Schedule slot not found.");
  }

  const capacity = departureCapacity(profile.vehicle!.seats, 1);
  const pricePerSeat = input.pricePerSeat ?? slot.suggestedPricePerSeat;
  const departureId = `dep_${cuid()}`;

  const departure = await prisma.$transaction(async (tx) => {
    const created = await tx.sharedDeparture.create({
      data: {
        id: departureId,
        driverId,
        pickupLocationId: slot.pickupLocationId,
        dropoffLocationId: slot.dropoffLocationId,
        sgrScheduleSlotId: slot.id,
        departureAt,
        pricePerSeat,
        capacity,
        status: "scheduled",
      },
      include: {
        pickupLocation: { select: { name: true } },
        dropoffLocation: { select: { name: true } },
      },
    });

    await tx.sharedDepartureSeat.createMany({
      data: Array.from({ length: capacity }, (_, i) => ({
        departureId,
        seatNumber: i + 1,
        status: "available" as const,
      })),
    });

    return created;
  });

  return { departure: toDepartureBrief(departure) };
}
