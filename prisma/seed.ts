// NEW — idempotent seed: 1 passenger + 1 driver

import "dotenv/config";
import { PrismaClient, UserRole, OnboardingStatus } from "@prisma/client";
import cuid from "cuid";
import { hashPassword } from "../src/lib/password.js";

const prisma = new PrismaClient();
const SEED_PASSWORD = "SongaDev1";

async function main() {
  const passwordHash = await hashPassword(SEED_PASSWORD);
  // Passenger — John Doe, +254712000001
  const passengerPhone = "+254712000001";
  const passenger = await prisma.user.upsert({
    where: {
      phone_role: { phone: passengerPhone, role: UserRole.passenger },
    },
    update: {
      name: "John Doe",
      email: "john@example.com",
      passwordHash,
      phoneVerified: true,
    },
    create: {
      id: `usr_${cuid()}`,
      phone: passengerPhone,
      role: UserRole.passenger,
      name: "John Doe",
      email: "john@example.com",
      passwordHash,
      phoneVerified: true,
      rating: 4.9,
    },
  });

  // Driver — James Mwangi, +254712345678 (strip spaces from mock data)
  const driverPhone = "+254712345678";
  const driver = await prisma.user.upsert({
    where: {
      phone_role: { phone: driverPhone, role: UserRole.driver },
    },
    update: {
      name: "James Mwangi",
      email: "james@example.com",
      passwordHash,
      phoneVerified: true,
    },
    create: {
      id: `usr_${cuid()}`,
      phone: driverPhone,
      role: UserRole.driver,
      name: "James Mwangi",
      email: "james@example.com",
      passwordHash,
      phoneVerified: true,
      rating: 4.92,
    },
  });

  const vehicle = await prisma.vehicle.upsert({
    where: { registration: "KDB 123A" },
    update: {
      type: "Car",
      make: "Toyota",
      model: "Noah",
      color: "Silver",
      year: "2018",
      seats: 6,
      status: "Activated",
    },
    create: {
      type: "Car",
      make: "Toyota",
      model: "Noah",
      registration: "KDB 123A",
      color: "Silver",
      year: "2018",
      seats: 6,
      status: "Activated",
    },
  });

  await prisma.driverProfile.upsert({
    where: { userId: driver.id },
    update: {
      acceptanceRate: 94,
      onboardingStatus: OnboardingStatus.approved,
      isOnline: false,
      vehicleId: vehicle.id,
    },
    create: {
      userId: driver.id,
      acceptanceRate: 94,
      onboardingStatus: OnboardingStatus.approved,
      isOnline: false,
      vehicleId: vehicle.id,
    },
  });

  console.log("Seed complete:", {
    passenger: { id: passenger.id, phone: passenger.phone },
    driver: { id: driver.id, phone: driver.phone },
    vehicle: { id: vehicle.id, registration: vehicle.registration },
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
