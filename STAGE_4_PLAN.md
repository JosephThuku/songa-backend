# Stage 4 — Driver Location, Nearby Feed, Basic Dispatch

## 1. Goal

Make online drivers discoverable and offer new ride requests to eligible drivers. This stage adds driver GPS storage, nearby search, and `ride.offer` delivery over the Stage 3 SSE stream. It does not add push notifications or offer timeout workers yet.

## 2. Schema changes

`DriverProfile` gains:

```prisma
location Json?
locationUpdatedAt DateTime?
```

`Ride.driverLocation` already exists from Stage 2 and is updated when the assigned driver posts location during an active ride.

## 3. Endpoints

### POST `/api/drivers/me/location`

Auth: driver only, approved, currently online.

Body:

```json
{ "lat": -1.2674, "lng": 36.807, "heading": 140, "speedKmh": 32, "accuracyM": 12, "recordedAt": "2025-05-22T14:01:05Z" }
```

Response: `204 No Content`.

### GET `/api/drivers/nearby?lat=&lng=&vehicleType=Car|Van|All&radiusKm=25`

Auth: passenger or driver.

Returns online approved drivers with fresh location (`locationUpdatedAt` within 60s), sorted by distance.

### POST `/api/rides/request`

Adds optional `preferredDriverId` and `listingId`. If `preferredDriverId` is present, dispatch only to that eligible driver first. Otherwise dispatch to online fresh drivers sorted by distance from pickup.

## 4. SSE additions

Driver subscribers to `GET /api/rides/active/stream` receive:

```json
{ "type": "ride.offer", "offer": { "rideId": "ride_...", "expiresAt": "..." } }
```

## 5. Tests

- Offline driver posting location gets `409 DRIVER_OFFLINE`.
- Online driver posting location gets `204`, and nearby returns that driver with distance/vehicle/location.
- Stale locations are excluded from nearby.
- Driver SSE stream receives `ride.offer` when an eligible passenger ride is requested.
- Assigned driver location updates `Ride.driverLocation` and emits `ride.updated`.

