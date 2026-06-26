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
│   │   │   └── routes/            # 12 route groups, one file per resource
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
