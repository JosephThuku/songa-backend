import { AppError } from "../../lib/errors.js";
import { verifyBookingPayInvite } from "../../lib/booking-pay-invite.js";
import { bookingSeatInclude, seatNumbersFromBooking } from "../../lib/booking-seats.js";
import { prisma } from "../../lib/prisma.js";
import { startPayment } from "../booking.service.js";

export async function getPayInviteSummary(token: string) {
  let payload;
  try {
    payload = verifyBookingPayInvite(token);
  } catch {
    throw new AppError("PAY_INVITE_INVALID", 401, "This payment link is invalid or has expired.");
  }

  const booking = await prisma.booking.findUnique({
    where: { id: payload.bid },
    include: {
      ...bookingSeatInclude,
      passenger: { select: { id: true, phone: true, name: true } },
      sharedDeparture: {
        include: {
          pickupLocation: { select: { name: true } },
          dropoffLocation: { select: { name: true } },
        },
      },
    },
  });

  if (!booking || booking.passengerId !== payload.sub) {
    throw new AppError("BOOKING_NOT_FOUND", 404, "Booking not found.");
  }

  return {
    booking: {
      id: booking.id,
      status: booking.status,
      total: booking.total,
      currency: booking.currency,
      seats: seatNumbersFromBooking(booking) ?? [],
      routeLabel: booking.sharedDeparture
        ? `${booking.sharedDeparture.pickupLocation.name} → ${booking.sharedDeparture.dropoffLocation.name}`
        : null,
      passenger: {
        phone: booking.passenger.phone,
        name: booking.passenger.name,
      },
      requiresLogin: false,
    },
  };
}

export async function payViaInvite(
  token: string,
  input: { provider: string; phone?: string },
) {
  let payload;
  try {
    payload = verifyBookingPayInvite(token);
  } catch {
    throw new AppError("PAY_INVITE_INVALID", 401, "This payment link is invalid or has expired.");
  }

  return startPayment({
    bookingId: payload.bid,
    passengerId: payload.sub,
    provider: input.provider,
    phone: input.phone,
  });
}
