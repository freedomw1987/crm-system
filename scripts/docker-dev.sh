#!/usr/bin/env bash
# One-shot dev stack launcher.
# Usage:
#   ./scripts/docker-dev.sh           # start stack (builds if needed)
#   ./scripts/docker-dev.sh --seed    # build, start, and seed database
#   ./scripts/docker-dev.sh --reset   # stop stack and remove volumes
#   ./scripts/docker-dev.sh --logs    # tail logs
#   ./scripts/docker-dev.sh --adminer # also start adminer UI on :8080
set -euo pipefail

cd "$(dirname "$0")/.."

case "${1:-up}" in
  up|"")
    echo "==> Building and starting stack..."
    docker compose up -d --build
    echo ""
    echo "==> Stack up! Tailing logs (Ctrl+C to exit)..."
    docker compose logs -f
    ;;
  --seed)
    echo "==> Building and starting with seed..."
    SEED_DB=true docker compose up -d --build
    echo "==> Waiting for API to be ready..."
    for i in 1 2 3 4 5 6 7 8 9 10; do
      if curl -fsS http://localhost:80/health >/dev/null 2>&1; then
        echo "==> Stack is up at http://localhost"
        echo "    Admin: admin@crm.local / admin123"
        exit 0
      fi
      sleep 2
    done
    echo "==> Stack did not become ready in time. Check: docker compose logs"
    exit 1
    ;;
  --reset)
    echo "==> Stopping and removing volumes..."
    docker compose down -v
    echo "==> Done. Run ./scripts/docker-dev.sh --seed to start fresh."
    ;;
  --logs)
    docker compose logs -f
    ;;
  --adminer)
    echo "==> Starting stack with adminer..."
    docker compose --profile with-adminer up -d --build
    echo "    Web:    http://localhost"
    echo "    Adminer: http://localhost:8080"
    ;;
  *)
    echo "Unknown arg: $1"
    echo "Usage: $0 [up|--seed|--reset|--logs|--adminer]"
    exit 1
    ;;
esac
