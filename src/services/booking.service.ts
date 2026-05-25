import cuid from "cuid";
import { Prisma } from "@prisma/client";
import { AppError } from "../lib/errors.js";
import { computeFare, PLATFORM_FEE_KES } from "../lib/ride-pricing.js";
import { prisma } from "../lib/prisma.js";
import type { PlaceDto } from "../lib/responses.js";

const PLATFORM_FEE = PLATFORM_FEE_KES;

export interface CreateBookingInput {
  passengerId: string;
  tripId?: string;
  pickup: PlaceDto;
  dropoff: PlaceDto;
  seats: number[];
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

export async function startPayment(bookingId: string, passengerId: string, provider: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: bookingInclude });
  if (!booking || booking.passengerId !== passengerId) throw new AppError("BOOKING_NOT_FOUND", 404, "Booking not found.");
  if (booking.status !== "pending_payment") {
    throw new AppError("INVALID_BOOKING_STATUS", 409, "Booking is not pending payment.");
  }
  const reference = `pay_${cuid()}`;
  const payment = await prisma.payment.create({
    data: {
      id: `pay_${cuid()}`,
      bookingId,
      provider,
      reference,
      checkoutUrl: `https://payments.songa.local/checkout/${bookingId}?ref=${reference}`,
    },
  });

  if (process.env.ALLOW_DEV_PAYMENT_CONFIRM === "true") {
    await prisma.booking.update({
      where: { id: bookingId },
      data: { status: "paid" },
    });
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "succeeded" },
    });
  }

  return { payment: toPaymentDto(payment) };
}

export async function getBooking(bookingId: string, passengerId: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: bookingInclude });
  if (!booking || booking.passengerId !== passengerId) throw new AppError("BOOKING_NOT_FOUND", 404, "Booking not found.");
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
  createdAt: Date;
}) {
  return {
    id: payment.id,
    bookingId: payment.bookingId,
    provider: payment.provider,
    status: payment.status,
    checkoutUrl: payment.checkoutUrl,
    reference: payment.reference,
    createdAt: payment.createdAt.toISOString(),
  };
}

