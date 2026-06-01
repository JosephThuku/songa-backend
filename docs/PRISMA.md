# Prisma client — avoid stale TypeScript errors

If the editor shows errors like:

```text
Property 'sgrScheduleSlot' does not exist on type 'PrismaClient'
Namespace 'Prisma' has no exported member 'CorridorLocationSelect'
```

the **database schema and `prisma/schema.prisma` are fine** — the **generated client** under `node_modules/.prisma/client` is out of date (or missing).

## Fix (every time after `git pull` that changes `schema.prisma`)

From **`songa-backend/`** (not the monorepo root):

```bash
npm run db:sync
```

That runs `prisma db push` + `prisma generate`.

Then in Cursor/VS Code: **Command Palette → “TypeScript: Restart TS Server”**.

## What we automate

| When | What runs |
|------|-----------|
| `npm install` | `postinstall` → `prisma generate` |
| `npm run dev` | `predev` → `ensure-prisma-client` + `db push` |
| `npm test` | `pretest` → `ensure-prisma-client` |
| `npm run typecheck` | `prisma generate` + `tsc` |
| Vitest `tests/setup.ts` | `prisma db push` (with generate) |

`scripts/ensure-prisma-client.ts` compares `schema.prisma` to the generated client and runs `prisma generate` when shared-rides models are missing or the schema is newer.

## Editor setup

1. Open the repo folder **`songa-backend`** as the workspace when working on the API (not the parent `songa_app` folder alone).
2. Run `npm run db:sync`, then **TypeScript: Restart TS Server** (Command Palette).
3. Install the **Prisma** extension (recommended via `.vscode/extensions.json`).
4. `tsconfig.json` includes `src/` and `tests/` so Prisma types apply in test files too; `npm run build` uses `tsconfig.build.json` (src only).

If errors persist after restart, run `npm run db:ensure-client` and confirm `node_modules/.prisma/client/index.d.ts` contains `get sgrScheduleSlot()`.

## App code convention

- **Enums / product types:** `src/domain/shared-rides.ts` (do not import Prisma enums in routes).
- **DB access:** `prisma.*` from `src/lib/prisma.ts`.
- **Avoid** `satisfies Prisma.SomeModelSelect` in hot paths if your IDE lags behind generate; prefer `as const` + small hand types in `src/services/shared-rides/shared-rides-prisma.ts`.
