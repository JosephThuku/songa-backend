#!/usr/bin/env bash
set -euo pipefail
API_KEY="${WASILIANA_API_KEY:?set WASILIANA_API_KEY}"
SENDER="${WASILIANA_SENDER_ID:?set WASILIANA_SENDER_ID}"
TO="${1:-254110919165}"
MSG="${2:-Songa curl test}"

curl -sS -w "\nHTTP %{http_code}\n" -X POST "https://api.wasiliana.com/api/v1/send/sms" \
  -H "Content-Type: application/json" \
  -H "apiKey: ${API_KEY}" \
  -d "{\"recipients\":[\"${TO}\"],\"from\":\"${SENDER}\",\"message\":\"${MSG}\",\"is_otp\":true}"
