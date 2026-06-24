import type { Payment, Booking, Prisma } from "@prisma/client";
import { bookingSeatInclude, seatNumbersFromBooking } from "../lib/booking-seats.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { creditDriverForSharedBooking } from "./wallet.service.js";
import {
  loadDepartureNotifyContext,
  notifyDriverSeatsPaid,
} from "./shared-rides/shared-rides-notify.js";

const bookingPaymentSelect = {
  id: true,
  status: true,
  sharedDepartureId: true,
} satisfies Prisma.BookingSelect;

/** Mark booking paid after successful M-Pesa (or dev) payment — idempotent. */
export async function completeBookingPayment(
  booking: Booking,
  payment: Payment,
  transactionRef: string | null,
  gatewayMerge: Record<string, unknown> = {},
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const freshBooking = await tx.booking.findUniqueOrThrow({
      where: { id: booking.id },
      select: bookingPaymentSelect,
    });
    const freshPayment = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });

    if (freshPayment.bookingId !== freshBooking.id) {
      throw new AppError("INVALID_INPUT", 400, "Payment does not belong to this booking.");
    }

    if (freshBooking.status === "paid" || freshPayment.status === "succeeded") {
      return;
    }

    if (freshBooking.status !== "pending_payment") {
      throw new AppError("INVALID_BOOKING_STATUS", 409, "Booking is not pending payment.");
    }

    if (freshPayment.status !== "pending" && freshPayment.status !== "failed") {
      throw new AppError("INVALID_PAYMENT_STATUS", 409, "Payment is not pending.");
    }

    const existingGateway =
      freshPayment.gatewayResponse && typeof freshPayment.gatewayResponse === "object"
        ? (freshPayment.gatewayResponse as Record<string, unknown>)
        : {};

    await tx.payment.update({
      where: { id: freshPayment.id },
      data: {
        status: "succeeded",
        transactionRef: transactionRef ?? freshPayment.transactionRef,
        gatewayResponse: { ...existingGateway, ...gatewayMerge } as Prisma.InputJsonValue,
      },
    });

    await tx.booking.update({
      where: { id: freshBooking.id },
      data: { status: "paid" },
    });

    await tx.user.updateMany({
      where: { id: booking.passengerId, phoneVerified: false },
      data: { phoneVerified: true },
    });

    if (freshBooking.sharedDepartureId) {
      await tx.sharedDepartureSeat.updateMany({
        where: { bookingId: freshBooking.id },
        data: {
          status: "paid",
          expiresAt: null,
        },
      });
      await creditDriverForSharedBooking(tx, freshBooking.id);
    }
  });

  if (booking.sharedDepartureId) {
    void notifyDriverSharedBookingPaid(booking.id, booking.sharedDepartureId).catch((err) => {
      console.warn("[shared-rides] driver seat paid notify failed", err);
    });
  }
}

async function notifyDriverSharedBookingPaid(
  bookingId: string,
  departureId: string,
): Promise<void> {
  const [notifyCtx, booking] = await Promise.all([
    loadDepartureNotifyContext(departureId),
    prisma.booking.findUnique({
      where: { id: bookingId },
      include: { passenger: { select: { name: true } }, ...bookingSeatInclude },
    }),
  ]);
  if (!notifyCtx || !booking) return;

  const seatNumbers = seatNumbersFromBooking(booking) ?? [];

  await notifyDriverSeatsPaid({
    driverId: notifyCtx.driverId,
    departureId,
    routeLabel: notifyCtx.routeLabel,
    passengerName: booking.passenger?.name ?? null,
    seatNumbers,
    amountKes: booking.subtotal,
  });
}
