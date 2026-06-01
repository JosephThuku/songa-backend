import type { PrismaClient } from "@prisma/client";

/** Default ops admin — login with `role: "admin"` (not self-registerable). */
export const SEED_ADMIN = {
  phone: "+254700000001",
  email: "admin@songa.dev",
  name: "Songa Admin",
} as const;

export async function seedAdminUser(prisma: PrismaClient, passwordHash: string) {
  return prisma.user.upsert({
    where: {
      phone_role: { phone: SEED_ADMIN.phone, role: "admin" },
    },
    update: {
      name: SEED_ADMIN.name,
      email: SEED_ADMIN.email,
      passwordHash,
      phoneVerified: true,
    },
    create: {
      id: "usr_seed_admin",
      phone: SEED_ADMIN.phone,
      role: "admin",
      name: SEED_ADMIN.name,
      email: SEED_ADMIN.email,
      passwordHash,
      phoneVerified: true,
    },
  });
}
