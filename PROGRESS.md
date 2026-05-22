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

18/18 passing. See `tests/auth.test.ts`. Coverage matches STAGE_1_PLAN.md §8 one-for-one:
phone/role validation, dev-code header behavior, rate limit (4th send → 429), invalid OTP, wrong code,
happy paths for both roles, one-shot consume, same-phone-distinct-roles, /me without auth, /me with valid/expired/revoked, logout flow.

Test command: `npm test` (loads `.env.test`, points Prisma at `songa_test` MySQL DB).
Runtime: 3.8s end-to-end.

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
