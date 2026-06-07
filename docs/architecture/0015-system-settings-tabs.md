# ADR 0015 — System Settings: sub-route tabs over per-page routes

- **Date:** 2026-06-07
- **Status:** Accepted
- **Deciders:** David Chu (product), Tree Monstor (eng)
- **Related:** [Day 14.7 plan](../retros/2026-06-07-system-settings.md),
  [ADR 0014 (audit log retention)](./0014-audit-log-retention.md),
  [DESIGN.md §9](../DESIGN.md)

## Context

Before Day 14.7 the CRM had **5 separate admin pages** — Users, Roles,
AI 設定, Man day role, Audit Log — each with its own top-level route
(`/users`, `/roles`, `/ai-config`, `/man-day-roles`, `/audit`). There
was also a 6th — `/settings` — which was the sales-pipeline
configuration page (Day 11, US-S1). All 6 pages rendered their own
`<h1>`, their own sub-title, and (in the case of `/settings`) their own
button-style tab strip.

The problems with this surface area:

1. **Discoverability**: the sidebar listed 5 separate admin entries.
   It wasn't obvious they were related (they're all admin config) or
   that there was a 6th "Settings" page hiding at a different URL.
2. **Naming**: each page had its own naming convention for the same
   concept (Users vs Roles vs AI 設定 vs Man day role vs Audit Log vs
   系統設置). Hard to scan, hard to remember.
3. **Future surface area**: Phase 2 was going to add a Tax Rate tab
   inside `/settings`, but the existing button-strip pattern (Pipeline /
   Tax rate) wouldn't scale to 3+ tabs without becoming awkward.
4. **Cross-linking**: there was no natural way to link from the Tax
   tab to "the audit log filtered to this setting" — the two pages
   didn't share a layout or a URL prefix.

## Decision

Reorganize all 6 admin surfaces under a single URL prefix `/settings/*`
with a shared `<SettingsLayout />` chrome that renders:

- An `<h1>系統設置</h1>` heading + sub-title
- A shadcn `<Tabs>` row of 7 `<TabsTrigger>`s (URL = source of truth)
- An `<Outlet />` for the child route

The 7 tabs are:

1. **Pipelines** — moved from `/settings` (Day 11's US-S1)
2. **Users** — moved from `/users`
3. **Roles** — moved from `/roles`
4. **AI** — moved from `/ai-config` (OpenRouter / gpt-5.5 form)
5. **Man-day** — moved from `/man-day-roles` (Senior/Junior role catalogue)
6. **Tax** — NEW (Day 14.7 US-S4 — global default tax rate)
7. **Audit** — moved from `/audit`

The 5 legacy top-level direct routes (`/users`, `/roles`, `/audit`,
`/ai-config`, `/man-day-roles`) are kept as `<Navigate replace />`
backward-compat redirects to the new sub-routes, so any bookmark /
chat-share / email link from before today still works.

The legacy `/settings` URL is also kept as `<Navigate replace />` to
`/settings/pipelines`, so the existing Pipeline CRUD deep links still
land on the right place.

The sidebar ADMIN section collapses from 5 entries to **1**: 系統設置.
The other 5 admin links are removed from the sidebar (they're reachable
via the Settings tabs, plus the legacy URLs still redirect).

### Why URL = source of truth (not Radix Tabs' internal state)

Standard shadcn Tabs uses `useState` to track the active tab. We
deliberately deviate from this pattern:

```tsx
<Tabs value={currentTab} onValueChange={handleTabChange}>
```

where `currentTab` is derived from `useLocation().pathname` and
`handleTabChange` calls `navigate('/settings/<next>')`.

This means:

- Deep links work: pasting `/settings/tax` into chat or email lands
  on the Tax tab with the right content rendered.
- Browser back/forward navigate between tabs as expected.
- Each tab is independently URL-shareable.
- Cross-tab deep links work: the Tax tab's "View audit log" link
  emits `/settings/audit?action=SYSTEM_CONFIG_UPDATED`, and the
  AuditPage reads `useSearchParams()` to pre-filter the table.

### Why `TabsTrigger` + `onClick`, not `<NavLink>` inside `<TabsList>`

An early draft used `<NavLink>` inside `<TabsList>` (styled to look
like a `<TabsTrigger>`). It failed because Radix Tabs in controlled
mode logs a console warning when its `value` prop doesn't match a
child `<TabsTrigger value=…>`. We switched to native `<TabsTrigger>` +
`onClick` calling `navigate(...)`. Trade-off: middle-click "open in
new tab" no longer works on the tab strip (it's a `<button>`, not an
`<a>`). Acceptable because the tab nav is for in-app navigation; deep
links from outside the app still land on the right tab via the URL
contract above.

## Alternatives considered

### A) Mega menu (dropdown nav)

- **Pros**: smallest surface-area change. Existing pages keep their URLs.
- **Cons**: doesn't solve the discoverability problem (5 separate menu
  items, still hard to scan). Doesn't enable cross-tab deep links.
  Doesn't scale to 3+ tabs in the future.
- **Rejected**: doesn't meet the discoverability + cross-link goals.

### B) Sidebar layout (left list, right content)

- **Pros**: visually clear — open Settings, see 5 entries.
- **Cons**: takes more screen real estate. Hard to RWD on mobile
  (sidebar + content + sidebar = cramming). Doesn't match the existing
  pattern (every other admin page is a full-page route, not a sidebar).
- **Rejected**: visual + RWD cost outweighs the clarity gain.

### C) Single "Settings" page with anchor scroll

- **Pros**: trivially simple. No new routes. No new layout component.
- **Cons**: no deep links to individual tabs. No browser back/forward
  between tabs. No per-tab page state (each tab is just an `<h2>` on
  the same page).
- **Rejected**: doesn't meet the deep-link goal, which is the whole
  point of having tabs in a CRM context.

## Consequences

### Positive

- Discoverable: 1 sidebar entry → 7 tabs.
- URL-shareable: every tab is a deep link.
- Cross-linkable: Tax tab → Audit tab pre-filtered to `SYSTEM_CONFIG_UPDATED`.
- Future-proof: adding an 8th tab (e.g. Regions, Integrations) is just
  one route + one entry in the `TABS` array.
- Audit-friendly: a 12-month retention ADR was already in place (Day
  14, ADR 0014); the Tax → Audit cross-link makes the retention
  visible to the admin who configures the value.

### Negative

- The original `/settings` page's inner header + button-style tab
  strip had to be removed (would have rendered twice — once in the
  Layout, once in the page). This is documented in
  `pages/settings.tsx`'s Day 14.7 Step 6 comment.
- The Audit tab's "all events" view is now 2 clicks away from the
  sidebar (Settings → Audit). Users who hit `/audit` directly from a
  chat share still land on the right page via the backward-compat
  redirect.
- The `<Tabs>` controlled-mode + Radix warning combination meant we
  can't use `<NavLink>` inside `<TabsList>`. We lose middle-click "open
  in new tab" on the tab strip. Documented in `SettingsLayout` comments.

### Neutral

- The dev task memory was polluted with 5 separate "Step N" states
  (Step 5, 6, 7, 8, 9, 10, 12). Each step shipped a single commit
  series; the retro file `2026-06-07-system-settings.md` ties them
  back together.
- The `SettingsTabPlaceholder` page is no longer used (all 7 tabs are
  real pages now) but was kept on disk for Step 12 retro to decide
  archive vs delete. It's not imported anywhere in the SPA bundle
  (Vite tree-shakes it).

## Plan execution deviations from the original doc

The Day 14.7 plan JSON
(`docs/_meta/2026-06-07-system-settings-plan.json`) said:

> "保留 /settings 舊 direct route 唔動"

We did **not** keep `/settings` as a direct route. We made it a
`<Navigate replace />` to `/settings/pipelines`. The reason: if
`/settings` rendered the old `<SettingsPage />` directly, the new
`<SettingsLayout />`'s 7-tab nav would never mount (react-router v7
matches the more specific route first). The result would be: visiting
`/settings` shows the old Pipeline card with no tabs at all, while
visiting `/settings/pipelines` shows the full new layout. That UX
inconsistency would have been worse than a 1-step redirect. The
backward-compat intent (existing bookmarks still land on Pipeline) is
preserved — just via `<Navigate>` instead of a direct render.

This is documented in the "Plan execution deviations" section of
`docs/retros/2026-06-07-system-settings.md`.
