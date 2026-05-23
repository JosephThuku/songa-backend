#!/usr/bin/env bash
# Adds passwordHash + phoneVerified to User (password auth). Run from repo root in WSL.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "Pushing Prisma schema to DATABASE_URL..."
npx prisma db push
echo "Regenerating Prisma client..."
npx prisma generate
echo "Done. Restart the API server (npm run dev)."
