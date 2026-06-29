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

---

## Day 10 — AI Assistant infrastructure

**Shipped**
- Singleton `AiConfig` row (admin-set endpoint URL, encrypted API key,
  model name, optional system prompt). API key AES-256-GCM encrypted
  with `AI_CONFIG_ENCRYPTION_KEY` from env.
- `Conversation` + `ConversationMessage` tables (user-scoped, persisted
  history for re-opening chats later)
- `AI_CONFIG_UPDATED` audit action
- `packages/ai` package: tool registry (11 tools), OpenAI function-calling
  loop, conversation replay
- Backend routes: `/ai/config` (admin CRUD with masked key in responses)
  + `/chat/conversations/*` + `/chat/send`
- Frontend: `/admin/ai-config` admin page + `/ai` chat page + `AiFab`
  floating button visible on every page except `/ai`
- Audit log every change to the AI config

## Day 10.1 — Streaming responses + inline tool pill UX

**Shipped**
- `runAgentStream` async generator backend loop (chunked SSE)
- `/chat/send` SSE response (`text/event-stream`) with
  `Cache-Control: no-cache, no-transform` + `X-Accel-Buffering: no`
- Frontend `chatApi.send` returns `Promise<{conversationId}>` via callback
- `MessageBubble` tool branch → inline pill (no max-w, no bot icon)
- `ToolPill` component (in-flight pulse + "執行中" / ok / failed states)
- `StreamingBotMessage` (single bot-anchored bubble with pills above)
- `quotations.tsx` AI draft — collects `draft_quotation` from `tool_end`
  events for the post-create navigate
- Backend: token, tool_start, tool_end, done events

## Day 11 — Settings + Pipeline CRUD + AI `list_pipelines` tool

**Shipped**
- `GET/PATCH/POST/DELETE /settings/pipelines[/stages]` for pipeline
  management (Lead / Qualified / Proposal / Negotiation / Won / Lost
  seeded by default)
- Stage move / name / probability / position swaps via
  `/settings/pipelines/stages/:id` (409 on delete with non-empty stage)
- AI tool `list_pipelines` returning the configured pipeline + stages
- Audit log on every mutation (`PIPELINE_*` actions)

## Day 14 — `SystemConfig` table + Tax rate (US-S4)

**Shipped**
- Generic key-value `system_config` table (JSON values, audit-logged)
- `SYSTEM_CONFIG_UPDATED` audit action
- `GET /settings/tax` + `PUT /settings/tax` (admin-only via
  `settings:read` + `settings:update` permissions)
- Frontend `QuotationBuilder` auto-prefills tax from system default
  unless user has manually touched the field (`userTouchedTax` race-safe)
- `default_tax_rate` is the first key, seeded via the `SEED_DB=true`
  init flow

## Day 14.7 — Settings sub-route refactor (7-tab layout) + 5 admin tabs

**Shipped** (across 10 commits, see `docs/REGRESSION-GUARD.md` §
"Day 14.7 wire-shape drift")
- `SettingsLayout` shell with 7 tabs: Pipelines / Users / Roles /
  AI / Man-day / Tax / Audit. URL = source of truth.
- 5 placeholder admin pages → real pages (settings/users, settings/roles,
  settings/ai, settings/man-day, settings/audit)
- 5 backward-compat `<Navigate />` routes for old top-level URLs
  (`/users`, `/roles`, `/audit`, etc.) — so existing bookmarks + chat
  share links still land on the right tab
- Sidebar collapsed from 5 entries into one "系統設置" entry
- "View audit log" deep link uses `/settings/audit?action=…` and
  survives the `<Navigate />` (the wire-shape drift fix)

## Day 17 — P0-SP1 / P1 sprint

**Shipped** (see `docs/TECH-DEBT.md` § "Day 17 P1 sprint shipped" for the
full list; highlights):
- P1-7: `/ai/config/status` perm gate
- P1-5: strong password policy (`minLength: 12` + digit + special)
- P1-6: audit log retention script + endpoint (cron deferred)
- P1-1 / P1-2: typecheck critical errors PARTIAL (11 of 36 fixed)
- P1-10: QuotationItem snapshot preserved on PATCH — edit dialog
  shows snapshot of deleted/renamed Product/Service
- RG-007: Day 17 AI tool confirmation migration was never applied
  to prod; now applied
- P1-9: frontend delete + edit on Companies / Deals / Quotations lists
  + `api.ts` CRUD-surface regression guard

## Day 17 — AI tool human-in-the-loop confirmation (RG-CHAT-002)

**Shipped** (backend complete; frontend dialog deferred to Day 18+ batch)
- 3 write tools tagged `requiresConfirmation: true`:
  `draftQuotation`, `updateDealStage`, `logActivity`
- Agent emits `confirmation_required` SSE event with stable `hashArgs()`
- Backend stores the proposal in `ConversationMessage` keyed by hash
- Audit log records `AI_TOOL_CONFIRMED` / `AI_TOOL_DENIED` per call
- Pinned by 13 unit tests in `packages/ai/src/__tests__/confirm.test.ts`
- Frontend gap: Radix Dialog with diff preview is the punted-to-Day-18
  piece

## Day 17.5 — Quotation GP% formula regression test (RG-2026-06-08-A3)

**Shipped**
- Extracted `gpOf()` + `costPerManDayFromSnapshot()` from the route
  file into `apps/api/src/lib/quotation-gp.ts` so they can be unit-tested
- 14 unit tests in `apps/api/src/__tests__/quotation-gp.test.ts` pin
  the formula across product / service / mixed-currency line types

---

# Day 18+ sprint — Standard versioning + sales rep + multi-currency + Activity CRUD

## Day 18-A — QuotationItem snapshot on read-only surfaces (P2-snapshot-display)

**User-reported** (2026-06-26): opening an old quotation whose Product /
Service was deleted or renamed showed blank line items on the detail
page and print route, even though the data was in the DB.

**Shipped**
- Shared `<LineItemSnapshotMeta>` component
  (`apps/web/src/components/quotation-line-item-snapshot.tsx`) renders:
  - Description (snapshot-precedence + live fallback)
  - SERVICE SOW / man-day breakdown via `manDaySnapshot`
  - "(已刪除)" badge + "原紀錄已刪除,以下為 snapshot 資料"
    hint when the live `product` / `service` relation is null
- Used on both `QuotationDetailPage` tables (normal mode + print mode)
- `crm-adapter.ts` `sow` / `sow_en` fields now prefer `item.description`
  (snapshot) over the live catalogue
- Pinned by 8 vitest tests in
  `apps/web/src/components/__tests__/quotation-line-item-snapshot.test.ts`
  + 6 bun:test cases in `crm-adapter.test.ts`

## Day 18-B — Quotation ↔ Deal linkage fix (P2-quotation-deal-link)

**User-reported**: editing a quotation, picking a Deal, hitting
save — the link was gone.

**Root cause**: `PATCH /quotations/:id` body schema silently dropped
`dealId` (TS type didn't include it; backend route typecast didn't
either).

**Shipped**: backend accepts `dealId` in PATCH body; frontend includes
it on save. (See `docs/REGRESSION-GUARD.md` "Quotation-deal-link"
entry.)

## Day 18-C — Sales rep on Deal + Quotation (P2-sales-rep)

**User-reported**: "I want Deal and Quotation to both have a sales
rep for following up."

**Shipped**
- `Quotation.salesRepId String?` FK to User; new `salesRep` relation
- `POST /quotations` defaults `salesRepId` to authenticated user;
  `PATCH /quotations/:id` accepts the field
- `DealDialog` + QuotationBuilder get a 銷售員 picker
  (new shared `UserAutocomplete`)
- Kanban `DealCard` shows owner-initial avatar (top-right corner)
- List / detail pages surface sales rep column / row
- Migration: `20260626000000_p2_quotation_sales_rep` (Prisma-generated,
  backfill from `createdById`, FK ON DELETE SET NULL)

## Day 18-C follow-up — Drop `dealId` from the SENT lock

**User-reported**: after the previous commit, editing a SENT
quotation to attach a Deal failed with the SENT-lock 409.

**Root cause**: I had incorrectly added `dealId` to the SENT-lock
guard with the reasoning "moving a sent quotation to a different
deal would silently change the sales-attribution trail." That's
wrong — sales attribution is `salesRepId` / `createdById`, not
`dealId`. Deal is a CRM container, not a commission rule.

**Shipped**: reverted that inclusion. `dealId` (and `salesRepId`) are
treated as CRM metadata and remain mutable across the lifecycle;
only the contractual fields (title / notes / taxRate / validUntil /
line items) are locked once SENT.

## Day 18-D — Quotation revisions (standard versioning)

**User-reported**: SENT lock errors tell users to "create a revision
instead" but no such flow existed.

**Shipped**
- `Quotation.parentQuotationId` (FK to self, ON DELETE SET NULL) +
  `Quotation.revisionNumber Int @default(0)`
- `POST /quotations/:id/revise` — refuses DRAFT source; computes
  chain-aware next number + revision via `nextRevisionInfo` (walk to
  root + BFS-count descendants to handle branching)
- Number format: `Q-YYYY-NNNN-R{N}` (R1, R2, …)
- Audit log records `parentQuotationId` + `parentQuotationNumber` in
  metadata
- Frontend: 「建立修訂」button on detail page (only when status !==
  DRAFT); inline confirm dialog; navigates to new `R{N}` on success
- Detail page header: 「修訂自 {parent.number}」chip + `R{N}` badge
- Migration: `20260627000000_p2_quotation_revisions`
- Manual chain smoke test confirmed: R1 → R2 → R3 numbers, revisions,
  parents all correct

## Day 18-E — Author-only Activity edit + delete

**User-reported**: "Activity has no way to edit or delete (my own
Activity should be editable and deletable)."

**Shipped**
- `PATCH /activities/:id` (author-only, 403 otherwise): accepts
  `{ type?, content? }`. Audit log: `ACTIVITY_UPDATED`.
- `DELETE /activities/:id` tightened from "any user" to author-only
- Frontend `ActivityItem`: edit + delete icons visible only when
  `activity.author.id === currentUser.id`. Inline edit dialog
  (type dropdown + content textarea). Delete uses the existing
  `useDeleteActivity` mutation + confirm flow.

## Day 19 — Multi-currency snapshots (HKD + MOP)

**Shipped**
- `SystemConfig` keys `cny_to_hkd` + `hkd_to_mop` (with `cny_to_hkd`
  as the system default)
- `Quotation.exchangeRateToHKD` + `totalHKD` (and `…ToMOP` / `totalMOP`)
  — captured at create time and at status=SENT transition
- `GET /settings/currency` + `PUT /settings/currency` (admin) returns
  the live rates + cached snapshot
- Frontend: currency picker on `DealDialog`, `ProductDialog`, and
  `ServiceQuickCreate`; default flows from system → product/service
- Detail / print / Excel views render HKD (default) + MOP equivalent
  rows when present
- `Quotation` builder shows the HKD preview alongside the customer-currency
  total

## Day 19 follow-up — Author-only attachment CRUD

**User-reported**: similar gap to Activity edit/delete — users could
delete other users' attachments.

**Shipped**
- `PATCH /activities/:id/attachments/:id` + `DELETE /…/:id` are
  uploader-only (403 otherwise)
- Frontend attachment chip surfaces edit/delete affordances only when
  `uploadedBy.id === currentUser.id`

---

## 🟡 Updated pending / known gaps

- **Production deploy to AWS** — local `docker compose -f docker-compose.prod.yml` works; CDK infra-as-code not written
- **CI/CD** — no GitHub Actions / CodePipeline
- **Email notifications** — quotation SENT status exists but no SMTP/SES
- **Customer-facing quotation view** — internal detail page exists; public share link isn't built
- **Inventory alerts** — `lowStockThreshold` is stored, no background job
- **Region selector on sign-up** — companies seeded with regions; no UI to attach during onboarding
- **Frontend AI confirmation dialog** — backend guardrail shipped (RG-CHAT-002); Radix Dialog + diff preview still punted
- **Audit log retention cron** — script + endpoint shipped (P1-6); the actual cron schedule deferred to US-OPS-2

---

## ⚠️ Updated known issues / workarounds

1. **Elysia 1.2 d.ts noise** — see Day 1. Use `--skipLibCheck` in `typecheck`. Bun runtime is clean. **Note**: most routes no longer need `@ts-nocheck` after the Day 17 P1-1 work; some still do (P2-10).
2. **Docker compose `api` service has no host volume mount for `migrations/`** — when you add a new migration on the host, `docker cp <folder> crm-api:/app/packages/db/prisma/migrations/` + `docker restart crm-api` so the container's entrypoint picks it up. (The Dockerfile also bakes `packages/db` into the image at build time, so `docker compose up -d --build` is sufficient for most migrations.)
3. **`request<T>` in `apps/web/src/lib/api.ts` is a pure typecast** — it does not normalise backend field names. Any Prisma relation field that doesn't match the frontend's `camelCase` expectation must be normalised at the API boundary (see `normaliseService` for the Service pattern).
4. **Wire-format vs type-format on Service man-day payload** — `POST/PATCH /services` JSON body must use `manDayLines` (Prisma relation name) to match the Elysia validator. The `Service` TypeScript type uses `manDays` (singular).
5. **When adding a new `.post('/:id/...')` chain method, REPLACE the entire method (from `.post(` through the closing `})`)**, not just the inner body. Edit-tool `old_string` matches a fixed substring — leaving the old opening/middle leaves orphan code that breaks Bun parsing. (Lesson from commit `214f255` / RG-018.)


---

## Day 20 — Doc refresh + regression-test sweep

### Docs updated (t1)

Project was at Day 9 in `PROGRESS.md` and Day 10 in `PROJECT-OVERVIEW`
when reality is Day 18+. The "Day 18+" sweep caught every doc up:

- **`PROGRESS.md`** — extended through Day 19 (multi-currency snapshot
  + author-only attachment CRUD). Now 403 lines.
- **`PROJECT-OVERVIEW.md`** — rewrote §3-7 for the Day 18+ state.
  Tech stack + module layout unchanged. Day-by-day shipping
  history adds Days 11-18+. Permissions model bumped to 29
  entries (was 23).
- **`QA-TRACKER.md`** — added Epic E (sales activity: E1-E5) and
  Epic F (deal drill-down: F1). 22 US rows total. Open follow-ups
  updated for Day 18+.
- **`TECH-DEBT.md`** — added Day 18 P2 sprint shipped list (P2-snapshot-
  display, P2-list-page-edit, P2-quotation-deal-link, P2-sales-rep,
  P2-sales-rep follow-up, P2-quotation-revisions, P2-Activity
  edit/delete, P2-attachment author-only, P2-multi-currency,
  P2-prisma-migration-format, P2-orphaned-chain-method parse fix).
- **`api.md`** — added 16 missing endpoints (revise, status,
  per-item CRUD, GET /services/:id, PATCH/DELETE /services/:id,
  full region CRUD, GET /man-day-roles/:id, PATCH/DELETE,
  PATCH /attachments/:id, full settings currency, POST
  /auth/change-password, POST /chat/confirm/:id, GET
  /products/:id, PATCH/DELETE /products/:id, GET
  /deals/kanban, PATCH /deals/:id/stage, GET
  /settings/retention-policy, etc.).
- **`architecture.md`** — bumped 12 → 16 route groups in §2 module
  layout. Added §11 Decision log with table of ADRs (0001,
  0014-0018).
- **`database.md`** — Quotation section now lists
  salesRepId / exchangeRateToHKD / totalHKD /
  exchangeRateToMOP / totalMOP / parentQuotationId /
  revisionNumber + Revision chain block. Renamed §18 from
  ActivityLog to Activity. Added §12b ManDayRole, §19
  Attachment, §20 AiConfig, §21 SystemConfig. Renumbered
  §22/23 Conversation/Message, §24 AuditLog. Migration
  history table: 16 migrations listed.

### Regression-test ports added (t3 + t4)

Code review (t2) found several high-RG-density areas with
fragile contracts. Extracted to importable pure helpers + tests
(t3 + t4) so future refactors fail at one source-of-truth
import rather than silently drifting.

- `apps/api/src/lib/quotation-patch-body.ts` — `QuotationPatchBody`
  type + `SENT_LOCKED_FIELDS` / `SENT_UNLOCKED_FIELDS` arrays +
  `buildQuotationPatchBody` factory + `validateQuotationPatchBody`
  (pinned by RG-020 / RG-021).
- `apps/api/src/lib/quotation-edit-prefill.ts` —
  `linesFromQuotation` + `assertPrefillReady` +
  `QuotationPrefillMissingError` (pinned by RG-019).
- `apps/api/src/lib/chat-sse.ts` — `CHAT_SSE_EVENT_TYPES`
  constants + `buildSseFrame` + `buildChatHeaders` +
  `buildChatPrecheckError` + `isChatSseEventType` (pinned by
  RG-002 / RG-003 / RG-005 / RG-CHAT-002).
- `apps/api/src/middleware/rbac.ts` — re-exports
  `PERMISSIONS` + `ROLE_PERMISSIONS` + adds derived
  `ADMIN_PERMISSIONS` Set (pinned by RG-004).
- `packages/ai/src/tools.ts` — exports `WRITE_TOOLS` +
  `READ_TOOLS` partitions (pinned by RG-CHAT-002).

Each helper is consumed by the existing route file (no
dead-code extractions): `quotation.ts` imports
`QuotationPatchBody` + `SENT_LOCKED_FIELDS`, `chat.ts`
imports `buildSseFrame` + `buildChatHeaders` +
`buildChatPrecheckError` + `CHAT_SSE_EVENT_TYPES`,
`packages/ai/src/index.ts` uses `WRITE_TOOLS.has(toolName)`
for the confirmation-required gate.

93 new test cases across 5 test files pin the contracts
(`b7ce018` test(t4)): 32 in `quotation-patch-body.test.ts`
(RG-020/021), 18 in `quotation-edit-prefill.test.ts`
(RG-019), 20 in `chat-sse.test.ts` (RG-002/003/005/CHAT-002),
13 in `rbac.test.ts` (RG-004), 10 in `tools.test.ts`
(RG-CHAT-002). Each file's header references the RG (matching
the existing `quotation-gp.test.ts` / `confirm.test.ts`
convention).

### RG-2026-06-30 entries (t2 code review)

Code review of high-RG-density files produced 9 RG entries
documented in `REGRESSION-GUARD.md` (16 → 25 entries total):

- 🔴 **RG-022** `quotation.ts` has zero `requirePermission`
  calls (P0-2 class gap)
- 🔴 **RG-023** `DELETE /quotations/:id` doesn't check status
  (silent data-loss for SENT/ACCEPTED/INVOICED)
- 🟨 **RG-024** PATCH body has no `t.Object` validator (known
  gap, not closed)
- 🟨 **RG-025** QuotationBuilder's `CompanyAutocomplete` is
  not `disabled={isEdit}` (edit-mode change silently lost)
- 🟨 **RG-026** `ai-config.ts` parallel auth system
  (inline checks + dynamic import dance)
- 🟢 **RG-027** `pendingConfirmations` Map is in-memory
  (restart wipes in-flight confirmations)
- 🟢 **RG-028** codify the RG-019 list-edit fetch pattern
  (next: list-endpoint addition)
- 🟢 **RG-029** consolidated into RG-025 (pointer)
- 🟢 **RG-030** permission-lint suggestion for new mutating
  routes

### Day-20 final pass/fail counts (t5 + t7)

- `apps/api` bun test: **172 / 0** (89 pre-existing + 83 new from
  t4)
- `apps/web` vitest: **34 / 0** (no regression)
- `packages/ai` bun test: **23 / 0** (13 pre-existing + 10 new)
- `apps/api` build: success (2.40 MB)
- typecheck: pre-existing P2-10 baseline (Elysia 1.2 plugin-context
  + `@prisma/client` regen needed for the ~1k `TS2307` block);
  documented in `TECH-DEBT.md`. Pinned by the `bun run verify`
  script which deliberately omits typecheck.

### Day-20 new commits (this batch)

- `b9c4851` docs: refresh docs for Day 18+ sprint + file
  RG-2026-06-30-* review findings
- `029eb9a` fix(rbac): close perm-gap on activity / man-day-role
  / region routes + add 3 ADRs
- `55c9c31` refactor(t3): extract regression-test ports as pure
  helpers
- `b7ce018` test(t4): regression tests for the t3 helper ports

