# Shared rides — backlog

Items intentionally **not** in the current “finish shared rides” PR unless noted.

---

## Driver / Songa billing (product TBD)

Detailed payment, wallet, cashout, and subscription issues now live in
[payments-wallet-subscriptions.md](./payments-wallet-subscriptions.md).

**Mobile (Joseph):** Shared checkout = **fare only**. No +50 KES, no platform-fee line. Use `booking.total`; `platformFee` is always `0` on `shared_sgr`.

**Today (backend):**

| What | Status |
|------|--------|
| Passenger pays (shared) | Seat fare only — `subtotal` = `total`, `platformFee` = **0** |
| Driver wallet on shared prepay | **Live** — full `subtotal` credited when booking is paid |
| Songa debit / holdback | **Not implemented** |

**Under discussion (not for this PR):**

| Option | Sketch |
|--------|--------|
| **Daily subscription** | Flat fee per calendar day from driver wallet (e.g. ~150 KES/day, amount TBD). |
| **Holdback + weekly payout** | Retain ~10% on each **in-app paid** trip (shared prepay + on-demand paid in app), weekly settlement to driver, minus daily subscription fee. |

Open product questions:

- Same rules for shared van + on-demand in-app, or different?
- Cash / walk-up trips excluded?
- Debit timing, empty wallet, negative balance, first-day grace.

`SHARED_RIDES_DRIVER_HOLDBACK_PERCENT` env is **not** the agreed shared model today (default 0).

On-demand `/api/rides/*` may still expose `platformFee: 50` in fare/booking JSON — separate from shared; passenger UX may change when billing option B ships.

---

## Call-in handoff to another driver

When driver A’s van is full, refer caller to driver B who publishes/joins a trip and sends call-in pay link.

**Status:** backlog — after single-driver call-in is live.

---

## Private ride CTA from shared flow

**Dropped** — passengers use existing `/api/rides/*` from Home.

---

## Departure vehicle snapshot — done in API

- `SharedDeparture.vehicleId` set on publish/join from driver’s registered vehicle.
- Eligibility: default min **8** bookable seats, types **Van** / **Minibus** (`SHARED_RIDES_MIN_BOOKABLE_SEATS`, `SHARED_RIDES_ALLOWED_VEHICLE_TYPES`).

---

## Implemented in current PR (for reference)

- Pickup pin + van GPS on departure  
- Expired seat hold sweep (5 min) + `npm run shared-rides:release-expired-holds`  
- Seat labels (A1…) from `Vehicle.seatLayout`  
- Driver **call-in booking** + guest pay link (no login; no SMS password)  
- Driver wallet credit on shared prepay (full seat subtotal, no per-booking Songa skim)  

---

## P0: STK retry breaks on `Payment.reference` unique constraint (confirmed in logs)

**Observed (2026-06-24, booking `BKG-cmqs8q3hi000h4yamb14hd9ri`):**

```
POST /api/bookings/.../pay → 409
prisma:error Unique constraint failed on the constraint: `Payment_reference_key`
```

**Root cause:** `startPayment()` sets `Payment.reference` to the same booking-derived slug (`CMQS8Q3HI000`) on every STK attempt. After the first attempt (even if `payment.status = failed`), that reference is taken. Retries create a new `Payment` row, STK is sent to Safaricom, then the final `payment.update({ reference })` **throws** → API returns 409.

**Side effects:**

- User receives STK on phone while API returns 409 (STK sent before DB update).
- Callback arrives (`ResultCode: 0`, receipt e.g. `UFOE48XOR5`) but `stk.callback.unmatched` — `mpesaCheckoutRequestId` was never saved.
- Passenger stuck on checkout; money may be taken with booking still `pending_payment`.

**Fix direction:**

- Keep `Payment.reference` unique per row (`pay_${cuid}`); use booking slug only as M-Pesa `accountReference` (non-unique field or separate column).
- On retry, reuse failed pending payment row or clear/rename reference on failed payments.
- If STK push succeeds but DB update fails, log critical alert and reconcile.

**Acceptance:** Three `POST …/pay` retries on same booking after cancel do not 409; success callback marks booking `paid`.

---

## P0: Checkout does not recover when pay fails or booking already paid

**Observed:** No `GET /api/bookings/:id` in logs during 409 session — client never polls because `payBooking` throws before `waitForPaidBooking`.

**Fix direction (client):**

- Before `POST …/pay`: `GET /bookings/:id` — if `paid`, go to success.
- On checkout mount / tab focus: background poll `pendingBookingId`.
- On 409 `INVALID_BOOKING_STATUS` or pay error: refresh booking and branch (paid vs still pending).

---

## P1: Orphan STK callbacks (`stk.callback.unmatched`)

**Observed:** Success callback `ResultCode: 0` logged but `STK callback: no pending payment` because lookup is `status: pending` only and/or `checkoutRequestId` not persisted.

**Fix direction:**

- Match callback by `mpesaCheckoutRequestId` regardless of status when booking still `pending_payment`.
- Idempotent `completeBookingPayment` when booking already `paid`.
- Log `bookingId`, `paymentId`, `resultCode` on unmatched (partially done via `M-Pesa payment trace`).

---

## P1: Driver / passenger seat map stale until manual refresh

**Observed:** After payment, `GET /departures/:id` etag unchanged (`44d`, len 1101) for many polls; driver UI still shows pending until refresh.

**Fix direction:**

- Push or poll driver departure detail after `completeBookingPayment` (socket event or shorter poll on driver screen).
- Invalidate departure cache on passenger success step.
- Ensure `GET /departures/:id` returns updated seat `status: paid` immediately after callback.

---

## P2: Real-time sync across shared-rides flows

**Scope:** Seat selection holds, booking creation, payment, and driver manifest should reflect within ~2s on both apps without manual refresh.

**Includes:** checkout recovery poll, driver departure poll interval, optional websocket `departure.updated` / `seat.paid` events.
