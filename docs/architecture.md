# Architecture

A high-level map of how the pieces fit together. For deeper details, see:

- [`database.md`](./database.md) — every model, field, index, enum, and ERD
- [`api.md`](./api.md) — full HTTP endpoint reference
- [`ai-agent.md`](./ai-agent.md) — AI tool catalogue and conversation model
- [`frontend.md`](./frontend.md) — pages, components, and the API client
- [`rbac.md`](./rbac.md) — permission catalogue and enforcement
- [`operations.md`](./operations.md) — env vars, Docker, migrations, deploy

---

## 1. Topology

```
┌────────────────────────────────────────────────────────────┐
│  Browser  →  http://localhost                              │
└──────────────┬─────────────────────────────────────────────┘
               │
        ┌──────▼──────┐
        │  crm-web    │  nginx 1.27-alpine
        │  (port 80)  │  • serves the SPA (Vite build output)
        │             │  • /api/* → reverse proxy to api:3001
        └──────┬──────┘
               │  Docker network
        ┌──────▼──────┐
        │  crm-api    │  oven/bun:1.2
        │  :3001      │  • Elysia REST routes
        │  (internal) │  • authContext + requirePermission middleware
        │             │  • @crm/ai agent loop
        │             │  • audit-log middleware
        │             │  • entrypoint runs prisma migrate deploy
        └──────┬──────┘
               │
        ┌──────▼──────────┐
        │  crm-postgres   │  postgres:16-alpine
        │  (no host port) │  • named volume crm_pgdata
        └─────────────────┘
```

The api container is **not** exposed to the host. All web traffic flows
through nginx. Adminer (opt-in profile) is the only sidecar service.

---

## 2. Module layout (monorepo)

```
crm-system/
├── apps/
│   ├── api/                       # Bun + Elysia + Prisma
│   │   ├── src/
│   │   │   ├── index.ts           # Elysia entry — registers all route groups
│   │   │   ├── lib/context.ts     # authContext (parses JWT, attaches userId)
│   │   │   ├── middleware/
│   │   │   │   ├── rbac.ts        # requirePermission('product:write') factory
│   │   │   │   └── audit.ts       # logEvent() — writes AuditLog rows
│   │   │   └── routes/            # 16 route groups, one file per resource (auth, users, roles, region, company, contact, product, service, man-day-role, deal, quotation, activity, attachment, audit, ai-config, chat, settings)
│   │   ├── Dockerfile             # multi-stage, oven/bun:1.2 base
│   │   └── docker-entrypoint.sh   # prisma migrate deploy + (optional) seed
│   │
│   └── web/                       # Vite + React 19 + Tailwind
│       ├── src/
│       │   ├── index.css          # tailwind directives + thin utilities
│       │   ├── main.tsx           # React root + router
│       │   ├── pages/             # one file per route (see frontend.md)
│       │   ├── components/
│       │   │   ├── layout/        # app-layout.tsx (nav + auth gate)
│       │   │   ├── ui/            # design-system primitives (button, dialog, …)
│       │   │   ├── quotation-builder.tsx     # polymorphic line-item editor
│       │   │   ├── product-dialog.tsx        # shared product create/edit
│       │   │   ├── quick-create-service-dialog.tsx  # service create (shared)
│       │   │   └── require-auth.tsx          # route guard
│       │       ├── lib/
│       │       │   ├── api.ts          # typed client + token storage (getToken/setToken)
│       │       │   └── utils.ts
│       ├── Dockerfile             # multi-stage Vite build → nginx-alpine
│       └── nginx.conf             # SPA + /api/* reverse proxy
│
├── packages/
│   ├── db/                        # @crm/db — Prisma client + schema + migrations
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/        # timestamp-prefixed SQL
│   │   │   └── seed.ts
│   │   └── src/index.ts           # exports prisma client singleton
│   │
│   ├── ai/                        # @crm/ai — OpenAI function-calling agent
│   │   ├── src/
│   │   │   ├── index.ts           # runAgent() — main loop
│   │   │   ├── tools.ts           # 8 CRM tools
│   │   │   └── prompts.ts         # system prompt
│   │   └── package.json
│   │
│   └── shared/                    # @crm/shared — cross-package types + RBAC
│       ├── src/permissions.ts    # UserRole enum + PERMISSIONS map + can()
│       └── package.json
│
├── scripts/                       # shell helpers
│   ├── docker-dev.sh              # the main dev entry point
│   ├── docker-reset.sh
│   ├── backup.sh / restore.sh
│   └── backup-container.sh
│
├── docker-compose.yml             # local dev stack
├── docker-compose.prod.yml        # production-like override
└── .env / .env.example
```

### Why three workspace packages?

| Package      | What lives there                             | Why separate                        |
| ------------ | -------------------------------------------- | ----------------------------------- |
| `@crm/db`    | Prisma client, schema, migrations, seed     | api and ai both import the client   |
| `@crm/ai`    | Agent + tools                                | could move out (separate service)   |
| `@crm/shared`| Type-only — RBAC catalogue, shared types     | imported by both api (server) and web (client) via type-only import |

---

## 3. Request lifecycle (typical read)

```
Browser
  │   1. User clicks "Deals" tab
  │   2. React Router renders <DealsPage>
  │   3. react-query fires GET /api/deals/kanban
  │
  ▼
nginx  (apps/web/nginx.conf)
  │   location /api/ → proxy_pass http://crm_api
  │   forwards Authorization header, body, method
  │
  ▼
Elysia  (apps/api/src/index.ts)
  │   4. global beforeHandle hooks run first
  │   5. route group .use(authContext) parses JWT → userId attached
  │   6. route group .use(requirePermission('deal:read')) checks RBAC
  │   7. handler runs Prisma query
  │
  ▼
Postgres
  │   8. SELECT … FROM deals JOIN stages JOIN companies …
  │
  ▼
Elysia response
  │   9. JSON serialised
  │   10. global afterHandle hooks (e.g. audit)
  │
  ▼
nginx → Browser
  │   11. react-query caches the response keyed by ['deals-kanban']
  │   12. component re-renders
```

### Request lifecycle (mutating write)

Identical to a read, plus:
- afterHandle `logEvent` middleware writes a row to `audit_logs`
  with the actor, action, resource, and (for products/services/users)
  before/after diff metadata
- For Deal `PATCH /:id/stage` specifically, the route handler also
  sets `closedAt` and `status` (WON/LOST/OPEN) when entering a
  terminal stage — this side effect is what the edit dialog also
  piggybacks on (see `frontend.md`)

---

## 4. Authentication

JWT-based, stateless.

### Token issuance

1. `POST /auth/login` (in `routes/auth.ts`) verifies email + password
   (Bun.password uses Argon2id by default)
2. On success, signs a JWT via the `@elysiajs/jwt` plugin with
   `JWT_SECRET` and `expiresIn: 7d`
3. Returns `{ token, user }`; the web app stores the token in
   `localStorage` under the key `crm:token`

### Token validation

Every request other than `/auth/login`, `/auth/me`, and `/health` must
carry `Authorization: Bearer <token>`. The flow:

```
authContext (lib/context.ts)
   │  reads Authorization header
   │  calls jwt.verify(token, JWT_SECRET)
   │  on failure → sets set.status = 401 and returns
   │  on success → attaches { userId, role } to ctx
   ▼
requirePermission('product:write')
   │  checks the role can() the permission
   │  on fail → 403
   │  on pass → continues
   ▼
handler
```

### Logout

There is no server-side logout (no token blacklist). The client just
removes the token from `localStorage`; subsequent requests become 401.

---

## 5. RBAC

Three system roles, defined in `packages/shared/src/permissions.ts`:

| Role      | Description                          | Permission coverage                |
| --------- | ------------------------------------ | ---------------------------------- |
| `ADMIN`   | Full access + user/role/audit mgmt  | All permissions                    |
| `SALES`   | Day-to-day CRM work                  | All `:read/create/update/delete` for companies, contacts, products (read only), quotations, deals; plus `quotation:send` and `chat:use` |
| `VIEWER`  | Read-only                            | `:read` on the same five resources |

Permissions are keyed `<resource>:<action>`. See [`rbac.md`](./rbac.md)
for the full catalogue and how custom roles are seeded.

---

## 6. Audit logging

The `logEvent` middleware (`apps/api/src/middleware/audit.ts`) is
called by route handlers **explicitly** (not automatically). It writes
a row to `audit_logs` with:

- `actorId` — user from the JWT
- `action` — `AuditAction` enum value (e.g. `QUOTATION_UPDATED`)
- `resourceType` / `resourceId` — what was touched
- `description` — human-readable
- `metadata` — JSON (typically a before/after diff for UPDATEs, or
  `{ manDayCount: N }` for service creates)
- `ipAddress` / `userAgent` — request context

`GET /audit/actions` returns the enum's full value list so the admin
UI can render a filter dropdown. The audit page is `/audit` and is
visible to anyone with `audit:read` (ADMIN only by default).

---

## 7. Wire-format conventions

These conventions make the API predictable. Deviating from them is a
bug source — see `frontend.md` § "Known API gotchas" for the list of
incidents so far.

### 7.1 List endpoints may return either shape

`GET /<resource>` historically returns either:
- a bare array `Product[]`, or
- `{ items: Product[], total: number }`

depending on which route file wrote it. The frontend `lib/api.ts`
client normalises both via `Array.isArray(r) ? r : r.items`. New
routes should pick one (bare array is the current majority) and
the client will keep working.

### 7.2 Prisma field names on the wire

Prisma's JSON output uses the **model field name** (camelCased from
the Prisma schema), not the DB column name. The frontend `Service`
type historically used `manDays` while the wire is `manDayLines` —
the `servicesApi` boundary normalises via `normaliseService()` so
components can rely on `manDays`. See `frontend.md` § "Field-name
drift" for the recipe.

### 7.3 Polymorphic payloads

`QuotationItem` is `itemType: 'PRODUCT' | 'SERVICE'` with exactly one
of `productId` or `serviceId` set. The service item also carries a
`manDaySnapshot` JSONB so the original service can be edited later
without breaking the historical quote. See `database.md` for the
field-level details.

Display in the edit dialog (`apps/web/src/components/quotation-builder.tsx`'s
`ProductAutocomplete` / `ServiceAutocomplete`) reads the **snapshot**
fields (`line.name`, `line.sku`), not the live `Product` / `Service`
record. If the underlying record was deleted, the line keeps showing
the snapshot with a "(已刪除)" badge; if it was renamed, the line
keeps showing the snapshot name. The quotation is a faithful record
of what was quoted, not a live view of the catalogue.

The same snapshot precedence applies to the **read-only** surfaces,
so an old quotation behaves the same in every view:

- `QuotationDetailPage` (normal + print mode line-items tables) uses
  the shared `<LineItemSnapshotMeta>` component
  (`apps/web/src/components/quotation-line-item-snapshot.tsx`), which
  renders description, the SERVICE SOW / man-day breakdown from
  `manDaySnapshot`, and the "(已刪除)" badge when the live `product` /
  `service` relation is null. Helpers: `isLineItemDeleted(item)` and
  `resolveLineItemDescription(item)`. P2-snapshot-display (commit
  1464b4e, 2026-06-26).
- The Excel export (`apps/api/src/lib/excel/crm-adapter.ts`) emits
  `sow` / `sow_en` from `item.description` (snapshot) before falling
  back to the live catalogue, so a deleted service doesn't blank the
  SOW sheet.

Pinned by vitest tests in
`apps/web/src/components/__tests__/quotation-line-item-snapshot.test.ts`
(8 cases) and bun:test cases in
`apps/api/src/lib/excel/crm-adapter.test.ts` (6 cases).

### 7.4 Currency and money

- All money fields are stored as `Decimal(12, 2)` in Prisma, returned
  as JSON strings (Prisma's default for `Decimal`).
- The frontend `formatCurrency` helper coerces with `Number(...)` for
  display. **Do not sum two `Decimal` strings with `+` — coerce first
  or you'll get concatenation, not addition** (a Day 6 bug).

### 7.5 Authentication header

All authenticated endpoints require:

```
Authorization: Bearer <jwt>
```

No cookie-based auth. No CSRF tokens (the SPA is same-origin through
nginx; the API is internal-only).

---

## 8. AI Agent loop

```
User prompt
  │
  ▼
POST /chat/send  { message, conversationId? }
  │   persist user message → ConversationMessage(role=user)
  │   load conversation history (last N turns)
  │
  ▼
@crm/ai/runAgent
  │   1. system prompt + history + user message
  │   2. OpenAI chat.completions.create with tools=toolRegistry
  │   3. if response.tool_calls → for each:
  │        a. parse args, validate against tool.parameters
  │        b. execute(args, { userId })
  │        c. persist tool message (role=tool, toolName, toolArgs, toolResult)
  │        d. loop: send tool result back, get next response
  │   4. if no tool_calls → final assistant text
  │        persist assistant message
  │
  ▼
Response: { conversationId, reply, toolCalls[], usage: { promptTokens, completionTokens, totalTokens } }
```

The agent has access to 8 tools. See [`ai-agent.md`](./ai-agent.md)
for the full catalogue and the design constraints (e.g. `draft_quotation`
can only be called after `search_products` resolved the SKUs).

---

## 9. Frontend ↔ API contract

The frontend never calls `fetch` directly. All calls go through
`apps/web/src/lib/api.ts`, which exposes a typed client:

```ts
import { productsApi, servicesApi, ... } from '@/lib/api';

const list = await productsApi.list({ category: 'Hardware' });
const svc  = await servicesApi.get(id);   // normalised manDays field
const q    = await quotationsApi.create(payload);
```

The client:
- Attaches the JWT from `localStorage`
- Throws `ApiError` (with `status` and `body`) on non-2xx
- Returns raw `Promise<T>` (no auto-retry)
- Has per-resource helpers (e.g. `quotationsApi.addItem`) for nested
  endpoints that don't fit the standard `get/list/create/update/remove`
  pattern

---

## 10. Recent features (Day 16-18 sprint bundle)

The architecture above describes the as-built skeleton. The Day 16-18
sprints layered on these subsystems. Each subsection below points at
its decision record (`docs/architecture/001N-*.md`):

- §10.1 Quotation revisions — [`0016-quotation-revisions.md`](./architecture/0016-quotation-revisions.md)
- §10.2 Sales-rep assignment
- §10.3 Multi-currency snapshots — [`0017-multi-currency-snapshot.md`](./architecture/0017-multi-currency-snapshot.md)
- §10.4 Activity + Attachment author-only CRUD — [`0018-author-only-crud.md`](./architecture/0018-author-only-crud.md)
- §10.5 Deal detail page
- §10.6 SENT lock semantics

### 10.1 Quotation revisions (Day 18-D)

`Quotation` carries a self-referencing `parentQuotationId` FK + an
integer `revisionNumber`. The chain forms via `parentQuotationId`
links; the root has `parentQuotationId = null` and `revisionNumber = 0`.

```
Q-2026-0001          (root, R0, parent=null)
└─ Q-2026-0001-R1   (parent=root, R1)
   └─ Q-2026-0001-R2 (parent=R1, R2)
      └─ Q-2026-0001-R3 (parent=R2, R3)
```

`POST /quotations/:id/revise` walks the parent chain to find the
root, BFS-counts descendants to pick the next position (handles
branching without number collisions), then clones the source as a
DRAFT with `parentQuotationId = source.id`, `revisionNumber = count`,
and `number = root.number-R{N}`. The new DRAFT's `updatedAt` is
auto-refreshed; audit log records `parentQuotationId` +
`parentQuotationNumber` in metadata.

`onDelete: SetNull` on `parentQuotationId` means deleting a row in
the middle of a chain doesn't orphan its descendants — they
become new roots.

### 10.2 Sales-rep assignment (Day 18-C)

`Quotation.salesRepId` (FK to User, `ON DELETE SET NULL`) joins the
existing `Deal.ownerId` field as the follow-up salesperson.

`POST /quotations` defaults `salesRepId` to the authenticated user
when omitted; `PATCH /quotations/:id` accepts the field. The
`UserAutocomplete` shared component is reused by `DealDialog` and
`QuotationBuilder` for both pickers.

The frontend surfaces the sales rep column on:
- `QuotationsListPage` table
- `QuotationDetailPage` Summary card (falls back to `createdBy` when null)
- `DealDetailPage` Quotations tab
- `DealCard` (Kanban) shows owner-initial avatar in the top-right corner

### 10.3 Multi-currency snapshots (Day 19)

`SystemConfig` stores the live exchange rates `cny_to_hkd` (system
default; admin-editable) and `hkd_to_mop`. Each Quotation captures
the rates at create time as `exchangeRateToHKD` /
`exchangeRateToMOP` and computes `totalHKD` / `totalMOP` snapshots
that survive rate changes.

```
┌──────────────────────────┐  create-time snapshot  ┌──────────────────┐
│ SystemConfig             │ ──────────────────────▶│ Quotation         │
│ cny_to_hkd = 1.08         │                          │ rateToHKD = 1.08 │
│ hkd_to_mop = 1.16         │                          │ rateToMOP = 1.16 │
│ (admin-editable)          │                          │ totalHKD = 162k │
└──────────────────────────┘                          │ totalMOP = 174k │
                                                     └──────────────────┘
```

The Excel `sow` sheet renders both HKD (default) and MOP equivalent
rows when the snapshots are present. Currency picker flows from
system default → Deal → Product/Service → Quotation, so users never
have to type a currency manually.

### 10.4 Activity + Attachment author-only CRUD (Day 18-E / Day 19-E-fix)

Both `PATCH /activities/:id` and `DELETE /activities/:id` are
author-only (403 otherwise). Same shape for per-attachment
`PATCH /activities/:id/attachments/:id` and `DELETE /…/:id`
(uploader-only).

The frontend `ActivityItem` mounts ✏️ + 🗑️ inline affordances only
when `activity.author?.id === currentUser.id`. The same conditional
applies on attachment chips. Audit log records `ACTIVITY_UPDATED`
/ `ACTIVITY_DELETED` per the existing pattern.

### 10.5 Deal detail page (Day 18-F)

`/deals/:id` is a new page that surfaces the full Deal context in
one place:

- Header: deal title, company link, owner, stage badge, status,
  action buttons (編輯, 刪除, + 新增報價)
- Meta strip: deal value, expected close date, closed-at, 報價數量
- Tab nav: `報價` (default) + `Activity`
  - `報價` tab: re-fetches `quotationsApi.list({ dealId })` and renders a
    read-only table with number / title / status / total / 銷售員 /
    created / sent / accepted columns + 查看 link
  - `Activity` tab: lazy-fetches `/api/activities?dealId=…` on first
    switch; renders type-badge + author + timestamp + content cards

The Kanban card's outer `onClick` now navigates to `/deals/:id` (was:
open edit dialog). The edit icon is still a separate click target
with `stopPropagation` for quick-edit.

### 10.6 SENT lock semantics (Day 18-C follow-up)

The `PATCH /quotations/:id` SENT-lock guard covers only the
**contractual** fields — what the customer sees on the document:

| Locked (contractual)  | Unlocked (CRM metadata) |
| --------------------- | ----------------------- |
| `title`                | `dealId`                |
| `notes`                | `salesRepId`             |
| `taxRate`              | `status` (excluded by `if`) |
| `validUntil`           |                         |
| line items (separate routes, all 409 on non-DRAFT) | |

This is the correction of an earlier mistake (RG-021): the original
"lock `dealId` because it's sales-attribution" reasoning was wrong.
Sales attribution is `salesRepId` / `createdById`, not `dealId`.
Deal is a CRM container, not a commission rule.

---

## 11. Decision log

All ADRs live under `docs/architecture/NNNN-slug.md`. Numbering is
strictly sequential; a new ADR takes the next available number.
The full machine-readable index lives at `_meta/adr-index.json`.

| ADR   | Title                                                          | Date       |
| ----- | -------------------------------------------------------------- | ---------- |
| 0001  | AI Assistant architecture                                     | 2026-06-08 |
| 0014  | Audit log retention (12mo default, 24mo sensitive)            | 2026-06-07 |
| 0015  | System settings 7-tab layout                                  | 2026-06-07 |
| 0016  | Quotation revisions via self-referencing chain                | 2026-06-26 |
| 0017  | Multi-currency snapshots on Quotation (HKD + MOP)              | 2026-06-29 |
| 0018  | Author-only edit + delete for Activity + Attachment            | 2026-06-26 |

The `[0-9]{4}-.+\.md$` filename pattern is what load-bearing indexers
grep on. Don't rename; deprecate by adding a `superseded-by` note
at the top instead.
