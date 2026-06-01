// Idempotent dev seed: passenger, online drivers near Nairobi, sample notifications.

import "dotenv/config";
import { PrismaClient, UserRole, OnboardingStatus } from "@prisma/client";
import cuid from "cuid";
import { indexDriverLocation } from "../src/lib/driver-geo.js";
import { hashPassword } from "../src/lib/password.js";
import { seedSharedRidesCoast } from "./seeds/shared-rides-coast.js";

const prisma = new PrismaClient();

export const SEED_PASSWORD = "SongaDev1";

/** Use these exact labels so checkout uses seat_selection (JKIA terminal flow). */
export const SAMPLE_PICKUP = {
  label: "JKIA Terminal 1A",
  lat: -1.3192,
  lng: 36.9278,
} as const;

export const SAMPLE_DROPOFF = {
  label: "Westlands",
  lat: -1.2674,
  lng: 36.807,
} as const;

export const SAMPLE_SEATS = [3, 4] as const;

type DriverSeed = {
  phone: string;
  name: string;
  email: string;
  rating: number;
  vehicle: {
    type: string;
    make: string;
    model: string;
    registration: string;
    color: string;
    seats: number;
  };
  location: { lat: number; lng: number };
};

const DRIVERS: DriverSeed[] = [
  {
    phone: "+254712345678",
    name: "James Mwangi",
    email: "james.driver@songa.dev",
    rating: 4.92,
    vehicle: {
      type: "Car",
      make: "Toyota",
      model: "Noah",
      registration: "KDB 123A",
      color: "Silver",
      seats: 6,
    },
    location: { lat: -1.3188, lng: 36.9282 },
  },
  {
    phone: "+254712345679",
    name: "Grace Wanjiru",
    email: "grace.driver@songa.dev",
    rating: 4.88,
    vehicle: {
      type: "Van",
      make: "Toyota",
      model: "Hiace",
      registration: "KCA 456B",
      color: "White",
      seats: 7,
    },
    location: { lat: -1.3196, lng: 36.9265 },
  },
  {
    phone: "+254712345680",
    name: "Peter Otieno",
    email: "peter.driver@songa.dev",
    rating: 4.75,
    vehicle: {
      type: "Car",
      make: "Nissan",
      model: "Note",
      registration: "KDG 789C",
      color: "Blue",
      seats: 4,
    },
    location: { lat: -1.3175, lng: 36.9295 },
  },
  {
    phone: "+254712345681",
    name: "Faith Njoki",
    email: "faith.driver@songa.dev",
    rating: 4.95,
    vehicle: {
      type: "Minibus",
      make: "Isuzu",
      model: "NQR",
      registration: "KDH 012D",
      color: "Yellow",
      seats: 14,
    },
    location: { lat: -1.3202, lng: 36.9271 },
  },
  {
    phone: "+254712345682",
    name: "David Kamau",
    email: "david.driver@songa.dev",
    rating: 4.81,
    vehicle: {
      type: "Car",
      make: "Mazda",
      model: "Demio",
      registration: "KDJ 345E",
      color: "Red",
      seats: 4,
    },
    location: { lat: -1.2682, lng: 36.8088 },
  },
  {
    phone: "+254712345683",
    name: "Hassan Ali",
    email: "hassan.driver@songa.dev",
    rating: 4.86,
    vehicle: {
      type: "Car",
      make: "Toyota",
      model: "Axio",
      registration: "KDM 901F",
      color: "White",
      seats: 4,
    },
    location: { lat: -4.0342, lng: 39.5948 },
  },
  {
    phone: "+254712345684",
    name: "Amina Said",
    email: "amina.driver@songa.dev",
    rating: 4.9,
    vehicle: {
      type: "Van",
      make: "Toyota",
      model: "Hiace",
      registration: "KDM 902G",
      color: "Silver",
      seats: 7,
    },
    location: { lat: -4.0438, lng: 39.7182 },
  },
];

const PASSENGER = {
  phone: "+254712000001",
  name: "John Doe",
  email: "john.passenger@songa.dev",
  rating: 4.9,
};

async function upsertPassenger(passwordHash: string) {
  return prisma.user.upsert({
    where: { phone_role: { phone: PASSENGER.phone, role: UserRole.passenger } },
    update: {
      name: PASSENGER.name,
      email: PASSENGER.email,
      passwordHash,
      phoneVerified: true,
      rating: PASSENGER.rating,
    },
    create: {
      id: `usr_${cuid()}`,
      phone: PASSENGER.phone,
      role: UserRole.passenger,
      name: PASSENGER.name,
      email: PASSENGER.email,
      passwordHash,
      phoneVerified: true,
      rating: PASSENGER.rating,
    },
  });
}

async function upsertDriver(seed: DriverSeed, passwordHash: string) {
  const user = await prisma.user.upsert({
    where: { phone_role: { phone: seed.phone, role: UserRole.driver } },
    update: {
      name: seed.name,
      email: seed.email,
      passwordHash,
      phoneVerified: true,
      rating: seed.rating,
    },
    create: {
      id: `usr_${cuid()}`,
      phone: seed.phone,
      role: UserRole.driver,
      name: seed.name,
      email: seed.email,
      passwordHash,
      phoneVerified: true,
      rating: seed.rating,
    },
  });

  const vehicle = await prisma.vehicle.upsert({
    where: { registration: seed.vehicle.registration },
    update: {
      type: seed.vehicle.type,
      make: seed.vehicle.make,
      model: seed.vehicle.model,
      color: seed.vehicle.color,
      seats: seed.vehicle.seats,
      status: "Activated",
    },
    create: {
      type: seed.vehicle.type,
      make: seed.vehicle.make,
      model: seed.vehicle.model,
      registration: seed.vehicle.registration,
      color: seed.vehicle.color,
      seats: seed.vehicle.seats,
      status: "Activated",
    },
  });

  const now = new Date();
  const location = {
    lat: seed.location.lat,
    lng: seed.location.lng,
    heading: 90,
    speedKmh: 0,
    updatedAt: now.toISOString(),
  };

  await prisma.driverProfile.upsert({
    where: { userId: user.id },
    update: {
      acceptanceRate: 94,
      onboardingStatus: OnboardingStatus.approved,
      isOnline: true,
      onlineSince: now,
      vehicleId: vehicle.id,
      location,
      locationUpdatedAt: now,
    },
    create: {
      userId: user.id,
      acceptanceRate: 94,
      onboardingStatus: OnboardingStatus.approved,
      isOnline: true,
      onlineSince: now,
      vehicleId: vehicle.id,
      location,
      locationUpdatedAt: now,
    },
  });

  await indexDriverLocation(user.id, seed.location.lng, seed.location.lat);

  return { user, vehicle };
}

async function seedPassengerNotifications(passengerId: string) {
  const items = [
    {
      id: "ntf_seed_welcome",
      title: "Welcome to Songa",
      body: "Your dev account is ready. Try booking JKIA → Westlands.",
      type: "system",
      deepLink: "/(tabs)",
    },
    {
      id: "ntf_seed_drivers_nearby",
      title: "Drivers nearby",
      body: "5 drivers are online near Nairobi airport.",
      type: "dispatch",
      deepLink: "/(tabs)",
    },
  ];

  for (const item of items) {
    await prisma.notification.upsert({
      where: { id: item.id },
      update: item,
      create: { ...item, userId: passengerId, read: false },
    });
  }
}

async function seedDriverWallet(driverId: string) {
  const existing = await prisma.walletTransaction.count({ where: { driverId } });
  if (existing > 0) return;

  await prisma.walletTransaction.createMany({
    data: [
      {
        id: `wlt_${cuid()}`,
        driverId,
        type: "credit",
        label: "Trip earnings",
        amount: 1250,
        currency: "KES",
        status: "posted",
      },
      {
        id: `wlt_${cuid()}`,
        driverId,
        type: "credit",
        label: "Trip earnings",
        amount: 980,
        currency: "KES",
        status: "posted",
      },
    ],
  });
}

async function main() {
  const passwordHash = await hashPassword(SEED_PASSWORD);
  const passenger = await upsertPassenger(passwordHash);

  const drivers: Awaited<ReturnType<typeof upsertDriver>>[] = [];
  for (const seed of DRIVERS) {
    const row = await upsertDriver(seed, passwordHash);
    await seedDriverWallet(row.user.id);
    drivers.push(row);
  }

  await seedPassengerNotifications(passenger.id);

  const sharedRides = await seedSharedRidesCoast(prisma);

  console.log("\n=== Songa dev seed ===\n");
  console.log(`Password (all accounts): ${SEED_PASSWORD}\n`);

  console.log("Passenger (book rides as this user):");
  console.log(`  Phone: ${PASSENGER.phone}`);
  console.log(`  Email: ${PASSENGER.email}`);
  console.log(`  Role:  passenger\n`);

  console.log("Drivers (log in on driver app / driver role):");
  for (const seed of DRIVERS) {
    console.log(`  ${seed.name.padEnd(16)} ${seed.phone}  ${seed.vehicle.type} (${seed.vehicle.registration})`);
  }

  console.log("\nSample ride to order (passenger app):");
  console.log(`  Pickup:  ${SAMPLE_PICKUP.label}  (${SAMPLE_PICKUP.lat}, ${SAMPLE_PICKUP.lng})`);
  console.log(`  Dropoff: ${SAMPLE_DROPOFF.label}  (${SAMPLE_DROPOFF.lat}, ${SAMPLE_DROPOFF.lng})`);
  console.log(`  Seats:   ${SAMPLE_SEATS.join(", ")} (seat_selection — airport terminal flow)`);
  console.log("  Flow: Home → enter route → Request ride OR Checkout with seats → pay (dev auto-pay) → dispatch");
  console.log("\nDrivers are seeded ONLINE with GPS near pickup. James/Grace/Faith/Peter are by JKIA; David is in Westlands.\n");

  console.log("Shared rides (coast):", {
    zones: sharedRides.zoneSlugs,
    slots: sharedRides.slotCount,
    demoDepartures: sharedRides.demoDepartures,
  });

  console.log("Seed complete:", {
    passengerId: passenger.id,
    driverIds: drivers.map((d) => d.user.id),
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
