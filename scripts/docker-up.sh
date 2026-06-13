#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "Building and starting Songa stack (MySQL + Redis + API)…"
docker compose up --build -d

echo ""
echo "Waiting for API health…"
for i in $(seq 1 60); do
  if curl -sf "http://localhost:4000/api/health" >/dev/null 2>&1; then
    echo "API is up: http://localhost:4000/api/health"
    curl -s "http://localhost:4000/api/health" | head -c 200
    echo ""
    echo ""
    echo "OpenAPI docs: http://localhost:4000/api/docs"
    echo "Mobile app:   EXPO_PUBLIC_API_BASE_URL=http://localhost:4000 pnpm dev:metro"
    exit 0
  fi
  sleep 2
done

echo "API did not become healthy in time. Check logs:"
echo "  docker compose logs -f api"
exit 1
