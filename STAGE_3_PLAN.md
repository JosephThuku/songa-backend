# Stage 3 — Real-Time Ride Sync (SSE)

## 1. Goal

Replace mobile-side ride phase polling/timers with a server-authoritative real-time stream. Stage 3 ships SSE, not WebSocket, because the current Express app has no socket server and the required Stage 3 traffic is server-to-client: active ride snapshots and phase updates.

## 2. Endpoint

### GET `/api/rides/active/stream`

Auth: Bearer token or `songa_session` cookie.

Response: `text/event-stream`.

Events:

```json
{ "type": "ride.updated", "ride": { "id": "ride_...", "phase": "driver_accepted" } }
{ "type": "ride.ended", "rideId": "ride_...", "phase": "trip_ended" }
```

Behavior:

- On connect, immediately sends the caller's active ride as `ride.updated`, or `{ "type": "ride.updated", "ride": null }`.
- Emits `ride.updated` after every Stage 2 ride mutation: request, accept, cancel, decline visibility no-op, arrived, start, complete.
- Emits `ride.ended` when a ride reaches `trip_ended`.
- Reuses the same DTO masking rules as REST by hydrating the ride per subscriber before writing.
- Sends comment heartbeats so proxies do not close idle streams.
- On reconnect, mobile should still call `GET /api/rides/active` to resync.

## 3. New files

```text
src/lib/ride-events.ts     # in-process event bus for Stage 3
tests/ride-stream.test.ts  # SSE integration tests
```

## 4. Out of scope

- `ride.offer` dispatch events. Stage 4 adds driver location + dispatch.
- Driver location streaming and ETA ticks. Stage 4 adds `POST /api/drivers/me/location`.
- Push notifications. Stage 7.

## 5. Tests

- Connecting to `/api/rides/active/stream` without auth returns `401`.
- Passenger stream receives an initial `ride.updated` for an active ride.
- Passenger stream receives `ride.updated` when a driver accepts.
- Driver stream receives `ride.updated` when the driver starts the trip.
- Passenger stream receives `ride.ended` when the driver completes the trip.

