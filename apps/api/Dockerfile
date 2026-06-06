# ====================================================================
# CRM API — Multi-stage Dockerfile
# Target: local deployment (Mac/Linux server, NAS, NUC)
# Base: oven/bun:1.2 (matches dev toolchain)
# ====================================================================

# ---- Stage 1: install + build ----
FROM oven/bun:1.2 AS builder

# Bun 1.2 base image is debian-slim. Install system deps for Prisma engine
# (libssl, ca-certificates) and curl for healthcheck.
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace package files first (better layer caching)
COPY package.json bunfig.toml tsconfig.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/db/package.json ./packages/db/
COPY packages/ai/package.json ./packages/ai/
COPY packages/shared/package.json ./packages/shared/

# Install ALL workspace deps (including dev for build)
RUN bun install --frozen-lockfile

# Copy source
COPY packages/db ./packages/db
COPY packages/ai ./packages/ai
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

# Generate Prisma client (writes to node_modules/@prisma/client + .prisma)
WORKDIR /app/packages/db
RUN bunx prisma generate

WORKDIR /app

# ---- Stage 2: runtime ----
FROM oven/bun:1.2 AS runtime

USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ca-certificates curl dumb-init \
    && rm -rf /var/lib/apt/lists/*

# Day N: pre-create the attachment upload directory. The Docker volume
# mount at /app/data/uploads in docker-compose.yml handles persistence
# across container recreations; the mkdir here just makes sure the
# in-container path exists the very first time the image runs (before
# the volume is mounted by compose).
RUN mkdir -p /app/data/uploads && chown -R bun:bun /app/data || true

WORKDIR /app

# Copy entire workspace from builder (Bun resolves TS directly)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api ./apps/api
COPY --from=builder /app/packages/db ./packages/db
COPY --from=builder /app/packages/ai ./packages/ai
COPY --from=builder /app/packages/shared ./packages/shared
# Prisma client is hoisted to root node_modules by Bun workspaces
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Entrypoint script
COPY apps/api/docker-entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/entrypoint

# Run as root for simplicity in local deployment.
# (For a more hardened setup, switch to USER bun and adjust file perms.)
# USER bun

ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fsS http://localhost:3001/health || exit 1

ENTRYPOINT ["dumb-init", "/usr/local/bin/entrypoint"]
CMD ["bun", "run", "apps/api/src/index.ts"]
