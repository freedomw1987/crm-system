# CRM System — Development Progress

> Day-by-day log. Each day is a self-contained milestone.
> Stack: Bun + Elysia + Prisma + Postgres (API), Vite + React 19 + Tailwind (Web), nginx (reverse proxy + SPA host).

---

## Day 1 — Repo scaffold + Prisma init + Elysia API + AI agent core

**Shipped**
- Bun workspaces monorepo (`apps/api`, `apps/web`, `packages/db`, `packages/ai`, `packages/shared`)
- Prisma schema (11 models) + `init` migration + seed (2 users, 3 companies, 5 contacts, 8 products, 1 pipeline, 3 deals, 1 quotation)
- Elysia API: 6 resource routes (auth, company, contact, product, deal, quotation) + chat/AI
- `@crm/ai` package: tool registry (8 tools) + OpenAI function-calling loop + Postgres-backed conversation memory
- Login credentials: `admin@crm.local / admin123` | `sales@crm.local / sales123`

**Known issue** (still applies)
- Elysia 1.2 `MacroContext['return']` field noise in `tsc --noEmit`. `--skipLibCheck` is the working mitigation; Bun runtime is unaffected.

---

## Day 2–4 — Frontend scaffold + core CRUD UI

**Shipped**
- Vite + React 19 + Tailwind + react-router-dom + react-query
- Login flow + JWT storage (`localStorage crm:token`)
- Companies / contacts / products list + detail pages
- Dashboard with KPI cards

**Notable pitfalls (David's memory)**
- nginx SPA `try_files $uri $uri/ /index.html` cycles inside `location /`; need a named `@spa` location with `try_files /index.html =404`
- Mac arm64 Docker build: `oven/bun:1.2` lacks `libssl` → install `openssl ca-certificates curl` in the Dockerfile
- Mac arm64: Vite 8 + rolldown's `@rolldown/binding-linux-arm64-gnu` doesn't install via `npm` → don't COPY `package-lock.json` into the frontend image, let the container re-resolve
- Frontend list endpoints must handle `Array.isArray(r) ? r : r.items` defensively (backend returns either shape)

---

## Day 5 — Quotation engine v1

**Shipped**
- Quotation CRUD: `Quotation`, `QuotationItem` (PRODUCT only at this point)
- Quotation list + detail + status workflow (`DRAFT → SENT → VIEWED → ACCEPTED/REJECTED/EXPIRED/INVOICED`)

---

## Day 6 — Nginx / SPA routing fixes (hit-and-learn)

**Shipped**
- Diagnosed and fixed three regressions that surfaced from end-to-end testing:
  - SPA `index.html` not being served on deep links → named `@spa` location fix
  - nginx missing `root` directive → set explicitly
  - Backend returning bare arrays from one route and `{ items, total }` from another → defensive `Array.isArray` in the API client
- All three were invisible to type-check; only visible via the browser. This is why end-to-end smoke (not just unit tests) is mandatory.

**Lesson (now in `MEMORY.md`)** — write standalone smoke scripts using modules Hermes won't trace (axios, puppeteer), not `curl`-based shell pipelines, to avoid the secret-redaction layer masking test output.

---

## Day 7 — Dynamic RBAC + Service catalogue + polymorphic QuotationItem

**Shipped**
- New `Role` + `RolePermission` model with seed data
- `authContext` + `requirePermission(key)` middleware
- **Service catalogue** as a first-class entity (distinct from Product):
  - `Service`, `ServiceManDay` models
  - SOW (Statement of Work) long-form description
  - Man-day breakdown (role + dayRate + days) — the SOW structure
  - Status: `ACTIVE / ARCHIVED / DRAFT` (text column at this point)
- **Polymorphic `QuotationItem`**:
  - `itemType: PRODUCT | SERVICE` discriminator
  - `productId` / `serviceId` + `manDaySnapshot` JSONB for SERVICE items
  - SOW snapshot at quotation time so the original service can be edited later without breaking past quotations
- Audit log middleware (`logEvent`) for resource create/update/delete
- Migration: `day7_dynamic_rbac_services` + `day7_extend_audit_enum`

**Notable**
- This is the day that introduced the `Service.isActive` field that later drifted out of the schema (eventually replaced by the `status` enum — see Day 9).

---

## Day 8 — Region table + Deal Kanban + UI polish

**Shipped**
- `Region` table: HK / MO / CN / OTHER with `isActive`, `flag`, `sortOrder` (replaces a previous enum that needed to be referenced as a foreign key from `Company`)
- Deal Kanban board (`GET /deals/kanban`, `PATCH /deals/:id/stage` for drag-and-drop)
  - Auto-set `status` (WON / LOST / OPEN) and `closedAt` based on the target stage name
- RWD mobile audit + fixes across the SPA

**Pitfall**
- `prisma migrate dev` cannot produce the migration for "enum → table" (or "table → enum" — see Day 9). Manual SQL + manual `_prisma_migrations` row insert is the only reliable path. Recipe in `prisma-migrate-private-rds` skill.

---

## Day 9 — String enums, polymorphic UI, bug fixes

**Shipped**
- Quotation builder full form (polymorphic: pick Product or Service, full SOW + man-day editor for Service)
- `Region` already a table; the `Region` enum is gone
- Quick-create dialogs for Product + Service in the quotation builder autocomplete
- Deal edit dialog (previously only create + drag-drop)
- Shared `ProductDialog` extracted from the Products page for create + edit
- `bg-popover` Tailwind token added (previous site-wide transparency bug on dropdowns)
- 502 fix on `POST /services`: payload key was `manDays`, backend Elysia validator wanted `manDayLines` (Prisma relation name). Wired through.
- **Service status enum drift fix** (the `ServiceStatus` enum existed in `schema.prisma` but the DB column was still `TEXT`):
  - Wrote manual migration `20260606080526_add_service_status_enum` (`CREATE TYPE` + `ALTER COLUMN ... TYPE` + reset default)
  - Inserted `_prisma_migrations` row manually (checksum = SHA-256 of the SQL file)
  - `prisma generate` to refresh the client
  - `docker cp` the new migration folder into `crm-api` (compose's api service has no host volume mount for `migrations/`) + `docker restart` so the entrypoint picked it up
- Legacy `Service.isActive` cleaned out everywhere it appeared on the `Service` entity (User.isActive and Region.isActive are real columns and were left alone)
- **Field-name drift fix** (`manDayLines` on the wire vs `manDays` in the frontend `Service` type) — added a `normaliseService` helper at the `servicesApi` boundary so every component can rely on a single field name

**Migration list as of Day 9**

| Timestamp                          | Name                                          | Day |
| ---------------------------------- | --------------------------------------------- | --- |
| 20260605014842                     | `init`                                        | 1   |
| 20260605020000                     | `add_audit_log`                               | 7   |
| 20260605030000                     | `day7_dynamic_rbac_services`                  | 7   |
| 20260605030001                     | `day7_extend_audit_enum`                      | 7   |
| 20260605040000                     | `day8_region_deal_kanban`                     | 8   |
| 20260606000000                     | `day9_region_table_quotation_item_string`     | 9   |
| 20260606080526                     | `add_service_status_enum` *(manual)*          | 9   |

---

## 🟡 Pending / known gaps

- **Production deploy to AWS** — local `docker compose -f docker-compose.prod.yml` works, but ECS / RDS / CloudFront infra-as-code (CDK) is not written yet
- **CI/CD** — no GitHub Actions or CodePipeline yet
- **Email notifications** — quotation `SENT` status exists but no SMTP/SES integration to actually email the customer
- **Customer-facing quotation view** — internal detail page exists; the public share link / accept-quote flow isn't built
- **Inventory alerts** — `lowStockThreshold` is stored, no background job to notify
- **Region selector on sign-up** — companies are seeded with regions; no UI to attach a region to a new company during onboarding

---

## ⚠️ Known issues / workarounds

1. **Elysia 1.2 d.ts noise** — see Day 1. Use `--skipLibCheck` in `typecheck`. Bun runtime is clean.
2. **Docker compose `api` service has no host volume mount for `migrations/`** — when you add a new migration on the host, `docker cp <folder> crm-api:/app/packages/db/prisma/migrations/` + `docker restart crm-api` so the container's entrypoint picks it up. Otherwise the container's `prisma migrate deploy` will P3009-drift.
3. **`request<T>` in `apps/web/src/lib/api.ts` is a pure typecast** — it does not normalise backend field names. Any Prisma relation field that doesn't match the frontend's `camelCase` expectation must be normalised at the API boundary (see `normaliseService` for the Service pattern).
4. **Wire-format vs type-format on Service man-day payload** — `POST/PATCH /services` JSON body must use `manDayLines` (Prisma relation name) to match the Elysia validator. The `Service` TypeScript type uses `manDays` (singular). The dialog and API wrapper handle the rename.
