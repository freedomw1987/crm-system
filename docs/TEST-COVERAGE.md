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
