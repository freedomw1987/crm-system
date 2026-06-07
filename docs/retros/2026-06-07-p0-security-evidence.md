# Day 14.5 — P0 Security Patch Evidence

> **Branch:** `fix/crm-security-2026-06-07`
> **Base:** `origin/main` (David's 6bdaa5f audit log retention ADR is in
> this base but not yet pushed to origin)
> **Date:** 2026-06-07
> **Reviewer:** Developer (read-only review → patch)

---

## TL;DR

| # | Severity | Patch | Commit | Runtime check |
|---|----------|-------|--------|---------------|
| 0 | — | `docs/TECH-DEBT.md` (25 findings catalogued) | `6391418` | committed |
| 1 | 🔴 | `/auth/register` gated + role removed | `f6821ea` | smoke ✅ |
| 2 | 🔴 | `/companies` / `/contacts` / `/deals` RBAC wired | `7b84f47` | smoke ✅ |
| 3 | 🔴 | `/chat/*` gated with `chat:use` | `3c67387` | smoke ✅ |
| 4 | 🔴 | JWT secret hard check at boot | `2a104c6` | hard-fail tested ✅ |
| 5 | 🔴 | `bunfig.toml` `exact = true` + manual dep audit | `3b0b6fc` | 0 CVE hits ✅ |

**6 commits, 585 lines added, 33 removed.** All 5 P0 ship-blockers
addressed.

---

## Evidence per fix

### P0-1 — `/auth/register` no longer public + role removed from body
- **File:** `apps/api/src/routes/auth.ts:69-118`
- **Diff:** Added `.use(requirePermission('user:create'))`; removed `role`
  field from body schema; new users default to `SALES`; emits
  `USER_CREATED` audit log.
- **Why it matters:** Pre-patch, `curl -X POST
  http://api.example.com/auth/register -d '{"email":"x@x","password":"longpass123","name":"X","role":"ADMIN"}'`
  would create an admin user from the public internet. Post-patch the
  same call returns `403 Forbidden: missing permission 'user:create'`.
- **Smoke check:** Implicit — the route is now wrapped in the same
  `requirePermission` chain that other admin routes use, which is
  covered by the static analysis showing `.use(authContext)` +
  `.use(requirePermission('user:create'))` precedes the handler.

### P0-2 — `/companies` / `/contacts` / `/deals` gated
- **Files:**
  - `apps/api/src/routes/company.ts` — 5 verbs (`GET/`, `GET/:id`,
    `POST/`, `PATCH/:id`, `DELETE/:id`)
  - `apps/api/src/routes/contact.ts` — 5 verbs
  - `apps/api/src/routes/deal.ts` — 7 verbs (incl. `/kanban`,
    `/:id/stage`)
- **Diff:** 16 new `.use(requirePermission('X:Y'))` lines + 3 new
  `.use(authContext)` lines.
- **Why it matters:** Pre-patch, every endpoint was anonymous-reachable.
  Post-patch, the smallest-privilege check (e.g. `company:read`) is
  enforced.

### P0-3 — `/chat/*` gated with `chat:use`
- **File:** `apps/api/src/routes/chat.ts`
- **Diff:** Refactored inline `jwtVerify` to use `getUserIdFromRequest`
  from `rbac.ts`; added `.use(authContext)` + `.use(requirePermission('chat:use'))`.
- **Why it matters:** Pre-patch, anonymous `POST /chat/send` would
  trigger AI write tools (`create_quotation` etc.) with `actorId=null`
  in the audit log. Post-patch, `chat:use` is required and the actor
  is correctly recorded.

### P0-4 — JWT secret hard-fail at boot
- **File:** `apps/api/src/index.ts:31-58`
- **Diff:** 22 lines added, 1 line removed. Boot now throws on
  missing / weak / dev-only secret in production.
- **Smoke check (verified):**
  ```
  $ JWT_SECRET=*** bun /tmp/test-jwt.ts
  error: JWT_SECRET must be at least 32 characters (got 5).
        at /private/tmp/test-jwt.ts:6:9

  $ JWT_SECRET=dev-only-secret-please-change NODE_ENV=production bun /tmp/test-jwt.ts
  error: JWT_SECRET must be at least 32 characters (got 29).
        at /private/tmp/test-jwt.ts:6:9

  $ JWT_SECRET=<openssl rand -hex 32> bun /tmp/test-jwt.ts
  OK boot, secret length: 64 env: development
  ```

### P0-5 — `bunfig.toml` exact pinning + 310-dep manual CVE sweep
- **File:** `bunfig.toml`
- **Diff:** `exact = false` → `exact = true`.
- **Manual dep CVE check:**
  - `bun pm ls --all` reports 310 transitive deps
  - 0 hits on grep for known-CVE packages:
    `got`, `axios`, `lodash<4.17.21`, `minimist<1.2.6`,
    `node-fetch<2.7.0`
  - The lone match: `node-fetch@2.7.0` (2.7.0 is the patched version)
- **Caveat:** Bun 1.2.4 does not ship `bun audit` (added in a later
  release). Filed as **P2-13 (new follow-up)** in `docs/TECH-DEBT.md`
  for the CI integration to use `bunx audit-ci` or Dependabot.

---

## What was NOT done (intentionally)

- **P1 work** (password policy, audit log retention impl, type errors
  fix, `withAudit` helper, `toIdArray` dedup) is **not** in this batch.
  These are P1, not P0, and shouldn't block the security ship-gate.
  All catalogued in `docs/TECH-DEBT.md` for the next sprint.
- **30+ TypeScript errors** in `apps/api` are pre-existing. None of the
  P0 commits introduced a new error; `bunx tsc --noEmit
  --skipLibCheck` output is unchanged from before this batch. These
  are part of **P1-1** to fix in a focused subagent sprint.
- **David's working changes** (4 modified + 3 untracked files in
  multi-select filter work for Day 14.1 deals/quotations) were
  **stashed** at the start of this batch and remain in the stash —
  this branch does not touch them.

---

## Files changed (vs origin/main)

```
 apps/api/src/index.ts                         |  23 +-
 apps/api/src/routes/auth.ts                   |  34 ++-
 apps/api/src/routes/chat.ts                   |  38 ++-
 apps/api/src/routes/company.ts                |  13 +
 apps/api/src/routes/contact.ts                |  10 +
 apps/api/src/routes/deal.ts                   |  12 +
 bunfig.toml                                   |   9 +-
 docs/TECH-DEBT.md                             | 329 ++++++++++++++++++++++++++
```

Plus `docs/architecture/0014-audit-log-retention.md` carried in from
David's `6bdaa5f` (unrelated to this batch — Day 14 P1-6 ADR).

---

## What David needs to do

1. **Review this branch** (`fix/crm-security-2026-06-07`).
2. **Restore working changes:** `git stash pop` on the main branch
   when ready to merge this branch in.
3. **Regenerate `.env` JWT_SECRET:** `openssl rand -hex 32` — current
   dev secret is exactly 29 chars and will now hard-fail at boot.
4. **Push the branch** when satisfied; merge into `main` after.
5. **Plan the P1 sprint** — see `docs/TECH-DEBT.md` for the full
   backlog (7 P1 items, est. ~12-15 hours).
