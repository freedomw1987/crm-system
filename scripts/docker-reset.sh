#!/usr/bin/env bash
# Reset CRM stack — stop, remove containers + volumes.
# WARNING: This deletes all data!
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> This will DELETE all CRM data (database, uploads, etc.)"
read -p "    Continue? [y/N] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "==> Aborted."
  exit 0
fi

docker compose down -v --remove-orphans
echo "==> Stack reset complete."
echo "    Run ./scripts/docker-dev.sh --seed to start fresh."
