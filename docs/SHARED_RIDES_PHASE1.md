# Shared rides — Phase 1 checklist

API prefix: **`/api/shared-rides`** (admin later: **`/api/admin/shared-rides`**).

Control doc: [SHARED_RIDES_AUDIT.md](./SHARED_RIDES_AUDIT.md).

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
- [ ] `POST /api/shared-rides/corridor-locations/resolve` (GPS → zone)
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

- [ ] `POST /api/shared-rides/departures/:id/seats/reserve|release`
- [ ] `POST /api/shared-rides/departures/:id/bookings` + M-Pesa pay
- [ ] `Booking.departureId` / `shared_sgr` mode
- [ ] Mobile seat picker + checkout

---

## Phase 4 — Driver supply

- [ ] `GET /api/shared-rides/trip-requests` (driver board)
- [ ] `POST /api/shared-rides/trip-requests/:id/join`
- [ ] `POST /api/shared-rides/departures` (driver publish)

---

## Phase 5 — Polish

- [ ] Private ride CTA → existing `/api/rides/*`
- [ ] Notifications / SMS on match
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
