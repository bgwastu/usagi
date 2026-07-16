# ============================================
# Stage 1: Dependencies Installation Stage
# ============================================
# Bun multi-stage build based on the official Next.js with-docker example:
# https://github.com/vercel/next.js/tree/canary/examples/with-docker

FROM oven/bun:1 AS dependencies

WORKDIR /app

COPY package.json bun.lock* ./

RUN --mount=type=cache,target=/root/.bun/install/cache \
  bun install --no-save --frozen-lockfile

# ============================================
# Stage 2: Build Next.js application
# ============================================

FROM oven/bun:1 AS builder

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN bun run build

# ============================================
# Stage 3: Run Next.js application
# ============================================

FROM oven/bun:1 AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN mkdir -p public .next data && chown -R bun:bun .next data

COPY --from=builder --chown=bun:bun /app/public ./public
COPY --from=builder --chown=bun:bun /app/.next/standalone ./
COPY --from=builder --chown=bun:bun /app/.next/static ./.next/static

USER bun

EXPOSE 3000

CMD ["bun", "server.js"]
