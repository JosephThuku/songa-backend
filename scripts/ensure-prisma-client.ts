/**
 * Ensures @prisma/client matches prisma/schema.prisma before dev, test, or build.
 * Run automatically via npm `pretest` / `predev` / `prebuild`, or manually: npm run db:generate
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(root, "prisma/schema.prisma");
const clientTypesPath = path.join(root, "node_modules/.prisma/client/index.d.ts");

/** Delegates that must exist after shared-rides schema is present. */
const REQUIRED_DELEGATES = [
  "corridorLocation",
  "sgrScheduleSlot",
  "sharedTripRequest",
  "sharedTripRequestReservation",
  "sharedDeparture",
  "sharedDepartureSeat",
] as const;

function delegateMissing(clientSource: string, delegate: string): boolean {
  return !clientSource.includes(`get ${delegate}()`);
}

function readClientSource(): string | null {
  if (!existsSync(clientTypesPath)) return null;
  return readFileSync(clientTypesPath, "utf8");
}

function isClientStale(): boolean {
  const source = readClientSource();
  if (!source) return true;
  if (REQUIRED_DELEGATES.some((d) => delegateMissing(source, d))) return true;
  if (!existsSync(schemaPath)) return false;
  try {
    return statSync(schemaPath).mtimeMs > statSync(clientTypesPath).mtimeMs;
  } catch {
    return true;
  }
}

function runGenerate(): void {
  console.log("[prisma] Generating client (schema newer than client or models missing)…");
  execSync("npx prisma generate", { cwd: root, stdio: "inherit", env: process.env });
}

function verify(): void {
  const source = readClientSource();
  if (!source) {
    console.error("[prisma] Client not found after generate. Run: npm install && npm run db:sync");
    process.exit(1);
  }
  const missing = REQUIRED_DELEGATES.filter((d) => delegateMissing(source, d));
  if (missing.length > 0) {
    console.error(
      `[prisma] Generated client is still missing: ${missing.join(", ")}.\n` +
        "  Run from songa-backend/: npm run db:sync\n" +
        "  Then restart the TypeScript server in your editor.",
    );
    process.exit(1);
  }
}

if (isClientStale()) {
  runGenerate();
}
verify();
