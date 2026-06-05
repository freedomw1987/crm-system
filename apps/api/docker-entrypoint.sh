#!/bin/sh
set -e

echo "==> [entrypoint] Running database migrations..."
# Schema is at /app/packages/db/prisma/schema.prisma in the runtime image
if [ -z "$SKIP_MIGRATE" ]; then
  cd /app/packages/db
  bunx prisma migrate deploy
  cd /app
else
  echo "==> [entrypoint] SKIP_MIGRATE set, skipping migrations"
fi

# Optional seed (only if SEED_DB=true)
if [ "$SEED_DB" = "true" ]; then
  echo "==> [entrypoint] SEED_DB=true, seeding database..."
  cd /app/packages/db
  bun run prisma/seed.ts
  cd /app
fi

echo "==> [entrypoint] Starting API server..."
cd /app
exec "$@"
