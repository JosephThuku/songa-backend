# Shared rides — local backend setup

Use this when running **`songa-backend`** locally so corridor data, demo vans, and test accounts exist before Joseph wires the mobile app.

**Related docs:**

- [SHARED_RIDES_MOBILE_INTEGRATION.md](./SHARED_RIDES_MOBILE_INTEGRATION.md) — passenger/driver flows  
- [SHARED_RIDES_API_REFERENCE.md](./SHARED_RIDES_API_REFERENCE.md) — every endpoint + JSON bodies  
- [DEV_SEED.md](./DEV_SEED.md) — on-demand (JKIA) seed accounts  

---

## 1. One-time setup

```bash
cd songa-backend
cp .env.example .env
# Edit DATABASE_URL, SESSION_JWT_SECRET, OTP_PEPPER (required)
npm install
npm run db:sync          # prisma db push + generate
npm run db:seed          # full dev seed (recommended)
```

Start API:

```bash
npm run dev
# Default: http://localhost:4000/api
```

**Helpful `.env` for mobile dev:**

| Variable | Suggested local value |
|----------|---------------------|
| `ALLOW_DEV_PAYMENT_CONFIRM` | `true` — instant pay without M-Pesa |
| `CORS_ALLOW_ALL` | `true` |
| `PORT` | `4000` (match app API base URL) |
| `PAY_INVITE_BASE_URL` | optional — web URL prefix for call-in SMS links |

OpenAPI: `http://localhost:4000/api/docs` → tag **Shared rides**.

---

## 2. What gets seeded (shared rides)

`npm run db:seed` calls **`seedSharedRidesCoast`** after users/drivers. You can run only shared data with:

```bash
npm run db:seed:shared-rides
```

### Corridor locations (`CorridorLocation`)

Fixed **zones** along the Mombasa coast — not GPS-priced like on-demand rides. Each row has a center `lat`/`lng` and `radiusM` for “am I in Nyali?” checks.

| Slug | Name |
|------|------|
| `sgr-miritini` | SGR Miritini (train terminus) |
| `mtwapa` | Mtwapa |
| `nyali` | Nyali |
| `bamburi` | Bamburi |
| `mombasa-cbd` | Mombasa CBD |
| `diani` | Diani |

Source file: `prisma/seeds/coast-corridor-locations.ts`.

### SGR schedule slots (`SgrScheduleSlot`)

**Timetable rows**: zone ↔ SGR, direction (`to_sgr` / `from_sgr`), train time, van departure time, **price per seat (KES)**.  
Example: Nyali van leaves 06:00 → train 08:00 inter-county.

~40 slots (5 zones × 8 slot patterns). Admin can CRUD via `/api/admin/shared-rides/*` (separate from mobile).

### Demo departures (`SharedDeparture` + seats)

Two **pre-published vans** for testing seat map + booking without a driver joining a pool:

| ID | Route | Notes |
|----|--------|--------|
| `dep_seed_nyali_sgr_morning` | Nyali → SGR | Use in curl/tests |
| `dep_seed_mtwapa_from_sgr` | SGR → Mtwapa | |

Seats use **A1-style labels** when generated from layout (14 bookable seats on demo vans).

### What is *not* seeded

- **Matched** departures from driver join — use driver board + join on `trip_req_seed_cbd_express`  
- **Call-in** bookings — driver creates on a live departure  

### QA routes (mobile Path A vs Path B)

After seed, use passenger `+254712000001` / `SongaDev1`:

| Scenario | Search query | Expected |
|----------|--------------|----------|
| **Path A — vans listed** | `GET /api/shared-rides/departures/search?direction=to_sgr&corridorLocationSlug=nyali` | `exactDepartures` includes `dep_seed_nyali_sgr_morning` |
| **Path B — no vans** | `GET /api/shared-rides/departures/search?direction=to_sgr&corridorLocationSlug=mombasa-cbd` | `exactDepartures: []`, `suggestedTripRequests` non-empty |
| **Driver pool (CBD)** | `GET /api/shared-rides/trip-requests?direction=to_sgr&corridorLocationSlug=mombasa-cbd` | Open pool `trip_req_seed_cbd_express` (2 seats) |

Constants: `prisma/seeds/shared-rides-qa.ts`.

```bash
curl -s "$API/shared-rides/departures/search?direction=to_sgr&corridorLocationSlug=nyali" \
  -H "Authorization: Bearer $PTOKEN" | jq '.exactDepartures[].id'

curl -s "$API/shared-rides/departures/search?direction=to_sgr&corridorLocationSlug=mombasa-cbd" \
  -H "Authorization: Bearer $PTOKEN" | jq '{departures: .exactDepartures | length, suggestions: .suggestedTripRequests | length}'
```

---

## 3. Test accounts (from full seed)

Password for all: **`SongaDev1`** (see [DEV_SEED.md](./DEV_SEED.md)).

| Role | Phone | Use for shared rides |
|------|-------|----------------------|
| Passenger | `+254712000001` | Browse, trip request, reserve, pay |
| Driver (van) | `+254712345679` | Grace — **Van** — good for 14-seat shared |
| Driver | `+254712345678` | James — Car (fewer seats) |

After login as driver, register vehicle if needed (`POST /api/drivers/me/vehicle`), go **online**, post **location** (on-demand habit — also used for dispatch).

---

## 4. Quick smoke test (shared only)

```bash
export API=http://localhost:4000/api

# Passenger login
PTOKEN=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"identifier":"+254712000001","password":"SongaDev1","role":"passenger"}' | jq -r .sessionToken)

# Zones
curl -s "$API/shared-rides/corridor-locations" -H "Authorization: Bearer $PTOKEN" | jq '.locations[].slug'

# Suggestions Nyali → SGR
curl -s "$API/shared-rides/suggestions?direction=to_sgr&corridorLocationSlug=nyali" \
  -H "Authorization: Bearer $PTOKEN" | jq .

# Demo departure seat map
curl -s "$API/shared-rides/departures/dep_seed_nyali_sgr_morning" \
  -H "Authorization: Bearer $PTOKEN" | jq '.departure.seats[0:3]'
```

---

## 5. Prisma / schema changes

After pulling backend changes:

```bash
npm run db:sync
```

New shared-rides fields include `Vehicle.seatLayout`, `SharedDepartureSeat.seatLabel`, departure `driverLat`/`driverLng`, seat `pickupLabel`/coords.

---

## 6. Troubleshooting

| Problem | Fix |
|---------|-----|
| Empty `corridor-locations` | Run `npm run db:seed` or `db:seed:shared-rides` |
| `403` driver join/publish | Register vehicle + approved driver profile |
| Pay hangs | Set `ALLOW_DEV_PAYMENT_CONFIRM=true` |
| Stale seat holds | `npm run shared-rides:release-expired-holds` (also runs every 5 min in dev server) |
| IDE Prisma errors | `npm run db:sync` + restart TS server — see [PRISMA.md](./PRISMA.md) |
