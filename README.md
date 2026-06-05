# CRM System

A modern CRM + quotation system with built-in AI Agent for sales teams.
Rebuild of `erp.sme-boardpro.com` CRM with AI-powered quotation assistant, customer analysis, and tool calling.

---

## ⚡ Quick start (Docker)

The fastest way to run the whole stack locally:

```bash
git clone git@david-dev-env:freedomw1987/crm-system.git
cd crm-system

# Build + start (with seeded admin users)
./scripts/docker-dev.sh --seed

# Open http://localhost
# Login: admin@crm.local / admin123
```

That's it — Postgres + API + Web (nginx) all running in containers.

---

## 🐳 Docker stack

| Service | Port | Image | Notes |
|---|---|---|---|
| `web`   | 80   | Custom (nginx 1.27-alpine) | SPA + reverse proxy `/api` → api:3001 |
| `api`   | 3001 (internal) | Custom (oven/bun:1.2) | Elysia + Prisma; not exposed to host |
| `postgres` | — | postgres:16-alpine | Data in named volume `crm_pgdata` |
| `adminer` | 8080 (opt-in) | adminer:4.8.1 | DB admin UI; only with `--profile with-adminer` |

### Common commands

```bash
./scripts/docker-dev.sh           # Start stack + tail logs
./scripts/docker-dev.sh --seed    # First-run: build + start + seed admin users
./scripts/docker-dev.sh --reset   # ⚠️ DELETE all data
./scripts/docker-dev.sh --logs    # Tail logs only
./scripts/docker-dev.sh --adminer # Also start adminer on :8080
```

### Production deployment

For a local "production-like" deployment (no adminer, stricter restart, baked images):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

### Environment variables

All set in `.env` at the project root (copy `.env.example`):

| Var | Default | Notes |
|---|---|---|
| `POSTGRES_USER` | `crm` | DB user |
| `POSTGRES_PASSWORD` | `crm_dev_password` | **Change for prod** |
| `POSTGRES_DB` | `crm_system` | DB name |
| `JWT_SECRET` | dev default | **Must be long random in prod** |
| `OPENAI_API_KEY` | (empty) | Required for AI agent |
| `OPENAI_MODEL` | `gpt-4o-mini` | Override to use GPT-4 etc. |
| `WEB_PORT` | `80` | Host port for web |
| `ADMINER_PORT` | `8080` | Host port for adminer (when profile enabled) |
| `SEED_DB` | (empty) | Set to `true` to seed on first run |

---

## 🛠 Development (without Docker)

If you want hot-reload:

```bash
# 1. Start Postgres
docker compose up -d postgres

# 2. Install deps
bun install

# 3. Migrate + seed
cd packages/db && bunx prisma migrate dev && bunx prisma db seed

# 4. Start API (terminal 1)
cd apps/api && bun --env-file=../../.env --watch src/index.ts

# 5. Start Web (terminal 2)
cd apps/web && bun run dev
# → http://localhost:5173 (proxies /api → :3001)
```

---

## 🏗 Architecture

```
┌─────────────────────────────────────────┐
│  Browser  →  http://localhost           │
└──────────────┬──────────────────────────┘
               │
        ┌──────▼──────┐
        │  crm-web    │  nginx 1.27
        │  (port 80)  │  • serves SPA
        │             │  • proxies /api → api:3001
        └──────┬──────┘
               │
        ┌──────▼──────┐
        │  crm-api    │  Bun + Elysia + Prisma
        │  :3001      │  • REST endpoints
        │             │  • JWT auth
        │             │  • AI agent (OpenAI)
        └──────┬──────┘
               │
        ┌──────▼──────┐
        │  crm-postgres│  Postgres 16
        │  (internal)  │  Volume: crm_pgdata
        └─────────────┘
```

### Monorepo layout

```
crm-system/
├── apps/
│   ├── api/         # Bun + Elysia REST API
│   │   ├── src/
│   │   ├── Dockerfile
│   │   └── docker-entrypoint.sh
│   └── web/         # Vite + React 19 SPA
│       ├── src/
│       ├── Dockerfile
│       └── nginx.conf
├── packages/
│   ├── db/          # Prisma schema + client
│   ├── ai/          # OpenAI function-calling agent + tools
│   └── shared/      # Cross-package types/utils
├── scripts/
│   ├── docker-dev.sh
│   └── docker-reset.sh
├── docker-compose.yml
├── docker-compose.prod.yml
└── .env
```

---

## 🤖 AI Agent

The system has a built-in CRM-aware AI assistant (`/ai` page in web UI, or `POST /chat/send`).

**Available tools:**
- `search_companies` / `get_company` — Find customer details
- `search_products` — Product catalog lookup
- `list_quotations` / `list_deals` — Recent activity
- `draft_quotation` — Create a draft quotation from natural language
- `log_activity` — Log calls/emails/meetings
- `get_top_customers` — Revenue analysis

Example prompt:
> 「幫 ACME 開個 5 個 HW-MON-001 同 2 個 SVC-CONS-001 嘅 quotation」

The agent will:
1. Search for ACME's company ID
2. Look up HW-MON-001 and SVC-CONS-001 in the catalog
3. Call `draft_quotation` with structured line items
4. Return the new quotation ID

---

## 📚 Day-by-day progress

See `docs/PROGRESS.md` for the development log.
