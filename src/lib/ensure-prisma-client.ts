import { Prisma } from "@prisma/client";

const REQUIRED_USER_FIELDS = ["passwordHash", "phoneVerified"] as const;

/**
 * Fail fast when schema.prisma was updated but `prisma generate` was not run.
 */
export function assertPrismaClientCurrent(): void {
  const fields = Prisma.UserScalarFieldEnum;
  const missing = REQUIRED_USER_FIELDS.filter((f) => !(f in fields));
  if (missing.length === 0) return;

  throw new Error(
    `Prisma client is out of date (missing User fields: ${missing.join(", ")}). ` +
      `From the backend folder run: npm run db:fix-auth (or npm run db:sync) — then restart npm run dev.`,
  );
}
