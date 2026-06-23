/** Admin Prisma select shapes (no `satisfies Prisma.*` — avoids IDE errors when client lags). */

import type { UserRole } from "@prisma/client";

export const userPublicSelect = {
  id: true,
  phone: true,
  role: true,
  name: true,
  email: true,
  phoneVerified: true,
  isBlocked: true,
  avatarUrl: true,
  rating: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type AdminUserPublic = {
  id: string;
  phone: string;
  role: UserRole;
  name: string | null;
  email: string | null;
  phoneVerified: boolean;
  isBlocked: boolean;
  avatarUrl: string | null;
  rating: number;
  createdAt: Date;
  updatedAt: Date;
};
