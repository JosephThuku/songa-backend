# Songa Backend — Build Progress

Tracks per-stage outcomes for the staged backend build. Source of truth for "what's done, what passed, what's open." Updated after every stage.

Mobile app this backend serves: `../songa-mobile-app` (React Native / Expo). Canonical contract: `../songa-mobile-app/docs/backend-requirements.md`.

---

## Stage 1 — Foundation + Auth

Status: **complete** — 2026-05-23

Goal: runnable server, DB connected, OTP auth end-to-end.

### Built

- Full TypeScript + Express 4 + Prisma + MySQL + Redis (in-memory fallback) scaffold.
- Prisma models: `User`, `DriverProfile`, `OtpAttempt`, `Session` + enums `UserRole`, `OnboardingStatus`. Composite unique `(phone, role)`.
- Endpoints: `POST /api/auth/register`, `POST /api/auth/register/confirm`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` — register confirms phone via OTP; login uses phone/email + password.
- OTP storage: SHA-256(code + pepper) in Redis, 300s TTL, one-shot.
- Sessions: JWT (HS256, 30d) + DB-backed `Session` row keyed by `sha256(token)` for revocation. Web clients also get an HttpOnly `songa_session` cookie (UA-detected).
- Rate limits (Redis sliding window): 10/IP/min + 3/phone/15min on send, 5/phone/5min on verify.
- Error shape per §10 via single error middleware.
- Seed: 1 passenger (`+254712000001`, "John Doe") + 1 driver (`+254712345678`, "James Mwangi") with approved DriverProfile.

### Tests

22/22 passing. See `tests/auth.test.ts`.

### Mobile integration

See `MOBILE_INTEGRATION_NOTES.md`. Verdict: **needs minor mobile changes**, no blockers.

---

## Stage 2 — Ride Lifecycle

Status: **complete** — 2026-05-23

Goal: server-authoritative ride phase machine with append-only `RideEvent` audit log.

### Built

- Prisma: `Ride`, `RideEvent`, `Vehicle`, enums `RidePhase`, `BookingMode`, `RideEventActor`.
- Endpoints: `POST /api/rides/request`, `GET /api/rides/active`, `GET /api/rides/:rideId`, `POST /api/rides/:rideId/cancel|accept|decline|arrived|start|complete`.
- `src/lib/ride-machine.ts` mirrors mobile predicates; `src/lib/ride-booking-mode.ts` mirrors terminal vs pay-on-arrival rules.
- Idempotency on request/accept via `Idempotency-Key` header.

### Tests

6/6 passing. See `tests/rides.test.ts`.

---

## Stage 3 — Real-Time Ride Sync (SSE)

Status: **complete** — 2026-05-23

### Built

- `GET /api/rides/active/stream` — `text/event-stream` with `ride.updated`, `ride.ended`, comment heartbeats.
- In-process bus: `src/lib/ride-events.ts`.

### Tests

2/2 passing. See `tests/ride-stream.test.ts`.

---

## Stage 4 — Driver Location, Nearby, Dispatch

Status: **complete** — 2026-05-23

### Built

- `DriverProfile.location` + `locationUpdatedAt`.
- `PATCH /api/drivers/me/online`, `POST /api/drivers/me/location`, `GET /api/drivers/nearby`.
- Dispatch on ride request: nearby online drivers (or `preferredDriverId`), SSE `ride.offer` events.

### Tests

3/3 passing. See `tests/drivers.test.ts`.

---

## Stage 5 — Bookings and Payment Sessions

Status: **complete** — 2026-05-23

### Built

- Prisma: `Booking`, `Payment`, enums `BookingStatus`, `PaymentStatus`.
- `POST /api/bookings`, `POST /api/bookings/:id/pay`, `GET /api/bookings/:id`.
- Local deterministic checkout URL; prepaid ride requests validate `bookingId` + `paid` status.

### Tests

3/3 passing. See `tests/bookings.test.ts`.

---

## Stage 6 — Driver Wallet Ledger

Status: **complete** — 2026-05-23

### Built

- Prisma: `WalletTransaction` append-only ledger.
- Trip completion credits `max(0, price - 50)` KES.
- `GET /api/drivers/me/wallet`, `POST /api/drivers/me/wallet/cashout`.

### Tests

2/2 passing. See `tests/wallet.test.ts`.

---

## Stage 7 — Notifications and Device Tokens

Status: **complete** — 2026-05-23

### Built

- Prisma: `Notification`, `Device`.
- `GET /api/notifications?limit=30`, `POST /api/devices` (push token upsert).
- Triggers: `ride_offer` on dispatch, `ride_update` on accept / arrived / trip completed.

### Tests

2/2 passing. See `tests/notifications.test.ts`.

---

## Test suite (all stages)

**40 tests** across 7 files. Run: `npm test` (loads `.env.test`, auto `prisma db push` to `songa_test` in `tests/setup.ts`).

| File | Tests |
|------|-------|
| `tests/auth.test.ts` | 22 |
| `tests/rides.test.ts` | 6 |
| `tests/drivers.test.ts` | 3 |
| `tests/bookings.test.ts` | 3 |
| `tests/ride-stream.test.ts` | 2 |
| `tests/wallet.test.ts` | 2 |
| `tests/notifications.test.ts` | 2 |

---

## Open / deferred

- **Wasiliana SMS**: placeholder HTTP adapter; finalize when API docs are available (`src/lib/sms.wasiliana.ts`).
- **Flutterwave**: Stage 5 uses local checkout URLs; wire real provider when env vars are set.
- **FCM/APNs push delivery**: device tokens stored; outbound push not wired yet.
- **Prisma migrations**: schema managed via `db push` for now; add versioned migrations before production deploy.
- **OAuth legacy mobile paths**: still out of scope per Stage 1 plan.
