# CRM System

A modern CRM + quotation platform with a built-in AI sales agent.
Polymorphic quotation line items, drag-and-drop deal pipeline, role-based
access control, and a Postgres-backed audit log.

> Rebuild of `erp.sme-boardpro.com` with an AI-aware data model and
> a strict dev/staging/prod environment split.

---

## ⚡ Quick start (Docker)

The fastest way to run the whole stack locally:

```bash
git clone git@david-dev-env:freedomw1987/crm-system.git
cd crm-system

# Build + start (with seeded admin users)
./scripts/docker-dev.sh --seed

# Open http://localhost
# Login: admin@crm.local / admin123  (or sales@crm.local / sales123)
```

`docker-dev.sh` will:
- copy `.env.example` to `.env` if missing
- auto-generate `AI_CONFIG_ENCRYPTION_KEY` and `JWT_SECRET` if the
  `__GENERATE_*__` placeholders are still in `.env` (both are 32-byte
  hex secrets; missing/weak values cause the API to refuse to boot)
- run `SEED_DB=true docker compose up -d --build`
- wait for the API health check to pass before exiting

If you want to manage `.env` yourself, you can skip the wrapper and
run `docker compose up -d --build` directly, as long as `.env` has
real values for everything the compose file requires.

Postgres + API + Web (nginx) all run in containers. The script
also tails the API logs so you can watch migrations and seed output.

---

## 🐳 Docker stack

| Service      | Port          | Image                          | Notes                                                         |
| ------------ | ------------- | ------------------------------ | ------------------------------------------------------------- |
| `web`        | 80            | Custom (nginx 1.27-alpine)     | SPA + reverse proxy `/api` → `api:3001`                       |
| `api`        | 3001 (int.)   | Custom (oven/bun:1.2)          | Elysia + Prisma; not exposed to the host                      |
| `postgres`   | —             | postgres:16-alpine             | Data in named volume `crm_pgdata`                             |
| `adminer`    | 8080 (opt-in) | adminer:4.8.1                  | DB admin UI; only with `--adminer` or `PROFILE=with-adminer`  |

### Common commands

```bash
./scripts/docker-dev.sh            # Start stack + tail logs
./scripts/docker-dev.sh --seed     # First-run: build + start + seed admin users
./scripts/docker-dev.sh --reset    # ⚠️  Wipe Postgres volume + restart
./scripts/docker-dev.sh --logs     # Tail logs only
./scripts/docker-dev.sh --adminer  # Also start adminer on :8080
./scripts/docker-dev.sh --rebuild  # Force rebuild of api + web images
```

### Production deployment

For a local "production-like" deployment (no adminer, baked images,
stricter restart policy):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

### Environment variables

All set in `.env` at the project root. The shipped `.env.example` uses
`__GENERATE_*__` placeholders for secrets — `./scripts/docker-dev.sh`
auto-fills them on first run. If you manage `.env` by hand, fill in:

| Var                          | Default                       | Notes                                                                                                |
| ---------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| `POSTGRES_USER`              | `crm`                         | DB user                                                                                              |
| `POSTGRES_PASSWORD`          | `crm_dev_password`            | **Must change for prod**                                                                             |
| `POSTGRES_DB`                | `crm_system`                  | DB name                                                                                              |
| `JWT_SECRET`                 | dev default / `__GENERATE`    | **Must be ≥ 32 chars.** The API hard-fails at boot if shorter. Use `openssl rand -hex 32`.           |
| `AI_CONFIG_ENCRYPTION_KEY`   | `__GENERATE`                  | **Must be 64 hex chars (32 bytes).** Used to AES-256-GCM encrypt the admin-supplied OpenAI key. Use `openssl rand -hex 32`. Compose fails fast with `${VAR:?...}` if missing. |
| `CORS_ORIGIN`                | `http://localhost,http://localhost:5173` | Comma-separated Origin allowlist forwarded to the API. Include both the compose web port and the vite dev port if you `bun run dev:web` against the same `.env`. |
| `OPENAI_API_KEY`             | (empty)                       | Required for the AI agent (admin can also set it from the /admin/ai-config page)                     |
| `OPENAI_MODEL`               | `gpt-4o`                      | Override to use a different model                                                                    |
| `API_PORT`                   | `3001`                        | Internal API port                                                                                    |
| `WEB_PORT`                   | `80`                          | Host port for `web`                                                                                  |
| `ADMINER_PORT`               | `8080`                        | Host port for `adminer` (when profile enabled)                                                       |
| `SEED_DB`                    | (empty)                       | Set to `true` to run `prisma/seed.ts` on container start. The `--seed` flag in `docker-dev.sh` sets this for you. |
| `SKIP_MIGRATE`               | (empty)                       | Set to `1` to skip `prisma migrate deploy` on start                                                  |
| `BACKUP_KEEP_DAYS`           | `7`                           | Retention for the `backup` profile's `pg_dump` cron                                                  |

---

## 🛠 Development (without Docker)

Hot-reload workflow if you don't want the containerised stack:

```bash
# 1. Start Postgres
docker compose up -d postgres

# 2. Install workspace deps
bun install

# 3. Migrate + seed
bun db:migrate         # runs `prisma migrate dev`
bun db:seed            # runs `prisma/seed.ts`

# 4. Start API (terminal 1) — watches src/, restarts on change
cd apps/api
bun --env-file=../../.env --watch src/index.ts

# 5. Start Web (terminal 2) — Vite dev server with HMR
cd apps/web
bun run dev            # → http://localhost:5173, /api proxied to :3001
```

Top-level convenience:

```bash
bun run dev            # runs `dev` in every workspace (api + web in parallel)
bun run build          # typecheck + build all workspaces
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
        │  :3001      │  • REST endpoints (12 route groups)
        │             │  • JWT auth + RBAC
        │             │  • AI agent tool-calling loop
        │             │  • Audit log middleware
        └──────┬──────┘
               │
        ┌──────▼──────┐
        │ crm-postgres│  Postgres 16
        │  (internal) │  Volume: crm_pgdata
        └─────────────┘
```

### Monorepo layout

```
crm-system/
├── apps/
│   ├── api/                       # Bun + Elysia REST API
│   │   ├── src/
│   │   │   ├── routes/            # 12 route groups (see API table below)
│   │   │   ├── middleware/        # rbac.ts, audit.ts
│   │   │   └── index.ts           # Elysia entry
│   │   ├── Dockerfile
│   │   └── docker-entrypoint.sh   # runs `prisma migrate deploy` on start
│   └── web/                       # Vite + React 19 SPA
│       ├── src/
│       │   ├── pages/             # 15 routes (see Frontend table)
│       │   ├── components/        # shared (quotation-builder, product-dialog, ui/)
│       │   ├── lib/               # api.ts (typed client), auth, utils
│       │   └── index.css
│       ├── Dockerfile
│       └── nginx.conf
├── packages/
│   ├── db/                        # Prisma schema + migrations + seed
│   ├── ai/                        # OpenAI function-calling agent + 8 tools
│   └── shared/                    # Cross-package types/utils
├── scripts/
│   ├── docker-dev.sh              # The main dev entry point
│   ├── docker-reset.sh
│   ├── backup.sh / restore.sh
│   └── backup-container.sh
├── docker-compose.yml
├── docker-compose.prod.yml
└── .env
```

---

## 🔌 API surface (12 route groups)

| Prefix        | File                  | Highlights                                                         |
| ------------- | --------------------- | ------------------------------------------------------------------ |
| `/auth`       | `auth.ts`             | Login, `/me`, change password                                      |
| `/companies`  | `company.ts`          | CRUD + region filter                                               |
| `/contacts`   | `contact.ts`          | CRUD                                                               |
| `/products`   | `product.ts`          | CRUD + inventory + audit-logged                                    |
| `/services`   | `service.ts`          | CRUD + man-day breakdown + SOW + audit-logged                      |
| `/quotations` | `quotation.ts`        | CRUD + polymorphic line items (PRODUCT/SERVICE) + status workflow  |
| `/deals`      | `deal.ts`             | CRUD + Kanban view + `PATCH /:id/stage` for drag-drop              |
| `/pipelines`  | (inside `deal.ts`)    | Pipeline + stage management                                        |
| `/users`      | `users.ts`            | CRUD + activate/deactivate + reset password                        |
| `/roles`      | `roles.ts`            | Dynamic RBAC roles + permission matrix                             |
| `/regions`    | `region.ts`           | Region catalogue (HK/MO/CN/OTHER)                                  |
| `/chat`       | `chat.ts`             | AI agent — list/get conversations, `POST /send` to run             |
| `/audit`      | `audit.ts`            | Audit log reader (admin)                                           |

All routes (except `/auth` and `/health`) require JWT in `Authorization: Bearer <token>`.
Mutating routes additionally require a permission key (e.g. `product:write`).
The full permission catalogue is exposed at `GET /roles/permissions`.

---

## 🤖 AI Agent

The system has a built-in CRM-aware AI assistant.
Use it in the web UI at `/ai-chat` or directly via `POST /chat/send`.

**Available tools:**

| Tool                | Purpose                                                    |
| ------------------- | ---------------------------------------------------------- |
| `search_companies`  | Find companies by name/region                             |
| `get_company`       | Full company + recent deals + quotations                   |
| `search_products`   | Product catalogue search                                   |
| `list_quotations`   | Recent quotations, optionally filtered by company/status   |
| `list_deals`        | Recent deals in the pipeline                               |
| `draft_quotation`   | Create a draft quotation with structured line items        |
| `log_activity`      | Log calls / emails / meetings on a deal                   |
| `get_top_customers` | Revenue analysis                                           |

Example prompt:

> 「幫 ACME 開個 5 個 HW-MON-001 同 2 個 SVC-CONS-001 嘅 quotation」

The agent will:
1. Search for ACME's company ID
2. Look up HW-MON-001 and SVC-CONS-001 in the catalogue
3. Call `draft_quotation` with structured line items
4. Return the new quotation ID

---

## 🖥 Frontend routes (15 pages)

| Route                          | Page                       | Purpose                                              |
| ------------------------------ | -------------------------- | ---------------------------------------------------- |
| `/login`                       | `login.tsx`                | Email/password login                                 |
| `/dashboard`                   | `dashboard.tsx`            | KPI cards + recent activity                          |
| `/companies`                   | `companies.tsx`            | List + filter (region, status)                       |
| `/companies/:id`               | `company-detail.tsx`       | Detail + linked contacts/quotations/deals            |
| `/products`                    | `products.tsx`             | Catalogue + inventory                                |
| `/services`                    | `services.tsx`             | Service catalogue + SOW + man-day breakdown          |
| `/services/:id`                | `service-detail.tsx`       | Edit service + manage man-day rows                   |
| `/quotations`                  | `quotations.tsx`           | List of all quotations                               |
| `/quotations/:id`              | `quotation-detail.tsx`     | View + status workflow                               |
| `/quotations/new`              | (uses `QuotationBuilder`)  | Polymorphic line item builder                        |
| `/deals`                       | `deals.tsx`                | Kanban board with drag-and-drop                      |
| `/users`                       | `users.tsx`                | User management (admin)                              |
| `/users/:id`                   | `user-detail.tsx`          | Edit user + role                                     |
| `/roles`                       | `roles.tsx`                | RBAC role + permission matrix (admin)                |
| `/ai-chat`                     | `ai-chat.tsx`              | AI assistant UI                                      |
| `/audit`                       | `audit.tsx`                | Audit log viewer (admin)                             |

---

## 🗄 Database

Prisma schema lives at `packages/db/prisma/schema.prisma`.
Migrations are timestamp-prefixed SQL files in `packages/db/prisma/migrations/`
(applied in lexical order — newer numbers run after older).

**Models** (in dependency order):

```
User, Role, Company, Contact, Address, Tag, CompanyTag,
Product, Service, ServiceManDay,
Pipeline, PipelineStage, Deal, ActivityLog,
Quotation, QuotationItem, Conversation, ConversationMessage, AuditLog, Region
```

For day-by-day migration history, see `docs/PROGRESS.md`.

---

## 🧪 Quality gates

- `bun run build` — typecheck + build all workspaces
- `bun run typecheck` (per workspace) — `tsc --noEmit --skipLibCheck`
- `apps/api` and `apps/web` both have a top-level `typecheck` script

> The Elysia 1.2 type definitions have known TS 5.x noise
> (`MacroContext['return']` etc.) — `--skipLibCheck` is set in the
> typecheck script to keep the output clean. The Bun runtime is unaffected.

---

## 📚 Day-by-day progress

See `docs/PROGRESS.md` for the development log (Day 1 → Day 9+).
