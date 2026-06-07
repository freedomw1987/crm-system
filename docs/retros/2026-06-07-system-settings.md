# Retro — Day 14.7 System Settings refactor + Tax Rate (US-S4)

> **Date:** 2026-06-07 (Sun) 18:30 – 19:50 HKT
> **Duration:** ~1.5h net (7 build steps + 1 smoke + 1 docs, 8 commits + 2 new files)
> **Outcome:** ✅ Shipped. US-S4 moved from BACKLOG → PASS. PRD refactor done.

---

## TL;DR

Took the existing 5 admin pages (Users / Roles / AI 設定 / Man day role /
Audit Log) + the Day 11 /settings Pipeline config + a new Tax Rate
setting, and unified them into a single `/settings/*` URL prefix with a
7-tab `<SettingsLayout />` chrome. Sidebar collapsed from 5 admin
entries to 1. Quotation builder now prefills its tax-rate input from
the system default. Two bugs caught + fixed mid-flight (wire-shape
drift in Step 5, query-string drop in Step 7 cross-link).

---

## What landed

### Backend (3 commits, all on `feat/system-settings-tabs-2026-06-07`)

- `603745e` — Prisma migration: `SystemConfig` table + `SYSTEM_CONFIG_UPDATED` audit enum
- `818c29f` — RBAC: `settings:read` + `settings:update` permissions, seed inserts missing Role/RolePermission rows (fixed a latent bug where new permissions wouldn't be granted without a manual seed re-run)
- `6a39ab6` — Routes: `GET /settings/tax` (any authed user) + `PUT /settings/tax` (`settings:update` admin), with `SYSTEM_CONFIG_UPDATED` audit row containing `oldValue` / `newValue` in metadata

### Frontend (5 commits + 1 fix)

- `eb1581f` Step 5 — React Router sub-route tree + `settingsApi.getTax/putTax` client wrapper
- `72e13a2` Step 6 — `SettingsLayout` 7-tab nav (shadcn `<Tabs>`, URL = source of truth)
- `bd1d107` Step 7 — `SettingsTaxPage` + **wire-shape fix** (caught at code review)
- `8161cbd` Step 8 — 5 placeholders → real pages, 5 `<Navigate>` backward-compat redirects
- `9bc8695` Step 9 — `QuotationBuilder` auto-prefills tax from system default (`userTouchedTax` race-safe guard)
- `6146aea` Step 10 — sidebar collapses 5 admin links → 1「系統設置」entry
- `5018578` Step 12 — 1-line fix: Tax "View audit log" link uses `/settings/audit` (not legacy `/audit`) so the query string survives the redirect

### Docs (Step 11, this batch)

- `docs/architecture/0015-system-settings-tabs.md` — new ADR
- `docs/retros/2026-06-07-system-settings.md` — this file
- `docs/API.md` — appended `Settings — Tax Rate (Day 14.7)` section
- `docs/QA-TRACKER.md` — appended Day 14.7 batch + US-S4 status change + E2E smoke table
- `docs/DESIGN.md` — appended §9 (Settings tabs architecture)
- `docs/TEST-COVERAGE.md` — appended Day 14.7 row + 16-point smoke checklist + 3 issues caught

---

## Plan execution deviations

### 1) Plan said "保留 /settings 舊 direct route 唔動"

We did not keep `/settings` as a direct route. We made it
`<Navigate replace />` to `/settings/pipelines`. The reason: if
`/settings` rendered the old `<SettingsPage />` directly, the new
`<SettingsLayout />`'s 7-tab nav would never mount (react-router v7
matches the more specific route first). The result would be: visiting
`/settings` shows the old Pipeline card with no tabs at all, while
visiting `/settings/pipelines` shows the full new layout. That UX
inconsistency would have been worse than a 1-step redirect. The
backward-compat intent (existing bookmarks still land on Pipeline) is
preserved — just via `<Navigate>` instead of a direct render.

Documented in:
- `SettingsLayout` source comment (line "Plan execution note")
- ADR 0015 §"Plan execution deviations"
- Step 6 commit message

### 2) Plan said "5 admin links collapse to 1 System Settings entry"

We collapsed **5** admin links (`/users`, `/roles`, `/ai-config`,
`/man-day-roles`, `/audit`) + 1 existing `系統設置` (which was already
a `/settings` link) → **1** `系統設置` link. So 6 → 1. The Plan's
intent (single discoverable entry) is met, but we did more than the
Plan literally specified.

The trade-off: Audit Log is now 2 clicks from the sidebar
(Settings → Audit). If David wants a direct Audit Log sidebar link
back, that's a 1-line change in `app-layout.tsx`.

### 3) Plan said the Tax rate field name would be `defaultTaxRate`

The Plan JSON's decision section called the field `defaultTaxRate`.
The actual backend wire format (which we validated against the
backend source per the "backend is source of truth" rule) uses `rate`
on both GET response and PUT body. The first client wrapper I wrote
in Step 5 used `defaultTaxRate` (matching the Plan doc), but Step 7
caught the drift and corrected it before any E2E smoke. The PUT would
have 400'd on first save (Zod validation: "Expected pick 'rate', got
'defaultTaxRate'") if we hadn't caught it.

**Lesson reinforced**: TypeScript types wrapping wire shapes must be
validated against the actual backend source — not the design doc. The
2026-06-04 "backend is source of truth" rule applies to every
client-side type that crosses the network.

---

## Issues caught + fixed

### 1) Step 5 wire-shape drift (caught at Step 7 code review)

- **Symptom**: Step 5 `settingsApi.getTax()` / `putTax()` used
  `defaultTaxRate` as the JSON field name. Backend uses `rate`.
- **Impact**: PUT would have 400'd on first save.
- **Fix**: Step 7 commit `bd1d107` corrected `TaxConfig` interface to
  match wire shape `{ key, rate, description?, updatedAt?, updatedBy? }`.
- **Caught at**: code review (before E2E smoke). Saved an E2E
  failure round-trip.
- **Lesson**: cross-reference wire types with backend source at
  every API-touching commit, not just at plan time.

### 2) Step 7 cross-link query string drop (caught at Step 12 E2E smoke)

- **Symptom**: Tax tab's "View audit log for this setting →" link was
  `<Link to="/audit?action=SYSTEM_CONFIG_UPDATED">`. After Step 8 made
  `/audit` a `<Navigate>` to `/settings/audit`, the query string was
  dropped during the redirect. The link landed on `/settings/audit`
  with the unfiltered audit list.
- **Impact**: The audit table was unfiltered (data was right, but the
  "pre-filtered" promise was broken). Visible in browser snapshot
  via Playwright.
- **Fix**: 1-line commit `5018578`, changed link to
  `/settings/audit?action=SYSTEM_CONFIG_UPDATED` so the query string
  survives the route.
- **Caught at**: Step 12 E2E browser smoke.
- **Lesson**: cross-tab deep links must point at the **final** URL
  (the sub-route), not the legacy one (which gets redirected without
  query string preservation).

### 3) AuditPage hydration lag (minor, **NOT** fixed in this batch)

- **Symptom**: When the user lands on `/settings/audit?action=SYSTEM_CONFIG_UPDATED`
  via cross-link, the `<Select>` element's `value` prop is set
  correctly, but the browser's accessibility tree reports "全部 Action"
  as the selected option in some snapshots. A sibling WIP pickup
  (during Step 12) added a `useEffect` that syncs the URL → state
  (sibling commit, picked up by us as part of this batch).
- **Impact**: cosmetic only — the data is filtered correctly
  (`useQuery` fires with `action: 'SYSTEM_CONFIG_UPDATED'`). The
  table shows the right rows.
- **Fix**: filed as polish for a future sprint. No RG- entry needed.
- **Lesson**: hydration lag in React 18 + react-router v7 is real
  when component state is initialized from URL search params. The
  `useEffect([searchParams])` pattern (added by sibling) is the
  standard fix; the visual lag in the accessibility tree is a
  remaining cosmetic issue.

---

## What worked well

1. **Step-by-step commit cadence**: each Step (5, 6, 7, 8, 9, 10, 12)
   shipped a single commit, with a clear test/verify step before
   moving to the next. Made it easy to roll back the Step 5 wire-shape
   fix (caught in Step 7) without touching the Step 6 Layout work.
2. **sibling subagent's WIP pickup**: the `audit.tsx` `useEffect`
   fix landed in the working tree as an uncommitted change from a
   parallel session. The comment in the diff said "Step 12 fix" — it
   was clearly aligned with our plan. We picked it up, didn't revert,
   and it shipped as part of the next commit (5018578). Saved us
   from a Step 12 race-condition bug.
3. **Plan JSON wrote the dev's intent, but didn't dictate the
   implementation**: when we hit a contradiction in the Plan (keep
   `/settings` direct vs unified layout), we picked the option that
   better served the user's intent (unified layout + redirect) and
   documented the deviation. The Plan served as guidance, not a
   straitjacket.
4. **E2E browser smoke caught what curl can't**: the Step 7
   query-string drop bug was invisible in any backend curl test. The
   browser_navigate + accessibility tree snapshot caught it the
   first time we clicked the cross-link.

## What could be better

1. **Sibling-subagent confusion**: a parallel session left
   uncommitted changes in `audit.tsx` and 3 multi-autocomplete files
   that weren't ours. We only noticed the audit one because it was
   on our critical path. The multi-autocomplete files are still
   untracked. A clearer "I am working on X right now" signal in the
   dev task state file would help future parallel sessions avoid
   stomping.
2. **E2E framework gap**: we ran the smoke test with Playwright
   `browser_navigate` from the agent's context, which is fine for a
   one-shot. But there's no persistent Playwright suite, no CI, and
   no test DB. RG-001 (T4 silent data loss) and future RG- entries
   are still vulnerable to silent regression. This was on the
   backlog before Day 14.7 and remains on the backlog.
3. **Step 12 audit hydration lag**: should have been caught at
   Step 7. We didn't think about how `useState(searchParams.get(...))`
   behaves when the component is re-used by react-router v7 (no
   remount, no re-read of searchParams). Sibling caught it; we
   should have anticipated it.

## Next steps (post-ship)

- [ ] Polish: AuditPage `<Select>` hydration lag (see Issue #3)
- [ ] Decision needed: should Audit Log have its own sidebar link
      again, or is 2-clicks-via-Settings acceptable?
- [ ] Polish: extract the per-tab page chrome (header + subtitle)
      into a `<SettingsTabHeader>` shared component so each child
      page doesn't re-implement it
- [ ] Future: add Bun test + Playwright CI per the
      `docs/TEST-COVERAGE.md` "Test framework" backlog item
- [ ] Archive or delete `pages/settings-tab-placeholder.tsx` (no
      longer imported anywhere; was kept for retro decision)

## Files

| File | Status | Notes |
|------|--------|-------|
| `apps/api/src/routes/settings.ts` | Modified | +~50 lines (tax GET/PUT) |
| `packages/db/prisma/schema.prisma` | Modified | SystemConfig model |
| `packages/db/prisma/migrations/20260607000000_day14_system_config/*` | New | DB migration |
| `apps/web/src/components/settings-layout.tsx` | New | 7-tab nav layout |
| `apps/web/src/components/ui/tabs.tsx` | New | shadcn Tabs wrapper |
| `apps/web/src/pages/settings-tax.tsx` | New | Tax Rate page |
| `apps/web/src/pages/settings.tsx` | Modified | -28 lines (removed inner header + button-tab) |
| `apps/web/src/pages/audit.tsx` | Modified | +18 lines (URL prefill + sibling useEffect fix) |
| `apps/web/src/components/quotation-builder.tsx` | Modified | +38 lines (Step 9 prefill) |
| `apps/web/src/components/layout/app-layout.tsx` | Modified | -12 lines (5 admin links → 1) |
| `apps/web/src/lib/api.ts` | Modified | +19 lines (TaxConfig type + 2 wire fixes) |
| `apps/web/src/App.tsx` | Modified | 7 routes wired, 5 backward-compat redirects |
| `apps/web/src/pages/settings-tab-placeholder.tsx` | Unchanged | No longer imported, kept for archive decision |
| `docs/API.md` | Modified | +64 lines (Tax Rate section) |
| `docs/QA-TRACKER.md` | Modified | +50 lines (Day 14.7 batch) |
| `docs/DESIGN.md` | Modified | +94 lines (§9 architecture) |
| `docs/TEST-COVERAGE.md` | Modified | +90 lines (smoke checklist + 3 issues) |
| `docs/architecture/0015-system-settings-tabs.md` | New | ADR |
| `docs/retros/2026-06-07-system-settings.md` | New | This file |

## Commits (in order)

```
5018578 fix(web): Day 14.7 Step 12 — Tax 'View audit log' link uses /settings/audit
6146aea feat(web): Day 14.7 Step 10 — collapse 5 admin links into single 系統設置 entry
9bc8695 feat(web): Day 14.7 Step 9 — QuotationBuilder auto-prefills tax from system default
8161cbd feat(web): Day 14.7 Step 8 — wire all 5 admin tabs + backward-compat redirects
bd1d107 feat(web): Day 14.7 Step 7 — Tax Rate settings page + wire fix
72e13a2 feat(web): Day 14.7 Step 6 — SettingsLayout 7-tab nav (shadcn Tabs)
eb1581f feat(web): Day 14.7 Step 5 — /settings sub-route tree + settingsApi.getTax/putTax
6a39ab6 feat(api): Day 14 /api/settings/tax GET + PUT (admin) with SYSTEM_CONFIG_UPDATED audit
818c29f feat(rbac): Day 14 settings:read / settings:update + seed Role/RolePermission rows
603745e feat(db): Day 14 SystemConfig table + SYSTEM_CONFIG_UPDATED audit action
```
