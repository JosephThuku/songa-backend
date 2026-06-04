import cuid from "cuid";
import { AppError } from "../../lib/errors.js";
import { callInHoldExpiresInSeconds } from "../../lib/call-in-hold.js";
import { payInviteLink, signBookingPayInvite } from "../../lib/booking-pay-invite.js";
import { prisma } from "../../lib/prisma.js";
import { toNairobiIso } from "../../lib/nairobi-time.js";
import { completeBookingPayment } from "../booking-payment.service.js";
import { releaseExpiredSeatHolds } from "./departure-seats.service.js";

async function loadDriverSeat(driverId: string, departureId: string, seatNumber: number) {
  await releaseExpiredSeatHolds(departureId);

  const departure = await prisma.sharedDeparture.findUnique({
    where: { id: departureId },
    select: { id: true, driverId: true, status: true, departureAt: true },
  });
  if (!departure || departure.driverId !== driverId) {
    throw new AppError("FORBIDDEN", 403, "This departure belongs to another driver.");
  }
  if (departure.status === "cancelled" || departure.status === "completed") {
    throw new AppError("DEPARTURE_NOT_ACTIVE", 409, "This departure is no longer active.");
  }

  const seat = await prisma.sharedDepartureSeat.findFirst({
    where: { departureId, seatNumber },
    include: {
      reservedBy: { select: { id: true, phone: true, name: true } },
    },
  });
  if (!seat) {
    throw new AppError("SEAT_NOT_FOUND", 404, "Seat not found.");
  }
  return { departure, seat };
}

export async function driverSeatPayInvite(
  driverId: string,
  departureId: string,
  seatNumber: number,
): Promise<{
  payInviteUrl: string;
  payInviteToken: string;
  reservedUntil: string;
  passengerPhone: string;
  passengerName: string | null;
}> {
  const { seat } = await loadDriverSeat(driverId, departureId, seatNumber);

  if (seat.status !== "reserved" || !seat.bookingId || !seat.reservedBy) {
    throw new AppError(
      "SEAT_NOT_HELD",
      409,
      "This seat is not waiting for payment. Use call-in booking first.",
    );
  }

  const now = new Date();
  if (!seat.expiresAt || seat.expiresAt.getTime() <= now.getTime()) {
    throw new AppError("HOLD_EXPIRED", 409, "The payment hold has expired. Book the seat again.");
  }

  const expiresInSeconds = callInHoldExpiresInSeconds(seat.expiresAt, now);
  const payInviteToken = signBookingPayInvite({
    bookingId: seat.bookingId,
    passengerId: seat.reservedBy.id,
    expiresInSeconds,
  });

  return {
    payInviteUrl: payInviteLink(payInviteToken),
    payInviteToken,
    reservedUntil: toNairobiIso(seat.expiresAt),
    passengerPhone: seat.reservedBy.phone,
    passengerName: seat.reservedBy.name,
  };
}

export async function driverMarkSeatPaidCash(
  driverId: string,
  departureId: string,
  seatNumber: number,
): Promise<{ departureId: string; seatNumber: number }> {
  const { seat } = await loadDriverSeat(driverId, departureId, seatNumber);

  if (seat.status !== "reserved" || !seat.bookingId) {
    throw new AppError(
      "SEAT_NOT_HELD",
      409,
      "Only seats on hold can be marked paid in cash.",
    );
  }

  const booking = await prisma.booking.findUnique({
    where: { id: seat.bookingId },
  });
  if (!booking || booking.sharedDepartureId !== departureId) {
    throw new AppError("BOOKING_NOT_FOUND", 404, "Booking not found.");
  }
  if (booking.status === "paid") {
    return { departureId, seatNumber };
  }
  if (booking.status !== "pending_payment") {
    throw new AppError("INVALID_BOOKING_STATUS", 409, "Booking is not pending payment.");
  }

  let payment = await prisma.payment.findFirst({
    where: { bookingId: booking.id, status: "pending" },
    orderBy: { createdAt: "desc" },
  });

  if (!payment) {
    payment = await prisma.payment.create({
      data: {
        id: `PAY-${cuid()}`,
        bookingId: booking.id,
        provider: "cash",
        status: "pending",
        reference: `CASH-${cuid()}`,
      },
    });
  }

  await completeBookingPayment(booking, payment, payment.reference, {
    channel: "driver_cash",
    markedByDriverId: driverId,
  });

  return { departureId, seatNumber };
}
