import { prisma } from "../../lib/prisma.js";

/** Release all expired seat holds (for cron or manual ops). */
export async function releaseAllExpiredSeatHolds(): Promise<{ released: number }> {
  const now = new Date();
  const expiredSeats = await prisma.sharedDepartureSeat.findMany({
    where: {
      status: "reserved",
      expiresAt: { lt: now },
    },
    select: { bookingId: true },
  });
  const bookingIds = [
    ...new Set(expiredSeats.map((seat) => seat.bookingId).filter((id): id is string => Boolean(id))),
  ];

  const result = await prisma.$transaction(async (tx) => {
    if (bookingIds.length > 0) {
      await tx.booking.updateMany({
        where: {
          id: { in: bookingIds },
          status: "pending_payment",
        },
        data: { status: "cancelled" },
      });
    }

    return tx.sharedDepartureSeat.updateMany({
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
  });
  return { released: result.count };
}
