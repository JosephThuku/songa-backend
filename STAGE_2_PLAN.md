# Stage 2 — Ride Lifecycle (core state machine, no real-time yet)

## 1. Goal

Persist and enforce the ride phase machine end-to-end. After this stage, a passenger can request a ride, a driver can accept / decline / mark arrived / start / complete, a passenger can cancel within the valid window, and the system rejects every invalid transition with the correct error code. Phase transitions append to an append-only `RideEvent` log for audit and future analytics. No WebSocket / SSE yet — that's Stage 3.

## 2. Mobile contracts touched

| File | Symbol(s) the backend must satisfy |
|------|------------------------------------|
| `lib/ride-request.ts` | The 8 `RideRequestPhase` values; predicate functions `canPassengerCancelTrip`, `canDriverAcceptOffer`, `canDriverStartTrip`, `canDriverEndTrip`, `isTerminalPhase`. |
| `lib/active-trip-store.ts` | The `ActiveTrip` shape — every field name must be derivable from our ride DTO. |
| `lib/trip-booking-rules.ts` | `TERMINAL_PATTERNS` regex set, `getTripBookingMode(trip)`. Backend re-implements this server-side. |
| `lib/trip-cancel-reasons.ts` | The 6 valid `reasonId` values + 'other' requires detail (min 3 chars). |
| `hooks/use-ride-request.ts` | Currently simulates phase progression client-side (28s fallback accept, 2.8s tick). To be replaced with backend phase updates over WebSocket (Stage 3). |
| `hooks/use-driver-ride-progress.ts` | Same — driver-side simulation, replaced in Stage 3. |
| `data/mock-songa.json` | Trip and vehicle shapes used to seed and populate ride responses. |

**Contract gaps to flag** (mobile-integrator will detail):
1. Mobile's `ActiveTrip` is FLAT (`driverName`, `vehicle`, `passengerName`); requirements §3.5 is NESTED (`driver: {…}`, `vehicle: {…}`, `passenger: {…}`). Backend ships §3.5 — mobile needs an adapter or full type swap.
2. Mobile uses fields not in §3.5 like `passengerName` on the trip object — those come from §3.5's `passenger.name`.
3. Mobile drives phase progression locally via timers — this MUST be removed once Stage 3 ships, otherwise client-side ETA will drift from server truth.

## 3. Prisma schema diff

```prisma
// NEW — ride lifecycle enums

enum RidePhase {
  finding_driver
  driver_accepted
  driver_en_route
  driver_arriving
  driver_arrived
  trip_in_progress
  trip_ended
  cancelled
}

enum BookingMode {
  seat_selection
  pay_on_arrival
}

enum RideEventActor {
  passenger
  driver
  system
}

// CHANGE — add ride relations to User

model User {
  // ... existing fields unchanged ...
  passengerRides Ride[] @relation("PassengerRides")  // NEW
  driverRides    Ride[] @relation("DriverRides")     // NEW
  rideEvents     RideEvent[]                          // NEW
}

// CHANGE — DriverProfile gains a Vehicle relation

model DriverProfile {
  // ... existing fields unchanged except vehicleId already there ...
  vehicle Vehicle? @relation(fields: [vehicleId], references: [id])  // NEW
}

// NEW — vehicle model (matches backend-requirements.md §6.5 sample)

model Vehicle {
  id           String   @id @default(cuid())
  type         String   // "Car" | "Van" | "Minibus" | "Bike" | "Tuktuk"
  make         String
  model        String
  registration String   @unique
  color        String
  year         String?
  seats        Int      @default(4)
  status       String   @default("Activated") // "Activated" | "Pending" | "Suspended"
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  driverProfiles DriverProfile[]
}

// NEW — Ride

model Ride {
  id               String       @id    // prefix: "ride_<cuid>"
  tripId           String?      // optional link to a Trip listing (Stage 4)
  passengerId      String
  passenger        User         @relation("PassengerRides", fields: [passengerId], references: [id])
  driverId         String?
  driver           User?        @relation("DriverRides", fields: [driverId], references: [id])
  phase            RidePhase    @default(finding_driver)
  bookingMode      BookingMode
  prepaid          Boolean      @default(false)
  price            Int          // KSh, whole shillings
  currency         String       @default("KES")
  etaMinutes       Int?
  distanceKm       Float?
  driverProgress   Float        @default(0)
  passengerBoarded Boolean      @default(false)
  seats            String?      // e.g. "3,4"
  pickup           Json         // { placeId?, label, lat, lng }
  dropoff          Json         // { placeId?, label, lat, lng }
  driverLocation   Json?        // { lat, lng, heading?, speed?, updatedAt }
  cancelReason     Json?        // { reasonId, reasonLabel, detail? }
  cancelledByRole  RideEventActor?
  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt
  events           RideEvent[]

  // Decline list — drivers who declined this ride. Used by Stage 4 dispatch.
  declinedBy       String  @default("[]") @db.Text  // JSON array of driver user ids

  @@index([passengerId, phase])
  @@index([driverId, phase])
  @@index([phase, createdAt])
}

// NEW — append-only ride event log

model RideEvent {
  id        String         @id @default(cuid())
  rideId    String
  ride      Ride           @relation(fields: [rideId], references: [id], onDelete: Cascade)
  actor     RideEventActor
  actorId   String?
  user      User?          @relation(fields: [actorId], references: [id], onDelete: SetNull)
  action    String         // 'ride.requested' | 'driver.accepted' | 'driver.declined' | 'driver.arrived' | 'trip.started' | 'trip.ended' | 'ride.cancelled' | 'driver.online' | 'driver.offline'
  phase     RidePhase
  metadata  Json?
  at        DateTime       @default(now())

  @@index([rideId, at])
}
```

Migration name suggestion: `0002_ride_lifecycle`.

`declinedBy` is a text-column JSON array (no Postgres-array luxury on MySQL). Helper functions in `src/lib/ride-decline.ts` will (parse → push → stringify) atomically inside a transaction.

## 4. Folder layout (new files)

```
prisma/
└── schema.prisma                  # CHANGED
└── seed.ts                        # CHANGED — adds 1 Vehicle, links to driver

src/
├── lib/
│   ├── ride-machine.ts            # NEW — pure phase transition predicates
│   ├── ride-booking-mode.ts       # NEW — TERMINAL_PATTERNS, getBookingMode()
│   ├── idempotency.ts             # NEW — withIdempotency() helper, Redis-backed 24h store
│   └── ride-decline.ts            # NEW — parse/append/contains helpers for declinedBy JSON
├── middleware/
│   └── require-ride-party.ts      # NEW — checks req.user is passenger OR driver on the ride
├── routes/
│   ├── rides.ts                   # NEW — /api/rides/*
│   └── drivers.ts                 # NEW — /api/drivers/*
├── services/
│   ├── ride.service.ts            # NEW — requestRide, getActive, cancel, accept, decline, arrived, start, complete
│   └── driver.service.ts          # NEW — setOnline
├── schemas/
│   ├── ride.schema.ts             # NEW — request bodies, response shape, OpenAPI path registrations for 9 ride endpoints
│   └── driver.schema.ts           # NEW — online toggle schema + OpenAPI path
└── lib/responses.ts               # CHANGED — add toRideDto(), toDriverEmbedDto(), toVehicleEmbedDto(), toPassengerEmbedDto()
```

## 5. Endpoint contracts

All ride endpoints require auth (Bearer or cookie). Authorization rules per endpoint below.

### POST `/api/rides/request` (passenger)

Body (Zod):
```jsonc
{
  "tripId": "trip-4",                 // optional, links to a Trip listing
  "pickup":  { "placeId": "ChIJ…", "label": "JKIA Terminal 1A", "lat": -1.3192, "lng": 36.9278 },
  "dropoff": { "placeId": "ChIJ…", "label": "Westlands",         "lat": -1.2674, "lng": 36.8070 },
  "seats":   [3, 4],                  // optional, only valid when bookingMode resolves to seat_selection
  "prepaid": false,                   // when true, must include bookingId; means a Booking row already covers payment
  "bookingId": "BKG-001",            // optional, set when prepaid: true
  "paymentMethod": null               // optional, "mpesa" | "card" | null (cash)
}
```

Response 201:
```jsonc
{
  "ride": { /* full ride shape — see §3.5 in requirements doc */ }
}
```

Side effects:
- Compute `bookingMode` from pickup/dropoff labels (see §6).
- Persist `Ride` row (phase=finding_driver, price derived from distance/seats or 1200 default for Stage 2 — proper pricing is Stage 8), serialize seats array to "3,4" string.
- Insert `RideEvent { action: 'ride.requested', actor: passenger, phase: finding_driver }`.
- Reject if the passenger already has an active (non-terminal) ride — 409 `RIDE_ALREADY_ACTIVE`.

**Idempotency-Key** header supported. Key namespace: `rides.request`.

Errors: 400 `INVALID_INPUT`, 409 `RIDE_ALREADY_ACTIVE`, 409 `SEATS_REQUIRED` (bookingMode=seat_selection but no seats), 401 `UNAUTHORIZED`.

### GET `/api/rides/active`

Returns the current non-terminal ride for the calling user (passenger or driver). If none, returns `{ "ride": null }`.

Response 200: `{ "ride": <RideDto> | null }`.

### GET `/api/rides/{rideId}`

Returns the ride if the calling user is the passenger or the assigned driver. Otherwise 404 (do not leak existence).

Response 200: `{ "ride": <RideDto> }`.

Errors: 404 `RIDE_NOT_FOUND`.

### POST `/api/rides/{rideId}/cancel` (passenger)

Body:
```jsonc
{ "reasonId": "wait_too_long", "reasonLabel": "Wait time is too long", "detail": null }
```
- `reasonId` must be one of: `plans_changed`, `wait_too_long`, `found_another`, `wrong_location`, `driver_asked`, `other`.
- `reasonLabel` must match the label for that id (or backend re-derives it from id — implementer choice; either way reject if id/label disagree).
- If `reasonId === "other"` → `detail` is required, min 3 trimmed chars.

Allowed only from: `finding_driver`, `driver_accepted`, `driver_en_route`, `driver_arriving`.

Response 200: `{ "ride": <RideDto> }` with `phase: "cancelled"`, `cancelReason` populated.

Errors: 400 `INVALID_INPUT`, 404 `RIDE_NOT_FOUND`, 409 `RIDE_NOT_CANCELLABLE` (details: `{ phase }`).

### POST `/api/rides/{rideId}/accept` (driver)

Body: none.

Allowed only when:
- phase === finding_driver
- caller is a driver with `DriverProfile.onboardingStatus === "approved"`
- caller has NOT declined this ride (decline list check)
- caller is not already on another active ride

On success: set `driverId = caller`, phase = `driver_accepted`, etaMinutes = 8 default, distanceKm = 3.4 default (proper values from Google routes API in Stage 8), append `RideEvent { action: 'driver.accepted' }`.

Response 200: `{ "ride": <RideDto> }`.

**Idempotency-Key** header supported. Key namespace: `rides.accept`.

Errors: 404 `RIDE_NOT_FOUND`, 409 `OFFER_EXPIRED` (phase moved), 403 `DRIVER_NOT_APPROVED`, 409 `DRIVER_BUSY` (already on active ride), 409 `OFFER_DECLINED` (caller previously declined this ride).

### POST `/api/rides/{rideId}/decline` (driver)

Body: none.

Allowed only when phase === finding_driver AND ride has no `driverId` yet.

On success: append caller's id to `Ride.declinedBy` JSON array, insert `RideEvent { action: 'driver.declined' }`. No phase change. Stage 4 dispatch worker reads `declinedBy` to avoid re-offering.

Response 200: `{ "ok": true }`.

Errors: 404 `RIDE_NOT_FOUND`, 409 `OFFER_EXPIRED`.

### POST `/api/rides/{rideId}/arrived` (driver)

Allowed when phase ∈ { driver_accepted, driver_en_route, driver_arriving } AND caller === ride.driverId.

On success: phase → `driver_arrived`, etaMinutes = 0, distanceKm = 0, `RideEvent { action: 'driver.arrived' }`.

Response 200: `{ "ride": <RideDto> }`.

Errors: 404 `RIDE_NOT_FOUND`, 409 `INVALID_PHASE` (details: `{ from, allowed }`).

### POST `/api/rides/{rideId}/start` (driver)

Allowed when phase === `driver_arrived` AND caller === ride.driverId.

On success: phase → `trip_in_progress`, passengerBoarded = true, `RideEvent { action: 'trip.started' }`.

Response 200: `{ "ride": <RideDto> }`.

Errors: 404 `RIDE_NOT_FOUND`, 409 `INVALID_PHASE`.

### POST `/api/rides/{rideId}/complete` (driver)

Allowed when phase === `trip_in_progress` AND caller === ride.driverId.

On success: phase → `trip_ended`, driverProgress = 1, `RideEvent { action: 'trip.ended' }`. Wallet credit (Stage 6) NOT triggered here yet.

Response 200: `{ "ride": <RideDto> }`.

Errors: 404 `RIDE_NOT_FOUND`, 409 `INVALID_PHASE`.

### PATCH `/api/drivers/me/online` (driver)

Body: `{ "isOnline": true }`.

Side effects: update `DriverProfile.isOnline`, set `onlineSince = now()` when going from false→true (else null), insert `RideEvent` is NOT applied (this is on the driver, not a ride). Instead we'll add a `DriverEvent` log in Stage 4 if needed.

Response 200: `{ "isOnline": true, "onlineSince": "2025-05-22T14:00:00.000Z" }`.

Errors: 401 `UNAUTHORIZED`, 403 `DRIVER_NOT_APPROVED`.

## 6. Business rules & invariants

- **Phase machine** lives in `src/lib/ride-machine.ts`. Single source of truth — every service checks transitions via `canTransition(from, to)` or `allowedActions(phase)`.
- **Booking mode**: regex set `[/\bairport\b/i, /\bjkia\b/i, /\bwilson\b/i, /\bsgr\b/i, /\bterminal\b/i, /\bterminus\b/i]`. If pickup OR dropoff label matches any → `seat_selection`. Else `pay_on_arrival`. Live in `src/lib/ride-booking-mode.ts`; tests cover the exact patterns from the mobile rules file.
- **Cancel reasons** validated against a server-side allowlist of the 6 ids. Hard-coded; if mobile adds more, mobile and backend must update together.
- **One active ride per user** (per role): a passenger cannot request a ride while they already have a non-terminal ride; a driver cannot accept while they already have a non-terminal one.
- **Idempotency**: `withIdempotency(req, namespace, handler)` reads `Idempotency-Key` header, returns cached response if present (24h TTL). Cache key: `idemp:{namespace}:{userId}:{key}`.
- **Ride event log** is append-only — never updated or deleted. One row per phase transition + ride.requested + driver.declined.
- **Phone masking** (per §12): passenger phone visible in DTOs only when phase ≥ `driver_accepted` AND the caller is the driver on the ride. Otherwise omit or null-out.
- **Driver location** is excluded from the response in Stage 2 (Stage 3 wires the location update + broadcast). Field exists in DB.

## 7. Open questions & defaults

- **Price computation**: spec doesn't say. Default for Stage 2: pickup-dropoff straight-line distance × 100 KSh/km, floor to whole KES, minimum 200 KSh. Proper Google-routes-based estimate is Stage 8. Logged in PROGRESS.md.
- **`paymentMethod`**: stored on Ride row as nullable string. Real Flutterwave wiring is Stage 5.
- **`prepaid: true` validation**: when prepaid, require `bookingId` — verify the Booking row exists and `status === "paid"` AND belongs to the passenger. Stage 5 owns Booking; until then, accept prepaid: true blindly with a TODO comment.
- **Driver decline = re-offer in Stage 2?** No dispatch yet, so decline just records. Stage 4 reads `declinedBy` to skip when offering.

## 8. Test list (tester input)

In `tests/rides.test.ts`:

### Happy path
- Passenger requests → ride created in `finding_driver` with correct bookingMode (test both terminal and non-terminal pickups).
- Driver accepts → phase → `driver_accepted`, driverId set, RideEvent appended.
- Driver hits `/arrived` → phase → `driver_arrived`.
- Driver hits `/start` → phase → `trip_in_progress`, passengerBoarded = true.
- Driver hits `/complete` → phase → `trip_ended`, driverProgress = 1.
- RideEvent log contains the 5 expected rows in order.

### Phase enforcement
- Cancel from each of: finding_driver, driver_accepted, driver_en_route, driver_arriving → 200.
- Cancel from driver_arrived → 409 `RIDE_NOT_CANCELLABLE`.
- Cancel from trip_in_progress → 409 `RIDE_NOT_CANCELLABLE`.
- Cancel from trip_ended → 409 `RIDE_NOT_CANCELLABLE`.
- Accept on already-accepted ride → 409 `OFFER_EXPIRED`.
- Start without arrival → 409 `INVALID_PHASE`.
- Complete without start → 409 `INVALID_PHASE`.

### Booking mode
- pickup="JKIA Terminal 1A", dropoff="Westlands" → seat_selection.
- pickup="Westlands", dropoff="Kilimani" → pay_on_arrival.
- pickup="SGR terminus", dropoff="Karen" → seat_selection.

### Cancel reasons
- reasonId 'other' without detail → 400 `INVALID_INPUT`.
- reasonId 'other' with 2-char detail → 400 `INVALID_INPUT`.
- reasonId 'other' with 3-char detail → 200.
- Unknown reasonId → 400 `INVALID_INPUT`.

### Authorization
- Passenger A cannot cancel passenger B's ride → 404 `RIDE_NOT_FOUND` (mask existence).
- Driver who isn't on the ride cannot hit `/arrived` → 404 or 409.
- Random user hitting GET `/rides/{otherId}` → 404.

### Idempotency
- Two POST `/rides/request` with same `Idempotency-Key` from same passenger → second returns the same ride id, no second DB row.
- Two POST `/rides/{id}/accept` with same key → same idempotent response.
- Different key → second request gets 409 `RIDE_ALREADY_ACTIVE`.

### Driver online
- PATCH `/drivers/me/online` with `{isOnline:true}` → 200, profile.isOnline = true, onlineSince set.
- PATCH `/drivers/me/online` with `{isOnline:false}` → 200, profile.isOnline = false.
- Passenger trying PATCH → 403.

## 9. Out of scope for Stage 2

- WebSocket / SSE / real-time event emissions (Stage 3).
- Dispatch worker — automatic offering of `finding_driver` rides to nearby drivers (Stage 4).
- ETA / distance updates from driver GPS (Stage 3).
- Real Booking + payment verification on `prepaid: true` (Stage 5).
- Wallet credit on trip end (Stage 6).
- SMS / push notifications on phase changes (Stage 7).
