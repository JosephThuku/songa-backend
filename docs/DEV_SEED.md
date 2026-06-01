# Dev database seed

Apply schema and seed:

```bash
npm run db:push
npm run db:seed
```

**Password for every seeded account:** `SongaDev1`

## Passenger (order rides)

| Field | Value |
|-------|--------|
| Phone | `+254712000001` |
| Email | `john.passenger@songa.dev` |
| Name | John Doe |
| App role | **Passenger** |

## Drivers (accept offers)

All are **approved**, **online**, and have a fresh GPS fix. Four are near JKIA; one is in Westlands.

| Name | Phone | Vehicle | Plate |
|------|-------|---------|-------|
| James Mwangi | `+254712345678` | Car | KDB 123A |
| Grace Wanjiru | `+254712345679` | Van | KCA 456B |
| Peter Otieno | `+254712345680` | Car | KDG 789C |
| Faith Njoki | `+254712345681` | Minibus | KDH 012D |
| David Kamau | `+254712345682` | Car | KDJ 345E |

Log in with **Driver** role using any phone above.

## Sample ride (passenger)

Use these places so search shows **seat_selection** (airport terminal) and nearby drivers match:

| | Label | Lat | Lng |
|---|--------|-----|-----|
| **Pickup** | JKIA Terminal 1A | -1.3192 | 36.9278 |
| **Dropoff** | Westlands | -1.2674 | 36.807 |
| **Seats** | 3 and 4 | | |

### In the mobile app

1. Log in as passenger: `+254712000001` / `SongaDev1`.
2. On Home, set pickup **JKIA Terminal 1A** and dropoff **Westlands** (or open checkout with the same labels/coordinates).
3. Choose **Car** (or Van) — options should show as available if the API is running and drivers are still online.
4. For seat checkout: select seats **3** and **4**, pay (with `ALLOW_DEV_PAYMENT_CONFIRM=true` on the backend, pay completes in dev).
5. Confirm ride request — James/Grace/Peter/Faith should be eligible for offers near JKIA.

### Via API (curl)

```bash
# Login
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"+254712000001","password":"SongaDev1","role":"passenger"}' \
  | jq -r .sessionToken)

# Search
curl -s -X POST http://localhost:3000/api/rides/search \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"pickup":{"label":"JKIA Terminal 1A","lat":-1.3192,"lng":36.9278},"dropoff":{"label":"Westlands","lat":-1.2674,"lng":36.807}}'

# Request (pay on arrival / no prepaid)
curl -s -X POST http://localhost:3000/api/rides/request \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"pickup":{"label":"JKIA Terminal 1A","lat":-1.3192,"lng":36.9278},"dropoff":{"label":"Westlands","lat":-1.2674,"lng":36.807},"seats":[3,4],"optionId":"car"}'
```

## End-to-end test without moving (dev)

Use two browser windows (or normal + private): **passenger** `+254712000001` and **driver** `+254712345678` (James Mwangi), password `SongaDev1`.

1. **Passenger:** Request ride JKIA Terminal 1A → Westlands → **Confirm order** (Car).
2. **Driver:** Log in as Driver, go **Online**, accept the offer.
3. **Driver sheet:** Tap **I've arrived at pickup** (no real drive needed).
4. **Driver:** **Start trip** (or “Passenger boarded — start now”).
5. **Driver:** **Complete trip** at dropoff.
6. **Passenger:** Should show tracking through pickup → on trip → completed.

Optional: in `__DEV__` builds, the driver overlay shows **GPS at pickup** / **GPS at dropoff** to fake location and refresh ETA (phase may move to `driver_arriving` near pickup).

### Automated map animation (backend script)

With the API running and two Expo web tabs logged in (passenger + driver above):

```bash
cd songa-backend
npm run simulate:ride
```

This requests JKIA → Westlands, accepts as James, posts GPS every ~2.5s from far away → pickup (`driver_en_route` → `driver_arriving`) → dropoff → complete. Tune speed with `STEP_MS=1500`.

## Notes

- Re-run `npm run db:seed` anytime; it is idempotent (upserts by phone/registration).
- Driver GPS in Redis is indexed on seed. If Redis was flushed, restart seed or toggle a driver offline/online and post location from the driver app.
- Locations older than **60 seconds** are excluded from nearby/search until updated.
