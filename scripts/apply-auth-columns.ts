/**
 * Idempotent: adds User.passwordHash and User.phoneVerified if missing.
 * Use when prisma generate succeeded but db push was never run.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ cnt: bigint }[]>`
    SELECT COUNT(*) AS cnt
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ${table}
      AND COLUMN_NAME = ${column}
  `;
  return Number(rows[0]?.cnt ?? 0) > 0;
}

async function main(): Promise<void> {
  const table = "User";

  if (!(await columnExists(table, "passwordHash"))) {
    console.log("Adding User.passwordHash …");
    await prisma.$executeRawUnsafe(
      "ALTER TABLE `User` ADD COLUMN `passwordHash` VARCHAR(191) NULL",
    );
  } else {
    console.log("User.passwordHash already exists.");
  }

  if (!(await columnExists(table, "phoneVerified"))) {
    console.log("Adding User.phoneVerified …");
    await prisma.$executeRawUnsafe(
      "ALTER TABLE `User` ADD COLUMN `phoneVerified` BOOLEAN NOT NULL DEFAULT false",
    );
  } else {
    console.log("User.phoneVerified already exists.");
  }

  console.log("Auth columns OK.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
