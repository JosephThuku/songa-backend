# songa-backend

Node.js, TypeScript, Express, Prisma, MySQL, Redis, Socket.IO, and OpenAPI backend for the Songa mobile app.

## What This Service Provides

- Passenger and driver authentication with phone OTP, password login, JWT sessions, and web cookies.
- Ride search, pricing, dispatch, live ride tracking, cancellation, completion, and driver rating.
- Driver onboarding, online status, GPS updates, nearby-driver lookup, wallet, and cashout.
- Seat-selection bookings, dev payment confirmation, and optional Safaricom M-Pesa STK/B2C callbacks.
- Places autocomplete/reverse geocoding through dummy local data or Google Places.
- Realtime updates through Socket.IO and an SSE fallback endpoint.
- Interactive API docs at `/api/docs` and raw OpenAPI JSON at `/api/openapi.json`.

## Requirements

- Node.js 20 or newer
- MySQL 8
- npm
- Redis is optional for local development; the app falls back to an in-memory Redis-compatible client when `REDIS_URL` is empty.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Create local environment config
cp .env.example .env

# 3. Edit .env and set at least:
# DATABASE_URL, SESSION_JWT_SECRET, OTP_PEPPER

# 4. Apply the Prisma schema and generate the Prisma client
npm run db:sync

# 5. Seed local passenger, driver, vehicle, and place data
npm run db:seed

# 6. Start the development server
npm run dev
```

By default the API listens on:

```text
http://localhost:4000
```

Useful local URLs:

| URL | Purpose |
| --- | --- |
| `GET /api/health` | Health check |
| `GET /api/docs` | Swagger UI |
| `GET /api/openapi.json` | Raw OpenAPI contract |
| `/socket.io` | Socket.IO realtime endpoint |
| `/uploads/*` | Public uploaded files |

## Local Development Notes

The default `.env.example` is set up for a productive local workflow:

- Leave `REDIS_URL=""` to use the in-memory fallback.
- Leave `USE_DUMMY_PLACES=true` to use `data/dummy-places.json` instead of Google Places.
- Keep `ALLOW_DEV_PAYMENT_CONFIRM=true` to auto-confirm booking payments in development.
- Set `GOOGLE_PLACES_API_KEY` or `GOOGLE_MAPS_API_KEY` only when you want real Google Places or traffic-aware routes.
- Configure the M-Pesa variables only when testing real Safaricom STK push or B2C cashouts.

Seeded login accounts and sample trips are documented in [docs/DEV_SEED.md](./docs/DEV_SEED.md).

## Common Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the API with `tsx watch src/index.ts` |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm run db:generate` | Generate the Prisma client |
| `npm run db:migrate` | Run `prisma migrate dev` |
| `npm run db:push` | Push the Prisma schema without creating a migration |
| `npm run db:sync` | Run `db:push` and `db:generate` |
| `npm run db:seed` | Seed local development data |
| `npm test` | Run the Vitest test suite once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run typecheck` | Run `tsc --noEmit` |
| `npm run lint` | Alias for `tsc --noEmit` |

## Environment Variables

See [.env.example](./.env.example) for the full list.

Required for boot:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | MySQL connection string used by Prisma |
| `SESSION_JWT_SECRET` | Secret for signing session JWTs; minimum 16 characters |
| `OTP_PEPPER` | Secret pepper for OTP hashing; minimum 8 characters |

Common optional variables:

| Variable | Purpose |
| --- | --- |
| `PORT` | API port, defaults to `4000` |
| `NODE_ENV` | `development`, `test`, or `production` |
| `TEST_DATABASE_URL` | Dedicated test database connection |
| `REDIS_URL` | Redis connection for queues, pub/sub, cache, and geo index |
| `CORS_ALLOW_ALL` | Allow any origin in local development |
| `CORS_ORIGINS` | Comma-separated production allowlist |
| `USE_DUMMY_PLACES` | Use local dummy place data |
| `GOOGLE_PLACES_API_KEY` | Google Places autocomplete/details/reverse geocoding |
| `GOOGLE_MAPS_API_KEY` | Google Directions traffic-aware routing |
| `ALLOW_DEV_PAYMENT_CONFIRM` | Auto-complete booking payments in dev/demo |
| `WASILIANA_API_KEY` | Real OTP SMS delivery |
| `EXPO_ACCESS_TOKEN` | Expo push notifications for enhanced-security projects |
| `MPESA_*` | Safaricom Daraja STK and B2C integration settings |

## Testing

Tests load `.env.test`, push the Prisma schema to the test database, reset data between tests, and use the in-memory Redis fallback by default.

```bash
npm test
npm run typecheck
```

Make sure `TEST_DATABASE_URL` points at a disposable MySQL database. The test setup truncates application tables.

## API And Architecture Documentation

For the route catalog, algorithm flows, ride state machine, realtime architecture, and technical diagrams, see [docs.md](./docs.md).

Existing focused docs:

| File | Purpose |
| --- | --- |
| [docs/DEV_SEED.md](./docs/DEV_SEED.md) | Seeded users, drivers, and sample dev trips |
| [docs/DUMMY_PLACES.md](./docs/DUMMY_PLACES.md) | Dummy place catalog and sample place queries |
| [docs/ROUTING.md](./docs/ROUTING.md) | Google Directions routing and ETA behavior |
| [MOBILE_INTEGRATION_NOTES.md](./MOBILE_INTEGRATION_NOTES.md) | Mobile/backend integration notes |
