# Mobile Integration Notes

Updated after mobile ↔ backend integration (auth, rides, realtime, driver location).

## Realtime transport

| Layer | Implementation |
|--------|----------------|
| **Backend** | Socket.io on `/socket.io` (JWT in handshake) + SSE fallback `GET /api/rides/active/stream` |
| **Mobile** | `socket.io-client` in `lib/realtime-client.ts`; `hooks/use-ride-sync.ts` |
| **Events** | `ride.updated`, `ride.offer` (drivers), `ride.ended` |
| **Resync** | On connect/reconnect: `GET /api/rides/active` |

## Wired in mobile app

| Feature | Mobile files | Backend endpoints |
|---------|--------------|-------------------|
| Password auth | `lib/_core/api.ts`, login/signup/otp-verify | `POST /register` → `POST /register/confirm` (OTP) → `POST /login`; `/me`, `/logout` |
| Request / cancel ride | `ride-flow-overlay.tsx`, `ride-api.ts` | `POST /api/rides/request`, `.../cancel` |
| Live ride state | `use-ride-sync.ts`, `passenger-realtime-sync.tsx` | Socket.io + `GET /api/rides/active` |
| Driver online | `driver-session-store.ts`, driver home | `PATCH /api/drivers/me/online` |
| Driver GPS | `use-driver-location.ts` | `POST /api/drivers/me/location` (15s) |
| Driver offers | driver home + socket | `ride.offer` → accept/decline API |
| Driver trip actions | `driver-ride-overlay.tsx` | arrived/start/complete |

## Still mock / partial

| Feature | Status |
|---------|--------|
| Passenger home cards | `songaMock.trips` — swap to `GET /api/drivers/nearby` when GPS available |
| Bookings / checkout | `checkout.tsx` — `ride-api` has booking helpers; UI not fully wired |
| Wallet / notifications tabs | Mock data; API clients exist on backend |
| Driver requests list | `songaMock.driverRequests` |

## Env (mobile)

```bash
EXPO_PUBLIC_API_BASE_URL=http://localhost:4000
```

Physical device: use LAN IP, not `localhost`.

## Verdict

**Core ride loop integrated** (request → socket updates → cancel; driver online → location → offer → accept → complete). Remaining work is discovery feed, bookings checkout, wallet/notifications UI.
