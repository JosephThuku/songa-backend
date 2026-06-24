import cuid from "cuid";
import { Prisma } from "@prisma/client";
import { AppError } from "../lib/errors.js";
import { mpesaPaymentTrace } from "../lib/mpesa-payment-log.js";
import { computeFare, PLATFORM_FEE_KES } from "../lib/ride-pricing.js";
import { prisma } from "../lib/prisma.js";
import {
  bookingSeatInclude,
  persistBookingSeats,
  seatNumbersFromBooking,
  serializeBookingSeats,
} from "../lib/booking-seats.js";
import { persistPlacePair } from "../lib/place-persist.js";
import type { PlaceDto } from "../lib/responses.js";
import { isMpesaConfigured } from "../config/mpesa.js";
import { SHARED_SGR_UNPAID_BOOKING_MINUTES } from "../config/shared-rides.js";
import { MpesaService } from "./mpesa.service.js";
import { completeBookingPayment } from "./booking-payment.service.js";

const PLATFORM_FEE = PLATFORM_FEE_KES;

export interface CreateBookingInput {
  passengerId: string;
  tripId?: string;
  pickup: PlaceDto;
  dropoff: PlaceDto;
  seats: number[];
}

export interface StartPaymentInput {
  bookingId: string;
  passengerId: string;
  provider: string;
  phone?: string;
  mpesaChannel?: "stk" | "paybill" | "till";
}

function subtotal(input: CreateBookingInput): number {
  const fare = computeFare(input.pickup, input.dropoff);
  return fare.total * Math.max(1, input.seats.length);
}

const bookingInclude = {
  payments: { orderBy: { createdAt: "desc" as const }, take: 1 },
  ...bookingSeatInclude,
};

export async function createBooking(input: CreateBookingInput) {
  if (input.seats.length === 0) throw new AppError("INVALID_INPUT", 400, "At least one seat is required.");
  const bookingSubtotal = subtotal(input);
  const seatNumbers = input.seats;
  const booking = await prisma.$transaction(async (tx) => {
    const places = await persistPlacePair(tx, input.pickup, input.dropoff);
    const created = await tx.booking.create({
      data: {
        id: `BKG-${cuid()}`,
        passengerId: input.passengerId,
        tripId: input.tripId ?? null,
        seats: serializeBookingSeats(seatNumbers),
        subtotal: bookingSubtotal,
        platformFee: PLATFORM_FEE,
        total: bookingSubtotal + PLATFORM_FEE,
        pickup: places.pickup,
        dropoff: places.dropoff,
        pickupPlaceId: places.pickupPlaceId,
        dropoffPlaceId: places.dropoffPlaceId,
      },
    });
    await persistBookingSeats(tx, created.id, seatNumbers);
    return tx.booking.findUniqueOrThrow({ where: { id: created.id }, include: bookingInclude });
  });
  return toBookingDto(booking);
}

export async function startPayment(input: StartPaymentInput) {
  const { bookingId, passengerId, provider, phone, mpesaChannel = "stk" } = input;
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: bookingInclude });
  if (!booking || booking.passengerId !== passengerId) {
    throw new AppError("BOOKING_NOT_FOUND", 404, "Booking not found.");
  }
  if (booking.status !== "pending_payment") {
    throw new AppError("INVALID_BOOKING_STATUS", 409, "Booking is not pending payment.");
  }

  const accountReference =
    booking.id.replace(/^BKG-/, "").slice(0, 12).toUpperCase() || `SONGA${cuid().slice(0, 8)}`;

  let payment = await prisma.payment.findFirst({
    where: { bookingId, status: "pending" },
    orderBy: { createdAt: "desc" },
  });

  if (!payment) {
    payment = await prisma.payment.create({
      data: {
        id: `pay_${cuid()}`,
        bookingId,
        provider,
        reference: `pay_${cuid()}`,
        checkoutUrl: null,
      },
    });
  } else {
    payment = await prisma.payment.update({
      where: { id: payment.id },
      data: { provider, checkoutUrl: null, mpesaCheckoutRequestId: null, transactionRef: null },
    });
  }

  if (provider !== "mpesa") {
    throw new AppError(
      "PAYMENT_PROVIDER_DISABLED",
      503,
      "This payment provider is not available yet. Use M-Pesa STK push.",
    );
  }

  if (mpesaChannel !== "stk") {
    throw new AppError(
      "MPESA_MANUAL_DISABLED",
      503,
      "Manual M-Pesa Paybill/Till payments are not available yet. Use STK push.",
    );
  }

  if (process.env.ALLOW_DEV_PAYMENT_CONFIRM === "true") {
    await completeBookingPayment(booking, payment, `DEV-${cuid()}`, { simulated: true, provider });
    const updated = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: bookingInclude,
    });
    return {
      payment: toPaymentDto(updated.payments[0]!),
      message: "Payment confirmed (development mode).",
    };
  }

  if (!isMpesaConfigured()) {
    throw new AppError("MPESA_NOT_CONFIGURED", 503, "M-Pesa is not configured on this server.");
  }
  if (!phone?.trim()) {
    throw new AppError("PHONE_REQUIRED", 400, "Phone number is required for M-Pesa STK push.");
  }

  const mpesa = new MpesaService();
  const amount = Math.round(booking.total);
  const result = await mpesa.stkPush({
    amount,
    phone: phone.trim(),
    accountReference,
    transactionDesc: "Songa booking",
  });

  if (result.status !== "success") {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "failed",
        gatewayResponse: { stk_error: result } as Prisma.InputJsonValue,
      },
    });
    throw new AppError("MPESA_STK_FAILED", 502, result.message ?? "Could not start M-Pesa payment.");
  }

  const data = result.data ?? {};
  const responseCode = String(data.ResponseCode ?? "");
  if (responseCode && responseCode !== "0") {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "failed",
        gatewayResponse: { stk_response: data } as Prisma.InputJsonValue,
      },
    });
    throw new AppError(
      "MPESA_STK_FAILED",
      502,
      String(data.CustomerMessage ?? data.ResponseDescription ?? "M-Pesa did not accept the STK request."),
    );
  }

  const checkoutRequestId = data.CheckoutRequestID;
  if (!checkoutRequestId || typeof checkoutRequestId !== "string") {
    throw new AppError("MPESA_STK_FAILED", 502, "Invalid response from M-Pesa.");
  }

  payment = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      mpesaCheckoutRequestId: checkoutRequestId,
      gatewayResponse: {
        stk_init: data,
        phone: phone.trim(),
        accountReference,
      } as Prisma.InputJsonValue,
    },
  });

  mpesaPaymentTrace("stk.push.sent", {
    bookingId,
    paymentId: payment.id,
    checkoutRequestId,
    passengerId,
    amount: Math.round(booking.total),
  });

  return {
    payment: toPaymentDto(payment),
    message: "Check your phone for the M-Pesa prompt and enter your PIN.",
  };
}

export async function getBooking(bookingId: string, passengerId: string) {
  await expireStaleUnpaidSharedSgrBookings(passengerId);
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: bookingInclude });
  if (!booking || booking.passengerId !== passengerId) {
    throw new AppError("BOOKING_NOT_FOUND", 404, "Booking not found.");
  }
  return { booking: toBookingDto(booking) };
}

/** Cancel unpaid passenger bookings and release shared SGR seats. */
export async function cancelPassengerBooking(bookingId: string, passengerId: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: bookingInclude });
  if (!booking || booking.passengerId !== passengerId) {
    throw new AppError("BOOKING_NOT_FOUND", 404, "Booking not found.");
  }
  if (booking.status === "cancelled") {
    return { booking: toBookingDto(booking) };
  }
  if (booking.status === "paid") {
    throw new AppError("INVALID_BOOKING_STATUS", 409, "Paid bookings cannot be cancelled here.");
  }
  if (booking.status !== "pending_payment" && booking.status !== "failed") {
    throw new AppError("INVALID_BOOKING_STATUS", 409, "Booking cannot be cancelled.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: bookingId },
      data: { status: "cancelled" },
    });
    await tx.payment.updateMany({
      where: { bookingId, status: "pending" },
      data: { status: "failed" },
    });
    if (booking.sharedDepartureId) {
      await tx.sharedDepartureSeat.updateMany({
        where: { bookingId },
        data: {
          status: "available",
          bookingId: null,
          reservedById: null,
          reservedAt: null,
          expiresAt: null,
          pickupLabel: null,
          pickupLat: null,
          pickupLng: null,
        },
      });
    }
  });

  const updated = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: bookingInclude,
  });
  return { booking: toBookingDto(updated) };
}

/** Fully cancel stale unpaid shared SGR bookings so seats return to the pool. */
export async function expireStaleUnpaidSharedSgrBookings(passengerId?: string): Promise<number> {
  const cutoff = new Date(Date.now() - SHARED_SGR_UNPAID_BOOKING_MINUTES * 60_000);
  const stale = await prisma.booking.findMany({
    where: {
      product: "shared_sgr",
      status: "pending_payment",
      createdAt: { lt: cutoff },
      ...(passengerId ? { passengerId } : {}),
    },
    select: { id: true, passengerId: true },
  });

  for (const row of stale) {
    await cancelPassengerBooking(row.id, row.passengerId);
  }

  return stale.length;
}

export async function requirePaidBooking(bookingId: string, passengerId: string): Promise<void> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking || booking.passengerId !== passengerId || booking.status !== "paid") {
    throw new AppError("BOOKING_NOT_PAID", 409, "Booking must be paid before requesting a prepaid ride.");
  }
}

function toBookingDto(booking: Awaited<ReturnType<typeof prisma.booking.findUnique>> & { payments?: unknown[] }) {
  const payments = Array.isArray(booking.payments) ? booking.payments : [];
  return {
    id: booking.id,
    passengerId: booking.passengerId,
    tripId: booking.tripId ?? null,
    product: booking.product ?? "on_demand",
    sharedDepartureId: booking.sharedDepartureId ?? null,
    status: booking.status,
    seats: seatNumbersFromBooking(booking),
    subtotal: booking.subtotal,
    platformFee: booking.platformFee,
    total: booking.total,
    currency: booking.currency,
    pickup: booking.pickup,
    dropoff: booking.dropoff,
    payment: payments.length > 0 ? toPaymentDto(payments[0] as Parameters<typeof toPaymentDto>[0]) : null,
    createdAt: booking.createdAt.toISOString(),
    updatedAt: booking.updatedAt.toISOString(),
  };
}

function mpesaFailureFromGateway(gatewayResponse: unknown): {
  mpesaResultCode: number | null;
  mpesaResultDesc: string | null;
} {
  if (!gatewayResponse || typeof gatewayResponse !== "object") {
    return { mpesaResultCode: null, mpesaResultDesc: null };
  }
  const row = gatewayResponse as Record<string, unknown>;
  const topCode = row.result_code;
  const topDesc = row.result_desc;
  const stkBody = (row.stk_callback as Record<string, unknown> | undefined)?.Body as
    | Record<string, unknown>
    | undefined;
  const stkCallback = stkBody?.stkCallback as Record<string, unknown> | undefined;

  const mpesaResultCode =
    typeof topCode === "number"
      ? topCode
      : stkCallback?.ResultCode != null
        ? Number(stkCallback.ResultCode)
        : null;
  const mpesaResultDesc =
    typeof topDesc === "string" && topDesc.trim()
      ? topDesc.trim()
      : typeof stkCallback?.ResultDesc === "string" && stkCallback.ResultDesc.trim()
        ? stkCallback.ResultDesc.trim()
        : null;

  return {
    mpesaResultCode: mpesaResultCode != null && !Number.isNaN(mpesaResultCode) ? mpesaResultCode : null,
    mpesaResultDesc,
  };
}

function toPaymentDto(payment: {
  id: string;
  bookingId: string;
  provider: string;
  status: string;
  checkoutUrl: string | null;
  reference: string;
  mpesaCheckoutRequestId?: string | null;
  transactionRef?: string | null;
  gatewayResponse?: unknown;
  createdAt: Date;
}) {
  const failure =
    payment.status === "failed" ? mpesaFailureFromGateway(payment.gatewayResponse) : null;
  return {
    id: payment.id,
    bookingId: payment.bookingId,
    provider: payment.provider,
    status: payment.status,
    checkoutUrl: payment.checkoutUrl,
    reference: payment.reference,
    mpesaCheckoutRequestId: payment.mpesaCheckoutRequestId ?? null,
    transactionRef: payment.transactionRef ?? null,
    mpesaResultCode: failure?.mpesaResultCode ?? null,
    mpesaResultDesc: failure?.mpesaResultDesc ?? null,
    createdAt: payment.createdAt.toISOString(),
  };
}

/** Test / admin helper — simulate STK success without Safaricom. */
export async function simulateMpesaPaymentSuccess(checkoutRequestId: string, receipt = "SIMRECEIPT") {
  const payment = await prisma.payment.findFirst({
    where: { mpesaCheckoutRequestId: checkoutRequestId },
    include: { booking: true },
  });
  if (!payment || payment.booking.status !== "pending_payment") return null;
  await completeBookingPayment(payment.booking, payment, receipt, { simulated_stk: true });
  return payment.bookingId;
}
