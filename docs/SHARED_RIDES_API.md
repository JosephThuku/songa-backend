# Shared rides API (`/api/shared-rides`)

Coast **SGR Miritini** corridor: scheduled vans, fixed Madaraka timetables, prepay (Phase 3).

**Auth:** All endpoints require a passenger or driver JWT (`Authorization: Bearer …`) or browser `songa_session` cookie — same as `/api/rides`.

**Validation (Phase 1):** Query and path params are parsed with **Zod** in the route handlers. Invalid input returns **400** with the standard error envelope:

```json
{
  "error": {
    "code": "INVALID_INPUT",
    "message": "Invalid input.",
    "details": { "issues": [ /* zod issue list */ ] }
  }
}
```

Examples that return **400**: missing `direction` on `/suggestions`, invalid `date` format, malformed `corridor-locations/:slug` (non `a-z0-9-` slug).

**OpenAPI:** Interactive docs at `/api/docs` · raw spec `/api/openapi.json` (tag **Shared rides**). Spec lists **200**, **400**, **401**, and **404** (slug lookup only) where applicable.

**Code:** Routes [`src/routes/shared-rides.ts`](../src/routes/shared-rides.ts) · schemas [`src/schemas/shared-rides.schema.ts`](../src/schemas/shared-rides.schema.ts).

---

## Endpoints (Phase 1)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/shared-rides/corridor-locations` | List zones + SGR Miritini |
| `GET` | `/api/shared-rides/corridor-locations/{slug}` | One zone by slug |
| `GET` | `/api/shared-rides/sgr-schedule-slots` | Full timetable for a zone |
| `GET` | `/api/shared-rides/suggestions` | Next 1–2 bookable slots (time-aware) |
| `GET` | `/api/shared-rides/departures/search` | Scheduled vans + suggestions if empty |

### Query parameters

**`direction`** (required on suggestions & departures search)

| Value | Meaning |
|-------|---------|
| `to_sgr` | Neighborhood → **SGR Miritini** (van before train) |
| `from_sgr` | **SGR Miritini** → neighborhood (van after train arrival) |

**Zone filter** (optional on slots / suggestions / search)

- `corridorLocationSlug` — e.g. `nyali`, `diani`, `mtwapa`, `bamburi`, `mombasa-cbd`
- or `corridorLocationId` — cuid from `corridor-locations`

**`date`** (optional on departures search) — `YYYY-MM-DD`, Nairobi calendar day.

---

## Example flows

### 1. Zone catalog

```http
GET /api/shared-rides/corridor-locations
Authorization: Bearer <token>
```

```json
{
  "locations": [
    { "id": "…", "slug": "sgr-miritini", "name": "SGR Miritini", "lat": -4.02178, "lng": 39.57947, "radiusM": 1200, "sortOrder": 0 },
    { "id": "…", "slug": "nyali", "name": "Nyali", "lat": -4.0207, "lng": 39.7199, "radiusM": 3500, "sortOrder": 20 }
  ]
}
```

### 2. Suggestions (one-tap intent preview — Phase 2 POST)

```http
GET /api/shared-rides/suggestions?direction=to_sgr&corridorLocationSlug=diani
Authorization: Bearer <token>
```

```json
{
  "suggestedTripRequests": [
    {
      "sgrScheduleSlotId": "…",
      "direction": "to_sgr",
      "corridorLocationId": "…",
      "corridorLocationSlug": "diani",
      "departureDate": "2026-06-02",
      "headline": "Catch the 3:00 PM train to Nairobi",
      "detail": "Shared van ~12:00 PM from Diani · KES 700/seat · prepay to confirm",
      "trainLabel": "Afternoon Express · departs Miritini 15:00",
      "vanDepartureAt": "2026-06-02T09:00:00.000Z",
      "pricePerSeat": 700,
      "seatsRequested": 1
    }
  ]
}
```

### 3. Departures search

```http
GET /api/shared-rides/departures/search?direction=to_sgr&corridorLocationSlug=nyali
Authorization: Bearer <token>
```

```json
{
  "exactDepartures": [
    {
      "id": "dep_seed_nyali_sgr_morning",
      "departureAt": "2026-06-02T03:00:00.000Z",
      "pricePerSeat": 350,
      "capacity": 14,
      "bookedSeatsCount": 2,
      "availableSeats": 12,
      "routeLabel": "Nyali → SGR Miritini",
      "driver": { "id": "…", "name": "James Mwangi", "rating": 4.92 },
      "sgrScheduleSlotId": "…"
    }
  ],
  "otherDepartures": [],
  "locations": [ "…" ],
  "suggestedTripRequests": [ "…" ]
}
```

---

## Departure capacity vs driver vehicle

**Not tied in Phase 1.** `SharedDeparture.capacity` defaults to **14** and demo seats are generated from that number only. The assigned `driverId` (if any) does **not** read `Vehicle.seats` today.

**Planned (Phase 4 — driver publish / join):** when a driver creates or claims a departure, set `capacity` from their registered van (`DriverProfile.vehicle.seats`, capped for shared SGR product rules) and generate `SharedDepartureSeat` rows to match.

Until then, treat `capacity` / `availableSeats` on search results as **catalog defaults**, not live vehicle inventory.

---

## Environment (optional)

| Variable | Default | Effect |
|----------|---------|--------|
| `SHARED_RIDES_BOOKING_LEAD_MIN` | `120` | Min minutes before van departs (`to_sgr` suggestions) |
| `SHARED_RIDES_FROM_SGR_GRACE_MIN` | `45` | After arrival, still suggest `from_sgr` |
| `SHARED_RIDES_FROM_SGR_LOOKAHEAD_H` | `6` | How far ahead to show arrivals |
| `SHARED_RIDES_MAX_SUGGESTIONS` | `2` | Max suggestions returned |

---

## Not in Phase 1 (coming)

| Method | Path |
|--------|------|
| `POST` | `/api/shared-rides/trip-requests` |
| `GET` | `/api/shared-rides/trip-requests/mine` |
| `POST` | `/api/shared-rides/departures/{id}/seats/reserve` |
| `POST` | `/api/admin/shared-rides/corridor-locations` |

See [SHARED_RIDES_PHASE1.md](./SHARED_RIDES_PHASE1.md) checklist.
