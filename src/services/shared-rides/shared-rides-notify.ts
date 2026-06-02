import { logger } from "../../lib/logger.js";
import { getSmsProvider } from "../../lib/sms.js";
import { prisma } from "../../lib/prisma.js";
import { createNotification } from "../notification.service.js";

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
      body: `${input.routeLabel} · departs ${input.departureAtIso}. Choose your seats and pay.`,
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
