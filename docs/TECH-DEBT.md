# CRM System — Technical Debt Register

> **Source:** 2026-06-07 code review (Security A + Architecture B + Ship Gate C)
> by Developer. Each entry has: where, why, severity, estimated cost,
> and the P0/P1/P2 priority assigned by red-line 10 + business risk.
> **Update this file when a finding is fixed, deferred, or re-prioritised.**

---

## 0. Headline

| Severity | Count | Ship-blocking? |
|----------|-------|----------------|
| 🔴 **P0** (critical, blocks ship) | 6 | Yes (all 6 ✅ Fixed in Day 17 P0 sprint) |
| 🟠 **P1** (high, must fix this sprint) | 8 | No (but should) |
| 🟡 **P2** (medium, backlog) | 13 | No |

**Day 17 P1 sprint (2026-06-08) shipped:**
- ✅ P1-7 — `/ai/config/status` perm gate
- ✅ P1-5 — strong password policy
- ✅ P1-1 / P1-2 — typecheck critical errors (PARTIAL: 11 of 36 fixed; 25 P2-10-bound)
- ✅ P1-6 — audit log retention script + endpoint (PARTIAL: cron scheduling deferred to US-OPS-2; orphan-`.get` syntax fix in commit ee63bbd)
- ✅ P1-3 (was already done in commit 42ef13b/7d79357)
- ✅ P1-4 (was already done in commit 726b23c)
- ✅ P1-9 — frontend CRUD gaps on Companies/Deals/Quotations list pages (commit fca07ee) + api.ts surface regression guard (commit c578759)
- ✅ P1-10 — Quotation line items preserve snapshot when Product/Service is deleted/renamed (commits 3b36451 + 835d972)
- ✅ P1-11 — Docker base-image floating tag + Bun install cache (bunfig.toml + Dockerfile pin to `oven/bun:1.2.23`)
- 📌 Critical follow-up: RG-007 — Day 17 AI tool confirmation migration was
   never applied to prod (also fixed in this sprint)

**Target:** all P0 done before next prod ship. P1 in this sprint. P2
maintained as a known backlog.

---

## P0 — Ship blockers (must fix before next deploy)

### P0-1 — Self-registration allows picking `role: 'ADMIN'`
- **Where:** `apps/api/src/routes/auth.ts:69-105`
- **Why:** `POST /auth/register` has no `.use(authContext)` or
  `.use(requirePermission('user:create'))`. Body schema accepts
  `role: t.Union([ADMIN, SALES, VIEWER])` from the client. Anyone on the
  public internet can self-register as admin in one request.
- **Fix:** Add `requirePermission('user:create')` and drop the `role`
  field from the body schema; new users default to SALES. Admins promote
  via the existing `PATCH /users/:id` flow.
- **Est:** 1 hour
- **Linked:** red-lines 3 (no SQL injection — N/A), 5 (no XSS — N/A),
  7 (security; implicit in red-line 11 + the project's QA gate).

### P0-2 — Companies / Contacts / Deals routes have no authContext
- **Where:** `apps/api/src/routes/company.ts` (4 endpoints),
  `contact.ts` (4 endpoints), `deal.ts` (4 endpoints)
- **Why:** `authContext=0` in all three files. Every GET / POST / PATCH /
  DELETE on `/companies`, `/contacts`, `/deals` is reachable by an
  unauthenticated client. `POST` even runs with `actorId = null` (system
  actor) when no token is supplied, so audit log gets a null actor.
- **Fix:** Add `.use(authContext)` then per-route
  `.use(requirePermission('company:read'))` / `:create` / `:update` /
  `:delete` matching the matrix in `docs/rbac.md`.
- **Est:** 2-3 hours (apply same pattern × 12 endpoints)
- **Linked:** `docs/rbac.md` permission matrix (which is now the source
  of truth but the routes haven't been wired to it).

### P0-3 — Chat / AI write tools have no RBAC
- **Where:** `apps/api/src/routes/chat.ts` (0 auth, 0 perm)
- **Why:** All chat endpoints are anonymous-reachable. The AI agent's
  write tools (`create_quotation` / `update_deal` / `create_company`)
  execute as system actor with no `chat:use` permission check. Audit
  log captures null actor — meaning AI-driven mutations are
  untraceable.
- **Fix:** `.use(authContext)` + `.use(requirePermission('chat:use'))`
  on `chatRoutes`. The agent loop already records actor context for
  tool calls; just need to gate the route.
- **Est:** 30 minutes

### P0-4 — JWT secret has insecure fallback in production
- **Where:** `apps/api/src/index.ts:46` + `rbac.ts:80`
- **Why:** `process.env.JWT_SECRET ?? 'dev-only-secret-please-change'`
  means a production build with a missing env var silently starts with
  a hard-coded weak secret. Anyone with the source can forge tokens.
- **Fix:** At boot, hard-fail if `JWT_SECRET` is missing or shorter than
  32 chars, and refuse the dev fallback string when
  `NODE_ENV === 'production'`.
- **Est:** 15 minutes

### P0-5 — `bun audit` + `npm audit` both fail (CVE status unknown)
- **Where:** `bun.lock` (Bun's format) + `bunfig.toml` (`exact = false`)
- **Why:** Red-line 18 says "Critical/High CVE = 0 to merge". `npm audit`
  errors with `ENOLOCK` (doesn't read `bun.lock`). `bun audit` requires
  Bun 1.2+ which we have, but the team has not run it. As of right now
  we have **zero** visibility into known-CVE dependencies. `exact = false`
  means `^5.6.3` caret ranges allow non-reproducible installs.
- **Fix:**
  1. `bunfig.toml`: set `exact = true`
  2. CI step: `bun audit --production` (must report 0 high/critical)
  3. Document the result in this file as evidence
- **Est:** 30 minutes (config + 1 CI workflow file)

### P0-6 — `docs/TECH-DEBT.md` missing (this file fixes that)
- **Where:** `docs/TECH-DEBT.md`
- **Why:** Red-line 10 explicitly requires this file to exist and be
  committed before any project can ship. It was missing; this entry
  is the meta-record that we created it. Future sprints will append
  findings here.
- **Est:** done (this file)

---

## P1 — High (this sprint, after P0)

### P1-1 — 30+ TypeScript errors in `apps/api`, masked by `@ts-nocheck`
- **Where:** `apps/api/src/routes/*.ts`
- **Why:** `bunx tsc --noEmit --skipLibCheck` in `apps/api` returns 30+
  errors. The most concerning:
  - `prisma.aiConfig` does not exist on `PrismaClient` (5 errors in
    `ai-config.ts` + `chat.ts:78`). The route is live in prod and works
    because `bun run` skips typecheck.
  - `'DEAL_STAGE_CHANGED'` not assignable to `AuditAction` enum
    (`deal.ts:152`).
  - `'AI_CONFIG_UPDATED'` not assignable to `AuditAction` enum
    (`ai-config.ts:199`).
  - `ContactInclude` doesn't have `activities` (`contact.ts:33`).
  - `jwt` and `userId` don't exist on context types in routes that
    consume them.
- **Fix:** Re-run `bunx prisma generate` to refresh the client; add the
  missing `AuditAction` enum values; remove `@ts-nocheck` and fix
  per-file.
- **Est:** 2-4 hours (one focused subagent sprint)
- **Linked:** no regression entry — these are pre-existing latent
  failures masked by the typecheck skip, not bugs that have surfaced.
- **Status (2026-06-08):** ✅ PARTIAL — fixed in commit f7eb183
  - 11 of 36 errors fixed: 6 `WorkSheet` type-only imports, 1
    `ContactInclude.activities` (latent 500), 1 `prisma.activityLog` →
    `prisma.activity` (latent 500 in AI tools.ts), and 7
    `AuditAction` enum values (now in schema + migration
    `20260608000000_p1-1_audit_action_enum` applied to prod).
  - 25 errors REMAIN — all `Property 'jwt' / 'userId' does not exist
    on type 'Context'`. These are Elysia 1.2 plugin-composition
    typecheck limitations (the actual values are present at runtime).
    Filed under P2-10 (Elysia 1.3 release will fix this). Full PR
    rationale in commit f7eb183.
  - RG-007 (Day 17 AI tool confirmation migration not applied to
    prod) was also fixed in commit 9829de2 — a hidden critical bug
    surfaced by the P1-1 work.

### P1-2 — `prisma.aiConfig` model referenced but not exported
- **Where:** `apps/api/src/routes/chat.ts:78`, `ai-config.ts:57,84,173,199,258`
- **Why:** Production runtime works only because `bun run` does not
  typecheck. If the generated Prisma client ever lags behind schema
  changes (e.g. a fresh `prisma generate` after a migration is applied
  to a different machine), these endpoints will return 500 at first
  hit.
- **Fix:** Part of P1-1; verify the `AiConfig` model is in
  `packages/db/prisma/schema.prisma` and regenerate.
- **Est:** included in P1-1
- **Status (2026-06-08):** ✅ Fixed in commit f7eb183 — `bunx prisma
  generate` regenerated the client; `prisma.aiConfig` now exists in
  the typed surface.

### P1-3 — Per-route audit log boilerplate duplication
- **Where:** `deal.ts:209-222`, `contact.ts:65-78`, `company.ts:175-194`
- **Why:** Three near-identical `findUnique → delete → logEvent → return
  success` blocks. Hard to keep consistent (e.g. forget a metadata
  field on one and not the others).
- **Fix:** Extract `withAudit({ action, resourceType, fn })` helper in
  `apps/api/src/lib/with-audit.ts`; refactor the three delete handlers
  (and any future ones) to use it.
- **Est:** 2 hours
- **Status (2026-06-08):** ✅ Fixed in commits 42ef13b + 7d79357 (P1-3a
  introduced `withAuditDelete` helper, P1-3b adopted it in 4 delete
  handlers).

### P1-4 — `toIdArray` query helper duplicated in `deal.ts` and `quotation.ts`
- **Where:** `apps/api/src/routes/deal.ts:11-15`,
  `quotation.ts:12-16`
- **Why:** Two identical 5-line helpers. Already a day-old drift risk
  (the queries changed on 2026-06-09 in parallel).
- **Fix:** Move to `apps/api/src/lib/query-helpers.ts`; import from
  both routes.
- **Est:** 30 minutes
- **Status (2026-06-08):** ✅ Fixed in commit 726b23c — `toIdArray`
  moved to `lib/query-helpers.ts`, both routes import from there.
  Covered by 8 unit tests (commit d653f1b).

### P1-5 — Password policy too weak
- **Where:** `apps/api/src/routes/auth.ts:62-67, 94-103, 155-159`
- **Why:** Login `minLength: 6`, register `minLength: 8`, change-password
  `minLength: 8`. No complexity rule. `Bun.password.hash` uses argon2id
  by default, but the input space is too small to be safe against
  dictionary attacks at scale.
- **Fix:** Register + change-password: `minLength: 12` + regex requiring
  one digit + one special char. Login: minLength 8 (we can't enforce on
  login without breaking existing users — handle in a separate
  migration that bumps the floor on next login).
- **Est:** 1 hour
- **Linked:** RG-006 (proposed — see below)
- **Status (2026-06-08):** ✅ Fixed in commit 571bb02 — `minLength: 12`
  + `validateStrongPassword` (digit + special char) enforced in
  register and change-password. Login stays at `minLength: 6`
  (grandfathered; RG-006 documents the Day 18+ login-floor
  migration). 40 unit tests cover the policy helper.

### P1-6 — Audit log retention spec (committed Day 14)
- **Where:** `docs/architecture/0014-audit-log-retention.md`
- **Why:** The ADR exists; the implementation does not. The 12-month
  default + 24-month sensitive retention rule is not yet enforced by
  a cron job, partition strategy, or archival pipeline.
- **Fix:** Implement a Prisma `cron`-style cleanup (or external cron)
  that soft-deletes `AuditLog` rows older than the configured retention
  based on `action` category. Add an admin "retention policy" CRUD to
  extend the ADR.
- **Est:** 4-6 hours
- **Linked:** ADR-0014
- **Status (2026-06-08):** ✅ PARTIAL — fixed in commit 7982d3d
  - `apps/api/src/scripts/audit-log-prune.ts` implements ADR 0014
    Phase A (script + dry-run + batched DELETE + sensitive list).
  - `GET /audit/retention-policy` endpoint exposes the current policy.
  - 6 unit tests cover the policy constants.
  - **Cron scheduling deferred to US-OPS-2 (Day 18+).** Manual
    invocation works: `docker compose exec api bun run
    apps/api/src/scripts/audit-log-prune.ts --dry-run --verbose`.

### P1-7 — AI Config `status` endpoint reachable by all users
- **Where:** `apps/api/src/routes/ai-config.ts` (status endpoint)
- **Why:** The `/ai/config/status` endpoint reveals
  `configured: true/false` to anonymous users, leaking admin
  environment state. QA-TRACKER row 34 self-flags this.
- **Fix:** Add `requirePermission('ai-config:read')` to the status
  route specifically.
- **Est:** 15 minutes

### P1-11 — Docker base image is a floating tag; Bun install cache poisoned by BuildKit
- **Where:** `apps/api/Dockerfile` (lines 8 + 43), `apps/web/Dockerfile` (line 8),
  `bunfig.toml` (`[install.cache]`)
- **Why (symptom, 2026-06-26):** `docker compose build api` failed at step
  10/17 with `bun install --frozen-lockfile` →
  `error: No version matching "5.22.0" found for specifier "prisma" (but
  package exists)`. The lockfile pins `prisma@5.22.0` correctly; the
  registry has 5.22.0; locally `bun install --frozen-lockfile` passed.
  Two compounding root causes:
  1. **`oven/bun:1.2` is a floating tag.** At different pulls it resolves
     to different patches (the crm-api container recently jumped
     1.2.14 → 1.2.23). 1.2.23's resolver is stricter and disagreed with
     the cached metadata that 1.2.14 had written.
  2. **`[install.cache] disable = false`** (Bun's default) means Bun
     keeps a per-`bun install` cache of resolved registry metadata.
     Inside Docker BuildKit's layer cache, that cache outlives a
     `docker build` invocation, so the next build can hit the network,
     fetch a slightly newer manifest for an unrelated package, and end
     up with a stale-but-not-stale-enough snapshot of `prisma` whose
     version range no longer matches the lockfile.
- **Fix (2026-06-26):**
  1. Pin both Dockerfiles to `oven/bun:1.2.23` (matches the running
     crm-api container). Documented a "must regenerate bun.lock" rule
     alongside.
  2. Set `[install.cache] disable = true` in `bunfig.toml`. Adds ~30s
     to a cold build; eliminates the class of failure entirely.
- **Est:** 10 minutes (already shipped)
- **Linked:** Day 17 hardening list (red-line 7 — env hygiene).

---

## P2 — Medium backlog (sprint +1 or later)

### P2-1 — `bunfig.toml` `exact = false` allows non-reproducible installs
- **Where:** `bunfig.toml:3`
- **Why:** Caret-range versions drift. Already partially covered by
  `bun install --frozen-lockfile` in Dockerfiles, but local `bun add`
  can introduce new ranges.
- **Fix:** `exact = true`. (Already part of P0-5 but called out
  separately for awareness.)
- **Est:** 5 minutes

### P2-2 — `apps/web/src/lib/api.ts` has no runtime validation
- **Where:** `apps/web/src/lib/api.ts` (the whole file)
- **Why:** Generic `request<T>` cast never verifies the wire response
  matches T. Backend regression that returns a different shape (e.g. a
  renamed field) wouldn't surface as a frontend error; the page would
  show `undefined` or crash deep in render.
- **Fix:** Add Zod schemas in `packages/shared/src/schemas/` mirroring
  the most-used response types (Company, Quotation, Deal, User, etc.)
  and call `.parse()` in the `request` wrapper.
- **Est:** 3-4 hours
- **Linked:** skill `polymorphic-line-items` already documents the
  `manDayLines` ↔ `manDays` rename trap.

### P2-3 — Frontend has no error boundary
- **Where:** `apps/web/src/`
- **Why:** Any uncaught render error (e.g. undefined `data.something`)
  crashes the whole React tree, sending the user back to a blank page.
- **Fix:** Add a top-level `<ErrorBoundary>` that catches and shows a
  localised "出了點問題 · 重新整理" message with a refresh button. Wrap
  the route components.
- **Est:** 1-2 hours

### P2-4 — CORS default `http://localhost:5173`
- **Where:** `apps/api/src/index.ts:33`
- **Why:** `CORS_ORIGIN` defaults to dev. In a real prod deploy, an
  unset `CORS_ORIGIN` would lock out the real frontend domain. Not
  exploitable, but operationally fragile.
- **Fix:** Hard-fail on `NODE_ENV=production` + missing `CORS_ORIGIN`.
- **Est:** 10 minutes

### P2-5 — File upload MIME validation missing
- **Where:** `apps/api/src/routes/activity.ts` (50MB upload limit
  exists; no type whitelist)
- **Why:** nginx caps uploads at 50MB and the server accepts whatever
  is posted. A motivated user could upload executables or scripts;
  the risk is reduced because nothing executes the file server-side
  and the SPA downloads via `<a download>`, but the metadata could
  be misleading.
- **Fix:** Whitelist MIME types (`image/png`, `image/jpeg`,
  `application/pdf`, `text/csv`, etc.); reject others with 415.
- **Est:** 1 hour

### P2-6 — No rate limiting on `/auth/login`
- **Where:** `apps/api/src/routes/auth.ts:8-67`
- **Why:** Credential stuffing / brute force has no cap. Even with
  argon2id, attacker can saturate the API.
- **Fix:** Add a simple in-memory token bucket per-IP + per-email
  (e.g. 5 failed attempts per 15 minutes). Document that this is
  per-process (multi-instance deploy would need Redis).
- **Est:** 2 hours

### P2-7 — No JWT expiry verification documented
- **Where:** `apps/api/src/index.ts:43-48`
- **Why:** `@elysiajs/jwt` defaults to 15-minute expiry, but no
  comment / doc states this. `iat` is set but not `exp` explicitly,
  so a future maintainer might break the rotation.
- **Fix:** Pin `exp` explicitly in `jwt.sign({...}, { exp: '15m' })`;
  add a refresh-token endpoint; document in `docs/operations.md`.
- **Est:** 2 hours
- **Linked:** would generate a fresh RG-007 entry.

### P2-8 — Frontend stores JWT in `localStorage`
- **Where:** `apps/web/src/lib/api.ts:3-4`
- **Why:** XSS gives the attacker the token. httpOnly cookie + CSRF
  token is the safer pattern, but switching changes the SPA auth
  model significantly. Acceptable for now given the threat model
  (internal CRM, not consumer), but document the trade-off.
- **Fix:** Document the threat-model decision in `docs/architecture/`.
  No code change yet.
- **Est:** 1 hour (doc only)

### P2-9 — `logEvent` write failures are not retried
- **Where:** `apps/api/src/middleware/audit.ts` (presumed location)
- **Why:** If Prisma fails to write the audit row (deadlock, connection
  blip), the API call still succeeds. Audit completeness is not
  guaranteed.
- **Fix:** Either (a) wrap the whole mutation + audit in a
  `prisma.$transaction()`, or (b) write audit to an outbox table and
  ship from a background worker.
- **Est:** 3 hours
- **Linked:** would be a new ADR-0015.

### P2-10 — Elysia 1.2 `// @ts-nocheck` everywhere
- **Where:** `apps/api/src/routes/{rbac,quotation}.ts` and friends
- **Why:** The Day 1 trade-off comment in `rbac.ts:1-4` explains why
  (`set.status` literal union, derive context across plugins). Once
  Elysia 1.3 ships, re-enable typecheck.
- **Fix:** Track Elysia 1.3 release notes; remove `@ts-nocheck` per
  file.
- **Est:** 4-6 hours (wait for Elysia 1.3)

### P2-11 — `nginx:1.27-alpine` and `postgres:16-alpine` EOL
- **Where:** `docker-compose.yml` + `apps/web/Dockerfile`
- **Why:** Both are recent as of 2026; postgres 16 EOL 2028, nginx
  1.27 EOL ~2026. No action needed now, but file the awareness.
- **Fix:** Calendar reminder 6 months ahead.
- **Est:** calendar entry only

### P2-12 — Frontend TanStack Query devtools not enabled in dev
- **Where:** `apps/web/src/main.tsx` (presumed)
- **Why:** Debugging cache state requires manual inspection. Low
  cost, big debug win.
- **Fix:** Wrap `<QueryClientProvider>` in `<ReactQueryDevtools />`
  in dev only.
- **Est:** 15 minutes

### P2-13 — Zero automated test coverage (Unit / Integration)
- **Where:** `apps/api` + `apps/web` + `packages/db`
- **Why:** Red-line 16 requires P0 US to have Unit + Integration + E2E
  test layers. As of Day 14.7 (merged 2026-06-07 in `019cab8`):
  - 0 unit test files in the repo
  - 0 integration test files
  - 0 test directories
  - `apps/api/package.json` has `"test": "echo 'test: not configured yet'"`
  - `apps/web/package.json` has no `test` script at all
  - All testing relies on the 23-step E2E smoke script
    (`/tmp/smoke-before-merge.sh`) + manual verification

  This is **pre-existing structural debt** dating back to Day 1
  (`bun-elysia-react-vite-stack` skill bootstrap), not introduced
  by the Day 14.7 PR. Elysia 1.2 + `@ts-nocheck` in many route
  files makes writing unit tests harder (a small refactor pass
  to remove `@ts-nocheck` would help — see P1-1).

  **Caveat from red-line audit 2026-06-07T14:05Z** (David approved
  keeping merge without this entry, asked to log it as P2 for
  Day 15+):
  > "0 test 嘅 US 唔可以 ship" — strictly read, no P0 US can ship
  > until this is addressed. We've been getting away with E2E-only
  > because the manual smoke covers the happy paths, but any future
  > refactor will lack a safety net.
- **Fix:** (Day 15+ sprint; not blocking current prod deploy)
  1. `apps/api`: add `bun:test` setup. Cover 7 settings endpoints
     + Tax API + RBAC `requirePermission` (3 smoke tests each,
     targeting 100% of the `permission → route` matrix in
     `docs/rbac.md`).
  2. `apps/web`: add `vitest` + React Testing Library. Cover
     `lib/api.ts` request wrapper, multi-autocomplete components,
     and the quotation-builder tax-override flow.
  3. `packages/db`: add Prisma raw-query integration tests
     (e.g. `audit log is written transactionally with mutation`).
  4. Convert `/tmp/smoke-before-merge.sh` to Playwright so the
     E2E layer is reproducible in CI.
- **Est:** 2-3 sprints (~16-24 hours)
- **Priority rationale:** logged as P2 because David approved
  Day 14.7 merge with this caveat (red-line 16 is a known
  acceptable risk for this ship, not a hard block). Will be
  re-promoted to P1 if any of the next 3 sprints introduces
  a refactor that lacks unit-test safety net.
- **Linked:** red-line 16 (testing); red-line 12 (P0 US must
  have test tasks) — `docs/QA-TRACKER.md` rows for US-S1..S7
  all show `planned` test status; red-line 17 (deploy smoke
  exists but is E2E-only, not unit-backed).

---

## Cross-references

- **Red-line 10** (`docs/project-documentation-standard.md`): this file
  is the project-documentation standard's `TECH-DEBT.md` requirement.
- **Red-line 11** (`docs/qa-tracker.md`): QA-TRACKER.md is the per-US
  status; this file is the cross-cutting tech debt (architecture +
  security + ops). Different concern, both required.
- **Red-line 13** (`skills/regression-guard/`): each bug fix gets an
  RG-XXX entry; tech debt items are pre-existing structural issues
  and don't get RG- entries unless they have already caused a bug.
- **Red-line 16/17/18** (testing + smoke + CVE): tracked in
  `docs/qa-gate.md` and `docs/TEST-COVERAGE.md`.

---

## How to update this file

1. **New finding** discovered → append a new `### P?-N` block with
   location, why, fix, est, linked entries.
2. **Finding fixed** → change severity tag, append `✅ Fixed in <commit>`
   with date, move to a `## Archive` section at the bottom.
3. **Finding re-prioritised** → update severity, note why in the
   entry body.
4. **Finding deferred** → add a `⏸ Deferred: <reason>` tag. Don't
   delete — keep the historical record.
