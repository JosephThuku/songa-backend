# Songa API — Node 20 + Prisma + compiled TypeScript
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache openssl wget

COPY package.json package-lock.json ./
COPY prisma ./prisma/
COPY scripts/ensure-prisma-client.ts ./scripts/ensure-prisma-client.ts
COPY tsconfig.json tsconfig.build.json ./

RUN npm ci

COPY src ./src/

RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

RUN apk add --no-cache openssl wget

ENV NODE_ENV=production
ENV PORT=4000

COPY package.json package-lock.json ./
COPY prisma ./prisma/
COPY scripts/ensure-prisma-client.ts ./scripts/ensure-prisma-client.ts
COPY data ./data/
COPY src ./src/
COPY --from=builder /app/dist ./dist/
COPY docker/entrypoint.sh /entrypoint.sh

RUN npm ci --omit=dev \
  && npm install prisma@5.22.0 tsx --no-save \
  && npx prisma generate \
  && chmod +x /entrypoint.sh

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-4000}/api/health" >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/entrypoint.sh"]
