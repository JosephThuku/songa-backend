# Songa backend — Docker (optional, local dev only)

**Default for the team:** use the **hosted Songa API**. Laptops run only the Expo app (`pnpm dev:metro` in `songa-mobile-app`). Do **not** start MySQL/Redis/API in Docker unless you are doing isolated backend work.

## Laptop setup (hosted API)

1. In `songa-mobile-app`, copy `.env.example` → `.env`
2. Set `EXPO_PUBLIC_API_BASE_URL` to your hosted API URL (staging or production)
3. Start Metro: `pnpm dev:metro` (or `npx expo start -c` after env changes)

See `songa-mobile-app/docs/DEV_NETWORKING.md` for emulator vs physical device URLs.

## Optional: full local stack

Only when you need a local API without touching hosted data:

```bash
cd songa-backend
docker compose -f docker-compose.local.yml up --build -d
curl http://localhost:4000/api/health
```

Then point the mobile app at `http://localhost:4000` (emulator: `http://10.0.2.2:4000`).

OTP codes appear in `docker compose -f docker-compose.local.yml logs -f api`.

Local compose sets `DB_SEED_PROFILE=dev` so the container runs the full dev seed (test users, demo drivers, shared-rides QA data).

## Production Docker (seed + migrate)

The image entrypoint (`docker/entrypoint.sh`) supports:

| Command | What it does |
|--------|----------------|
| `serve` (default) | `prisma migrate deploy` → optional seed → start API |
| `migrate` | Apply migrations only |
| `seed [profile]` | Run seed only (no server) |

**Seed profiles** (`DB_SEED_PROFILE` or first arg to `seed`):

| Profile | Script | Contents |
|---------|--------|----------|
| `none` | — | Skip seed (default for production unless configured) |
| `production` | `npm run db:seed:production` | Coast corridor zones + SGR schedule slots only |
| `dev` | `npm run db:seed` | Full dev seed (users, drivers, demo departures) |
| `shared-rides` | `npm run db:seed:shared-rides` | Shared-rides catalog + dev demo data |

**First production deploy** — set env on the API service:

```bash
DB_SEED_PROFILE=production
# optional: upsert ops admin on first run
SEED_ADMIN_PASSWORD=<strong-password>
```

**One-off seed** (e.g. after deploy, without restarting the server):

```bash
docker compose run --rm api /entrypoint.sh seed production
# or inside a running container:
docker exec <container> /entrypoint.sh seed production
```

Legacy: `RUN_DB_SEED=false` skips seeding; `RUN_DB_SEED=true` without `DB_SEED_PROFILE` runs the dev seed (local docker-compose compatibility).

After catalog seed, shared rides endpoints (`/api/shared-rides/corridor-locations`, `/api/shared-rides/sgr-schedule-slots`) are populated. Demo departures and test accounts are **not** created in production profile.

## Troubleshooting (when using local stack)

| Symptom | Likely cause |
|--------|----------------|
| App hits wrong server | `.env` still has `localhost:4000` while you meant hosted URL (or the reverse) |
| Port 4000 in use | Old local stack still running — `docker compose -f docker-compose.local.yml down` |
| Slow first boot | MySQL init + DB seed on first `up` |
| 401 / empty data | Hosted vs local mismatch — pick one API URL and restart Expo with `-c` |

`Dockerfile` in this repo is for building the API image (e.g. server deploy). It is **not** part of the normal mobile dev workflow.
