/**
 * Wipe all DB rows for every User with the given phone (any role), then create a
 * fresh driver account on that number with a 4-seater vehicle.
 *
 * Usage:
 *   npm run user:reset-driver
 *   npm run user:reset-driver -- 0110919165
 *   PHONE=0110919165 npm run user:reset-driver
 *
 * Env (optional):
 *   DRIVER_NAME, DRIVER_EMAIL, VEHICLE_REGISTRATION, SEED_PASSWORD (default SongaDev1)
 */

import "dotenv/config";
import { PrismaClient, UserRole, OnboardingStatus } from "@prisma/client";
import cuid from "cuid";

import { indexDriverLocation, removeDriverFromGeoIndex } from "../src/lib/driver-geo.js";
import { normalizePhone } from "../src/lib/phone.js";
import { hashPassword } from "../src/lib/password.js";
import { SEED_PASSWORD } from "../prisma/seed-constants.js";

const prisma = new PrismaClient();

const DEFAULT_PHONE = "0110919165";
const DEFAULT_DRIVER_NAME = "Dev Driver";
const DEFAULT_LOCATION = { lat: -4.0438, lng: 39.7182 }; // Mombasa coast

function phoneFromArgv(): string {
  const arg = process.argv.slice(2).find((a) => !a.startsWith("-"));
  return (process.env.PHONE ?? arg ?? DEFAULT_PHONE).trim();
}

async function deleteUserData(userId: string): Promise<void> {
  await removeDriverFromGeoIndex(userId).catch(() => undefined);

  await prisma.sharedDeparture.updateMany({
    where: { driverId: userId },
    data: { driverId: null },
  });

  await prisma.sharedDepartureSeat.updateMany({
    where: { reservedById: userId },
    data: {
      reservedById: null,
      reservedAt: null,
      expiresAt: null,
      status: "available",
      bookingId: null,
      pickupLabel: null,
      pickupLat: null,
      pickupLng: null,
    },
  });

  await prisma.sharedTripRequestReservation.deleteMany({ where: { passengerId: userId } });

  const bookingIds = (
    await prisma.booking.findMany({
      where: { passengerId: userId },
      select: { id: true },
    })
  ).map((b) => b.id);

  if (bookingIds.length > 0) {
    await prisma.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  }

  const rideIds = (
    await prisma.ride.findMany({
      where: { OR: [{ passengerId: userId }, { driverId: userId }] },
      select: { id: true },
    })
  ).map((r) => r.id);

  if (rideIds.length > 0) {
    await prisma.rideEvent.deleteMany({ where: { rideId: { in: rideIds } } });
    await prisma.ride.deleteMany({ where: { id: { in: rideIds } } });
  }

  await prisma.rideEvent.deleteMany({ where: { actorId: userId } });
  await prisma.walletTransaction.deleteMany({ where: { driverId: userId } });
  await prisma.notification.deleteMany({ where: { userId } });
  await prisma.device.deleteMany({ where: { userId } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.savedPlace.deleteMany({ where: { userId } });
  await prisma.paymentMethodPreference.deleteMany({ where: { userId } });

  const profile = await prisma.driverProfile.findUnique({
    where: { userId },
    select: { vehicleId: true },
  });

  await prisma.driverProfile.deleteMany({ where: { userId } });

  if (profile?.vehicleId) {
    const otherDrivers = await prisma.driverProfile.count({
      where: { vehicleId: profile.vehicleId, userId: { not: userId } },
    });
    if (otherDrivers === 0) {
      await prisma.vehicle.delete({ where: { id: profile.vehicleId } }).catch(() => undefined);
    }
  }

  await prisma.user.delete({ where: { id: userId } });
}

async function purgePhone(phone: string): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { phone },
    select: { id: true, role: true },
  });

  for (const user of users) {
    console.log(`Deleting ${user.role} user ${user.id}…`);
    await deleteUserData(user.id);
  }

  await prisma.otpAttempt.deleteMany({ where: { phone } });

  return users.map((u) => `${u.role}:${u.id}`);
}

async function createDriver(phone: string): Promise<void> {
  const password = process.env.SEED_PASSWORD ?? SEED_PASSWORD;
  const passwordHash = await hashPassword(password);
  const name = process.env.DRIVER_NAME?.trim() || DEFAULT_DRIVER_NAME;
  const email =
    process.env.DRIVER_EMAIL?.trim() || `driver.${phone.replace(/\D/g, "").slice(-9)}@songa.dev`;
  const registration =
    process.env.VEHICLE_REGISTRATION?.trim() || `KDU ${phone.replace(/\D/g, "").slice(-3)}A`;

  const user = await prisma.user.create({
    data: {
      id: `usr_${cuid()}`,
      phone,
      role: UserRole.driver,
      name,
      email,
      passwordHash,
      phoneVerified: true,
      rating: 5,
    },
  });

  const vehicle = await prisma.vehicle.create({
    data: {
      type: "Car",
      make: "Toyota",
      model: "Vitz",
      registration,
      color: "White",
      seats: 4,
      status: "Activated",
    },
  });

  const now = new Date();
  const location = {
    lat: DEFAULT_LOCATION.lat,
    lng: DEFAULT_LOCATION.lng,
    heading: 90,
    speedKmh: 0,
    updatedAt: now.toISOString(),
  };

  await prisma.driverProfile.create({
    data: {
      userId: user.id,
      acceptanceRate: 100,
      onboardingStatus: OnboardingStatus.approved,
      isOnline: true,
      onlineSince: now,
      vehicleId: vehicle.id,
      location,
      locationUpdatedAt: now,
    },
  });

  await indexDriverLocation(user.id, location.lng, location.lat);

  console.log("\n=== Driver created ===\n");
  console.log(`Phone:        ${phone}`);
  console.log(`Password:     ${password}`);
  console.log(`Name:         ${name}`);
  console.log(`Email:        ${email}`);
  console.log(`User id:      ${user.id}`);
  console.log(`Vehicle:      ${vehicle.type} · ${vehicle.seats} seats · ${vehicle.registration}`);
  console.log(`Online:       yes (approved)`);
}

async function main() {
  const rawPhone = phoneFromArgv();
  const phone = normalizePhone(rawPhone);

  console.log(`Target phone (E.164): ${phone}\n`);

  const removed = await purgePhone(phone);
  if (removed.length === 0) {
    console.log("No existing users for this phone.");
  } else {
    console.log(`Removed: ${removed.join(", ")}`);
  }

  const leftover = await prisma.user.count({ where: { phone } });
  if (leftover > 0) {
    throw new Error(`Expected 0 users after purge, found ${leftover}`);
  }

  await createDriver(phone);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
