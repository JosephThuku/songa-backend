# Songa Backend — Build Progress

Tracks per-stage outcomes for the staged backend build. Source of truth for "what's done, what passed, what's open." Updated after every stage.

Mobile app this backend serves: `../songa-mobile-app` (React Native / Expo). Canonical contract: `../songa-mobile-app/docs/backend-requirements.md`.

---

## Stage 1 — Foundation + Auth

Status: **complete** — 2026-05-23

Goal: runnable server, DB connected, OTP auth end-to-end.

### Built

- Full TypeScript + Express 4 + Prisma + MySQL + Redis (in-memory fallback) scaffold.
- Prisma models: `User`, `DriverProfile`, `OtpAttempt`, `Session` + enums `UserRole`, `OnboardingStatus`. Composite unique `(phone, role)`.
- Endpoints: `POST /api/auth/otp/send`, `POST /api/auth/otp/verify`, `POST /api/auth/logout`, `GET /api/auth/me` — response shapes byte-equivalent to backend-requirements.md §2.3 / §2.4.
- OTP storage: SHA-256(code + pepper) in Redis, 300s TTL, one-shot.
- Sessions: JWT (HS256, 30d) + DB-backed `Session` row keyed by `sha256(token)` for revocation. Web clients also get an HttpOnly `songa_session` cookie (UA-detected).
- Rate limits (Redis sliding window): 10/IP/min + 3/phone/15min on send, 5/phone/5min on verify.
- Error shape per §10 via single error middleware.
- Seed: 1 passenger (`+254712000001`, "John Doe") + 1 driver (`+254712345678`, "James Mwangi") with approved DriverProfile.

### Tests

22/22 passing. See `tests/auth.test.ts`. The original 18 match STAGE_1_PLAN.md §8 one-for-one
(phone/role validation, dev-code header, rate limit 4th send → 429, invalid OTP, wrong code,
happy paths for both roles, one-shot consume, same-phone-distinct-roles, /me without auth, /me with valid/expired/revoked, logout).
Plus 4 signup tests (see "Stage 1 follow-up" below).

Test command: `npm test` (loads `.env.test`, points Prisma at `songa_test` MySQL DB).
Runtime: ~4s end-to-end.

### Stage 1 follow-up — signup + SMS — 2026-05-23

Added after the Stage 1 commit:

- **Signup via `/otp/verify`** — accepts optional `name` and `email`. Applied only when the user is being created on this call; ignored for returning users. Response gains `isNewUser: boolean` so mobile can route signup → onboarding vs login → home. Matches the passwordless / Uber pattern (no separate `/signup` endpoint).
- **SMS provider abstraction** at `src/lib/sms.ts`. Two impls: `ConsoleSmsProvider` (logs body to stdout — current dev behaviour) and `WasilianaProvider` (real HTTP). Env-selected: if `WASILIANA_API_KEY` is set, Wasiliana is used; otherwise console fallback. `sendOtp` service now dispatches the code — but failures don't fail the API call (the OTP is already stored, so a retry would still work).
- **Wasiliana HTTP adapter** at `src/lib/sms.wasiliana.ts` — placeholder request body keyed on a guess of the docs at https://docs.wasiliana.com/. Three `TODO(wasiliana-docs)` markers to finalize once we have the docs in hand: endpoint path, auth-header name, and request body keys. The provider gracefully falls back to console on failure in the meantime.

### Mobile integration

See `MOBILE_INTEGRATION_NOTES.md`. Verdict: **needs minor mobile changes**, no blockers.
Headline mismatch: `lib/_core/auth.ts` `User` type is old OAuth shape (`id: number, openId, loginMethod`); backend ships the spec-aligned shape (`id: string, role, phone, rating, ...`). Mobile must update the type and remove legacy `/api/oauth/mobile` + `/api/auth/session` references (not in spec, not shipped).

### Decisions made (from Open Questions §15 + stage-specific ambiguity)

- **Database:** MySQL 8 on localhost (not Postgres as the architect plan originally said). Switched mid-stage when default Postgres creds didn't work and user specified MySQL (user: `joe`, pwd: `2148`). Prisma `provider = "mysql"`. Affects future stages — keep MySQL-compatible SQL (no `TRUNCATE ... CASCADE`, no Postgres-specific arrays/json operators).
- **Phone uniqueness:** `(phone, role)` is unique, not `phone` alone. A single human can sign up both as passenger AND as driver on the same number — they get distinct `User` rows. Matches spec wording "one role per session" and mobile UX that switches at login/signup.
- **OTP storage:** SHA-256(code + server pepper) stored in Redis with 5min TTL. Plaintext code only exists transiently in the response of `otp/send` in dev mode (NODE_ENV=development), never in production.
- **Session strategy:** JWT (HS256, 30-day expiry) is the source of truth for "is this token valid for this user". A `Session` row is also created per login so we can revoke server-side (logout, security incident) by hashing the JWT and looking up `tokenHash`. Cookie-based auth for web wraps the same JWT in an HTTP-only cookie.
- **Mobile contract gap:** mobile app currently consumes the OLD OAuth-shaped User (`id: number, openId, loginMethod`) — backend ships the NEW spec-aligned shape (`id: string, role, phone, rating, createdAt`). Mobile will need updates in `lib/_core/auth.ts` and `lib/_core/api.ts`. See `MOBILE_INTEGRATION_NOTES.md` once written.

### Open questions deferred

- §15.1 dispatch model — deferred to Stage 4.
- §15.2 cancel-after-accept fee — deferred to Stage 2 (we'll log the cancel + reason in the event log, no fee charged yet).
- §15.3 platform fee — KSh 50 fixed (matches mobile mock), revisit in Stage 6.

---

## Stage 2–8

Pending.
