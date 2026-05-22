# songa-backend

Node.js + TypeScript + Express + Prisma + PostgreSQL + Redis backend for the Songa mobile app.

## Stack

- Node.js 20+, TypeScript 5.x, ESM
- Express 4.x
- Prisma 5.x + PostgreSQL
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

# 3. Generate the Prisma client
npm run db:generate

# 4. Run the initial migration against your local Postgres
npm run db:migrate

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

## API surface — Stage 1

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/otp/send` | Send a 6-digit OTP to a Kenya phone number |
| `POST` | `/api/auth/otp/verify` | Exchange OTP for a session JWT (and web cookie) |
| `POST` | `/api/auth/logout` | Revoke the current session |
| `GET` | `/api/auth/me` | Return the authenticated user |

Detailed contracts live in [`STAGE_1_PLAN.md`](./STAGE_1_PLAN.md) and the mobile-side [`backend-requirements.md`](../songa-mobile-app/docs/backend-requirements.md).
