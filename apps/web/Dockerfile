# ====================================================================
# CRM Web — Multi-stage Dockerfile
# Stage 1: Build SPA with Vite
# Stage 2: Serve static files + reverse proxy /api to api:3001
# Base: oven/bun:1.2.23 — PINNED (P1-11, 2026-06-26)
# Match apps/api/Dockerfile. Don't bump without regenerating bun.lock.
# ====================================================================

# ---- Stage 1: build ----
FROM oven/bun:1.2.23 AS builder

USER root
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace package files
COPY package.json bunfig.toml tsconfig.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/db/package.json ./packages/db/
COPY packages/ai/package.json ./packages/ai/
COPY packages/shared/package.json ./packages/shared/

RUN bun install --frozen-lockfile

# Copy source
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

WORKDIR /app/apps/web

# Build args can be used to inject API base URL at build time
ARG VITE_BASE_PATH=/
ARG VITE_API_BASE=/api
ENV VITE_BASE_PATH=$VITE_BASE_PATH
ENV VITE_API_BASE=$VITE_API_BASE

RUN bun run build

# ---- Stage 2: nginx ----
FROM nginx:1.27-alpine AS runtime

# Copy built assets
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# Copy nginx config (SPA fallback + /api reverse proxy)
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -fsS http://localhost/health || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
