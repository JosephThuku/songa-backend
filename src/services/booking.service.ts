import cuid from "cuid";
import { Prisma } from "@prisma/client";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import type { PlaceDto } from "../lib/responses.js";

const PLATFORM_FEE = 50;

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

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthKm = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthKm * Math.asin(Math.sqrt(h));
}

function subtotal(input: CreateBookingInput): number {
  const base = Math.max(200, Math.round(distanceKm(input.pickup, input.dropoff) * 100));
  return base * Math.max(1, input.seats.length);
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

