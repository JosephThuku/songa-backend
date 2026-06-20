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
