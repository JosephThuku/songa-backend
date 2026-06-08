import { formatNairobiDepartureLabel } from "../../lib/nairobi-time.js";
import { logger } from "../../lib/logger.js";
import { getSmsProvider } from "../../lib/sms.js";
import { prisma } from "../../lib/prisma.js";
import { createNotification } from "../notification.service.js";

function driverDepartureDeepLink(departureId: string): string {
  return `songa://driver/shared-rides/departures/${departureId}`;
}

const DRIVER_JOIN_POOL_LINK = "songa://driver/shared-rides/join";

/** In-app + SMS when a driver claims a passenger pool (Laravel TripRequestMatched + SMS). */
export async function notifyPassengersTripRequestMatched(input: {
  tripRequestId: string;
  departureId: string;
  routeLabel: string;
  departureAtIso: string;
  destinationName: string;
}): Promise<void> {
  const reservations = await prisma.sharedTripRequestReservation.findMany({
    where: { tripRequestId: input.tripRequestId, status: "active" },
    include: {
      passenger: { select: { id: true, phone: true, name: true } },
    },
  });

  const deepLink = `songa://shared-rides/departures/${input.departureId}`;
  const smsBody =
    `Songa: A driver matched your trip to ${input.destinationName}. ` +
    `Choose your seats and pay: ${deepLink}`;

  for (const row of reservations) {
    const passenger = row.passenger;
    if (!passenger) continue;

    await createNotification({
      userId: passenger.id,
      title: "Shared van confirmed",
      body: `${input.routeLabel} · departs ${formatNairobiDepartureLabel(input.departureAtIso)}. Choose your seats and pay.`,
      type: "shared_ride_matched",
      deepLink,
      metadata: {
        tripRequestId: input.tripRequestId,
        departureId: input.departureId,
        seatsRequested: row.seatsRequested,
      },
    });

    const phone = passenger.phone?.trim();
    if (!phone) continue;

    try {
      const result = await getSmsProvider().send({ to: phone, body: smsBody });
      if (!result.ok) {
        logger.warn(
          { passengerId: passenger.id, error: result.error },
          "shared-rides: match SMS failed",
        );
      }
    } catch (err) {
      logger.warn({ err, passengerId: passenger.id }, "shared-rides: match SMS error");
    }
  }
}

/** Alert online drivers that passengers are waiting in a pool. */
export async function notifyDriversPassengerPoolWaiting(input: {
  tripRequestId: string;
  routeLabel: string;
  departureAtIso: string;
  poolSeatsTotal: number;
  direction: string;
}): Promise<void> {
  const drivers = await prisma.driverProfile.findMany({
    where: {
      onboardingStatus: "approved",
      vehicleId: { not: null },
      isOnline: true,
    },
    select: { userId: true },
  });

  if (drivers.length === 0) return;

  const seatLabel = input.poolSeatsTotal === 1 ? "1 seat" : `${input.poolSeatsTotal} seats`;
  const body =
    `${input.routeLabel} · ${formatNairobiDepartureLabel(input.departureAtIso)}. ` +
    `${seatLabel} waiting — join the pool to claim this run.`;

  await Promise.all(
    drivers.map((driver) =>
      createNotification({
        userId: driver.userId,
        title: "Passengers waiting for a driver",
        body,
        type: "shared_ride_pool_waiting",
        deepLink: DRIVER_JOIN_POOL_LINK,
        metadata: {
          tripRequestId: input.tripRequestId,
          poolSeatsTotal: input.poolSeatsTotal,
          direction: input.direction,
        },
      }),
    ),
  );
}

/** Driver owns the departure — passenger held seats (not yet paid). */
export async function notifyDriverSeatsReserved(input: {
  driverId: string;
  departureId: string;
  routeLabel: string;
  passengerName: string | null;
  seatNumbers: number[];
}): Promise<void> {
  const who = input.passengerName?.trim() || "A passenger";
  const seatLabel =
    input.seatNumbers.length === 1
      ? `seat ${input.seatNumbers[0]}`
      : `seats ${input.seatNumbers.join(", ")}`;

  await createNotification({
    userId: input.driverId,
    title: "Seat reserved on your van",
    body: `${who} reserved ${seatLabel} on ${input.routeLabel}. Payment may still be pending.`,
    type: "shared_ride_seat_reserved",
    deepLink: driverDepartureDeepLink(input.departureId),
    metadata: {
      departureId: input.departureId,
      seatNumbers: input.seatNumbers,
    },
  });
}

/** Driver owns the departure — passenger completed payment. */
export async function notifyDriverSeatsPaid(input: {
  driverId: string;
  departureId: string;
  routeLabel: string;
  passengerName: string | null;
  seatNumbers: number[];
  amountKes: number;
}): Promise<void> {
  const who = input.passengerName?.trim() || "A passenger";
  const seatLabel =
    input.seatNumbers.length === 1
      ? `seat ${input.seatNumbers[0]}`
      : `${input.seatNumbers.length} seats`;

  await createNotification({
    userId: input.driverId,
    title: "Payment received",
    body: `${who} paid KES ${input.amountKes} for ${seatLabel} on ${input.routeLabel}.`,
    type: "shared_ride_seat_paid",
    deepLink: driverDepartureDeepLink(input.departureId),
    metadata: {
      departureId: input.departureId,
      seatNumbers: input.seatNumbers,
      amountKes: input.amountKes,
    },
  });
}

export async function loadDepartureNotifyContext(departureId: string): Promise<{
  driverId: string;
  routeLabel: string;
} | null> {
  const departure = await prisma.sharedDeparture.findUnique({
    where: { id: departureId },
    include: {
      pickupLocation: { select: { name: true } },
      dropoffLocation: { select: { name: true } },
    },
  });
  if (!departure?.driverId) return null;
  return {
    driverId: departure.driverId,
    routeLabel: `${departure.pickupLocation.name} → ${departure.dropoffLocation.name}`,
  };
}
