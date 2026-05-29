import type { Payment, Booking, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";

/** Mark booking paid after successful M-Pesa (or dev) payment — idempotent. */
export async function completeBookingPayment(
  booking: Booking,
  payment: Payment,
  transactionRef: string | null,
  gatewayMerge: Record<string, unknown> = {},
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const freshBooking = await tx.booking.findUniqueOrThrow({ where: { id: booking.id } });
    const freshPayment = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });

    if (freshPayment.bookingId !== freshBooking.id) {
      throw new AppError("INVALID_INPUT", 400, "Payment does not belong to this booking.");
    }

    if (freshBooking.status === "paid" && freshPayment.status === "succeeded") {
      return;
    }

    if (freshBooking.status !== "pending_payment") {
      throw new AppError("INVALID_BOOKING_STATUS", 409, "Booking is not pending payment.");
    }

    if (freshPayment.status !== "pending") {
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
  });
}
