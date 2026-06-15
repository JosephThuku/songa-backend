#!/bin/sh
set -e

run_migrate() {
  echo "[songa-api] Applying database schema…"
  npx prisma migrate deploy
}

# DB_SEED_PROFILE: none | production | dev
# Legacy RUN_DB_SEED=false forces none; RUN_DB_SEED=true without profile defaults to dev.
resolve_seed_profile() {
  if [ "${RUN_DB_SEED:-}" = "false" ]; then
    echo "none"
    return
  fi

  profile="${DB_SEED_PROFILE:-}"
  if [ -z "$profile" ]; then
    if [ "${RUN_DB_SEED:-}" = "true" ]; then
      echo "dev"
      return
    fi
    echo "none"
    return
  fi

  echo "$profile"
}

run_seed() {
  profile="${1:-$(resolve_seed_profile)}"

  case "$profile" in
    none|"")
      echo "[songa-api] Database seed skipped (DB_SEED_PROFILE=none)."
      ;;
    production|prod)
      echo "[songa-api] Running production seed (catalog only)…"
      npm run db:seed:production
      ;;
    dev|development|full)
      echo "[songa-api] Running dev seed…"
      npm run db:seed
      ;;
    shared-rides)
      echo "[songa-api] Running shared-rides seed…"
      npm run db:seed:shared-rides
      ;;
    *)
      echo "[songa-api] Unknown DB_SEED_PROFILE=$profile (expected none, production, dev, shared-rides)." >&2
      exit 1
      ;;
  esac
}

start_server() {
  echo "[songa-api] Starting server on port ${PORT:-4000}…"
  exec node dist/index.js
}

case "${1:-serve}" in
  migrate)
    run_migrate
    ;;
  seed)
    shift
    run_seed "${1:-$(resolve_seed_profile)}"
    ;;
  serve)
    run_migrate
    run_seed
    start_server
    ;;
  *)
    echo "[songa-api] Unknown command: $1 (expected serve, migrate, seed)." >&2
    exit 1
    ;;
esac
