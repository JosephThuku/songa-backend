# Shared rides — Phase 1 checklist

API prefix: **`/api/shared-rides`** (admin later: **`/api/admin/shared-rides`**).

Control doc: [SHARED_RIDES_AUDIT.md](./SHARED_RIDES_AUDIT.md).

**Mobile integrators:** [SHARED_RIDES_MOBILE_INTEGRATION.md](./SHARED_RIDES_MOBILE_INTEGRATION.md) (capabilities + why), [SHARED_RIDES_MOBILE_FLOW.md](./SHARED_RIDES_MOBILE_FLOW.md) (sequences).

---

## Phase 1 — Catalog + browse (current sprint)

- [x] Prisma: `CorridorLocation`, `SgrScheduleSlot`, `SharedDeparture`, `SharedDepartureSeat`
- [x] Coast seeder: SGR Miritini + Mtwapa, Nyali, Bamburi, Mombasa CBD, **Diani** (8 slots × 5 zones = 40 slots)
- [x] Demo departures in dev seed (Nyali→SGR, SGR→Mtwapa)
- [x] `GET /api/shared-rides/corridor-locations`
- [x] `GET /api/shared-rides/corridor-locations/:slug`
- [x] `GET /api/shared-rides/sgr-schedule-slots`
- [x] `GET /api/shared-rides/suggestions` (Madaraka-aware, lead time + arrival grace)
- [x] `GET /api/shared-rides/departures/search` (+ `suggestedTripRequests` when empty)
- [x] Admin CRUD: `POST/PATCH/DELETE /api/admin/shared-rides/corridor-locations`
- [x] Admin CRUD: `POST/PATCH/DELETE /api/admin/shared-rides/sgr-schedule-slots`
- [x] `POST /api/shared-rides/corridor-locations/resolve` (GPS → zone)
- [ ] Mobile: SGR entry → shared flow (replace mock `ride-share.tsx`)
- [ ] Mobile: empty search → one-tap suggestion → `trip-requests` (Phase 2)

---

## Phase 2 — Passenger intent

- [x] Prisma: `SharedTripRequest` (+ `SharedTripRequestReservation`)
- [x] `POST /api/shared-rides/trip-requests`
- [x] `GET /api/shared-rides/trip-requests/mine`
- [ ] Mobile: wire “Request van for [slot]” (POST body = `suggestedTripRequests` item)

---

## Phase 3 — Seats + prepay

- [x] `GET /api/shared-rides/departures/:id` (seat map)
- [x] `POST /api/shared-rides/departures/:id/seats/reserve|release`
- [x] `POST /api/shared-rides/departures/:id/bookings` + pay via `POST /api/bookings/:id/pay`
- [x] `Booking.sharedDepartureId` / `product: shared_sgr`
- [ ] Mobile seat picker + checkout

---

## Phase 4 — Driver supply

- [x] `GET /api/shared-rides/trip-requests` (driver board)
- [x] `POST /api/shared-rides/trip-requests/:id/join` (+ in-app + SMS `shared_ride_matched`)
- [x] `POST /api/shared-rides/departures` (driver publish)
- [x] `GET /api/shared-rides/departures/mine` (driver list + seat fill)
- [x] `GET /api/shared-rides/departures/:id` (driver seat map with occupants)
- [x] `PATCH /api/shared-rides/departures/:id/status` (boarding / completed / cancelled)
- [ ] Mobile: driver board + join + publish + lifecycle screens

---

## Phase 5 — Pickup tracking + polish

- [x] Passenger `pickup` pin on seat reserve (+ fallback from `pickupNote` / zone center)
- [x] Booking pickup/dropoff respects `to_sgr` / `from_sgr`
- [x] Driver `PATCH …/departures/:id/location` (Laravel trip GPS)
- [x] Passenger track `driverLocation` on departure GET while `boarding`
- [x] `npm run shared-rides:release-expired-holds` (global expired hold release)
- [x] [`SHARED_RIDES_MOBILE_INTEGRATION.md`](./SHARED_RIDES_MOBILE_INTEGRATION.md)
- [ ] Private ride CTA → existing `/api/rides/*`
- [x] Driver call-in booking + guest pay invite (no login; see API)
- [x] Seat layout labels (`Vehicle.seatLayout` → A1, B2, …)
- [x] In-process expired hold sweep (5 min) + `npm run shared-rides:release-expired-holds`
- [ ] Refer call-in to another driver (backlog)
- [ ] Driver wallet / subscription (backlog — `docs/backlog/shared-rides.md`)
- [x] Notifications / SMS on match (Phase 4)
- [x] OpenAPI docs for shared-rides routes (`src/schemas/shared-rides.schema.ts`, tag **Shared rides**)
- [x] Integrator markdown [`SHARED_RIDES_API.md`](./SHARED_RIDES_API.md)
- [x] Tests: `tests/shared-rides.test.ts`, `tests/shared-rides-suggestions.test.ts`

---

## TypeScript / Prisma client

See **[PRISMA.md](./PRISMA.md)** — stale client causes `Property 'sgrScheduleSlot' does not exist on PrismaClient` in the IDE.

Enums and DTOs live in **`src/domain/shared-rides.ts`** (not imported from `@prisma/client` in app code).  
After any `schema.prisma` change run **`npm run db:sync`** from `songa-backend/`, then restart the TS server.

`npm run dev` / `npm test` / `npm run typecheck` also run `prisma generate` (or `ensure-prisma-client`) automatically.

## Seed commands

```bash
cd songa-backend
npx prisma db push
npx prisma generate
npm run db:seed:shared-rides   # corridors + slots only
npm run db:seed                # full dev seed (users + shared rides)
```

Corridor coordinates are defined in **`prisma/seeds/coast-corridor-locations.ts`** (SGR Miritini uses Wikipedia terminus coords).

## Quick API smoke (after login)

```bash
# List zones
curl -s -H "Authorization: Bearer $TOKEN" \
  "$API/api/shared-rides/corridor-locations" | jq .

# Suggestions Nyali → SGR
curl -s -H "Authorization: Bearer $TOKEN" \
  "$API/api/shared-rides/suggestions?direction=to_sgr&corridorLocationSlug=nyali" | jq .

# Departures + suggestions
curl -s -H "Authorization: Bearer $TOKEN" \
  "$API/api/shared-rides/departures/search?direction=to_sgr&corridorLocationSlug=nyali" | jq .
```
