# Shared rides — API reference (request bodies)

Quick lookup for Joseph: **method**, **path**, **who can call**, **what to send**.  
Narrative flows: [SHARED_RIDES_MOBILE_INTEGRATION.md](./SHARED_RIDES_MOBILE_INTEGRATION.md).  
Local data: [SHARED_RIDES_LOCAL_SETUP.md](./SHARED_RIDES_LOCAL_SETUP.md).

**Base:** `{API}/api` · **Auth header:** `Authorization: Bearer <sessionToken>` unless noted **Public**.

**Errors:** `{ "error": { "code": "…", "message": "…", "details"? } }` · **400** invalid input · **401** no auth · **403** wrong role · **409** conflict.

**Times:** datetimes in responses use **EAT** `+03:00` (e.g. `2026-06-02T06:00:00+03:00`).

---

## Auth (prerequisite)

| Method | Path | Body |
|--------|------|------|
| `POST` | `/api/auth/login` | `{ "identifier": "+2547…", "password": "…", "role": "passenger" \| "driver" }` |

Response includes `sessionToken`. Same as on-demand app.

---

## Driver — vehicle (required before shared van)

Shared departures build the seat grid from the driver’s **registered vehicle**.

| Method | Path | Auth | Body |
|--------|------|------|------|
| `POST` | `/api/drivers/me/vehicle` | driver | See below |
| `PATCH` | `/api/drivers/me/online` | driver | `{ "isOnline": true }` |
| `POST` | `/api/drivers/me/location` | driver | `{ "lat", "lng", "heading?", "speedKmh?", "accuracyM?" }` |

### `POST /api/drivers/me/vehicle`

```json
{
  "type": "Van",
  "make": "Toyota",
  "model": "Hiace",
  "registration": "KCA 456B",
  "color": "White",
  "year": "2018",
  "seats": 14,
  "seatLayout": {
    "rows": 7,
    "cols": 2,
    "disabled_seats": []
  }
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `type` | yes | `Car` \| `Van` \| `Minibus` |
| `seats` | yes | Bookable passenger capacity (1–60) |
| `seatLayout` | no | Omit → default 2-column grid; driver seat auto-disabled (Laravel). Used when creating shared departure seats (`A1`, `B2`, …). |
| `seatLayout.rows` / `cols` | if layout | Grid size |
| `seatLayout.disabled_seats` | no | e.g. `["A2"]` |

---

## Catalog (passenger or driver)

| Method | Path | Query / body |
|--------|------|----------------|
| `GET` | `/api/shared-rides/corridor-locations` | — |
| `GET` | `/api/shared-rides/corridor-locations/{slug}` | path: `nyali`, `sgr-miritini`, … |
| `POST` | `/api/shared-rides/corridor-locations/resolve` | `{ "lat": -4.02, "lng": 39.72 }` |
| `GET` | `/api/shared-rides/sgr-schedule-slots` | `?direction=to_sgr&corridorLocationSlug=nyali` |
| `GET` | `/api/shared-rides/suggestions` | `?direction=to_sgr&corridorLocationSlug=nyali` |
| `GET` | `/api/shared-rides/departures/search` | `?direction=to_sgr&corridorLocationSlug=nyali&date=2026-06-02` optional |

**`direction`:** `to_sgr` (neighborhood → SGR) or `from_sgr` (SGR → neighborhood).

**`suggestions` / search empty:** response may include `suggestedTripRequests[]` — copy into `POST /trip-requests`.

---

## Passenger — trip request (pool)

| Method | Path | Body |
|--------|------|------|
| `POST` | `/api/shared-rides/trip-requests` | See below |
| `GET` | `/api/shared-rides/trip-requests/mine` | — |

### `POST /api/shared-rides/trip-requests`

Copy fields from `suggestedTripRequests` item (or build manually):

```json
{
  "sgrScheduleSlotId": "clxxx…",
  "direction": "to_sgr",
  "corridorLocationId": "clxxx…",
  "departureDate": "2026-06-02",
  "vanDepartureAt": "2026-06-02T06:00:00+03:00",
  "seatsRequested": 2,
  "pickupNote": "Near City Mall gate",
  "notes": "optional"
}
```

| Field | Notes |
|-------|--------|
| `pickupNote` | Text only — landmark for driver before match. GPS pin sent later on **seat reserve**. |
| `vanDepartureAt` | Must match slot; use value from suggestions |

---

## Passenger — book seats on a departure

| Method | Path | Body |
|--------|------|------|
| `GET` | `/api/shared-rides/departures/{departureId}` | — |
| `POST` | `/api/shared-rides/departures/{departureId}/seats/reserve` | `{ "seatNumbers": [3, 4], "pickup"? }` |
| `POST` | `/api/shared-rides/departures/{departureId}/seats/release` | `{ "seatNumbers": [3] }` optional — omit to release all your holds |
| `POST` | `/api/shared-rides/departures/{departureId}/bookings` | `{ "seatNumbers": [3, 4] }` |

### Reserve — `pickup` (neighborhood pin)

```json
{
  "seatNumbers": [3, 4],
  "pickup": {
    "label": "City Mall gate",
    "lat": -4.043,
    "lng": 39.71
  }
}
```

| Direction | `pickup` on reserve |
|-----------|---------------------|
| `to_sgr` | **Recommended** — where van picks you up. If omitted: `pickupNote` + zone center, or zone center only. |
| `from_sgr` | **Optional** — you board at SGR; drop-off pin only if needed. |

**Hold:** 5 minutes (`SHARED_RIDES_SEAT_RESERVE_MIN`, default 5). Response: `reservedUntil`, updated `departure`.

**Seat map response:** each seat has `seatNumber` (use in API), `seatLabel` (show `A1`), `status`, `isMine`.

### Pay (not under `/shared-rides`)

| Method | Path | Body |
|--------|------|------|
| `POST` | `/api/bookings/{bookingId}/pay` | `{ "provider": "mpesa", "phone": "+2547…" }` |

Booking comes from `POST …/bookings` with `product: "shared_sgr"`.  
**Pricing (Joseph):** `subtotal` = `pricePerSeat × seat count`, `platformFee` = **0**, `total` = `subtotal`. **Do not show +50 KES or a platform-fee row** — charge `total` only. Songa driver billing (daily fee vs % holdback + weekly payout) is backlog.  
With `ALLOW_DEV_PAYMENT_CONFIRM=true`, pay succeeds immediately in dev.

### Track van after pay

`GET /api/shared-rides/departures/{departureId}` while status is `scheduled` or `boarding` → `driverLocation: { lat, lng, updatedAt }` if driver posts GPS.

---

## Driver — supply & run trip

| Method | Path | Query / body |
|--------|------|----------------|
| `GET` | `/api/shared-rides/trip-requests` | `?direction=to_sgr&corridorLocationSlug=nyali` |
| `POST` | `/api/shared-rides/trip-requests/{tripRequestId}/join` | no body |
| `POST` | `/api/shared-rides/departures` | below |
| `GET` | `/api/shared-rides/departures/mine` | — |
| `GET` | `/api/shared-rides/departures/{departureId}` | driver sees `occupant` on seats |
| `PATCH` | `/api/shared-rides/departures/{departureId}/location` | `{ "lat", "lng" }` |
| `PATCH` | `/api/shared-rides/departures/{departureId}/status` | `{ "status": "boarding" \| "completed" \| "cancelled" }` |
| `POST` | `/api/shared-rides/departures/{departureId}/call-in-bookings` | below |

### Publish van (no passenger pool)

```json
{
  "sgrScheduleSlotId": "clxxx…",
  "departureAt": "2026-06-02T06:00:00+03:00",
  "pricePerSeat": 350
}
```

`pricePerSeat` optional — defaults to slot suggested price.

### Driver `GET /departures/{id}` — occupant

For reserved/paid seats:

```json
"occupant": {
  "passengerId": "…",
  "name": "Jane",
  "status": "reserved",
  "reservedUntil": "2026-06-02T06:04:00+03:00",
  "pickupPin": { "label": "City Mall gate", "lat": -4.043, "lng": 39.71 }
}
```

Show `pickupPin` on map / passenger detail. Call `tel:` using passenger phone from your user profile if you add that lookup later.

### Call-in booking (phone passenger)

```json
{
  "phone": "+254712345999",
  "passengerName": "Mary",
  "seatNumbers": [5],
  "pickup": {
    "label": "Beach road",
    "lat": -4.05,
    "lng": 39.72
  }
}
```

| Field | Notes |
|-------|--------|
| `phone` | Creates passenger account if new — **no password** |
| `pickup` | Required for `to_sgr`; optional for `from_sgr` |

**Response:**

```json
{
  "bookingId": "BKG-…",
  "passengerId": "…",
  "payInviteToken": "eyJ…",
  "payInviteUrl": "songa://shared-rides/pay-invite?token=…",
  "reservedUntil": "…",
  "smsSent": true
}
```

Passenger pays via **guest pay** endpoints (SMS link). Hold: 24h same Nairobi day / 72h later calendar day, capped 1h before departure.

---

## Guest pay (public — no JWT)

| Method | Path | Body |
|--------|------|------|
| `GET` | `/api/shared-rides/pay-invites/{token}` | — |
| `POST` | `/api/shared-rides/pay-invites/{token}/pay` | `{ "provider": "mpesa", "phone": "+2547…" }` |

Use for call-in SMS link. Mobile can open WebView or deep link with `token` query param.

`GET` returns booking summary + `requiresLogin: false`.

---

## Notifications

| Type | When |
|------|------|
| `shared_ride_matched` | Driver joined passenger’s pool — deep link to `departureId` |

Register device token same as on-demand. Inbox: `GET /api/notifications`.

---

## Departure status (driver PATCH)

| From | To |
|------|-----|
| `scheduled` | `boarding`, `cancelled`, `completed` |
| `boarding` | `completed`, `cancelled` |

Location `PATCH` only while `scheduled` or `boarding`. After `completed` → **409** `DEPARTURE_NOT_ACTIVE`.

---

## Common error codes

| Code | When |
|------|------|
| `SEAT_NOT_AVAILABLE` | Seat taken / expired hold |
| `SEATS_NOT_HELD` | Book without reserve |
| `UNPAID_BOOKING_PENDING` | Another unpaid booking exists |
| `TRIP_REQUEST_ALREADY_CLAIMED` | Another driver joined |
| `VEHICLE_REQUIRED` | Driver has no vehicle |
| `PICKUP_LOCATION_REQUIRED` | `to_sgr` without pickup pin |
| `PAY_INVITE_INVALID` | Expired or bad token |

---

## Admin (not mobile — reference)

Header `X-Shared-Rides-Admin-Key` + admin login.  
`/api/admin/shared-rides/corridor-locations`, `/sgr-schedule-slots` CRUD.  
See [SHARED_RIDES_API.md](./SHARED_RIDES_API.md).
