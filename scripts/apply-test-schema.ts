/**
 * Keeps the test database aligned with prisma/schema.prisma.
 *
 * - Existing test DBs (created via db push): `db push` applies FK changes idempotently.
 * - Marks the baseline migration resolved so green-field deploys can use `migrate deploy`.
 */
import { execSync } from "node:child_process";

const APPLIED_MIGRATIONS = [
  "20260320120000_initial_schema",
  "20260605200000_place_normalization",
  "20260605300000_booking_seats",
  "20260605400000_trip_request_trim",
  "20260605500000_phase5_location_decline_seats",
] as const;

execSync("npx prisma db push", {
  stdio: "inherit",
  env: process.env,
});

for (const migration of APPLIED_MIGRATIONS) {
  try {
    execSync(`npx prisma migrate resolve --applied ${migration}`, {
      stdio: "pipe",
      env: process.env,
    });
  } catch {
    // Migration already resolved or _prisma_migrations not ready — safe to continue tests.
  }
}

execSync("npx prisma generate", {
  stdio: "inherit",
  env: process.env,
});
