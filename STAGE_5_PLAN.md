# Stage 5 — Bookings and Payment Sessions

## 1. Goal

Support prepaid seat-selection rides by creating a booking, starting a server-side payment session, polling booking status, and validating `prepaid: true` ride requests against paid bookings.

## 2. Prisma schema

New enums:

```prisma
enum BookingStatus { pending_payment paid failed cancelled }
enum PaymentStatus { pending succeeded failed }
```

New models:

```prisma
model Booking {
  id          String @id
  passengerId String
  status      BookingStatus @default(pending_payment)
  seats       String?
  subtotal    Int
  platformFee Int @default(50)
  total       Int
  currency    String @default("KES")
  pickup      Json
  dropoff     Json
  payments    Payment[]
}

model Payment {
  id          String @id
  bookingId   String
  provider    String
  status      PaymentStatus @default(pending)
  checkoutUrl String?
  reference   String @unique
}
```

## 3. Endpoints

### POST `/api/bookings`

Passenger only. Creates a pending booking for seat checkout.

### POST `/api/bookings/{id}/pay`

Passenger only. Creates a payment session. Stage 5 uses a deterministic local checkout URL unless Flutterwave env vars are added later.

### GET `/api/bookings/{id}`

Passenger only. Returns current booking and last payment.

## 4. Ride integration

`POST /api/rides/request` with `prepaid: true` must include `bookingId` and the booking must:

- exist
- belong to the passenger
- have `status === "paid"`

Otherwise reject with `409 BOOKING_NOT_PAID`.

## 5. Tests

- Passenger creates booking with seats and gets `pending_payment` totals.
- Passenger starts payment and gets checkout URL + pending payment.
- GET booking returns status and payment.
- Prepaid ride request with unpaid booking gets `409 BOOKING_NOT_PAID`.
- Prepaid ride request with paid booking succeeds.
- Other passenger cannot read booking.

