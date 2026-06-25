import type { Prisma } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { verifyBookingPayInvite } from "../../lib/booking-pay-invite.js";
import { bookingSeatInclude, seatNumbersFromBooking } from "../../lib/booking-seats.js";
import { prisma } from "../../lib/prisma.js";
import { toNairobiIso } from "../../lib/nairobi-time.js";
import { startPayment, toPaymentDto } from "../booking.service.js";

const payInviteInclude = {
  ...bookingSeatInclude,
  passenger: { select: { id: true, phone: true, name: true } },
  payments: { orderBy: { createdAt: "desc" as const }, take: 1 },
  sharedDeparture: {
    include: {
      pickupLocation: { select: { name: true } },
      dropoffLocation: { select: { name: true } },
      sgrScheduleSlot: { select: { sgrEventTime: true } },
    },
  },
};

type PayInviteBookingRow = Prisma.BookingGetPayload<{ include: typeof payInviteInclude }>;

function toPayInviteBookingDto(booking: PayInviteBookingRow) {
  const latestPayment = Array.isArray(booking.payments) ? booking.payments[0] : null;
  const pickupLabel =
    booking.pickup && typeof booking.pickup === "object" && "label" in booking.pickup
      ? String((booking.pickup as { label?: string }).label ?? "")
      : null;

  return {
    id: booking.id,
    status: booking.status,
    total: booking.total,
    currency: booking.currency,
    seats: seatNumbersFromBooking(booking) ?? [],
    routeLabel: booking.sharedDeparture
      ? `${booking.sharedDeparture.pickupLocation.name} → ${booking.sharedDeparture.dropoffLocation.name}`
      : null,
    departureAt: booking.sharedDeparture
      ? toNairobiIso(booking.sharedDeparture.departureAt)
      : null,
    sgrEventTime: booking.sharedDeparture?.sgrScheduleSlot?.sgrEventTime ?? null,
    pickupLabel: pickupLabel?.trim() ? pickupLabel.trim() : null,
    passenger: {
      phone: booking.passenger.phone,
      name: booking.passenger.name,
    },
    payment: latestPayment ? toPaymentDto(latestPayment) : null,
    requiresLogin: false,
  };
}

export async function getPayInviteSummary(token: string) {
  let payload;
  try {
    payload = verifyBookingPayInvite(token);
  } catch {
    throw new AppError("PAY_INVITE_INVALID", 401, "This payment link is invalid or has expired.");
  }

  const booking = await prisma.booking.findUnique({
    where: { id: payload.bid },
    include: payInviteInclude,
  });

  if (!booking || booking.passengerId !== payload.sub) {
    throw new AppError("BOOKING_NOT_FOUND", 404, "Booking not found.");
  }

  return {
    booking: toPayInviteBookingDto(booking),
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
