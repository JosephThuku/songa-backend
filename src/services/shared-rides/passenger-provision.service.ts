import { UserRole, type User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { normalizePhone } from "../../lib/phone.js";

/**
 * Call-in / driver-invite: ensure a passenger row exists without forcing signup or password.
 * Phone is marked verified after successful M-Pesa pay on the invite link.
 */
export async function findOrCreatePassengerByPhone(
  phoneInput: string,
  name?: string | null,
): Promise<User> {
  const phone = normalizePhone(phoneInput);
  const existing = await prisma.user.findUnique({
    where: { phone_role: { phone, role: UserRole.passenger } },
  });
  if (existing) {
    if (name?.trim() && !existing.name) {
      return prisma.user.update({
        where: { id: existing.id },
        data: { name: name.trim() },
      });
    }
    return existing;
  }

  return prisma.user.create({
    data: {
      phone,
      role: UserRole.passenger,
      name: name?.trim() || null,
      phoneVerified: false,
      passwordHash: null,
    },
  });
}
