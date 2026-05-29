# Mobile Integration Notes

Updated after ride search, Uber-style pricing, and vehicle enforcement.

## Realtime transport

| Layer | Implementation |
|--------|----------------|
| **Backend** | Socket.io on `/socket.io` (JWT in handshake) + SSE fallback `GET /api/rides/active/stream` |
| **Mobile** | `socket.io-client` in `lib/realtime-client.ts`; `hooks/use-ride-sync.ts` |
| **Events** | `ride.updated`, `ride.offer` (drivers), `ride.ended`, `ride.cancelled` |
| **Resync** | On connect/reconnect: `GET /api/rides/active` |

## Passenger ride flow (primary)

1. **Places autocomplete** — Google/Mapbox on device (not Songa API).
2. **`POST /api/rides/search`** — `{ pickup, dropoff }` -> `{ options: [{ optionId, vehicleType, label, available, pickupEtaMinutes, priceAmount }] }`.
3. User selects tier (e.g. `optionId: "car"`).
4. **`POST /api/rides/request`** — `{ optionId, pickup, dropoff, seats?, ... }` -> `{ ride }`.
5. Socket `ride.updated` through trip.

## Driver flow

| Step | API |
|------|-----|
| Register vehicle (once) | `POST /api/drivers/me/vehicle` |
| Go online | `PATCH /api/drivers/me/online` `{ isOnline: true }` — requires linked vehicle |
| GPS while online | `POST /api/drivers/me/location` every 10–15s |
| Incoming request | Socket `ride.offer` |
| Accept / trip actions | `POST /api/rides/:id/accept` etc. |

## Wired in mobile app

| Feature | Mobile files | Backend endpoints |
|---------|--------------|-------------------|
| Password auth | `lib/_core/api.ts`, login/signup/otp-verify | Auth routes |
| **Search rides** | `ride-flow-overlay.tsx`, `lib/ride-api.ts` | `POST /api/rides/search` |
| **Vehicle register** | `register-vehicle-sheet.tsx`, `driver-onboarding.tsx` | `POST /api/drivers/me/vehicle` |
| **ride.cancelled** | `lib/realtime-client.ts`, `hooks/use-ride-sync.ts` | Socket `ride.cancelled` |
| Request / cancel ride | `ride-flow-overlay.tsx`, `ride-api.ts` | `POST /api/rides/request`, `.../cancel` |
| Live ride state | `use-ride-sync.ts` | Socket.io + `GET /api/rides/active` |
| Driver online | `driver-session-store.ts` | `PATCH /api/drivers/me/online` |
| Driver GPS | `use-driver-location.ts` | `POST /api/drivers/me/location` |
| Driver offers | driver home + socket | `ride.offer` |

## Env (mobile)

```bash
EXPO_PUBLIC_API_BASE_URL=http://localhost:4000
```

Physical device: use LAN IP, not `localhost`.

Optional: `EXPO_PUBLIC_USE_MOCKS=1` restores `mock-songa.json` passenger trip cards (off by default).

## Pricing

Server-only Uber-style formula (`base + km + min + fee`, min 200 KES). Same price on search `options[].priceAmount` and `ride.price` on request. Client never sends price.

## Mobile changes applied — 2026-05-23

- `lib/ride-api.ts` — `searchRides`, `registerVehicle`, default `optionId: car` on request
- `lib/realtime-client.ts` — `ride.cancelled`, JWT in `handshake.auth.token` (all platforms)
- `hooks/use-ride-sync.ts` — cancel handler, resync on socket connect
- `lib/app-flags.ts`, `lib/format-money.ts` — mock gating and shared formatting
- `components/songa/ride-flow-overlay.tsx` — search options UI, API draft flow (`ConfirmPaneApi`)
- `components/songa/register-vehicle-sheet.tsx` — driver vehicle before online
- `app/request-ride.tsx`, `app/(tabs)/index.tsx` — Places -> search -> request
- `app/(driver-tabs)/index.tsx` — `VEHICLE_REQUIRED` -> register vehicle sheet
- `lib/ride-mapper.ts` — `selectedPlaceToPlaceDto`
- `lib/driver-session-store.ts` — `DriverOnlineError` for vehicle codes
- `hooks/use-ride-request.ts`, `hooks/use-driver-ride-progress.ts` — gated when mocks off
- `.env.example` — `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_USE_MOCKS`

## Remaining (non-blocking)

- Driver profile/activity/wallet still use `songaMock` for demo stats until wallet API wired
- Terminal seat-selection / checkout flow still mock-trip keyed (`checkout.tsx`)
- SSE fallback for `GET /api/rides/active/stream` not implemented on mobile
- Payment webhooks (Flutterwave) — prepaid flag on request only

## Mock data removed — 2026-05-23

- Deleted `data/mock-songa.json`, `lib/songa-mock.ts`, `lib/app-flags.ts`, client simulation hooks
- Passenger home: `GET /api/drivers/nearby` + Places → `searchRides` → `requestRide`
- Notifications: `GET /api/notifications`; driver wallet: `GET /api/drivers/me/wallet`
- Profiles use `/api/auth/me` only; checkout uses place params + booking APIs

## Full integration audit — 2026-05-23

### 1. Endpoints backend ships (rides / drivers / auth)

**Auth** — `src/routes/auth.ts`

| Method | Path | Notes |
|--------|------|-------|
| POST   | `/api/auth/register`         | `{ phone, role, password, name?, email? }` -> `{ ok, expiresInSeconds, devCode? }` (devCode only when `x-dev-show-otp: 1` header is set in non-prod) |
| POST   | `/api/auth/register/confirm` | `{ phone, role, code }` -> `{ ok, user }` — **no `sessionToken`**; client must `login` next |
| POST   | `/api/auth/login`            | `{ identifier, password, role }` -> `{ sessionToken, user }`; sets `songa_session` cookie when UA is a browser |
| POST   | `/api/auth/logout`           | bearer; clears cookie + revokes session |
| GET    | `/api/auth/me`               | bearer; returns `{ user }` |

**Rides** — `src/routes/rides.ts`

| Method | Path | Notes |
|--------|------|-------|
| POST   | `/api/rides/search`              | passenger only; returns `{ pickup, dropoff, tripDurationMinutes, bookingMode, requiresSeats, options[] }` |
| POST   | `/api/rides/request`             | passenger only; idempotent on `Idempotency-Key`; returns `201 { ride }` |
| GET    | `/api/rides/active`              | any auth; `{ ride: RideDto or null }` |
| GET    | `/api/rides/active/stream`       | SSE; emits `ride.updated`, `ride.ended`, `ride.cancelled`, `ride.offer` (drivers) |
| GET    | `/api/rides/:rideId`             | any auth (must be passenger or driver of ride) |
| POST   | `/api/rides/:rideId/cancel`      | passenger only; `{ reasonId, reasonLabel, detail? }` |
| POST   | `/api/rides/:rideId/accept`      | driver only; idempotent |
| POST   | `/api/rides/:rideId/decline`     | driver only; returns `{ ok: true }` (no ride payload) |
| POST   | `/api/rides/:rideId/arrived`     | driver only |
| POST   | `/api/rides/:rideId/start`       | driver only |
| POST   | `/api/rides/:rideId/complete`    | driver only |

**Drivers** — `src/routes/drivers.ts`

| Method | Path | Notes |
|--------|------|-------|
| PATCH  | `/api/drivers/me/online`           | `{ isOnline }` -> `{ isOnline, onlineSince }` |
| POST   | `/api/drivers/me/location`         | `{ lat, lng, heading?, speedKmh?, accuracyM?, recordedAt? }` -> `204` |
| POST   | `/api/drivers/me/vehicle`          | `{ type, make, model, registration, color, year?, seats }` -> `{ vehicle }` (type in Car / Van / Minibus / Bike / Tuktuk) |
| GET    | `/api/drivers/me/wallet`           | balance + transactions |
| POST   | `/api/drivers/me/wallet/cashout`   | `{ amount, mpesaPhone? }` |
| GET    | `/api/drivers/nearby`              | `?lat&lng&vehicleType?&radiusKm?` -> `{ drivers: NearbyDriverDto[] }` |

(`/api/bookings/*`, `/api/notifications`, `/api/devices` exist; not in mobile call graph yet.)

### 2. Mobile call sites checked

| File | Functions / role |
|------|-----------------|
| `lib/_core/api.ts` | `register`, `confirmRegistration`, `login`, `logout`, `getMe`, `apiCall` |
| `lib/ride-api.ts` | `searchRides`, `requestRide`, `getActiveRide`, `getRideById`, `cancelRide`, `acceptRide`, `declineRide`, `markDriverArrived`, `startRide`, `completeRide`, `setDriverOnline`, `postDriverLocation`, `getNearbyDrivers`, `registerDriverVehicle`, `createBooking`, `payBooking`, `getBooking` (typed but not called by any screen yet) |
| `lib/realtime-client.ts` | `subscribeRideRealtime`, `reconnectRideRealtime` (Socket.io with bearer in `auth` + `Authorization` header) |
| `lib/active-trip-store.ts` | `setActiveTripFromRide`, `setIncomingOffer`, `clearActiveTrip`, plus `@deprecated` mock helpers (`initActiveTrip`, `driverAcceptTrip`, `driverStartTrip`, `passengerCancelTrip`, `endTrip`, `driverConfirmBoardedAndStart`, `driverMarkPassengerBoarded`, `driverDeclineOffer`) |
| `lib/ride-mapper.ts` | `rideDtoToActiveTrip`, `rideOfferToActiveTrip`, `mockTripToPlaces`, `labelToPlace` (label-only fallback table) |
| `lib/driver-session-store.ts` | `setDriverOnline`, `toggleDriverOnline`, `hydrateDriverOnline`, `DriverOnlineError` |
| `hooks/use-ride-sync.ts` | bootstraps via `getActiveRide`, applies `ride.updated` / `ride.offer` / `ride.ended` / `ride.cancelled` |
| `hooks/use-ride-request.ts` | `useRideRequestSimulation` — pure 2.8s timer fake-flow |
| `hooks/use-driver-location.ts` | `postDriverLocation` every 15s |
| `components/songa/ride-flow-overlay.tsx` | `searchRides`, `requestRide`, `cancelRide`, `setActiveTripFromRide` |
| `components/songa/driver-ride-overlay.tsx` | `startRide`, `completeRide` |
| `components/songa/driver-incoming-sheet.tsx` | offer-countdown UI, accept/decline callbacks |
| `app/(driver-tabs)/index.tsx` | `acceptRide`, `declineRide`, `useDriverLocation`, `useRideSync`, `toggleDriverOnline`, `hydrateDriverOnline` |
| `app/login.tsx`, `app/signup.tsx`, `app/otp-verify.tsx` | `login`, `register`, `confirmRegistration` |
| `app/driver-onboarding.tsx` | `registerDriverVehicle` |
| `app/checkout.tsx` | `searchRides`, `requestRide({ prepaid: true, paymentMethod, seats })` — **does NOT call `/api/bookings/:id/pay`** |
| `app/(driver-tabs)/wallet.tsx`, `(driver-tabs)/activity.tsx`, `(tabs)/notifications.tsx`, `(driver-tabs)/notifications.tsx`, `(tabs)/request-trip.tsx`, `app/driver-requests.tsx` | render `songaMock` data only — no backend wiring |

### 3. Contract mismatches

| Endpoint / surface | Mobile expects | Backend ships | Severity | Mobile fix sketch |
|---|---|---|---|---|
| `POST /api/rides/request` (prepaid) | `app/checkout.tsx:65-89` calls `requestRide({ prepaid: true, seats, paymentMethod })` directly | Backend rejects prepaid ride without a paid booking (verified by `tests/bookings.test.ts -> requires a paid booking before prepaid ride request succeeds`); `bookingId` is required | **blocker** | `app/checkout.tsx`: `createBooking({ tripId, pickup, dropoff, seats })` -> `payBooking(bookingId)` -> poll `getBooking` until `status === "paid"` -> then `requestRide({ ..., prepaid: true, bookingId, paymentMethod })`. |
| `POST /api/rides/request` body | `app/checkout.tsx:32` hard-codes `optionId: "bus"` | `RIDE_PRODUCTS` includes `bus -> vehicleType "Bus"` (`src/lib/ride-products.ts:13`) but **no driver can register vehicle type `Bus`** (`src/schemas/driver.schema.ts:70`) so `available` is always `false` | **needed** | Read `optionId` from the `searchRides` response (prefer `available: true`); never hard-code `"bus"`. |
| `RIDE_PRODUCTS` vs `vehicleTypes` parity | mobile picker `vehicleTypes = ["All","Car","Van","Minibus","Bike","Tuktuk"]` (`lib/songa-mock.ts:23`); `TRIP_TYPE_TO_OPTION` maps `Bike -> "bike"`, `Tuktuk -> "tuktuk"` (`components/songa/ride-flow-overlay.tsx:50`) | `RIDE_PRODUCTS` ships only `["car","van","minibus","bus"]` — `bike`/`tuktuk` are not ride options at all | **needed** | Drop `Bike`/`Tuktuk` from `vehicleTypes` and `TRIP_TYPE_TO_OPTION`, or backend adds matching `RIDE_PRODUCTS` rows. The contract doc says backend product catalogue is canonical -> flag for backend. |
| `app/(tabs)/request-trip.tsx` | should be a real "where to / when / how many seats" flow | `searchRides` exists but isn't called anywhere on this screen | **needed** | Replace the static "Nairobi -> Mombasa · 08:00 AM · 2 seats" UI with `<DestinationAutocomplete>` + `searchRides` + `requestRide`. |
| `app/(tabs)/index.tsx` "Drivers near you" | iterates `songaMock.trips` (lines 13, 28, 97) | `GET /api/drivers/nearby` exists | **needed** | Replace with `getNearbyDrivers({ lat, lng })` driven by current GPS; render `NearbyDriverDto` rows. |
| Notifications | `app/(tabs)/notifications.tsx` and `app/(driver-tabs)/notifications.tsx` map `songaMock.notifications` | `GET /api/notifications?limit=` exists | **needed** | Fetch live; type with backend `Notification`. |
| Driver wallet | `app/(driver-tabs)/wallet.tsx` reads `songaMock.driverWallet`; cash-out button is `onPress={() => {}}` | `GET /api/drivers/me/wallet`, `POST /api/drivers/me/wallet/cashout` exist | **needed** | Wire balance + transactions; pass `mpesaPhone` to cashout. |
| Push tokens | nothing in mobile registers a push token | `POST /api/devices` exists | **needed** | After `login` (and on token refresh), call `apiCall("/api/devices", { method: "POST", body: { pushToken, platform } })`. |
| `RideDto.driverLocation` | mobile `DriverLocationDto` populates the moving driver dot in `LiveRideMap`/`DriverMapHero` | backend `toRideDto` passes through `ride.driverLocation` (column-level), but ride rows are **never updated with the driver's live location** — driver position lives only on `DriverProfile.location`. So `ride.driverLocation` will always be `null` on the wire | **needed** | Backend fix preferred: hydrate `RideDto.driverLocation` from `DriverProfile.location` when ride is in a driver-active phase. Mobile workaround if backend can't ship: rely on `ride.updated` events for low-fidelity updates only. |
| `RegisterVehicleInput.type` cast | `app/driver-onboarding.tsx:48` casts to `"Car" \| "Van" \| "Minibus" \| "Bike" \| "Tuktuk" \| "Bus"` | backend rejects `Bus` with `INVALID_INPUT` | cosmetic | Drop `\| "Bus"` from the cast in `driver-onboarding.tsx:48` so TS surfaces it. |
| `NearbyDriverDto.vehicle` | mobile types `vehicle: { ... }` (non-nullable) (`lib/ride-types.ts:189`) | backend ships `vehicle: VehicleSummary or null` plus extra `avatar`, `dailyRoute`, `estimatedFare`, `listingId` (`src/services/driver.service.ts:266`) | cosmetic | When wiring Drivers Nearby, widen `NearbyDriverDto.vehicle` to nullable and either ignore or add the extra fields. |
| `RideDto.cancelReason` OpenAPI | mobile types it as `CancelReasonDto or null` (`{ reasonId, reasonLabel, detail? }`) | backend OpenAPI declares `unknown or null`; runtime payload IS the right shape | cosmetic | Tighten backend `RideDtoSchema.cancelReason`; no mobile change. |
| Confirm-OTP UX | mobile expectation: after `register/confirm`, user is "logged in" | backend confirm returns user but **no `sessionToken`** — caller must `login` next | cosmetic | If a "session right after OTP" UX is required, run `login(...)` immediately after `confirmRegistration` succeeds (mobile already does this in `app/otp-verify.tsx`'s success branch — verify when integrating). |
| Vehicle id prefix | mobile treats `VehicleEmbedDto.id` as opaque | backend uses raw CUID (no `veh_*`); requirements doc + `tests/vehicle.test.ts:38` expect `veh_*` | cosmetic (mobile-side) | No mobile fix required — id is opaque. Backend test/contract drift. |
| `cancelledByRole` | mobile `RideDto.cancelledByRole: "passenger" or "driver" or "system" or null` | backend matches | none | — |
| `ride.offer` payload | mobile `RideOfferDto` (`{ rideId, pickup, dropoff, price, currency, bookingMode, passengerName, expiresAt }`) | backend `RideOfferEvent.offer` matches exactly (`src/lib/ride-events.ts:11`) | none | — |
| Auth me envelope | mobile `apiCall<{ user: User }>` (`lib/_core/api.ts:151`) | backend returns `{ user }` | none | — |

### 4. Mock / demo code to remove

These call sites still drive UX from `mock-songa.json` instead of the live backend.

1. **`hooks/use-ride-request.ts`** — `useRideRequestSimulation` is a pure 2.8s timer fake-flow. Delete; production path is `requestRide` + `useRideSync`.
2. **`lib/active-trip-store.ts:91-179`** — every `@deprecated` mock-only helper (`initActiveTrip`, `passengerCancelTrip`, `driverAcceptTrip`, `driverStartTrip`, `endTrip`, `driverConfirmBoardedAndStart`, `driverMarkPassengerBoarded`, `driverDeclineOffer`). Keep only the server-driven helpers.
3. **`app/(tabs)/index.tsx:13,28,97`** — `songaMock.trips` powers the "Drivers near you" list and the `RideFlowOverlay` trip prop. Replace with `getNearbyDrivers` + `searchRides` results.
4. **`app/(tabs)/request-trip.tsx`** — entire screen is hard-coded ("Nairobi -> Mombasa · May 25 · 2 seats"; CTA `router.push("/")`). Build a real form or remove from the tab bar.
5. **`app/(tabs)/notifications.tsx` and `app/(driver-tabs)/notifications.tsx`** — replace `songaMock.notifications` with `GET /api/notifications`.
6. **`app/(driver-tabs)/wallet.tsx`** — `songaMock.driverWallet`, `songaMock.driverStats.earnings`, no-op cash-out button. Wire to wallet API.
7. **`app/(driver-tabs)/activity.tsx`** — `songaMock.driverStats`, `songaMock.driverActivity` need a backend endpoint (Stage 7 listings/history) before this can move.
8. **`app/driver-requests.tsx` + `songaMock.driverRequests`** — long-haul "scheduled routes" list with no backend equivalent. Either build a Stage 7 listings endpoint or drop the screen.
9. **`app/(driver-tabs)/index.tsx:31,41`** — `songaMock.driverStats.earnings`/`todayTrips` and `songaMock.vehicles[0]`. Earnings comes from wallet; vehicle should come from `auth.user.driverProfile.vehicleId` (and ideally from a populated vehicle field on `/api/auth/me`).
10. **`app/checkout.tsx:32`** — hard-coded `optionId = "bus"`. Read from `searchRides`.
11. **`lib/active-trip-store.ts:113`** — `passengerName: "John Doe"` placeholder in `initActiveTrip` (becomes moot once #1/#2 are removed).
12. **`lib/ride-mapper.ts:6-13`** — `KNOWN_PLACES` static label -> lat/lng table is mock-only (used by `mockTripToPlaces`/`labelToPlace`). Real flow must come from `<DestinationAutocomplete>` (`SelectedPlace -> PlaceDto`).
13. **`app/(tabs)/profile.tsx:31`** — `songaMock.user.passenger` fallback when `authUser` is missing. Once auth is universally enforced, remove.
14. **`components/songa/ride-flow-overlay.tsx:50-61`** — `TRIP_TYPE_TO_OPTION` includes `Bike -> "bike"` and `Tuktuk -> "tuktuk"` which the backend doesn't catalogue; trim to types the server actually serves.

### 5. Mobile work punch list (specific files + changes)

1. **`app/checkout.tsx:65-89`** — replace single `requestRide(... prepaid: true ...)` with `createBooking -> payBooking -> poll -> requestRide({ ..., prepaid: true, bookingId })`. Drop hard-coded `"bus"` optionId on line 32 — pull from the `searchRides` response.
2. **`app/(tabs)/request-trip.tsx`** — rebuild as a live `searchRides` + `requestRide` form, or remove from the tab bar.
3. **`app/(tabs)/index.tsx`** — replace `songaMock.trips` with `getNearbyDrivers({ lat, lng })` results; pass real GPS pickup into `RideFlowOverlay` instead of `mockTripToPlaces`.
4. **`hooks/use-ride-request.ts`** — delete file and remove the import from any screen still using it.
5. **`lib/active-trip-store.ts:91-179`** — delete all `@deprecated` mock-only mutators.
6. **`app/(tabs)/notifications.tsx` + `app/(driver-tabs)/notifications.tsx`** — fetch `/api/notifications?limit=30`; type with backend `Notification` shape.
7. **`app/(driver-tabs)/wallet.tsx`** — fetch `/api/drivers/me/wallet`; wire cash-out button to `/api/drivers/me/wallet/cashout`.
8. **`app/(driver-tabs)/index.tsx:31,41`** — pull driver vehicle from `auth.user.driverProfile.vehicleId`; pull earnings from wallet.
9. **`app/driver-onboarding.tsx:48`** — drop `\| "Bus"` from the type cast.
10. **`lib/ride-types.ts:183-199`** — change `NearbyDriverDto.vehicle` to nullable (matches backend); add optional `avatar`, `dailyRoute`, `estimatedFare`, `listingId` so deserialization doesn't lose data.
11. **Push tokens** — after login (`app/login.tsx:54`, `app/signup.tsx`, `app/otp-verify.tsx`), call `POST /api/devices` with the Expo push token. Add a `registerDevice` helper in `lib/_core/api.ts` (or `lib/ride-api.ts`).
12. **`lib/realtime-client.ts:13`** — JSDoc claims an SSE fallback exists; it doesn't. Either implement it (EventSource -> reuse `dispatchEvent`) or remove the comment.
13. **`app/(tabs)/profile.tsx:31`** — drop the `songaMock.user.passenger` fallback.
14. **`components/songa/ride-flow-overlay.tsx:50-61`** — trim `TRIP_TYPE_TO_OPTION` to options the backend actually catalogues (`car`, `van`, `minibus`, `bus`).

### 6. Verdict

**Needs minor mobile changes — but with one hard blocker.**

- **Blocker**: `app/checkout.tsx` will fail every prepaid ride against the live backend because it calls `requestRide({ prepaid: true })` without a paid `bookingId`. Mobile must add the `createBooking -> payBooking -> poll -> requestRide` sequence (the backend test `tests/bookings.test.ts` confirms this contract).
- **Needed (non-blocking) mobile work**: wire `/api/notifications`, `/api/drivers/me/wallet`, `/api/drivers/nearby`, and `/api/devices`; remove `useRideRequestSimulation`; stop hard-coding `optionId: "bus"`; trim `Bike`/`Tuktuk` from the picker until the backend catalogue includes them.
- **Backend issue (not a mobile fix)**: `RIDE_PRODUCTS` and `RegisterVehicleRequestSchema` are out of sync — `bus` is a ride product but `Bus` isn't a registerable vehicle; `Bike`/`Tuktuk` are registerable but have no ride product. Backend must reconcile these per `backend-requirements.md`.
- **Backend gap**: `RideDto.driverLocation` is never populated (driver location lives on `DriverProfile`, not `Ride`). Hydrate it in `toRideDto` so the live driver dot animates on the passenger map.

Otherwise the rides happy-path (search -> request -> socket updates -> accept -> arrived -> start -> complete -> cancel) is correctly wired between the two repos.

### 7. Live driver pin + live ETA (realtime) — Bug 1.1 / 1.2 / 1.3

- **`ride.updated` now fires on every driver GPS ping during an active ride** (`driver_en_route`, `driver_arriving`, `driver_arrived`, `trip_in_progress`), throttled to at most one emit per ~3s per ride. **Phase transitions always emit immediately**, bypassing the throttle. The event is broadcast to **both** `user:<passengerId>` and `user:<driverId>` rooms (and the SSE `/api/rides/active/stream`).
- **No payload shape change.** `ride.updated.ride` is the same `RideDto`. The live fields the map needs are already present and now stay fresh:
  - `driverLocation`: `{ lat, lng, heading?, speedKmh?, updatedAt }` (resolved from the ride row / driver profile in `toRideDto`).
  - `etaMinutes`, `distanceKm`, `phase`.
  - Mobile already consumes these (`DriverLocationDto` in `lib/ride-types.ts`, `rideDtoToActiveTrip` in `lib/ride-mapper.ts`) — **no mobile change required** to receive the live pin/ETA.
- **`POST /api/drivers/me/location`** accepts the exact body the driver app sends (`lat`, `lng`, `heading?`, `speedKmh?`, `accuracyM?`, `recordedAt?`), persists `location` + `locationUpdatedAt` on every call with no clamping, and is allowed while offline.
- **Reconnect contract (unchanged):** the server does **not** replay missed events on socket reconnect. On `connect` the client must re-fetch `GET /api/rides/active` to resync (already done in `hooks/use-ride-sync.ts` via `onConnect -> resyncFromServer`).
