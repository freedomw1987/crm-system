# Day N Frontend Handoff (David's 6-feature batch)

**Audience**: frontend subagent(s) that will land 13 tasks behind a single
commit/PR. Read this end-to-end before writing any code. If a constraint
in this doc conflicts with what you see in the codebase, the doc wins —
the doc is the source of truth for David Day N.

**Working directory**: `~/www/crm-system`  (Mac, symlinked from
`~/Sites/localhost/crm-system`.)

**Stack** (already set up; do NOT change package versions):
- Bun 1.2 + React 18 + Vite 8 + react-router-dom v7 + TanStack Query 5
- shadcn/ui components in `apps/web/src/components/ui/`
- lucide-react icons
- Tailwind CSS 3 (NOT v4 — confirmed in `apps/web/tailwind.config.js`)
- Backend at `apps/api` (Bun + Elysia 1.2 + Prisma 5.22) — already
  shipped by commit `da28ec9`. All API changes you need are in that
  commit. You do NOT need to touch backend code.

**CRITICAL — David's "睇唔到 = 冇做" rule**: every task in this batch
must produce a visible UI affordance (new page, new nav link, new
button, new badge). Backend-only changes are not acceptable. If you
finish a task but a user can't see anything new in the browser, you
have NOT finished it.

**Login credentials** (for local smoke):
- `admin@crm.local` / `admin123` — full access, sees Man-day Role admin
  page and Role permission matrix
- `sales@crm.local` / `sales123` — can use Activities / Attachments,
  cannot access Man-day Role admin or role management

---

## 1. Backend changes that already exist (you consume these)

All 5 tasks below are already committed (`da28ec9`) and migrated. You
do NOT need to write any backend code. Just call the APIs.

### 1.1 Man-day Role catalogue

**New table**: `ManDayRole { id, name, price, cost, isActive, sortOrder,
createdAt, updatedAt }`. Currency is locked to CNY (per David, do not
expose a currency field anywhere).

**Endpoints** (already live in `apps/api/src/routes/man-day-role.ts`):
| Method | Path                            | Role required | Notes |
|--------|----------------------------------|---------------|-------|
| GET    | `/api/man-day-roles`             | any auth user | open list (used by service form dropdown) |
| GET    | `/api/man-day-roles/:id`         | any auth user | one role |
| POST   | `/api/man-day-roles`             | ADMIN only    | body: `{name, price, cost?, sortOrder?, isActive?}` |
| PATCH  | `/api/man-day-roles/:id`         | ADMIN only    | partial body |
| DELETE | `/api/man-day-roles/:id`         | ADMIN only    | 409 if referenced by any ServiceManDay |

**Frontend API client**: **add** these wrappers to `apps/web/src/lib/api.ts`
under a new `manDayRolesApi` object (no client exists yet — backend
shipped without frontend client). Shape:

```ts
export interface ManDayRole {
  id: string;
  name: string;
  price: number;        // sell per man-day
  cost: number;         // cost per man-day
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}
export const manDayRolesApi = {
  list:   () => request<ManDayRole[]>('/man-day-roles'),
  get:    (id: string) => request<ManDayRole>(`/man-day-roles/${id}`),
  create: (data: { name: string; price: number; cost?: number; sortOrder?: number; isActive?: boolean }) =>
    request<ManDayRole>('/man-day-roles', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<{ name: string; price: number; cost: number; sortOrder: number; isActive: boolean }>) =>
    request<ManDayRole>(`/man-day-roles/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  remove: (id: string) => request<{ success: boolean }>(`/man-day-roles/${id}`, { method: 'DELETE' }),
};
```

### 1.2 Activity + Attachment (polymorphic on Company or Deal)

**New tables**:
- `Activity { id, companyId?, dealId?, authorId, type, content, createdAt, updatedAt }`
  - **Exactly one** of `companyId` / `dealId` is set (validated server-side;
    a 400 returns if both or neither is set)
  - `type` is enum: `NOTE | CALL | EMAIL | MEETING`
  - `authorId` is required
- `Attachment { id, activityId, fileName, mimeType, sizeBytes, storageKey, uploadedById, createdAt }`
  - Files are stored on disk under `/app/data/uploads/` (Docker volume
    `crm_uploads`). Max 50 MB per file — enforced by nginx
    `client_max_body_size 50M` AND server-side multipart parser.

**Endpoints** (in `apps/api/src/routes/activity.ts`):
| Method | Path                                          | Auth | Notes |
|--------|-----------------------------------------------|------|-------|
| GET    | `/api/activities?companyId=&dealId=&type=&limit=&offset=` | yes | one of companyId/dealId required |
| GET    | `/api/activities/recent?limit=`               | yes  | latest N across all (Dashboard widget) |
| POST   | `/api/activities`                              | yes  | body: `{companyId OR dealId, type, content}` |
| DELETE | `/api/activities/:id`                          | yes  | cascades to attachments + deletes files |
| GET    | `/api/companies/:id/attachments`               | yes  | flat list (Attachment tab) |
| GET    | `/api/activities/:id/attachments`              | yes  | per-activity list |
| POST   | `/api/activities/:id/attachments`              | yes  | multipart upload (Content-Type: multipart/form-data) |
| GET    | `/api/attachments/:id/download`                | yes  | streams file with `Content-Disposition: attachment` |
| DELETE | `/api/attachments/:id`                         | yes  | deletes file from disk |

**Frontend API client**: **add** `activitiesApi` and `attachmentsApi`
to `lib/api.ts`. Type shapes:

```ts
export type ActivityType = 'NOTE' | 'CALL' | 'EMAIL' | 'MEETING';
export interface Activity {
  id: string;
  companyId: string | null;
  dealId: string | null;
  authorId: string;
  type: ActivityType;
  content: string;
  createdAt: string;
  updatedAt: string;
  author?: { id: string; name: string; email: string };
  company?: { id: string; name: string } | null;
  deal?: { id: string; title: string } | null;
  attachments?: Array<{ id: string; fileName: string; mimeType: string; sizeBytes: number; createdAt: string }>;
}
export interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedBy?: { id: string; name: string };
  // For per-company list endpoint only:
  activity?: { id: string; type: ActivityType; content: string; createdAt: string };
}
export const activitiesApi = {
  list:   (params: { companyId?: string; dealId?: string; type?: string; limit?: number; offset?: number } = {}) => { ... },
  recent: (limit = 10) => request<{ items: Activity[]; total: number }>(`/activities/recent?limit=${limit}`),
  create: (data: { companyId?: string; dealId?: string; type?: ActivityType; content: string }) =>
    request<Activity>('/activities', { method: 'POST', body: JSON.stringify(data) }),
  remove: (id: string) => request<{ success: boolean }>(`/activities/${id}`, { method: 'DELETE' }),
};
export const attachmentsApi = {
  forCompany: (companyId: string) =>
    request<{ items: Attachment[]; total: number }>(`/companies/${companyId}/attachments`),
  forActivity: (activityId: string) =>
    request<{ items: Attachment[]; total: number }>(`/activities/${activityId}/attachments`),
  upload: async (activityId: string, file: File): Promise<Attachment> => {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch('/api/activities/' + activityId + '/attachments', {
      method: 'POST',
      body: fd,
      headers: authHeader(),
    });
    if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
    const body = await r.json();
    return body.items[0];
  },
  downloadUrl: (id: string) => '/api/attachments/' + id + '/download',
  remove: (id: string) => request<{ success: boolean }>(`/attachments/${id}`, { method: 'DELETE' }),
};
```

> Note: `authHeader()` returns `{ Authorization: 'Bearer <token>' }`.
> Match the existing pattern in `request<T>()` in `lib/api.ts`. The
> `fetch` call here MUST use raw `fetch` because `request<T>` is
> hard-coded to `Content-Type: application/json`.

### 1.3 QuotationItem GP fields + SENT lock

**Schema changes** to `QuotationItem`:
- `costSnapshot Decimal @default(0)` — snapshot of total cost for the
  line (service: sum of manDay.costRate × days at line creation)
- `lineGp Decimal @default(0)` — sell total minus cost
- `lineGpPercent Decimal @default(100)` — gp% (PRODUCT = 100,
  SERVICE = (price-cost)/price)

**Behaviour**:
- `POST /api/quotations` and `PATCH /api/quotations/:id/items/...`:
  server recalculates GP from the **live** `ServiceManDay.costRate` if
  the quotation is DRAFT
- `POST /api/quotations/:id/status { status: 'SENT' }`: server refuses
  with 422 if any SERVICE line has `costSnapshot == 0` AND `lineTotal
  > 0` (i.e. the admin never set a man-day role cost)
- After SENT: PATCH /quotations/:id and items/... reject with 409
  ("Quotation is SENT and cannot be modified. Create a revision instead.")
- `GET /api/quotations/:id` returns items with `costSnapshot`,
  `lineGp`, `lineGpPercent` populated

**Type updates** in `lib/api.ts`:
```ts
export interface QuotationItem {
  // ... existing fields ...
  costSnapshot: number;
  lineGp: number;
  lineGpPercent: number;
}
```

**Display requirements** (for 2C):
- Per-line: show GP amount (`formatCurrency(item.lineGp, currency)`)
  and GP% (e.g. "40%")
- Total: a card on the QuotationBuilder with `Total GP` (sum of
  `lineGp`) and `Total GP%` (weighted: `totalGp / subtotal × 100`)
- Colour: green for healthy GP (>30%), amber (15-30%), red (<15%)

### 1.4 Service line item: Man-day Role dropdown

`POST /api/services` and `PATCH /api/services/:id` now accept
`manDayLines: [{ manDayRoleId?, role?, dayRate?, costRate?, days,
sortOrder? }]`. If `manDayRoleId` is provided, the server **snapshots**
the role's current `name`, `price`, and `cost` into the
`ServiceManDay` row (so a future role rename / price change does not
break the historical service line). The `role` text field is kept
denormalized for display.

**Frontend** (for 2B): the `services.tsx` create/edit dialog should:
- Replace the free-form `role` text input with a `<Select>` populated
  from `manDayRolesApi.list()` (active ones only)
- When the role changes, autofill `dayRate` from `role.price` and
  `costRate` from `role.cost` into local form state
- Still allow custom `days` (man-day count)
- Display: each line shows `role.name × N days @ ¥price (cost ¥cost)
  = subtotal` with a small "↻ live" badge to remind the user that
  changing the role will re-snapshot
- The summary card at the bottom shows the **service unitPrice** (the
  total) versus the **sum of manDayLines subtotals** — if mismatched,
  show a warning ("line subtotals sum to ¥X but unitPrice is ¥Y")

### 1.5 AuditAction enum grew

The enum has 7 new values: `MAN_DAY_ROLE_*` (3), `ACTIVITY_*` (2),
`ATTACHMENT_*` (2). The frontend `ACTION_LABELS` map in
`apps/web/src/pages/audit.tsx` was already updated in commit `8beaaf2`
to handle them. **No frontend change needed here.**

---

## 2. The 13 frontend tasks (in dependency order)

### 2A. Man-day Roles admin page

- **New page**: `apps/web/src/pages/man-day-roles.tsx`
- **Route**: `/man-day-roles` (register in `App.tsx` router)
- **Nav link**: in `app-layout.tsx`, under "Settings" group or after
  Products. **Visible only to ADMIN** (read `useAuth()` / user role
  from context — see `AppContext` in `app-layout.tsx`)
- **UI**: table with name, price, cost, margin% (`(price-cost)/price`),
  sortOrder, isActive badge. Top-right "+ 新增角色" button opens a
  dialog. Each row has ✏️ edit and 🗑️ delete (with confirm).
- **Dialog form fields**: name (text, required), price (number,
  required), cost (number, default 0), sortOrder (number, default 0),
  isActive (checkbox, default true)
- **Optimistic update**: refetch `man-day-roles` query on success
- **Empty state**: "未有 man-day 角色,click + 新增角色開始" with a hint
  suggesting common roles (Senior Engineer, Junior Engineer, PM, etc.)
- **Currency display**: always show `¥` prefix (CNY is hard-coded)
- **Permission check on save**: backend already enforces ADMIN; UI
  should hide the page entirely for non-admins (don't just disable
  the button — that exposes the catalogue even to viewers)

### 2B. Service edit dropdown — ManDayRole instead of free-form

- **Modify**: `apps/web/src/pages/services.tsx` (create + edit dialog)
- **Reference**: `apps/web/src/components/quick-create-service-dialog.tsx`
  (already does the free-form pattern) and `apps/web/src/components/product-dialog.tsx`
  (similar pattern)
- **Change**: replace the "role" text input in the man-day lines
  section with a `<Select>` populated from `manDayRolesApi.list()`
  filtered by `isActive === true`. Add a small "新增角色" inline link
  for admins (opens a tiny dialog or navigates to `/man-day-roles`)
- **Snapshot helper in UI**: when role changes, autofill `dayRate` and
  `costRate` into the line's local form state. Display them read-only
  with a tooltip explaining they will be snapshotted.
- **Back-compat**: if a service line has `manDayRoleId === null` (legacy
  data), allow keeping the free-form `role` / `dayRate` input
- **Verify the new flow end-to-end**: create a service with 2 man-day
  lines, both linked to a ManDayRole. Save. Reload the service — the
  lines still show the role name and price (snapshotted). Change the
  role's price in /man-day-roles — reload the service, prices are
  unchanged (this is the SENT-lock pattern applied to services too).

### 2C. Quotation display — GP amount + % per line + total GP card

- **Modify**: `apps/web/src/components/quotation-builder.tsx` and
  `apps/web/src/pages/quotation-detail.tsx`
- **Per-line table column**: add `GP` and `GP%` columns after
  `Subtotal`. Format: `formatCurrency(item.lineGp, currency)` and
  `item.lineGpPercent.toFixed(1) + '%'`. Colour: green if
  `lineGpPercent >= 30`, amber if 15-30, red if < 15.
- **Total GP card** (Builder only — Detail can use a similar banner):
  a `Card` next to the existing `Total` summary showing
  - "Total GP" big number
  - "GP%" weighted
  - Break down: "Products: ¥X (100%)" + "Services: ¥Y (Z%)"
  - Show warning if GP% < 15: "Low margin — review man-day costs"
- **Conditional rendering**: while DRAFT and a service line has
  `costSnapshot === 0 && lineTotal > 0`, show a small yellow warning
  chip on that line: "Set man-day cost to enable Send"

### 2D. QuotationBuilder — send-to-SENT button + lock

- **Modify**: `apps/web/src/components/quotation-builder.tsx`
- **New button**: in the header row, when `status === 'DRAFT'`, show
  primary "📤 Send" button. Click → confirm dialog "Mark as SENT?
  Prices and line items will be locked."
- **Submit**: call `quotationsApi.setStatus(id, 'SENT')`. On success,
  refetch and the UI flips to read-only mode.
- **Read-only mode** (after SENT, or any non-DRAFT status):
  - All item fields disabled (qty, price, discount, name)
  - "+ Add line" button hidden
  - Header "Send" button replaced with status pill (DRAFT/SENT/etc.)
  - Total GP card shows a "🔒 Locked" badge
- **Edit-mode toggle**: do NOT add a "Reopen for edit" — that would
  defeat the lock. Once SENT, the user must create a new quotation
  (a future feature; for now just hide any edit affordance)
- **Error handling**: if backend returns 422 (zero-cost service
  lines), show a toast: "Cannot send: service lines have no man-day
  cost configured. Open the service and set a cost first."

### 2E. AppLayout nav — Man-day Roles link (admin only)

- **Modify**: `apps/web/src/components/app-layout.tsx` (and any
  layout helper in `apps/web/src/components/layout/`)
- **New nav entry**: under a "Settings" or "Catalogues" group (or
  right after Products if there is no group). Label: "Man-day Roles"
  (English) or "人天結構" (if you want to match David's mixed
  Chinese/English style).
- **Visibility**: only render the link if the logged-in user's role
  is `ADMIN`. The role is available on the auth context — find the
  current shape (look for `useAuth` or the AppLayout's context).
- **Icon**: use `Users2` or `Briefcase` from lucide-react (NOT
  `Users` which is already used for the Users page)

### 2F. ActivityFeed shared component

- **New file**: `apps/web/src/components/activity-feed.tsx`
- **Props**:
  ```ts
  interface ActivityFeedProps {
    companyId?: string;   // exactly one of these
    dealId?: string;
    mode?: 'company' | 'deal' | 'cross'; // 'cross' = dashboard view
    showFilters?: boolean; // default true
    showCreateButton?: boolean; // default true
    limit?: number; // default 50
  }
  ```
- **Renders**: a vertical list of activity cards, newest first
  (already sorted by the API). Each card shows:
  - Author avatar (initials in a circle — we don't have avatars
    uploaded) + name + timestamp (relative: "2 小時前")
  - Type icon (NOTE → 📝, CALL → 📞, EMAIL → ✉️, MEETING → 🤝)
  - Content (preserve line breaks)
  - Attachment count badge: "📎 2 個附件" if any (clickable to expand)
  - On hover, show 3-dot menu with "刪除" (with confirm) — only for
    the author or admins
- **Empty state**: "未有跟進記錄" with a hint to log the first one
- **Loading state**: skeleton rows (3 grey bars)
- **Filter row** (when `showFilters`):
  - Activity type: All / Note / Call / Email / Meeting
  - Date range: 全部 / 今日 / 本週 / 本月 (or use a single date
    picker if simpler)
  - Author dropdown (only when `mode === 'deal'` — see 2J)
- **Create button** (when `showCreateButton`): opens `<ActivityDialog>`
  (2G) with the right `companyId`/`dealId` pre-filled
- **Cross mode** (Dashboard): no filter row, just the latest 10
  activities, each card showing the source (Company name or Deal
  title) as a small link

### 2G. ActivityDialog shared component

- **New file**: `apps/web/src/components/activity-dialog.tsx`
- **Props**:
  ```ts
  interface ActivityDialogProps {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    companyId?: string;
    dealId?: string;
    onCreated?: (activity: Activity) => void;
  }
  ```
- **Renders**: a Dialog with:
  - Type selector (4-option radio or `<Select>`): NOTE / CALL / EMAIL
    / MEETING (default NOTE)
  - Textarea: `placeholder="輸入跟進內容..."`, required, min 1 char
  - File dropzone: `<input type="file" multiple>` styled as a
    dashed-border box. Show selected files list (name, size) with
    remove ✕ on each. On submit, create the activity first, then
    upload each file sequentially using `attachmentsApi.upload()`.
  - Submit button: "儲存" (disabled if no content or no files
    — at least one of content or files is required)
  - Show upload progress per file (small spinner on the row)
  - Close dialog only after all uploads complete
- **Validation**: server requires `content` non-empty. If user only
  uploads files and leaves content empty, show a warning: "至少輸入
  文字或上傳一個附件"
- **Error handling**: if activity create fails, do NOT upload files.
  If file upload fails mid-way, show the error and offer retry on
  the failed files only.
- **Reset on close**: clear all state when dialog opens/closes

### 2H. AttachmentList shared component

- **New file**: `apps/web/src/components/attachment-list.tsx`
- **Props**:
  ```ts
  interface AttachmentListProps {
    companyId: string; // fetch via /api/companies/:id/attachments
    showUploader?: boolean; // default true
  }
  ```
- **Renders**: a table or grid of attachments
  - Columns: file name (with mime-type icon — 📄 PDF, 🖼️ image, 📎
    other), size (human-readable: "1.2 MB"), uploaded by, uploaded at
    (relative: "昨日"), activity context (link to the activity that
    contains it, or its snippet)
  - Each row has download button (calls `attachmentsApi.downloadUrl(id)`
    and opens in new tab) and delete ✕ (with confirm — for uploader
    or admin only)
  - Total count at top: "{n} 個附件"
  - Empty state: "未有附件"
- **Filter row** (optional but nice): filter by mime type
  (PDF / image / all)

### 2I. Quick-create modals

- **Modify**: `apps/web/src/pages/company-detail.tsx`
- **Current state**: the page has a "+ 新增 Deal" and "+ 新增
  Quotation" button in each section header that navigates to `/deals`
  or `/quotations` with URL params (`?dealId=`, `?companyId=`). David
  wants these to be **inline modals** instead.
- **Change**:
  - Import the existing `<DealDialog>` (from `deals.tsx`) and
    `<QuotationBuilder>` (from `quotation-builder.tsx`) components
  - Replace the navigation `onClick` handlers with state setters
    that open the dialog inline
  - Initial values: prefill `companyId` to the current company
  - For DealDialog: also prefill `pipelineId` and `stageId` to the
    pipeline's first stage (so the new deal lands in "Lead" by
    default)
  - For QuotationBuilder: also prefill `dealId` if a deal context
    is present (so a "Create Quotation for this Deal" still works)
- **Modify**: `apps/web/src/pages/deals.tsx` — find the existing
  DealCard component and add a "+ 新增 Quotation" button
- **DealCard button**: small button next to or below the card title
  "📄 新增 Quotation" → opens the `<QuotationBuilder>` in inline
  mode (do NOT navigate)
- **DealCard "+ Activity"** (preview for 2J — do this in the same
  commit): add a "📝 新增 Activity" button below the deal card.
  Opens `<ActivityDialog>` with `dealId` pre-filled.

### 2J. DealCard + Activity button + Deals panel Activity list with filters

- **Modify**: `apps/web/src/pages/deals.tsx`
- **DealCard**: add a footer row with two buttons:
  - "📝 新增 Activity" (opens ActivityDialog with this deal's id)
  - "📄 新增 Quotation" (opens QuotationBuilder — already in 2I)
- **Add a side panel or below-the-board section**: "Recent
  Activities". This panel:
  - Queries `activitiesApi.list({ dealId: ??? })` — but Activities
    are scoped to a deal individually, so the "across all deals"
    case isn't a single query. **Instead**: query
    `activitiesApi.recent(50)` once for the whole page, then
    client-side filter to only activities whose `dealId` is in the
    currently visible deals.
  - **Filter row**:
    - Author / Sales rep dropdown (multi-select): filter to
      activities by selected authors. Source: fetch all sales reps
      via `usersApi.list({ role: 'SALES' })` once and cache.
    - Date range: 全部 / 今日 / 本週 / 本月
  - **Default sort**: by `createdAt` desc (already server default)
  - **Group by deal** OR **flat list** (David chose flat in the plan).
    Render flat list with a small "Deal: XYZ" link per activity.
- **Empty state**: "未有跟進記錄 — 由 Deal Card 嘅 + 開始記錄"

### 2K. Dashboard Activity feed (Row 3, latest 10)

- **Modify**: `apps/web/src/pages/dashboard.tsx`
- **New section**: a full-width `<Card>` after the Recent Quotations +
  Recent Deals row, titled "最新跟進 Activity"
- **Body**: use the `<ActivityFeed>` component (2F) with
  `mode='cross'`, `showFilters={false}`, `limit=10`
- **Click activity → navigate to source**: if `companyId` is set,
  navigate to `/companies/:id`; if `dealId` is set, navigate to
  `/deals/:id`. Use react-router's `useNavigate`.

### 2L. CompanyAutocomplete shared — replace Company select in Quotation + Deal modals

- **Modify**: `apps/web/src/components/quotation-builder.tsx` and
  `apps/web/src/pages/deals.tsx`
- **Current state**: both modals have a `<Select>` of all companies
  (loaded via `companiesApi.list({ limit: 100 })`). David wants an
  autocomplete / typeahead instead.
- **New shared component**: `apps/web/src/components/autocomplete.tsx`
  - Generic: `Autocomplete<T>({ items, getKey, getLabel, value,
    onChange, placeholder, emptyText, onCreate?, className? })`
  - The dropdown should have **white background** (use
    `bg-white border border-border` — we already had a `bg-popover`
    transparency bug, don't regress)
  - On focus, show all items. On type, filter by
    `getLabel(item).toLowerCase().includes(query.toLowerCase())`.
  - Keyboard: ↑/↓ to navigate, Enter to select, Esc to close
  - When `onCreate` is provided, append a "Create new: '<query>'"
    item at the bottom of the dropdown (used for Product/Service
    quick-create)
- **Refactor**: extract `ProductAutocomplete` and
  `ServiceAutocomplete` from `quotation-builder.tsx` to use this
  shared `<Autocomplete>` — they currently have a near-identical
  implementation. Don't break the existing `onCreate` quick-create
  behaviour.
- **Replace** in `quotation-builder.tsx`: the Company select with
  `<Autocomplete>` populated from `companiesApi.list({ limit: 200 })`
  (companies count is small enough to load all up front; if it grows
  > 500, switch to a debounced server search).
- **Replace** in `deals.tsx`: same thing in the DealDialog.
- **Keep**: the `+ 新增公司` inline create button still works
  (it opens the `CreateCompanyDialog` from `companies.tsx` — but you
  should refactor that to use the same `CompanyFormDialog` from
  `companies.tsx` (the one introduced in commit `e6d2230`)).

### 2M. RoleDialog unification — Create + Edit use the same dialog

- **Modify**: `apps/web/src/pages/roles.tsx`
- **Current state**: two separate dialogs:
  - `CreateRoleDialog` — minimal: name + displayName + description
  - `EditRoleDialog` — full: includes permission matrix
- **David's complaint**: "新增角色時的Modal 可以用 編輯角色的Modal,
  因為權限設置上比較完善" — when creating, the permission matrix
  should be available too.
- **Change**: rename / merge into a single `RoleDialog({mode,
  role?, open, onOpenChange, onSaved})` that ALWAYS shows:
  - name (text; readonly for system roles — backend rejects updates
    to system role names anyway)
  - displayName (text)
  - description (textarea)
  - Permission matrix (grouped by resource, e.g. "Company", "Deal",
    "Quotation", etc.) — use the data from `rolesApi.permissions()`
    (already returns the full list)
- **For the create flow**: "Save" button is enabled only when name +
  at least one permission are set. Show a small validation note: "請
  至少選一個權限".
- **For system roles**: hide the permission matrix (it's read-only
  via the backend; we could allow viewing but not editing, OR we
  could hide the matrix entirely when `role.isSystem === true`).
  Either is fine; pick one and document it.
- **For delete**: keep the existing "cannot delete system role"
  guard.

---

## 3. Design system rules (read carefully)

These are not suggestions. They are how David's UI is built.

1. **shadcn/ui components only**. Use the components in
   `apps/web/src/components/ui/` (Card, Button, Input, Badge, Dialog,
   Label, Select, etc.). DO NOT add a new component library.
2. **Tailwind utilities**, no inline styles. `cn()` from
   `apps/web/src/lib/utils.ts` is available if you need conditional
   classes.
3. **lucide-react** for icons. DO NOT import a new icon library.
4. **Color tokens**: use `text-foreground`, `bg-background`,
   `text-muted-foreground`, `border-input`, `text-destructive`,
   `bg-primary`, etc. — NOT raw colors like `text-gray-500`.
5. **Typography**: H1 = `text-2xl md:text-3xl font-bold` for page
   titles; H2 = `text-lg font-semibold` for section headers; body =
   `text-sm` for table rows; `text-xs` for metadata.
6. **Spacing**: page-level = `space-y-6`; section-level =
   `space-y-4`; form fields = `space-y-3`; table rows = `space-y-2`.
7. **Mobile responsive**: David uses the app on phone. Use
   `md:grid-cols-2 lg:grid-cols-3` for grids, `flex-col md:flex-row`
   for button rows. The RWD test is "does this look right at 375px
   width?".
8. **RWD: Use the existing `mobile-chat-layout-css` patterns** (see
   skills in `~/.hermes/profiles/developer/skills/frontend/`).
9. **Buttons**: primary action = `<Button>` (filled); secondary =
   `<Button variant="ghost">` or `<Button variant="outline">`;
   destructive = `<Button variant="destructive">`. Icon-only
   buttons: use `aria-label` and `h-7 w-7` or `h-8 w-8` square.
10. **Dialogs**: use the existing `Dialog` / `DialogContent` /
    `DialogHeader` / `DialogTitle` / `DialogFooter` from
    `ui/dialog.tsx`. Don't reinvent.
11. **Form labels**: use `<Label htmlFor="...">` (imported from
    `ui/select.tsx` — yes, the `Label` re-exports from there).
12. **Empty states**: short message, optional CTA. Don't use
    illustrations.
13. **Loading states**: skeleton rows or "載入中..." text. Don't use
    spinners for whole-page loads.
14. **Dates**: `formatDate(iso)` from `lib/utils.ts` for absolute,
    or "X 小時前" (relative) — use the `date-fns` library which
    is already a dep. Look at how other pages format relative
    dates to match the style.
15. **Currency**: `formatCurrency(amount, currency)` from
    `lib/utils.ts`. Always pass currency (don't hardcode HKD in new
    code).

## 4. Routes & navigation

- **App.tsx** is the router. Add new routes:
  ```tsx
  <Route path="/man-day-roles" element={<ManDayRolesPage />} />
  ```
  Match the existing route style (lazy or eager — match what's
  there).
- **app-layout.tsx** is the chrome. Nav links go in there. Read the
  existing structure first to know where to insert.
- **Order in nav** (per David's recent reordering request in
  earlier commits): Dashboard → Companies → Deals → Quotation →
  Product → Service → Man-day Roles (new) → Audit → Users → Settings

## 5. State management & data fetching

- **TanStack Query** for everything. Pattern: `useQuery` for reads,
  `useMutation` for writes, with `queryClient.invalidateQueries`
  on success.
- **No Redux, no Zustand, no Context beyond what already exists.**
  The `AppContext` in `app-layout.tsx` is for the current user
  only — don't put feature data there.
- **Optimistic updates**: for simple CRUD (toggle, delete) use
  `onMutate` + `onError` rollback. For complex forms (create +
  attach), just refetch on success.

## 6. Verification (mandatory before commit)

After all 13 tasks land:

1. **Build the web image**:
   ```bash
   cd ~/www/crm-system
   timeout 90 docker compose build web
   ```
   Must complete with `crm-system-web Built`. If you see TS
   errors, fix them. (The `@ts-nocheck` rule is only for the
   `apps/api` code — the web app is typechecked.)

2. **Force-recreate the web container**:
   ```bash
   docker compose up -d --force-recreate --no-deps web
   ```

3. **Health check**:
   ```bash
   curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://localhost/
   ```
   Must return `HTTP 200`.

4. **Visual smoke** — log in as admin (`admin@crm.local` /
   `admin123`) and verify EACH of these pages loads and shows
   the new UI:
   - `/` (Dashboard) → Activity feed row at the bottom
   - `/companies` → edit ✏️ button on each card (already done in
     `e6d2230`, just verify it still works)
   - `/companies/:id` → Activity section + Attachment tab
   - `/deals` → "+ Activity" + "+ Quotation" on each card +
     Activity side panel
   - `/quotations/new` → GP column per line + Total GP card + Send
     button
   - `/man-day-roles` → admin-only table with + / ✏️ / 🗑️
   - `/services` → man-day lines use a dropdown, not free-form
   - `/roles` → + 新增 opens the full dialog with permission matrix

5. **Backend smoke** — write a Python script (no shell!) that
   hits each new endpoint with the admin token. Reference:
   `/tmp/smoke_test2.py` (which I wrote during Phase 1F) shows
   the pattern. The new tests to add:
   - Create a Man-day role, GET it, PATCH price, DELETE
   - Create an Activity, upload an attachment, download it, verify
     content matches
   - Create a Quotation with 1 product + 1 service line, send to
     SENT, verify the 422 if a service line has zero cost, verify
     items are locked after SENT

6. **Commit + push**:
   ```bash
   git add -A
   git commit -m "feat(frontend): Man-day Roles admin + Activity/Attachment UI + Quotation GP

   $(cat <<-EOF
   David Day N frontend:

   2A. /man-day-roles admin page (table + create/edit/delete dialogs)
   2B. Service edit: man-day lines now pick from ManDayRole dropdown,
       autofills price/cost snapshot
   2C. QuotationBuilder: GP column per line, Total GP card with
       weighted %; service lines without man-day cost show a warning
   2D. QuotationBuilder: Send button (DRAFT→SENT) with confirm +
       read-only mode after SENT (items disabled, +Add hidden)
   2E. AppLayout: Man-day Roles nav link, admin-only
   2F. <ActivityFeed> shared component (used in CompanyDetail,
       Deals panel, Dashboard)
   2G. <ActivityDialog> shared component (type + content + file
       dropzone, sequential upload)
   2H. <AttachmentList> shared component (table, per-company,
       with download/delete)
   2I. CompanyDetail: inline Deal/Quotation modals instead of
       navigate
   2J. Deals page: +Activity and +Quotation buttons on each card;
       Recent Activity panel with author + date filters
   2K. Dashboard: Row 3 Activity feed (latest 10, cross-company/deal)
   2L. <Autocomplete> shared component + CompanyAutocomplete in
       Quotation + Deal modals; ProductAutocomplete / ServiceAutocomplete
       refactored to use the shared component
   2M. RoleDialog unification: Create + Edit use the same dialog
       with full permission matrix

   Backend shipped earlier in da28ec9 (ManDayRole, Activity,
   Attachment tables; quotation GP calc + SENT lock).

   Build + bundle smoke verified.
   EOF
   )"
   git push origin main
   ```

7. **End-of-commit message to user**: list the URL of each new
   page David should visit, e.g. "→ /man-day-roles (admin), →
   /services (create with role dropdown), → /quotations/new (GP
   column + Send), → / (Dashboard activity row), → /companies/:id
   (Activity + Attachments tabs)".

## 7. Pitfalls (things I learned the hard way)

- **`bg-popover` is broken** in `tailwind.config.js` (the token
  doesn't exist; it falls back to transparent). If you see
  "transparent background" bugs on dropdowns / autocomplete
  panels, hardcode `bg-white border border-border` instead of
  `bg-popover`. This was a fix in commit `8beaaf2` — don't
  regress.
- **Type drift between Prisma and frontend**: relation fields
  sometimes have different names on the wire (camelCase vs
  snake_case). Use the `normaliseService()` helper pattern in
  `lib/api.ts` (around line 543) if you see a service field
  being `undefined` when it shouldn't be.
- **shadcn `<Select>` vs native `<select>`**: the existing
  CompanyFormDialog uses native `<select>` (because the
  shadcn Select was overkill for the region pills). Match the
  existing style — don't introduce shadcn Select for things
  that don't need its search/render machinery.
- **Tailwind v3, NOT v4**. Don't run `npx tailwindcss upgrade`.
- **`bunx vite build` is fine for type errors but `docker
  compose build web` is the actual gate** — only the latter
  fails the build on type errors.
- **The backend has 8 migrations**. If you ever need to add a
  new model, ask the user — don't just add it unilaterally.
  This doc covers everything you need from the existing schema.
- **Elysia 1.2 d.ts issues** are a backend concern, not yours.
  Ignore any TS warnings from the `apps/api` folder.
- **The auth token is in localStorage** under key `crm_token`
  (or similar — check `lib/api.ts` for the actual key). The
  `request<T>()` helper reads it automatically. You don't need
  to manage auth state yourself.

## 8. If you get stuck

- Look at how `companies.tsx` (recently refactored in `e6d2230`)
  handles create + edit in a single `CompanyFormDialog` —
  copy that pattern for `RoleDialog` (2M).
- Look at how `quotation-builder.tsx` already does
  `ProductAutocomplete` (line 614) — that's the pattern to
  generalize into a shared `<Autocomplete>` (2L).
- Look at the existing `ProductDialog` and
  `quick-create-service-dialog` for the form-with-fetch pattern.
- The `crm-system` project has many skills in
  `~/.hermes/profiles/developer/skills/` — relevant ones:
  - `frontend/ios-safari-scroll-fixed-elements`
  - `frontend/mobile-chat-layout-css`
  - `frontend/rwd-mobile-audit`
  - `polymorphic-line-items` (for quotation GP understanding)
  - `bun-elysia-react-vite-stack` (general stack)

End of handoff. Build, verify, commit, push. Reply with a
URL checklist for David.
