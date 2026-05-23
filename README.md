# songa-backend

Node.js + TypeScript + Express + Prisma + MySQL + Redis backend for the Songa mobile app.

## Stack

- Node.js 20+, TypeScript 5.x, ESM
- Express 4.x
- Prisma 5.x + MySQL 8
- Redis (via `ioredis`) with an in-memory fallback for tests / local dev when `REDIS_URL` is unset
- JWT sessions (`jsonwebtoken`)
- Zod for input validation
- `libphonenumber-js` for phone normalization
- `pino` + `pino-http` for structured logging
- `helmet`, `cors`, `cookie-parser`
- Tests: `vitest` + `supertest`

## Quick start

```bash
# 1. Install deps
npm install

# 2. Copy env template and fill in secrets
cp .env.example .env

# 3. Sync schema + Prisma client (required after pulling auth changes)
npm run db:sync

# 5. Seed the database (1 passenger + 1 driver)
npm run db:seed

# 6. Start the dev server
npm run dev
```

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the API with `tsx watch` for hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm run db:generate` | Generate the Prisma client |
| `npm run db:migrate` | Run `prisma migrate dev` |
| `npm run db:push` | Push schema without migrations (dev convenience) |
| `npm run db:sync` | `db:push` + `db:generate` (run after schema changes) |
| `npm run db:seed` | Run `prisma/seed.ts` |
| `npm test` | Run the Vitest test suite once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run typecheck` | `tsc --noEmit` |

## Environment variables

See [`.env.example`](./.env.example) for the full list. Required:

- `DATABASE_URL`
- `SESSION_JWT_SECRET`
- `OTP_PEPPER`

Optional:

- `TEST_DATABASE_URL` (tests)
- `REDIS_URL` (defaults to in-memory client)
- `PORT` (default 4000)
- `NODE_ENV`
- `CORS_ORIGINS` (comma-separated)

## API surface

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Start sign-up (sends OTP to phone) |
| `POST` | `/api/auth/register/confirm` | Confirm OTP and create account |
| `POST` | `/api/auth/login` | Sign in with phone or email + password |
| `POST` | `/api/auth/logout` | Revoke session |
| `GET` | `/api/auth/me` | Current user |
| `POST` | `/api/rides/request` | Request a ride |
| `GET` | `/api/rides/active` | Active ride snapshot |
| `GET` | `/api/rides/active/stream` | SSE ride updates |
| `GET` | `/api/rides/:rideId` | Ride detail |
| `POST` | `/api/rides/:rideId/{cancel,accept,decline,arrived,start,complete}` | Lifecycle transitions |
| `PATCH` | `/api/drivers/me/online` | Toggle driver online |
| `POST` | `/api/drivers/me/location` | Post GPS |
| `GET` | `/api/drivers/nearby` | Nearby online drivers |
| `GET` | `/api/drivers/me/wallet` | Driver wallet |
| `POST` | `/api/drivers/me/wallet/cashout` | Request cashout |
| `POST` | `/api/bookings` | Create seat booking |
| `POST` | `/api/bookings/:id/pay` | Start payment session |
| `GET` | `/api/bookings/:id` | Booking status |
| `GET` | `/api/notifications` | Notification inbox |
| `POST` | `/api/devices` | Register push token |
| `GET` | `/api/docs` | Swagger UI |
| `GET` | `/api/health` | Liveness |

Detailed contracts: [`STAGE_*_PLAN.md`](./STAGE_1_PLAN.md), [`PROGRESS.md`](./PROGRESS.md), and mobile [`backend-requirements.md`](../songa-mobile-app/docs/backend-requirements.md).
