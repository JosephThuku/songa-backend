#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "WARNING: Local Docker stack — team default is the HOSTED API."
echo "Only use this for isolated backend development."
echo ""

docker compose -f docker-compose.local.yml up --build -d

echo ""
echo "Waiting for health..."
for i in $(seq 1 60); do
  if curl -sf http://localhost:4000/api/health >/dev/null 2>&1; then
    echo "API healthy at http://localhost:4000"
    break
  fi
  sleep 2
done

echo ""
echo "Mobile app (local API only): EXPO_PUBLIC_API_BASE_URL=http://localhost:4000"
echo "Logs: docker compose -f docker-compose.local.yml logs -f api"
