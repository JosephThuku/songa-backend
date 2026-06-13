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

// Versioned schema: migrate deploy on the test DB (see scripts/apply-test-schema.ts).
execSync("npx tsx scripts/apply-test-schema.ts", { stdio: "pipe", env: process.env });

const { prisma } = await import("../src/lib/prisma.js");
const { resetRedisForTest, _setRedis } = await import("../src/lib/redis.js");
const { clearAllOfferTimeouts } = await import("../src/lib/offer-timeout.js");
const { ConsoleSmsProvider, _setSmsProvider } = await import("../src/lib/sms.js");

async function resetDatabase(): Promise<void> {
  // Stop any pending 15s offer-redispatch timers from a prior test firing
  // (and writing) into the next test's freshly-reset database.
  clearAllOfferTimeouts();
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS=0");
  await prisma.sharedTripRequestReservation.deleteMany();
  await prisma.sharedTripRequest.deleteMany();
  await prisma.sharedDepartureSeat.deleteMany();
  await prisma.sharedDeparture.deleteMany();
  await prisma.sgrScheduleSlot.deleteMany();
  await prisma.corridorLocation.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.device.deleteMany();
  await prisma.walletTransaction.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.bookingSeat.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.rideDriverDecline.deleteMany();
  await prisma.rideSeat.deleteMany();
  await prisma.rideEvent.deleteMany();
  await prisma.ride.deleteMany();
  await prisma.driverLocation.deleteMany();
  await prisma.place.deleteMany();
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
  delete process.env.WASILIANA_API_KEY;
  _setSmsProvider(new ConsoleSmsProvider());
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});
