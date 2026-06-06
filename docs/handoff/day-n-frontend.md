# Day N — Frontend Handoff (David feature set)

This document is the source of truth for the frontend work that follows
commit `da28ec9` (the backend push on 2026-06-06). It is intentionally
short — subagents should `read_file` the actual schema and route files
to get the full contract.

## Backend changes (commit `da28ec9`)

### New endpoints
- `GET    /api/man-day-roles`             — public, returns `ManDayRole[]`
- `POST   /api/man-day-roles`             — admin only (hardcoded role check, NOT RBAC table)
- `PATCH  /api/man-day-roles/:id`         — admin only
- `DELETE /api/man-day-roles/:id`         — admin only, 409 if referenced by service lines
- `GET    /api/activities?companyId=|dealId=` — list
- `GET    /api/activities/recent?limit=`  — cross-company/deal recent feed
- `POST   /api/activities`                — body `{companyId|dealId, type, content}`
- `DELETE /api/activities/:id`            — cascades to attachments, unlinks files
- `GET    /api/companies/:id/attachments` — flat list across all company activities
- `GET    /api/activities/:id/attachments`
- `POST   /api/activities/:id/attachments` — multipart/form-data, 50MB max
- `GET    /api/attachments/:id/download`  — `Content-Disposition: attachment; filename="…"`
- `DELETE /api/attachments/:id`

### Schema additions
- `ManDayRole`: `id, name (unique), price, cost, isActive, sortOrder`
- `ServiceManDay`: added `manDayRoleId?` (FK), `costRate @default(0)`
- `QuotationItem`: added `costSnapshot, lineGp, lineGpPercent`
- `Activity`: polymorphic `companyId?` XOR `dealId?`, `authorId, type, content`
- `Attachment`: `activityId, fileName, mimeType, sizeBytes, storageKey, uploadedById`
- `AuditAction` enum: +7 new values (MAN_DAY_ROLE_*, ACTIVITY_*, ATTACHMENT_*)
- Table `ActivityLog` dropped (was unused — no code references)

### Modified behaviour
- `POST/PATCH /api/services` `manDayLines[]` now accepts `manDayRoleId`. When
  provided, server snapshots role name + price + cost into the ServiceManDay
  row. Legacy free-form `role`+`dayRate` still works.
- `POST /api/quotations` recalculates `costSnapshot`/`lineGp`/`lineGpPercent`
  from live ManDayRole costs for DRAFT quotations
- `POST /api/quotations/:id/status` body `{status:"SENT"}` triggers:
  1. Last refresh from live ManDayRole costs
  2. 422 if any SERVICE line has `costSnapshot==0` (admin never set cost)
  3. Sets `sentAt`, locks quotation from further edits
- `PATCH /api/quotations/:id` (header) and `/items/:itemId` reject 409 if
  status != DRAFT
- `ManDayRole` writes use `prisma.user.findUnique` + `role === 'ADMIN'`
  check inline (NOT `requirePermission` — seed doesn't write RolePermission
  rows; using a named permission would 403 everyone)

### Docker
- New named volume `crm_uploads` mounted at `/app/data/uploads` on `crm-api`
- nginx `client_max_body_size 50M` on `crm-web` (upload cap)
- api Dockerfile `mkdir -p /app/data/uploads` baked-in

---

## Phase 2 — Frontend tasks (13 items, in execution order)

**Cluster A — Man-day + RBAC (small, isolated)**
- **2A** `/man-day-roles` page — list + create/edit/delete dialogs. Admin only
  (check `useAuthStore().user.role === 'ADMIN'` and hide nav link for non-admin).
- **2B** Service edit/create dialog `manDayLines[]` — replace free-form role text
  with a `<select>` populated from `GET /man-day-roles`. When the user picks
  a role, show the price (read-only) and the user enters days.
- **2E** AppLayout — add "Man-day Roles" nav link, admin-only visibility.
- **2M** `roles.tsx` — unify Create + Edit role dialogs. Use the Edit dialog
  (which has the full permission matrix) for both. Title toggles.

**Cluster B — Quotation GP display + send-to-SENT (medium)**
- **2C** Quotation display — show `lineGp` (¥) + `lineGpPercent` (%) per
  line. Header card: total GP amount + total GP%. Color hint: < 20% red,
  20-40% amber, > 40% green.
- **2D** QuotationBuilder — add "Send to SENT" button. If backend returns
  422 with `lines[]` of zero-cost service items, surface those line names
  in a toast/error. After SENT, the form is read-only (disable inputs).

**Cluster C — Autocomplete (small)**
- **2L** `CompanyAutocomplete` shared component — used in QuotationBuilder
  and DealDialog company pickers. Fuzzy match on `name` + `legalName` +
  `taxId`. Dropdown items show name + region flag. Use shadcn `Command`
  if available, else `<Popover>` + input + filtered list. Replace
  `<select>` (and `bg-popover` transparency issues).

**Cluster D — Activity + Attachment (biggest, 6 tasks)**
- **2F** `ActivityFeed` shared — used in CompanyDetail + Deals panel +
  Dashboard. Sort by createdAt desc. Show author avatar/name, type icon
  (NOTE/CALL/EMAIL/MEETING), content body, timestamp. Group by owner
  scope (company or deal) when in detail view; cross-feed for Dashboard.
- **2G** `ActivityDialog` shared — text content + type dropdown + file
  dropzone. POST to `/activities` then POST files to
  `/activities/:id/attachments`. Multipart upload. Disable submit while
  uploading.
- **2H** `AttachmentList` shared — flat list of attachments scoped to a
  company (via `/companies/:id/attachments`). Each row: file name,
  uploader, size, date, download button (which navigates to
  `/api/attachments/:id/download` with the auth header — see
  `bg-popover` fixed pattern in MEMORY for the blob-download trick to
  avoid the cross-tab download warning).
- **2I** Quick-create modals in `CompanyDetail` — replace the existing
  navigate-to-Deals / navigate-to-Quotations buttons with inline
  `<DealDialog>` and `<QuotationBuilder>` modals. The builder is heavy;
  lazy-load it.
- **2J** DealCard — add "+ Activity" button that opens `ActivityDialog`
  with `dealId` pre-set. Add an Activity list section in the Deals
  panel below the kanban (filter by `ownerId` + date range).
- **2K** Dashboard — Row 3, full-width Card titled "Recent Activity",
  uses `ActivityFeed` with `cross` mode, limit 10, links each item to
  the source company/deal detail page.

---

## Design constraints (read these carefully)

1. **"睇唔到 = 冇做" 鐵律** (from MEMORY): every frontend change must
   surface a visible button/page/nav link. If your task is "add Man-day
   Roles management", there must be a nav link AND a route. Backend
   smoke tests don't count as user-visible delivery.
2. **CNY 鎖死**: ManDayRole has no currency column. Do NOT add a currency
   selector to the form. Just store the number.
3. **50 MB cap**: frontend file picker should reject files > 50MB before
   upload. Dropzone `maxSize: 50 * 1024 * 1024`.
4. **JWT cookie/session download** (per David): use `fetch()` to grab
   the file as a blob, then `URL.createObjectURL` + programmatic
   `<a download>` click. Don't use `<a target="_blank">` directly
   (cross-tab download warning).
5. **SENT lock UX**: after a quotation is sent, every input on
   `QuotationBuilder` should be disabled AND a banner should say
   "已 SENT,報價鎖定".
6. **Mobile RWD** (David 強調): all new components must look reasonable
   on a phone. Use `flex-col` on small screens, `space-y-*` not `space-x-*`,
   test with the browser's responsive mode.
7. **`bg-popover` transparency** (known issue): never use the bare
   `bg-popover` class. The dropdown containers should use
   `bg-white border border-border` (the safe pattern). Same goes for
   any popover/dropdown a new autocomplete uses.
8. **shadcn/ui conventions**: the project uses shadcn primitives. Add
   new components to `apps/web/src/components/ui/`, follow the existing
   naming (`<Card>`, `<Button>`, `<Dialog>`, `<Input>`, etc.).
9. **API client**: extend `apps/web/src/lib/api.ts` with new API groups
   (`manDayRolesApi`, `activitiesApi`, `attachmentsApi`). Don't invent
   fetch calls inside components.
10. **React Query invalidation**: every mutation must
    `queryClient.invalidateQueries({ queryKey: [...] })` on success. The
    list pages rely on this for the new UI to feel live.

---

## Known bugs to avoid

- **Elysia 1.2 derive context** does not reach route handler scope.
  Backend already handles this with `getUserIdFromRequest(request)`
  inline. Don't re-derive things on the frontend based on assumptions
  about handler context — just call the API.
- **Prisma `Decimal` vs JS `Number`**: backend `costSnapshot`, `lineGp`
  come back as strings. Use `Number(x.lineGp)` before formatting.
- **Empty array vs `{items:[]}`**: GET /quotations returns a bare array
  in some places and `{items, total}` in others. The api.ts wrapper
  normalises this; don't double-normalise.

---

## Verification

After all 13 tasks are committed:
1. `cd ~/www/crm-system && docker compose up -d --build` — should
   restart cleanly.
2. `docker exec crm-postgres psql -U crm -d crm_system -c '\dt'` —
   confirm `man_day_roles`, `activities`, `attachments` exist.
3. Login as admin @ localhost. Manually:
   - Click "Man-day Roles" nav link → see empty list
   - Create 2 roles
   - Go to Services → create a service with a man-day line picking a role
   - Go to Quotation Builder → add that service → see GP amount + GP%
   - Mark SENT → see the lock banner
   - Go to a Company → add an Activity → upload a file → see it in
     the Attachment tab → download works
   - Go to Deals → add an Activity on a card
   - Go to Dashboard → see Activity feed Row 3
4. Switch to a sales user → confirm "Man-day Roles" nav link is hidden.

---

## Subagent delegation tip

If spawning multiple subagents: do NOT let them edit the same files.
Two natural partitions:
- Subagent A: 2A, 2B, 2E, 2L, 2M (no overlap on shared components)
- Subagent B: 2C, 2D, 2I (all touch QuotationBuilder / CompanyDetail modals)
- Subagent C: 2F, 2G, 2H, 2J, 2K (ActivityFeed / ActivityDialog /
  AttachmentList shared by all three sites — let this one ship first
  so the shared components exist before the others import them)
