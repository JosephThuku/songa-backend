#!/bin/sh
set -e

echo "[songa-api] Applying database schema…"
npx prisma migrate deploy

if [ "${RUN_DB_SEED:-true}" = "true" ]; then
  echo "[songa-api] Seeding database (idempotent)…"
  npm run db:seed
fi

echo "[songa-api] Starting server on port ${PORT:-4000}…"
exec node dist/index.js
