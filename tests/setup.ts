import { execSync } from "node:child_process";
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(__dirname, "..", ".env.test") });
process.env.NODE_ENV = "test";
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

execSync("npx prisma db push --skip-generate", { stdio: "pipe", env: process.env });

const { prisma } = await import("../src/lib/prisma.js");
const { resetRedisForTest, _setRedis } = await import("../src/lib/redis.js");
const { clearAllOfferTimeouts } = await import("../src/lib/offer-timeout.js");

async function resetDatabase(): Promise<void> {
  // Stop any pending 15s offer-redispatch timers from a prior test firing
  // (and writing) into the next test's freshly-reset database.
  clearAllOfferTimeouts();
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS=0");
  await prisma.notification.deleteMany();
  await prisma.device.deleteMany();
  await prisma.walletTransaction.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.rideEvent.deleteMany();
  await prisma.ride.deleteMany();
  await prisma.session.deleteMany();
  await prisma.otpAttempt.deleteMany();
  await prisma.driverProfile.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS=1");
  await resetRedisForTest();
  _setRedis(null);
}

beforeAll(async () => {
  await resetDatabase();
});

beforeEach(async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 75));
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});
