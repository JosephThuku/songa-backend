# Stage 1 — Foundation + Auth

## 1. Goal

Stand up a runnable Node.js + TypeScript + Express + Prisma + PostgreSQL + Redis backend, with end-to-end OTP authentication: phone → 6-digit code → JWT session. After this stage, the mobile app can authenticate against `/api/auth/*` and call `/api/auth/me` with a valid session. No ride logic yet.

## 2. Mobile contracts touched

- `lib/_core/api.ts` — uses `Bearer` for native, cookies for web; calls `/api/auth/logout` (POST) and `/api/auth/me` (GET).
- `lib/_core/auth.ts` — stores `sessionToken` in SecureStore (native) / cookie (web); caches a `User` object locally.
- `hooks/use-auth.ts` — calls `Api.getMe()` and expects `{ user: ... }` envelope.
- `docs/backend-requirements.md` §2 — canonical contract.
- `data/mock-songa.json` — passenger and driver placeholder names and phone numbers for seed data.

**Contract gap to flag** (mobile-integrator will detail): mobile's `Auth.User` type today is `{ id: number, openId, name, email, loginMethod, lastSignedIn }` — an old OAuth shape. Requirements §2.3 / §2.4 specify the new shape `{ id: string, role, name, phone, email, avatarUrl, rating, createdAt, driverProfile? }`. Backend ships the requirements-spec shape; mobile needs `lib/_core/auth.ts` updated to consume it.

## 3. Prisma schema (initial — Stage 1 owns the whole base schema)

```prisma
// NEW — full initial schema

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum UserRole {
  passenger
  driver
}

enum OnboardingStatus {
  pending
  approved
  rejected
}

model User {
  id            String   @id @default(cuid())
  phone         String
  role          UserRole
  name          String?
  email         String?
  avatarUrl     String?
  rating        Float    @default(5.0)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  driverProfile DriverProfile?
  sessions      Session[]

  @@unique([phone, role])             // one human can be both passenger AND driver on same #
  @@unique([email, role])             // null emails allowed; uniqueness only enforced when set
  @@index([phone])
}

model DriverProfile {
  id               String           @id @default(cuid())
  userId           String           @unique
  user             User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  isOnline         Boolean          @default(false)
  acceptanceRate   Int              @default(100)
  onboardingStatus OnboardingStatus @default(approved)
  vehicleId        String?
  onlineSince      DateTime?
  createdAt        DateTime         @default(now())
  updatedAt        DateTime         @updatedAt
}

model OtpAttempt {
  id        String   @id @default(cuid())
  phone     String
  ip        String?
  success   Boolean
  createdAt DateTime @default(now())

  @@index([phone, createdAt])
  @@index([ip, createdAt])
}

model Session {
  id           String    @id @default(cuid())
  userId       String
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash    String    @unique          // SHA-256 of the JWT, for revocation lookup
  userAgent    String?
  ip           String?
  expiresAt    DateTime
  revokedAt    DateTime?
  createdAt    DateTime  @default(now())

  @@index([userId])
  @@index([expiresAt])
}
```

Migration name: `0001_init_auth`.

## 4. Folder layout

```
songa-backend/
├── .claude/agents/                  # (already created)
├── prisma/
│   ├── schema.prisma                # NEW — schema above
│   └── seed.ts                      # NEW — 1 passenger + 1 driver
├── src/
│   ├── index.ts                     # NEW — entrypoint, starts server
│   ├── app.ts                       # NEW — Express app factory (exported for tests)
│   ├── config/
│   │   └── env.ts                   # NEW — Zod-validated env loader
│   ├── lib/
│   │   ├── prisma.ts                # NEW — PrismaClient singleton
│   │   ├── redis.ts                 # NEW — Redis client, in-memory fallback for tests
│   │   ├── jwt.ts                   # NEW — sign / verify JWT
│   │   ├── otp.ts                   # NEW — generate / hash / verify OTP
│   │   ├── phone.ts                 # NEW — E.164 normalize/validate (libphonenumber-js)
│   │   ├── errors.ts                # NEW — AppError class, asyncHandler, error middleware
│   │   ├── logger.ts                # NEW — pino instance
│   │   └── responses.ts             # NEW — toUserDto(), toMeDto() — shape helpers
│   ├── middleware/
│   │   ├── require-auth.ts          # NEW
│   │   ├── require-role.ts          # NEW
│   │   └── rate-limit.ts            # NEW — Redis sliding-window, used on OTP routes
│   ├── routes/
│   │   ├── index.ts                 # NEW — mounts all route modules
│   │   └── auth.ts                  # NEW — /api/auth/*
│   └── services/
│       └── auth.service.ts          # NEW — sendOtp, verifyOtp, logout, getMe
├── tests/
│   ├── setup.ts                     # NEW — Vitest global setup
│   ├── helpers.ts                   # NEW — buildApp(), truncateDb()
│   └── auth.test.ts                 # NEW — see Test list below
├── .env.example                     # NEW
├── .gitignore                       # NEW
├── package.json                     # NEW
├── tsconfig.json                    # NEW
├── vitest.config.ts                 # NEW
├── README.md                        # OVERWRITE — quick start
├── PROGRESS.md                      # (already created)
├── STAGE_1_PLAN.md                  # this file
└── MOBILE_INTEGRATION_NOTES.md      # NEW — written by mobile-integrator at end of stage
```

## 5. Endpoint contracts

### POST `/api/auth/otp/send`

Body (Zod):
```json
{ "phone": "+254712345678", "role": "passenger" }
```
- `phone`: required, parsed by `libphonenumber-js`, must be a valid Kenya mobile (defaults to KE if no country code prefix).
- `role`: required, `"passenger" | "driver"`.

Response 200:
```json
{ "ok": true, "expiresInSeconds": 300 }
```

In `NODE_ENV !== "production"` AND the request includes header `x-dev-show-otp: 1`, also include `"devCode": "123456"` in the response so tests/dev clients can grab it.

Errors:
- 400 `INVALID_PHONE` — couldn't parse / not a Kenya mobile.
- 400 `INVALID_ROLE` — role not in enum.
- 429 `RATE_LIMITED` — 3 sends per phone per 15 min OR 10 per IP per minute.

### POST `/api/auth/otp/verify`

Body:
```json
{ "phone": "+254712345678", "code": "123456", "role": "passenger" }
```

Response 200 (exactly §2.3 shape):
```json
{
  "sessionToken": "<jwt>",
  "user": {
    "id": "usr_...",
    "role": "passenger",
    "name": "John Doe",
    "phone": "+254712000001",
    "email": "john@example.com",
    "avatarUrl": null,
    "rating": 4.9,
    "createdAt": "2025-01-15T10:00:00.000Z"
  }
}
```

For a driver login, the `user` object additionally includes `driverProfile` per §2.4.

Side effects:
- Get-or-create `User` by `(phone, role)`. If newly created, name/email/avatarUrl are `null`, rating defaults to 5.0. If role is `driver`, also create `DriverProfile` with onboardingStatus `approved` (Stage 1 short-circuit; real onboarding flow is Stage 8).
- Create `Session` row with `tokenHash = sha256(jwt)`, expiresAt = now + 30d.
- Log `OtpAttempt` with `success: true`. Failed attempts also logged with `success: false` (used for rate limiting analytics).
- Delete OTP key from Redis (one-shot).
- Web clients (User-Agent matches a browser pattern) ALSO get an `HttpOnly; Secure; SameSite=Lax` cookie named `songa_session` carrying the same JWT. Mobile clients (native fetch, no UA browser pattern) only receive the JSON.

Errors:
- 401 `INVALID_OTP` — wrong code OR no OTP in flight for that phone. Do not distinguish (don't leak whether phone exists).
- 400 `INVALID_PHONE` / `INVALID_ROLE`.
- 429 `RATE_LIMITED` — too many verify attempts.

### POST `/api/auth/logout`

Requires auth. Body: none.

Response 200: `{ "ok": true }`.

Side effects:
- Set `Session.revokedAt = now()` for the session whose `tokenHash` matches the presented JWT.
- If cookie auth, clear the cookie (`Max-Age=0`).

### GET `/api/auth/me`

Requires auth. No body.

Response 200 (exactly §2.4 shape):
```json
{
  "user": {
    "id": "usr_driver_001",
    "role": "driver",
    "name": "James Mwangi",
    "phone": "+254712345678",
    "email": "james@example.com",
    "avatarUrl": "https://cdn.songa.app/avatars/james.jpg",
    "rating": 4.92,
    "createdAt": "...",
    "driverProfile": {
      "isOnline": false,
      "acceptanceRate": 94,
      "vehicleId": "veh-1",
      "onboardingStatus": "approved"
    }
  }
}
```

For passengers, omit `driverProfile`. `createdAt` is the ISO timestamp.

Errors:
- 401 `UNAUTHORIZED` — missing / invalid / expired / revoked session.

## 6. Business rules & invariants

- OTP code: 6 digits, generated via `crypto.randomInt(100000, 1000000)`. Stored in Redis at key `otp:{role}:{phone}` as `sha256(code + OTP_PEPPER)`. TTL 300s. One-shot — delete on successful verify.
- Rate limit `/otp/send`: 3 per phone per 15 min (sliding window in Redis), 10 per IP per minute.
- Rate limit `/otp/verify`: 5 attempts per phone per 5 min before forcing a re-send.
- JWT: HS256, payload `{ sub: userId, role, sid: sessionId, iat, exp }`. Secret from `SESSION_JWT_SECRET`. Expiry 30 days.
- Auth middleware extraction order: 1) `Authorization: Bearer <token>`, 2) cookie `songa_session`. First hit wins.
- Phone normalization: every input passes through `libphonenumber-js` `.parsePhoneNumber(input, "KE").number` so all stored phones are E.164.
- Error response shape (§10) is enforced by a single error middleware. Never return raw stack traces.
- All response timestamps are ISO 8601 with milliseconds (`new Date().toISOString()`).

## 7. Open questions & defaults

- **Can the same phone hold both passenger AND driver accounts?** Spec says "one role per session". Default: yes, two distinct User rows (composite unique on `(phone, role)`). Recorded in PROGRESS.md.
- **Does failed OTP verify count toward the send rate-limit window?** Default: no. Send and verify limits are independent.
- **How long should the OTP send response say it's valid?** Mirror Redis TTL (300s). Mobile UI can show a 5-min countdown.

## 8. Test list (for the tester agent)

In `tests/auth.test.ts`:

- `POST /api/auth/otp/send` rejects an invalid phone with 400 `INVALID_PHONE`.
- `POST /api/auth/otp/send` rejects an invalid role with 400 `INVALID_ROLE`.
- `POST /api/auth/otp/send` returns 200 + `expiresInSeconds: 300` for a valid Kenya phone.
- `POST /api/auth/otp/send` returns the dev code in the response when `x-dev-show-otp: 1` and `NODE_ENV !== production`.
- `POST /api/auth/otp/send` does NOT return the dev code in production (smoke-test by overriding env in one case).
- `POST /api/auth/otp/send` rate-limits the 4th send to the same phone within 15 minutes (429 `RATE_LIMITED`).
- `POST /api/auth/otp/verify` returns 401 `INVALID_OTP` when no OTP was sent for that phone.
- `POST /api/auth/otp/verify` returns 401 `INVALID_OTP` when the code is wrong.
- `POST /api/auth/otp/verify` happy path returns 200 + `sessionToken` + user object with exact §2.3 fields.
- `POST /api/auth/otp/verify` for a driver returns a user with `driverProfile.onboardingStatus = "approved"`.
- `POST /api/auth/otp/verify` creates a `Session` row and `OtpAttempt success=true`.
- `POST /api/auth/otp/verify` is one-shot — re-using the same code immediately returns 401.
- Same phone can verify once as `passenger` and once as `driver`; two distinct users with distinct ids.
- `GET /api/auth/me` without `Authorization` returns 401 `UNAUTHORIZED`.
- `GET /api/auth/me` with a valid Bearer token returns the §2.4 shape (driver case includes driverProfile).
- `GET /api/auth/me` with an expired token returns 401.
- `GET /api/auth/me` with a revoked session (post-logout) returns 401.
- `POST /api/auth/logout` revokes the session and subsequent `/me` returns 401.

## 9. Out of scope for Stage 1

- Real SMS gateway (we'll log the OTP code to stdout in dev; Africa's Talking wiring is Stage 7).
- The web cookie's CSRF protection beyond `SameSite=Lax` (Stage 8 hardening).
- Onboarding document upload + KYC (Stage 8).
- /api/oauth/mobile and /api/auth/session — mobile has legacy OAuth code paths but those are not in the spec. We do NOT ship them. The mobile-integrator will tell mobile to remove or repurpose those.
