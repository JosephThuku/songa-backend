import cuid from "cuid";
import { Prisma } from "@prisma/client";
import { AppError } from "../lib/errors.js";
import { computeFare, PLATFORM_FEE_KES } from "../lib/ride-pricing.js";
import { prisma } from "../lib/prisma.js";
import type { PlaceDto } from "../lib/responses.js";
import { isMpesaConfigured } from "../config/mpesa.js";
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
}

function placeJson(place: PlaceDto): Prisma.InputJsonObject {
  return {
    ...(place.placeId ? { placeId: place.placeId } : {}),
    label: place.label,
    lat: place.lat,
    lng: place.lng,
  };
}

function subtotal(input: CreateBookingInput): number {
  const fare = computeFare(input.pickup, input.dropoff);
  return fare.total * Math.max(1, input.seats.length);
}

const bookingInclude = { payments: { orderBy: { createdAt: "desc" as const }, take: 1 } };

export async function createBooking(input: CreateBookingInput) {
  if (input.seats.length === 0) throw new AppError("INVALID_INPUT", 400, "At least one seat is required.");
  const bookingSubtotal = subtotal(input);
  const booking = await prisma.booking.create({
    data: {
      id: `BKG-${cuid()}`,
      passengerId: input.passengerId,
      tripId: input.tripId ?? null,
      seats: input.seats.join(","),
      subtotal: bookingSubtotal,
      platformFee: PLATFORM_FEE,
      total: bookingSubtotal + PLATFORM_FEE,
      pickup: placeJson(input.pickup),
      dropoff: placeJson(input.dropoff),
    },
    include: bookingInclude,
  });
  return toBookingDto(booking);
}

export async function startPayment(input: StartPaymentInput) {
  const { bookingId, passengerId, provider, phone } = input;
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: bookingInclude });
  if (!booking || booking.passengerId !== passengerId) {
    throw new AppError("BOOKING_NOT_FOUND", 404, "Booking not found.");
  }
  if (booking.status !== "pending_payment") {
    throw new AppError("INVALID_BOOKING_STATUS", 409, "Booking is not pending payment.");
  }

  const reference = booking.id.replace(/^BKG-/, "").slice(0, 12).toUpperCase() || `SONGA${cuid().slice(0, 8)}`;

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

  if (provider === "mpesa") {
    if (!isMpesaConfigured()) {
      throw new AppError("MPESA_NOT_CONFIGURED", 503, "M-Pesa is not configured on this server.");
    }
    if (!phone?.trim()) {
      throw new AppError("PHONE_REQUIRED", 400, "Phone number is required for M-Pesa payment.");
    }

    const mpesa = new MpesaService();
    const amount = Math.round(booking.total);
    const result = await mpesa.stkPush({
      amount,
      phone: phone.trim(),
      accountReference: reference,
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
        reference,
        mpesaCheckoutRequestId: checkoutRequestId,
        gatewayResponse: {
          stk_init: data,
          phone: phone.trim(),
        } as Prisma.InputJsonValue,
      },
    });

    return {
      payment: toPaymentDto(payment),
      message: "Check your phone for the M-Pesa prompt and enter your PIN.",
    };
  }

  const checkoutUrl = `https://payments.songa.local/checkout/${bookingId}?ref=${payment.reference}`;
  payment = await prisma.payment.update({
    where: { id: payment.id },
    data: { checkoutUrl },
  });

  return {
    payment: toPaymentDto(payment),
    message: "Complete payment using the checkout link.",
  };
}

export async function getBooking(bookingId: string, passengerId: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: bookingInclude });
  if (!booking || booking.passengerId !== passengerId) {
    throw new AppError("BOOKING_NOT_FOUND", 404, "Booking not found.");
  }
  return { booking: toBookingDto(booking) };
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
    seats: booking.seats ? booking.seats.split(",").map((seat) => Number.parseInt(seat, 10)) : null,
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

function toPaymentDto(payment: {
  id: string;
  bookingId: string;
  provider: string;
  status: string;
  checkoutUrl: string | null;
  reference: string;
  mpesaCheckoutRequestId?: string | null;
  transactionRef?: string | null;
  createdAt: Date;
}) {
  return {
    id: payment.id,
    bookingId: payment.bookingId,
    provider: payment.provider,
    status: payment.status,
    checkoutUrl: payment.checkoutUrl,
    reference: payment.reference,
    mpesaCheckoutRequestId: payment.mpesaCheckoutRequestId ?? null,
    transactionRef: payment.transactionRef ?? null,
    createdAt: payment.createdAt.toISOString(),
  };
}

/** Test / admin helper — simulate STK success without Safaricom. */
export async function simulateMpesaPaymentSuccess(checkoutRequestId: string, receipt = "SIMRECEIPT") {
  const payment = await prisma.payment.findFirst({
    where: { mpesaCheckoutRequestId: checkoutRequestId, status: "pending" },
    include: { booking: true },
  });
  if (!payment) return null;
  await completeBookingPayment(payment.booking, payment, receipt, { simulated_stk: true });
  return payment.bookingId;
}
