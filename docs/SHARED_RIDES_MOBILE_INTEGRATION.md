# Shared rides — mobile integration guide (Joseph)

**Purpose:** Show what passengers and drivers can do in the **shared SGR / coast van** module, which API each step uses, and what is **not** built yet. 

| Doc | Use when |
|-----|----------|
| **[SHARED_RIDES_API_REFERENCE.md](./SHARED_RIDES_API_REFERENCE.md)** | **What to send** on each endpoint (JSON bodies, `seatLayout`, etc.) |
| **[SHARED_RIDES_LOCAL_SETUP.md](./SHARED_RIDES_LOCAL_SETUP.md)** | **Run backend locally** — seed, zones, demo departure ids |
| [SHARED_RIDES_API.md](./SHARED_RIDES_API.md) | Longer examples + admin |
| [SHARED_RIDES_MOBILE_FLOW.md](./SHARED_RIDES_MOBILE_FLOW.md) | Sequence diagrams |
| `/api/docs` | OpenAPI tag **Shared rides** |

---

## Start here

1. **Auth** is the same as today: passenger or driver JWT on almost every call (`Authorization: Bearer …`).
2. All shared-van APIs live under **`/api/shared-rides/*`**, except **payment** (reuse **`/api/bookings/{id}/pay`**) and **guest pay** (no login — see below).
3. **On-demand rides** (`/api/rides/*`) are unchanged. A passenger who wants a private trip uses the existing home / request-ride flow — there is no special “private CTA” on shared endpoints.
4. Replace the mock **`ride-share`** UI with these APIs. **`driver-requests`** should use the driver board + departures APIs below.

**Direction** (used in many queries):

| Value | Meaning |
|-------|---------|
| `to_sgr` | Neighborhood → **SGR Miritini** (catch the train) |
| `from_sgr` | **SGR Miritini** → neighborhood (after train) |

---

## Money — **important for Joseph (checkout UI)**

> **Do not add 50 KES (or any “platform fee” line) on shared van checkout.**  
> Show and charge **fare only**: `total` from the booking response (equals seat price × seats).  
> The API returns `platformFee: 0` on `product: "shared_sgr"` — **ignore it in UI**; do not display it as an extra line item.

| Party | **Build now** |
|-------|----------------|
| **Passenger (shared)** | Pay **`total`** only — same as `subtotal`, no surcharge. Example: 2 seats @ 350 → show **700 KES**, not 750. |
| **Driver (shared prepay)** | Wallet credited full seat amount when passenger pays (`GET /api/drivers/me/wallet`, type `shared_booking_credit`). |
| **Songa take (shared)** | **Not in app yet** — backend does not debit drivers on shared prepay today. |

**Do not reuse on-demand fare UI for shared.** Private rides (`/api/rides/*`) may still return `platformFee: 50` in some responses; that is legacy / a different product. Shared = fare only.

### Billing roadmap (product TBD — do not implement in mobile yet)

Songa is **not** Uber/Bolt-style commission per trip on vans. How drivers pay Songa is still being decided; likely one of:

| Option | Idea |
|--------|------|
| **A — Daily flat** | e.g. ~150 KES once per calendar day debited from driver wallet. |
| **B — Holdback + weekly payout** | Retain ~10% on each **in-app** trip (shared prepay + on-demand paid in app), pay drivers weekly, minus daily subscription (amount TBD). |

Rules (which products, cash trips, negative wallet, etc.) will land in a later backend release. Until then: **passenger pays fare only; driver wallet shows credits; no “Songa fee” row on passenger checkout.**

Details: [backlog/shared-rides.md](./backlog/shared-rides.md).

---

## What passengers can do (two paths)

### Path A — “There is already a van” (browse → book)

Use when **`GET /departures/search`** returns departures.

```
Pick zone (GPS) → search departures → open van → pick seats → pay
```

| Step | What the user does | API | Role |
|------|-------------------|-----|------|
| 1 | App detects neighborhood | `POST /api/shared-rides/corridor-locations/resolve` `{ lat, lng }` | passenger |
| 2 | Optional: list all zones | `GET /api/shared-rides/corridor-locations` | either |
| 3 | Find vans for zone + direction | `GET /api/shared-rides/departures/search?direction=to_sgr&corridorLocationSlug=nyali` | passenger |
| 4 | Open seat map | `GET /api/shared-rides/departures/{departureId}` | passenger |
| 5 | Hold seats (5 min) | `POST /api/shared-rides/departures/{departureId}/seats/reserve` `{ seatNumbers, pickup? }` | passenger |
| 6 | Create booking | `POST /api/shared-rides/departures/{departureId}/bookings` `{ seatNumbers }` | passenger |
| 7 | Pay (M-Pesa) | `POST /api/bookings/{bookingId}/pay` `{ provider: "mpesa", phone }` | passenger |
| 8 | After pay: track van (optional) | Same `GET …/departures/{id}` — includes `driverLocation` while `scheduled` / `boarding` | passenger |

**Seat map fields:** `seatNumber` (use in reserve/book), `seatLabel` (e.g. `A1` for UI), `status`, `isMine`.

**Pickup pin (`to_sgr`):** Send `pickup: { label, lat, lng }` on **reserve**. If omitted, backend uses `pickupNote` from your trip request (Path B) + zone center, or zone center only.

**Pickup pin (`from_sgr`):** Optional on reserve (passenger boards at SGR; drop-off neighborhood pin only if you want one).

---

### Path B — “No van listed yet” (intent pool → matched → book)

Use when search is **empty** but **`suggestedTripRequests`** is returned (or use **`GET /suggestions`** directly).

```
Pick zone → see suggestion → post trip request → wait for match → seat map → pay
```

| Step | What the user does | API | Role |
|------|-------------------|-----|------|
| 1 | Zone + suggestions | `GET /api/shared-rides/suggestions?direction=to_sgr&corridorLocationSlug=nyali` | passenger |
| 2 | Post intent (copy fields from suggestion) | `POST /api/shared-rides/trip-requests` — include `pickupNote`, `seatsRequested`, `vanDepartureAt`, etc. | passenger |
| 3 | Track my requests | `GET /api/shared-rides/trip-requests/mine` | passenger |
| 4 | **Push / inbox:** `shared_ride_matched` | Deep link to `departureId` — then continue Path A from step 4 | passenger |

Pooling: several passengers can share one `tripRequestId`; each has their own reservation row.

---

### Path A + B together (recommended UX)

1. Always try **`departures/search`** first.  
2. If `departures` empty → show **`suggestedTripRequests`** from the same response (or from **`suggestions`**) → one tap → **`POST /trip-requests`**.  
3. After match notification → **`GET /departures/{id}`** → reserve → book → pay.

---

## What drivers can do

Drivers need **vehicle registered** + **driver profile** (same as on-demand). Seat grid is built from **`Vehicle.seats`** + optional **`seatLayout`** (A1, B2, … like Laravel).

### Path C — Supply a van and run the trip

```
Board (open pools) OR publish own van → seat map / passengers → boarding → completed
```

| Step | What the driver does | API | Role |
|------|---------------------|-----|------|
| 1 | See open passenger pools | `GET /api/shared-rides/trip-requests?direction=&corridorLocationSlug=` | driver |
| 2a | Claim a pool (first driver wins) | `POST /api/shared-rides/trip-requests/{tripRequestId}/join` | driver |
| 2b | **Or** publish without a pool | `POST /api/shared-rides/departures` `{ sgrScheduleSlotId, departureAt, pricePerSeat? }` | driver |
| 3 | List my active vans | `GET /api/shared-rides/departures/mine` | driver |
| 4 | Seat map + passengers | `GET /api/shared-rides/departures/{departureId}` — seats have **`occupant`** (name, `pickupPin`, hold expiry) | driver |
| 5 | Post van GPS (~10–15s while trip active) | `PATCH /api/shared-rides/departures/{departureId}/location` `{ lat, lng }` | driver |
| 6 | Start loading | `PATCH /api/shared-rides/departures/{departureId}/status` `{ "status": "boarding" }` | driver |
| 7 | Finish trip | `PATCH …/status` `{ "status": "completed" }` | driver |
| 8 | Cancel if needed | `PATCH …/status` `{ "status": "cancelled" }` | driver |

**Call-in passenger (phone booking):** When the van is almost full and someone calls — driver enters phone + seat on the map:

| Step | API | Notes |
|------|-----|--------|
| Driver creates call-in | `POST /api/shared-rides/departures/{departureId}/call-in-bookings` `{ phone, seatNumbers, pickup?, passengerName? }` | Creates passenger account in background if needed |
| SMS to passenger | (backend) | Pay link only — **no password** |
| Passenger pays (no app login) | `GET /api/shared-rides/pay-invites/{token}` | **No JWT** |
| Passenger starts M-Pesa | `POST /api/shared-rides/pay-invites/{token}/pay` `{ provider: "mpesa", phone }` | **No JWT** |

Hold for call-in: **24h** if van leaves today (Nairobi date), **72h** if departure is a later calendar day, always capped **1 hour before** `departureAt`.

`to_sgr` call-ins need neighborhood **`pickup`**; `from_sgr` optional.

---

## Departure lifecycle (driver + passenger)

```
scheduled → boarding → completed
         ↘ cancelled
```

| Status | Passenger | Driver |
|--------|-----------|--------|
| `scheduled` | Reserve / pay; see seat map | Location updates allowed; call-in allowed |
| `boarding` | Poll `GET /departures/{id}` for `driverLocation` | Keep posting location |
| `completed` | View-only / history | Location updates return **409** `DEPARTURE_NOT_ACTIVE` |
| `cancelled` | — | Trip ended |

---

## APIs outside `/api/shared-rides` you still need

| API | Used for |
|-----|----------|
| `POST /api/bookings/{id}/pay` | Passenger in-app checkout after `…/bookings` (shared_sgr product) |
| `GET /api/bookings/{id}` | Booking status |
| `POST /api/devices/...` | Push for `shared_ride_matched` |
| `GET /api/notifications` | Inbox |
| `POST /api/drivers/me/vehicle` | Register van + `seats` (+ optional `seatLayout`) before driver shared flows |
| `/api/rides/*` | Normal point-to-point rides (not shared van) |

**Dev:** `ALLOW_DEV_PAYMENT_CONFIRM=true` auto-marks booking paid (no STK).

---

## What is new vs Laravel reference app

| Area | Laravel (`songa/`) | This backend |
|------|-------------------|--------------|
| Trip suggestions | — | **`GET /suggestions`** + empty-search suggestions |
| Boarding status | Mostly `scheduled` / `completed` | Adds **`boarding`** |
| Neighborhood GPS | Weak / note only | **`pickup` on reserve**, `occupant.pickupPin` for driver |
| Van GPS on trip | `driver_lat` / `driver_lng` on Trip | **`PATCH …/departures/{id}/location`**, `driverLocation` on GET |
| Call-in pay | Required existing user + 72h hold | **Creates user by phone**, pay link **without login**, smart 24h/72h hold |
| Seat labels | A1, B2 grid | **`seatLabel`** + `seatNumber` index |
| Private ride from shared | — | Use existing **`/api/rides/*`** (not a shared endpoint) |

---

## Not included (do not build against these yet)

| Feature | Notes |
|---------|--------|
| Refer call-in to another driver’s van | Backlog |
| Driver wallet on shared prepay | **Live** — credits full seat `subtotal` on pay; `GET /api/drivers/me/wallet` |
| Songa billing (daily flat **or** % holdback + weekly payout) | Backlog — see **Money** section above; Joseph: fare-only checkout for now |
| Uber-style per-passenger `Ride` phases on shared van | Not Laravel parity — use van GPS + pins only |
| Admin catalog from mobile | Use admin API / seed only |
| Guest pay without call-in | Only **`pay-invites/{token}`** after driver call-in (or extend later) |

See [docs/backlog/shared-rides.md](./backlog/shared-rides.md).

---

## Suggested build order for mobile

1. **Passenger:** resolve zone → search → (suggestions → trip request) → departure detail → reserve → booking → pay.  
2. **Notifications:** `shared_ride_matched` → open departure id.  
3. **Driver:** trip-requests board → join → departures/mine → detail seat map → location loop → status.  
4. **Call-in + guest pay screen** (WebView or in-app route for `pay-invites` token).  
5. **Post-pay:** poll departure for `driverLocation`.

---

## Quick endpoint index

### Passenger (JWT)

- `POST /corridor-locations/resolve`
- `GET /corridor-locations`, `GET /corridor-locations/{slug}`
- `GET /suggestions`
- `GET /departures/search`
- `POST /trip-requests`, `GET /trip-requests/mine`
- `GET /departures/{id}`
- `POST /departures/{id}/seats/reserve`, `POST …/seats/release`
- `POST /departures/{id}/bookings`
- `POST /api/bookings/{id}/pay`

### Driver (JWT)

- `GET /trip-requests`, `POST /trip-requests/{id}/join`
- `POST /departures`, `GET /departures/mine`
- `GET /departures/{id}`, `PATCH /departures/{id}/status`, `PATCH /departures/{id}/location`
- `POST /departures/{id}/call-in-bookings`

### No JWT

- `GET /pay-invites/{token}`
- `POST /pay-invites/{token}/pay`
