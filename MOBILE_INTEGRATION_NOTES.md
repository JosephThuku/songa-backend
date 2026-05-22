# Mobile Integration Notes

This file tracks the gap between what the Songa backend currently ships and what the Songa mobile app currently consumes. Updated after every stage by the mobile-integrator.

## Stage 1 — Foundation + Auth — 2026-05-23

### 1. Endpoints shipped this stage

- `POST /api/auth/otp/send`
- `POST /api/auth/otp/verify`
- `POST /api/auth/logout`
- `GET  /api/auth/me`

### 2. Mobile call sites checked

| File | Function | What it calls |
|------|----------|---------------|
| `lib/_core/api.ts:120` | `logout()` | `POST /api/auth/logout` |
| `lib/_core/api.ts:136` | `getMe()` | `GET /api/auth/me` |
| `lib/_core/api.ts:94-117` | `exchangeOAuthCode()` | `GET /api/oauth/mobile` (NOT in Stage 1 spec) |
| `lib/_core/api.ts:146-172` | `establishSession()` | `POST /api/auth/session` (NOT in Stage 1 spec) |
| `hooks/use-auth.ts:25` | `useAuth.fetchUser()` calls `Api.getMe()` | `GET /api/auth/me` |

**Note:** The mobile app's OTP send/verify endpoints (for phone-based auth) are **not yet wired up** in the screens. Screens exist (`app/login.tsx`, `app/otp-verify.tsx`, `app/signup.tsx`) but the actual HTTP calls to `/api/auth/otp/send` and `/api/auth/otp/verify` are **missing**. This is intentional: mobile team is still building the auth UI against mock data. These will be wired on the mobile side once the OTP endpoints are live.

### 3. Contract mismatches

| Endpoint | Mobile expects | Backend ships | Severity | Mobile fix sketch |
|----------|----------------|---------------|----------|-------------------|
| `GET /api/auth/me` | `{ user: { id: number, openId, name, email, loginMethod, lastSignedIn } }` | `{ user: { id: string, role, name, phone, email, avatarUrl, rating, createdAt, driverProfile? } }` | **blocker** | `lib/_core/auth.ts` `User` type must change. Backend ships the canonical type (from requirements); mobile's `Auth.User` is an old OAuth shape. |
| `POST /api/auth/logout` | Response: `{ success: true }` (server mock) | Response: `{ ok: true }` | **cosmetic** | Mobile accepts either. No code change needed. |
| OAuth legacy | Mobile calls `/api/oauth/mobile` + `/api/auth/session` | Backend does NOT ship these. | **needed but deferred** | STAGE_1_PLAN.md §9 explicitly says "we do NOT ship /api/oauth/mobile or /api/auth/session". Mobile's OAuth code paths are legacy; backend will not implement them in Stage 1. Mobile should either (a) remove unused OAuth references, or (b) stub them post-login for now. |

### 4. Missing fields

Mobile app's `Auth.User` type (in `lib/_core/auth.ts:5-12`) expects:
- `id: number` — backend returns `id: string` ✓ (mismatch, but workable)
- `openId: string` — backend returns `role: "passenger" | "driver"` instead (breaking)
- `name: string | null` — backend returns `name: string | null` ✓
- `email: string | null` — backend returns `email: string | null` ✓
- `loginMethod: string | null` — backend does NOT return this (breaking)
- `lastSignedIn: Date` — backend returns `createdAt: string` (ISO 8601, not Date) instead (breaking)

**Backend also returns (mobile doesn't know about yet):**
- `phone: string` — required auth field, new in Stage 1
- `avatarUrl: string | null` — new in Stage 1
- `rating: number` — new in Stage 1
- `driverProfile?: { isOnline, acceptanceRate, vehicleId, onboardingStatus }` — driver-only, new in Stage 1

### 5. Endpoints mobile uses that don't exist in spec

| Endpoint | Mobile calls | Backend status | Stage 1 decision |
|----------|-------------|----------------|------------------|
| `GET /api/oauth/mobile` | Yes, `lib/_core/api.ts:101` | NOT implemented | Out of scope. STAGE_1_PLAN.md §9 explicitly excludes OAuth. Mobile team: remove or stub these after login. |
| `POST /api/auth/session` | Yes, `lib/_core/api.ts:150` | NOT implemented | Out of scope. Appears to be a web cookie-establishment endpoint for iframe flows. Not in requirements. Mobile team: remove if not needed for web preview. |

### 6. Mobile work required (punch list)

- [ ] **lib/_core/auth.ts** — Update `User` type to match backend `UserDto` shape: `{ id: string, role, name, phone, email, avatarUrl, rating, createdAt: string }`. Remove `openId`, `loginMethod`, `lastSignedIn`. Parse `createdAt` to Date if needed locally.
- [ ] **lib/_core/api.ts:127-142** — Update `getMe()` return type to match new `User` shape.
- [ ] **hooks/use-auth.ts:29-39** — Update user mapping after `Api.getMe()` call to construct the new shape. Handle optional `driverProfile` for drivers.
- [ ] **app/login.tsx** — Wire `POST /api/auth/otp/send` call before screen routing. Collect phone + role, send OTP, navigate to otp-verify screen with phone as param.
- [ ] **app/otp-verify.tsx** — Wire `POST /api/auth/otp/verify` call. Expect `{ sessionToken, user }` back. Store `sessionToken` in `SecureStore` (native) / cookie (web). Store `user` via `Auth.setUserInfo()`.
- [ ] **app/signup.tsx** — Similar OTP flow as login. `POST /api/auth/otp/send` with `role="passenger"` for new accounts.
- [ ] **server/_core/oauth.ts:99-129** — Remove or stub `/api/oauth/mobile` endpoint if this auth path is not intended for Stage 1. (Mobile currently tries to call it in `exchangeOAuthCode`; decide if keep for web preview or delete.)
- [ ] **lib/_core/api.ts:146-172** — Remove or stub `/api/auth/session` endpoint if only for web cookie flow. (Not in backend spec.)

### 7. Verdict

**Needs minor mobile changes.**

**Why:** Backend ships the **canonical contract** from requirements (`UserDto` with `role`, `phone`, `avatarUrl`, `rating`, `createdAt`). Mobile's `Auth.User` type is an old OAuth shape (`openId`, `loginMethod`, `lastSignedIn`) that diverges from the spec. This is a mobile-side fix: update the type, wire the OTP endpoints in the screens, and handle the new fields.

**Blockers:** None. The backend endpoints are spec-compliant and all four required endpoints (`/otp/send`, `/otp/verify`, `/logout`, `/me`) are shipped and tested. Mobile team can integrate once they update `Auth.User` and add OTP form submission logic.

**OTP endpoints not yet called from mobile:** This is expected. Screens exist but are not wired to the API. Mobile team will add the HTTP calls to `/api/auth/otp/send` and `/api/auth/otp/verify` when implementing the login/signup UX. The backend is ready to receive them.
