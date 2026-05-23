// Vitest global setup: loads .env.test, ensures Prisma schema is in sync, and
// truncates all tables + resets the in-memory Redis between tests.

import { execSync } from "node:child_process";
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach } from "vitest";

// Load .env.test BEFORE any module that reads process.env (Prisma, env loader, etc).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(__dirname, "..", ".env.test") });

// Force NODE_ENV=test irrespective of how vitest was invoked.
process.env.NODE_ENV = "test";

// If TEST_DATABASE_URL is set, mirror it to DATABASE_URL so Prisma points at the test DB.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

// Keep the test database schema aligned with prisma/schema.prisma (no migration history yet).
execSync("npx prisma db push --skip-generate", {
  stdio: "pipe",
  env: process.env,
});

// Import after env is loaded so PrismaClient picks up DATABASE_URL.
const { prisma } = await import("../src/lib/prisma.js");
const { resetRedisForTest, _setRedis } = await import("../src/lib/redis.js");

beforeEach(async () => {
  // Truncate in dependency order. MySQL needs FK checks off to truncate.
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS=0");
  await prisma.$executeRawUnsafe("TRUNCATE TABLE `Notification`");
  await prisma.$executeRawUnsafe("TRUNCATE TABLE `Device`");
  await prisma.$executeRawUnsafe("TRUNCATE TABLE `WalletTransaction`");
  await prisma.$executeRawUnsafe("TRUNCATE TABLE `Payment`");
  await prisma.$executeRawUnsafe("TRUNCATE TABLE `Booking`");
  await prisma.$executeRawUnsafe("TRUNCATE TABLE `RideEvent`");
  await prisma.$executeRawUnsafe("TRUNCATE TABLE `Ride`");
  await prisma.$executeRawUnsafe("TRUNCATE TABLE `Session`");
  await prisma.$executeRawUnsafe("TRUNCATE TABLE `OtpAttempt`");
  await prisma.$executeRawUnsafe("TRUNCATE TABLE `DriverProfile`");
  await prisma.$executeRawUnsafe("TRUNCATE TABLE `Vehicle`");
  await prisma.$executeRawUnsafe("TRUNCATE TABLE `User`");
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS=1");
  // Drop the cached in-memory Redis so each test starts with empty OTP / rate-limit state.
  await resetRedisForTest();
  _setRedis(null);
});

afterAll(async () => {
  await prisma.$disconnect();
});
