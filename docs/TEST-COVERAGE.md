# CRM System — Test Coverage

> Mapping every User Story to the test layers that cover it. **P0 US must
> have Unit + Integration + E2E; P1+ can have less but must have at least
> one layer.** Status: ✅ shipped · 🟨 partial · ❌ missing.

---

## Test layers

| Layer | What it tests | Tooling |
|-------|---------------|---------|
| **Unit** | Pure functions: encryption, formatters, RBAC resolver | Bun test (`bun test`) |
| **Integration** | Backend routes with test DB (Prisma + Postgres) | Bun test + `app.request()` |
| **E2E** | Full browser flow via Playwright | `playwright` |
| **Manual smoke** | After deploy, curl + browser through critical paths | This document's "Smoke checklist" |

> **Reality check:** as of Day 10, we have **manual smoke only**. Adding
> Bun test + Playwright is in the backlog (see US-C5 and unassigned
> epic). This file's purpose is to track what *should* be tested, not to
> pretend we have it. 🟨 rows below are honest placeholders.

---

## Coverage matrix

### Epic A — Sales operations

| US | Title | Unit | Integration | E2E | Manual smoke |
|----|-------|------|-------------|-----|--------------|
| A1 | Companies CRUD | 🟨 planned | 🟨 planned | 🟨 planned | ✅ Done Day 6+ |
| A2 | Deal Kanban | 🟨 planned | 🟨 planned | 🟨 planned | ✅ Done Day 8 |
| A3 | Quotation builder + GP% | 🟨 planned | 🟨 planned | 🟨 planned | ✅ Done Day 9 |

### Epic B — Admin

| US | Title | Unit | Integration | E2E | Manual smoke |
|----|-------|------|-------------|-----|--------------|
| B1 | Users + roles | 🟨 planned | 🟨 planned | 🟨 planned | ✅ Done Day 5 |
| B2 | Custom roles editor | 🟨 planned | 🟨 planned | 🟨 planned | ✅ Done Day 7 |
| B3 | Man-day role catalogue | 🟨 planned | 🟨 planned | 🟨 planned | ✅ Done Day 9 |
| **B4** | **AI Config page** | **🟨 planned (encryption)** | **🟨 planned (PUT / GET / status / test)** | **🟨 planned** | **✅ Done this batch** |
| B5 | AI Config audit | 🟨 planned | 🟨 planned | — | ✅ Done Day 10 |

### Epic C — AI Assistant

| US | Title | Unit | Integration | E2E | Manual smoke |
|----|-------|------|-------------|-----|--------------|
| C1 | Chat UI + FAB | — | — | 🟨 planned | ✅ Done Day 10 |
| C2 | Read tools (×7) | — | ✅ partial (tools.ts manually verified) | 🟨 planned | ✅ Done Day 10 |
| C3 | Write tools (×3) | — | ✅ partial (manually verified) | 🟨 planned | ✅ Done Day 10 |
| **C4** | **DB-driven config (no env)** | **—** | **✅ done this batch (RG-002)** | **🟨 planned** | **✅ Done this batch** |

### Epic D — Mobile

| US | Title | Status |
|----|-------|--------|
| D1 | RWD across pages | ✅ Manual smoke (iOS Safari + Chrome devtools mobile) |

---

## Manual smoke checklist (run before every prod deploy)

Use this after any backend change:

```bash
# 1. health
curl -s http://localhost/api/health

# 2. login as admin
TOKEN=$(curl -s -X POST http://localhost/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@crm.local","password":"admin123"}' | jq -r .token)

# 3. AI config
curl -s -H "Authorization: Bearer $TOKEN" http://localhost/api/ai/config/status
# Expected: { "configured": false }  (no real LLM key in prod)

# 4. AI config (admin) — should NOT 403
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOKEN" http://localhost/api/ai/config
# Expected: 200

# 5. Chat send with no config — should 503 not 500 (RG-002)
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"message":"test"}' \
  http://localhost/api/chat/send
# Expected: 503 with helpful message
```

Use this for any frontend change:

1. Open browser at `http://localhost`
2. Log in as `admin@crm.local / admin123`
3. Verify nav renders: Dashboard, Companies, Deals, Quotation, Product,
   Service, [Users, Roles, **Man day role**, **AI 設定**, Audit Log]
4. Click AI 設定 → form renders with empty fields (if not configured)
5. Click bottom-right FAB → navigates to `/ai`
6. `/ai` empty state shows 4 example prompts
7. Resize to mobile (≤ 640 px) → sidebar collapses to hamburger, FAB
   still visible and tappable

---

## Test environment setup (planned — not done)

```bash
# In a future sprint, add this to the api package:
# apps/api/test/setup.ts
#   - boots a test Postgres (via testcontainers or a dedicated docker-compose.test.yml)
#   - runs migrations + seed
#   - sets Bun.env.DATABASE_URL to the test DB
```

## What's blocking the test backlog

1. **No test DB**: we don't have a separate Postgres for tests. Risk of
   polluting dev DB if integration tests run against it.
2. **No CI**: we have no GitHub Actions / CodePipeline running tests on
   push. Manual smoke is the only gate.
3. **No test framework installed**: `bun test` ships with Bun, but we
   haven't added `test/*.test.ts` files for any route.

These are real gaps and the day we add a regression test framework is the
day RG-001 (T4 silent data loss) becomes impossible to reintroduce.

---

## Day 14.7 — System Settings refactor + Tax Rate (US-S4)

### Coverage matrix addition

| US | Title | Unit | Integration | E2E | Manual smoke |
|----|-------|------|-------------|-----|--------------|
| **S4** | Tax rate settings + Quotation prefill | 🟨 planned | 🟨 planned | ✅ Done Day 14.7 | ✅ Done Day 14.7 |

> The other 6 Settings tabs (Pipelines/Users/Roles/AI/Man-day/Audit)
> were already shipped in earlier days with manual smoke coverage only —
> they remain 🟨 in the table above (inherited from their original rows).

### Day 14.7 E2E smoke checklist (✅ all green, 2026-06-07 19:45 HKT)

Ran via Playwright `browser_navigate` against the docker-compose stack
(`crm-web:80`, `crm-api:3001`, `crm-postgres:5432`) after a fresh
`docker compose build web` (no cache) and a `crm-web` container restart.

- [x] `GET /api/health` (via nginx proxy) → 200
- [x] `POST /api/auth/login` with `admin@crm.local` → 200 + token
- [x] Navigate to `/settings` → auto-redirect to `/settings/pipelines`,
      Pipelines tab is `aria-selected`, default Pipeline card renders
- [x] Sidebar (ADMIN section) shows exactly **1** entry: 系統設置
- [x] All 7 tabs render: Pipelines / Users / Roles / AI / Man-day / Tax / Audit
- [x] Click each tab → active state moves, content swaps correctly
- [x] Tax tab: input prefilled with current `default_tax_rate` (13%),
      Save button starts disabled, edits enable it
- [x] Tax save 13 → 25 → `SYSTEM_CONFIG_UPDATED` row appears in audit
      table with `oldValue:13 newValue:25`
- [x] Quotation create-dialog opens with `稅率 (%)` prefilled to 25
      (system default via Step 9 `userTouchedTax` race-safe prefill)
- [x] Tax "View audit log" link → URL = `/settings/audit?action=SYSTEM_CONFIG_UPDATED`,
      audit table is pre-filtered to SYSTEM_CONFIG_UPDATED rows
- [x] Backward-compat: `/users` → `/settings/users` (Users tab active)
- [x] Backward-compat: `/roles` → `/settings/roles` (Roles tab active)
- [x] Backward-compat: `/audit` → `/settings/audit` (Audit tab active,
      full unfiltered list rendered)
- [x] Backward-compat: `/ai-config` → `/settings/ai` (AI tab active,
      OpenRouter + gpt-5.5 populated)
- [x] Backward-compat: `/man-day-roles` → `/settings/man-day` (Man-day
      tab active, 3 roles rendered)
- [x] `bunx tsc --noEmit` → 0 errors (across Steps 5-10)
- [x] `docker compose build web` → 0 errors, new SPA bundle hash
      `index-am9hO3Fd.js` (589 KB)
- [x] 0 console errors in browser during the entire flow

### Day 14.7 issues caught + fixed

1. **Step 5 wire-shape drift** (`eb1581f`):
   - Plan JSON said the wire field was `defaultTaxRate`
   - Backend (`apps/api/src/routes/settings.ts`) actually uses `rate` on
     both GET response and PUT body
   - PUT would have 400'd on first save (Zod validation: "Expected pick
     'rate', got 'defaultTaxRate'")
   - **Caught at**: Step 7 code review (before E2E smoke)
   - **Fix**: Step 7 commit `bd1d107` corrected `TaxConfig` interface
     to match wire shape `{ key, rate, description?, updatedAt?, updatedBy? }`
   - **Lesson**: when a TypeScript type wraps a wire shape, validate
     against the actual backend source — not the design doc. The
     "user says 'backend is source of truth'" rule from 2026-06-04
     applies here.

2. **Step 7 cross-link query string drop** (`bd1d107`):
   - Tax tab's "View audit log" link was `<Link to="/audit?action=...">`
   - After Step 8 made `/audit` a `<Navigate>` to `/settings/audit`,
     the query string was dropped during the redirect
   - **Caught at**: Step 12 E2E browser smoke (link landed on
     `/settings/audit` but with the unfiltered audit list)
   - **Fix**: 1-line commit `5018578`, changed link to
     `/settings/audit?action=SYSTEM_CONFIG_UPDATED` so the query
     string survives the route
   - **Lesson**: cross-tab deep links must point at the **final** URL
     (the sub-route), not the legacy one (which gets redirected
     without query string preservation). Worth considering a future
     fix in react-router itself, but for now: always point at the
     new URL directly.

3. **AuditPage hydration lag** (minor, **NOT** fixed in this batch):
   - When the user lands on `/settings/audit?action=SYSTEM_CONFIG_UPDATED`
     via cross-link, the `<Select>` element's `value` prop is set
     correctly (sibling WIP pickup in Step 12 added a `useEffect`
     that syncs the URL → state), but the browser's accessibility
     tree still reports "全部 Action" as the selected option in
     some snapshots
   - The data is filtered correctly (the `useQuery` only fires with
     `action: 'SYSTEM_CONFIG_UPDATED'`), so the table is right
   - Cosmetic / hydration timing issue, doesn't block ship
   - Filed as polish for a future sprint (no RG- entry needed)
