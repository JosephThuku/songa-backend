// NEW — idempotent seed: 1 passenger + 1 driver

import { PrismaClient, UserRole, OnboardingStatus } from "@prisma/client";
import cuid from "cuid";

const prisma = new PrismaClient();

async function main() {
  // Passenger — John Doe, +254712000001
  const passengerPhone = "+254712000001";
  const passenger = await prisma.user.upsert({
    where: {
      phone_role: { phone: passengerPhone, role: UserRole.passenger },
    },
    update: {
      name: "John Doe",
      email: "john@example.com",
    },
    create: {
      id: `usr_${cuid()}`,
      phone: passengerPhone,
      role: UserRole.passenger,
      name: "John Doe",
      email: "john@example.com",
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
    },
    create: {
      id: `usr_${cuid()}`,
      phone: driverPhone,
      role: UserRole.driver,
      name: "James Mwangi",
      email: "james@example.com",
      rating: 4.92,
    },
  });

  await prisma.driverProfile.upsert({
    where: { userId: driver.id },
    update: {
      acceptanceRate: 94,
      onboardingStatus: OnboardingStatus.approved,
      isOnline: false,
    },
    create: {
      userId: driver.id,
      acceptanceRate: 94,
      onboardingStatus: OnboardingStatus.approved,
      isOnline: false,
    },
  });

  console.log("Seed complete:", {
    passenger: { id: passenger.id, phone: passenger.phone },
    driver: { id: driver.id, phone: driver.phone },
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
