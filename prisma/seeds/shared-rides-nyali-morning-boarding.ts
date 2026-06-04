/**
 * Dev passengers on Nyali → SGR morning van (`dep_seed_nyali_sgr_morning`),
 * each with a distinct neighborhood pickup pin for driver map QA.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { UserRole } from "@prisma/client";
import cuid from "cuid";
import { hashPassword } from "../../src/lib/password.js";
import { SEED_PASSWORD } from "../seed-constants.js";

export const NYALI_MORNING_DEPARTURE_ID = "dep_seed_nyali_sgr_morning";

/** Coastal minibus driver — good fit for 14-seat Nyali van. */
const NYALI_VAN_DRIVER_PHONE = "+254712345681";

const SGR_DROPOFF = {
  label: "SGR Miritini",
  lat: -4.02178,
  lng: 39.57947,
};

type BoardingPassengerSeed = {
  id: string;
  phone: string;
  name: string;
  email: string;
  seatNumber: number;
  bookingId: string;
  pickup: { label: string; lat: number; lng: number };
};

/** Spread pickups across Nyali (~2–3 km) for driver boarding map. */
export const NYALI_MORNING_BOARDING_PASSENGERS: BoardingPassengerSeed[] = [
  {
    id: "usr_seed_nyali_p01",
    phone: "+254712000201",
    name: "Asha Mwangi",
    email: "asha.nyali@songa.dev",
    seatNumber: 3,
    bookingId: "BKG_seed_nyali_p01",
    pickup: { label: "City Mall Nyali", lat: -4.0432, lng: 39.7184 },
  },
  {
    id: "usr_seed_nyali_p02",
    phone: "+254712000202",
    name: "Brian Otieno",
    email: "brian.nyali@songa.dev",
    seatNumber: 4,
    bookingId: "BKG_seed_nyali_p02",
    pickup: { label: "Kongowea Market", lat: -4.0315, lng: 39.7262 },
  },
  {
    id: "usr_seed_nyali_p03",
    phone: "+254712000203",
    name: "Caro Wanjiru",
    email: "caro.nyali@songa.dev",
    seatNumber: 5,
    bookingId: "BKG_seed_nyali_p03",
    pickup: { label: "Nyali Beach Hotel", lat: -4.0178, lng: 39.7146 },
  },
  {
    id: "usr_seed_nyali_p04",
    phone: "+254712000204",
    name: "Daniel Kamau",
    email: "daniel.nyali@songa.dev",
    seatNumber: 6,
    bookingId: "BKG_seed_nyali_p04",
    pickup: { label: "Nyali Bridge", lat: -4.0245, lng: 39.7048 },
  },
  {
    id: "usr_seed_nyali_p05",
    phone: "+254712000205",
    name: "Esther Njoki",
    email: "esther.nyali@songa.dev",
    seatNumber: 7,
    bookingId: "BKG_seed_nyali_p05",
    pickup: { label: "Prestige Plaza Nyali", lat: -4.0124, lng: 39.7281 },
  },
  {
    id: "usr_seed_nyali_p06",
    phone: "+254712000206",
    name: "Frank Ali",
    email: "frank.nyali@songa.dev",
    seatNumber: 8,
    bookingId: "BKG_seed_nyali_p06",
    pickup: { label: "Shell Nyali", lat: -4.0089, lng: 39.7215 },
  },
];

function placeJson(place: { label: string; lat: number; lng: number }): Prisma.InputJsonValue {
  return place as unknown as Prisma.InputJsonValue;
}

export async function seedNyaliMorningBoardingPassengers(
  prisma: PrismaClient,
  options?: { passwordHash?: string },
): Promise<{ departureId: string; passengerCount: number; driverPhone: string | null }> {
  const departure = await prisma.sharedDeparture.findUnique({
    where: { id: NYALI_MORNING_DEPARTURE_ID },
    select: { id: true, pricePerSeat: true, capacity: true, status: true },
  });
  if (!departure) {
    return { departureId: NYALI_MORNING_DEPARTURE_ID, passengerCount: 0, driverPhone: null };
  }

  const passwordHash = options?.passwordHash ?? (await hashPassword(SEED_PASSWORD));

  const driver = await prisma.user.findFirst({
    where: { phone: NYALI_VAN_DRIVER_PHONE, role: UserRole.driver },
    select: { id: true },
  });
  if (driver) {
    await prisma.sharedDeparture.update({
      where: { id: NYALI_MORNING_DEPARTURE_ID },
      data: { driverId: driver.id, status: "scheduled" },
    });
  }

  let count = 0;
  for (const row of NYALI_MORNING_BOARDING_PASSENGERS) {
    const passenger = await prisma.user.upsert({
      where: { phone_role: { phone: row.phone, role: UserRole.passenger } },
      update: {
        name: row.name,
        email: row.email,
        passwordHash,
        phoneVerified: true,
      },
      create: {
        id: row.id,
        phone: row.phone,
        role: UserRole.passenger,
        name: row.name,
        email: row.email,
        passwordHash,
        phoneVerified: true,
      },
    });

    const subtotal = departure.pricePerSeat;
    const platformFee = 0;
    const total = subtotal + platformFee;
    const paymentId = `pay_${row.bookingId}`;

    await prisma.$transaction(async (tx) => {
      await tx.booking.upsert({
        where: { id: row.bookingId },
        update: {
          passengerId: passenger.id,
          sharedDepartureId: NYALI_MORNING_DEPARTURE_ID,
          seats: String(row.seatNumber),
          subtotal,
          platformFee,
          total,
          status: "paid",
          pickup: placeJson(row.pickup),
          dropoff: placeJson(SGR_DROPOFF),
        },
        create: {
          id: row.bookingId,
          passengerId: passenger.id,
          product: "shared_sgr",
          sharedDepartureId: NYALI_MORNING_DEPARTURE_ID,
          seats: String(row.seatNumber),
          subtotal,
          platformFee,
          total,
          status: "paid",
          pickup: placeJson(row.pickup),
          dropoff: placeJson(SGR_DROPOFF),
        },
      });

      await tx.payment.upsert({
        where: { reference: paymentId },
        update: {
          bookingId: row.bookingId,
          provider: "dev_seed",
          status: "succeeded",
          transactionRef: `DEV-${row.bookingId}`,
        },
        create: {
          id: `pay_${cuid()}`,
          bookingId: row.bookingId,
          provider: "dev_seed",
          status: "succeeded",
          reference: paymentId,
          transactionRef: `DEV-${row.bookingId}`,
        },
      });

      await tx.sharedDepartureSeat.updateMany({
        where: {
          departureId: NYALI_MORNING_DEPARTURE_ID,
          seatNumber: row.seatNumber,
        },
        data: {
          status: "paid",
          reservedById: passenger.id,
          reservedAt: new Date(),
          expiresAt: null,
          bookingId: row.bookingId,
          pickupLabel: row.pickup.label,
          pickupLat: row.pickup.lat,
          pickupLng: row.pickup.lng,
        },
      });
    });

    count += 1;
  }

  return {
    departureId: NYALI_MORNING_DEPARTURE_ID,
    passengerCount: count,
    driverPhone: driver ? NYALI_VAN_DRIVER_PHONE : null,
  };
}
