import { prisma } from "../../lib/prisma.js";

/** Release all expired seat holds (for cron or manual ops). */
export async function releaseAllExpiredSeatHolds(): Promise<{ released: number }> {
  const now = new Date();
  const result = await prisma.sharedDepartureSeat.updateMany({
    where: {
      status: "reserved",
      expiresAt: { lt: now },
    },
    data: {
      status: "available",
      reservedById: null,
      reservedAt: null,
      expiresAt: null,
      bookingId: null,
      pickupLabel: null,
      pickupLat: null,
      pickupLng: null,
    },
  });
  return { released: result.count };
}
