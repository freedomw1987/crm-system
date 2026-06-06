# API reference

All endpoints are mounted under `/api/...` (the nginx reverse proxy
strips the `/api` prefix before forwarding to Elysia). The web app
makes calls through `lib/api.ts` which handles auth, normalisation,
and error throwing — see [`frontend.md`](./frontend.md) for the
client-side view.

> **Auth.** Every endpoint (except `/auth/login` and `/health`) requires
> `Authorization: Bearer <token…   on success returns 401. The
> `requirePermission` middleware returns 403 if the role lacks the
> permission for the route — see [`rbac.md`](./rbac.md).
>
> **Conventions.**
> - List endpoints may return either a bare array `[…]` or
>   `{ items: […], total: N }`. The frontend normalises both.
> - Prisma `Decimal` fields are serialised as JSON strings on the wire.
>   Coerce with `Number(...)` before arithmetic.

---

## Index

- [`/auth`](#auth) — login, me, change-password
- [`/companies`](#companies)
- [`/contacts`](#contacts)
- [`/products`](#products)
- [`/services`](#services)
- [`/quotations`](#quotations)
- [`/deals`](#deals) — also `/deals/kanban` and `/deals/:id/stage`
- [`/users`](#users)
- [`/roles`](#roles) — also `/roles/permissions` and `/roles/matrix`
- [`/regions`](#regions)
- [`/chat`](#chat) — AI agent
- [`/audit`](#audit) — admin

---

## `/auth`

| Method | Path                  | Permission      | Notes                                  |
| ------ | --------------------- | --------------- | -------------------------------------- |
| POST   | `/auth/login`         | *(public)*      | Returns `{ token, user }`              |
| GET    | `/auth/me`            | *(any user)*    | Current user from JWT                  |
| POST   | `/auth/change-password`| *(self)*       | Requires `userId` from JWT             |

### `POST /auth/login`

Request:
```json
{ "email": "admin@crm.local", "password": "admin123" }
```

Response 200:
```json
{ "token": "<jwt>", "user": { "id": "...", "email": "...", "name": "...", "role": "ADMIN", "roleId": "..." } }
```

Errors: `401` invalid credentials; `403` user is `isActive: false`.

---

## `/companies`

Permission for all: `company:read|create|update|delete`.

| Method | Path                  | Notes                                  |
| ------ | --------------------- | -------------------------------------- |
| GET    | `/companies`          | list; query: `search`, `regionId`, `status`, `industry`, `limit`, `offset` |
| GET    | `/companies/:id`      | detail                                 |
| POST   | `/companies`          | create                                 |
| PATCH  | `/companies/:id`      | update                                 |
| DELETE | `/companies/:id`      | delete (audit-logged)                  |

`POST` body shape: `CompanyInput` (subset of `Company`; omit `id`, timestamps).

---

## `/contacts`

Permission: `contact:read|create|update|delete`.

| Method | Path                  | Notes                                  |
| ------ | --------------------- | -------------------------------------- |
| GET    | `/contacts`           | list; query: `search`, `companyId`, `isPrimary`, `limit`, `offset` |
| GET    | `/contacts/:id`       |                                        |
| POST   | `/contacts`           |                                        |
| PATCH  | `/contacts/:id`       |                                        |
| DELETE | `/contacts/:id`       |                                        |

---

## `/products`

Permission: `product:read|create|update|delete`.

| Method | Path                  | Notes                                  |
| ------ | --------------------- | -------------------------------------- |
| GET    | `/products`           | list; query: `search`, `category`, `status`, `limit`, `offset` |
| GET    | `/products/:id`       | detail; includes last 10 quotationItems |
| POST   | `/products`           | audit-logged                           |
| PATCH  | `/products/:id`       | audit-logged; partial                  |
| DELETE | `/products/:id`       | audit-logged                           |

`POST`/`PATCH` body — the `ProductInput` type in `lib/api.ts`:

```ts
{
  sku: string;                  // required, unique
  name: string;                 // required
  description?: string;
  category?: string;
  unitPrice: number;            // required
  costPrice?: number;
  currency?: string;            // default "HKD"
  trackInventory?: boolean;
  stockQuantity?: number | null;
  lowStockThreshold?: number | null;
  status?: 'ACTIVE' | 'ARCHIVED' | 'DRAFT';
  imageUrl?: string;
  metadata?: Record<string, unknown>;
}
```

---

## `/services`

Permission: `service:read|create|update|delete`.

| Method | Path                  | Notes                                                                                  |
| ------ | --------------------- | -------------------------------------------------------------------------------------- |
| GET    | `/services`           | list; query: `category`, `status`, `limit`, `offset`; **includes `manDayLines`** (Day 9) |
| GET    | `/services/:id`       | detail; includes ordered `manDayLines`                                                |
| POST   | `/services`           | audit-logged; **body uses `manDayLines`** (Prisma relation name, validator requires it) |
| PATCH  | `/services/:id`       | audit-logged; **body uses `manDayLines`** for the same reason                          |
| DELETE | `/services/:id`       | 409 if any QuotationItem still references this service                                 |

### `POST /services` body

```json
{
  "name": "Installation Service",
  "description": "On-site setup and configuration. Includes SOW text…",
  "category": "Implementation",
  "unitPrice": 30000,
  "currency": "HKD",
  "status": "ACTIVE",
  "sortOrder": 0,
  "manDayLines": [
    { "role": "Senior Consultant", "dayRate": 5000, "days": 3, "sortOrder": 0 },
    { "role": "Junior Engineer",   "dayRate": 2000, "days": 5, "sortOrder": 1 }
  ]
}
```

> **Wire-format key.** The validator and the underlying Prisma
> relation are both named `manDayLines` (camelCase, plural). The
> frontend `Service` type uses `manDays`; the `servicesApi` wrapper
> normalises the response. Sending `manDays` to `POST /services`
> will fail with a 502 because the Elysia validator rejects unknown
> keys. See [`architecture.md` § 7.2](./architecture.md).

### `GET /services` response

Each item has its `manDayLines` array embedded. Example item:

```json
{
  "id": "...",
  "name": "Installation Service",
  "description": "...",
  "category": "Implementation",
  "unitPrice": "30000.00",
  "currency": "HKD",
  "status": "ACTIVE",
  "sortOrder": 0,
  "manDayLines": [
    { "id": "...", "role": "Senior Consultant", "dayRate": "5000.00", "days": "3.00", "subtotal": "15000.00", "sortOrder": 0 }
  ],
  "createdAt": "...",
  "updatedAt": "..."
}
```

---

## `/quotations`

Permission: `quotation:read|create|update|delete` (plus `quotation:send` for status changes).

| Method | Path                                  | Notes                                                     |
| ------ | ------------------------------------- | --------------------------------------------------------- |
| GET    | `/quotations`                         | list; query: `companyId`, `status`, `dealId`, `limit`, `offset` |
| GET    | `/quotations/:id`                     | detail; full `items` array                                |
| POST   | `/quotations`                         | create with items in one shot; auto-numbers               |
| PATCH  | `/quotations/:id`                     | update header (title, notes, tax, validUntil)             |
| DELETE | `/quotations/:id`                     | cascades to items                                         |
| POST   | `/quotations/:id/status`              | body: `{ status }` — DRAFT / SENT / VIEWED / …; stamps `sentAt` etc. |
| POST   | `/quotations/:id/items`               | add a single line item                                    |
| PATCH  | `/quotations/:id/items/:itemId`       | update a line item                                        |
| DELETE | `/quotations/:id/items/:itemId`       | delete a line item                                        |

### `POST /quotations` body

```json
{
  "companyId": "...",
  "dealId": "...",
  "title": "Q2 系統升級報價",
  "notes": "internal note",
  "taxRate": 0,
  "validUntil": "2026-08-31",
  "items": [
    {
      "itemType": "PRODUCT",
      "productId": "...",
      "sku": "HW-MON-001",
      "name": "27\" 4K Monitor",
      "quantity": 5,
      "unitPrice": 3200,
      "discount": 0
    },
    {
      "itemType": "SERVICE",
      "serviceId": "...",
      "name": "Installation Service",
      "quantity": 1,
      "unitPrice": 30000,
      "manDaySnapshot": {
        "lines": [
          { "role": "Senior Consultant", "dayRate": 5000, "days": 3, "subtotal": 15000 }
        ]
      }
    }
  ]
}
```

The server computes `subtotal` / `taxAmount` / `total` from the
items. `number` is auto-generated as `Q-<year>-<4-digit-seq>`.

---

## `/deals`

Permission: `deal:read|create|update|delete`.

| Method | Path                       | Notes                                                            |
| ------ | -------------------------- | ---------------------------------------------------------------- |
| GET    | `/deals`                   | list; query: `ownerId`, `stageId`, `status`, `companyId`, `limit`, `offset` |
| GET    | `/deals/kanban`            | buckets grouped by stage for the default (or specified) pipeline; includes deals, company, owner, stage, `_count.quotations` |
| GET    | `/deals/:id`               | detail; includes activities (last 30) and quotations             |
| POST   | `/deals`                   | audit-logged                                                     |
| PATCH  | `/deals/:id`               | update header fields; **does not** auto-set status/closedAt (that's the stage endpoint's job) |
| DELETE | `/deals/:id`               | audit-logged                                                     |
| PATCH  | `/deals/:id/stage`         | body: `{ stageId, status? }` — **this** is the endpoint that auto-sets `status` (WON/LOST/OPEN) and `closedAt` based on the target stage name |

### `GET /deals/kanban` response

```json
{
  "pipeline": { "id": "...", "name": "Default Sales Pipeline", "isDefault": true },
  "buckets": [
    {
      "stage": { "id": "...", "name": "Lead", "position": 0, "probability": 10, "color": "#94a3b8" },
      "deals": [
        { "id": "...", "title": "...", "value": "10000.00", "currency": "HKD", "status": "OPEN",
          "company": { "id": "...", "name": "ACME", "region": { "code": "HK", "name": "香港", "flag": "🇭🇰" } },
          "owner": { "id": "...", "name": "...", "email": "..." },
          "_count": { "quotations": 0 } }
      ]
    }
  ]
}
```

### `PATCH /deals/:id/stage` body

```json
{ "stageId": "...", "status": "OPEN" }
```

`status` is optional — the server derives it from the stage's name:
- stage name `Won` → status `WON`
- stage name `Lost` → status `LOST`
- otherwise → status `OPEN`

If the resulting status is not `OPEN`, `closedAt` is set to `now()`.

The edit dialog in the frontend calls this endpoint separately
when the user changes the stage, so the side effects are applied.

---

## `/users`

Permission: `user:read|create|update|delete` (plus `audit:read` for the listing).

| Method | Path                              | Notes                                  |
| ------ | --------------------------------- | -------------------------------------- |
| GET    | `/users`                          | list; query: `search`, `role`, `isActive`, `limit` |
| GET    | `/users/:id`                      |                                        |
| POST   | `/users`                          | audit-logged; admin-only               |
| PATCH  | `/users/:id`                      | audit-logged; cannot self-deactivate   |
| DELETE | `/users/:id`                      |                                        |
| POST   | `/users/:id/reset-password`       | body: `{ newPassword }`; audit-logged  |

---

## `/roles`

Permission: `user:read` (the page is admin-only in the UI).

| Method | Path                  | Notes                                  |
| ------ | --------------------- | -------------------------------------- |
| GET    | `/roles`              | all roles with `_count.users` and `_count.permissions` |
| GET    | `/roles/permissions`  | list of all permission strings (from `PERMISSIONS` in `@crm/shared`) |
| GET    | `/roles/matrix`       | role → permissions matrix (for the admin UI) |
| GET    | `/roles/:id`          | detail with full `permissions: string[]` |
| POST   | `/roles`              | audit-logged; create a custom role     |
| PATCH  | `/roles/:id`          | audit-logged; **cannot rename a system role** |
| DELETE | `/roles/:id`          | audit-logged; **cannot delete a system role** |

### `POST /roles` body

```json
{
  "name": "Senior Sales",
  "displayName": "Senior Sales Rep",
  "description": "...",
  "permissions": ["company:read", "company:create", "quotation:read", "quotation:create", "deal:read", "chat:use"]
}
```

---

## `/regions`

Permission: region is an admin-curated table; the API requires
`user:read` (or higher) to write; everyone authenticated can read.

| Method | Path             | Notes                                  |
| ------ | ---------------- | -------------------------------------- |
| GET    | `/regions`       | all regions, ordered by `sortOrder`    |
| GET    | `/regions/:id`   |                                        |
| POST   | `/regions`       |                                        |
| PATCH  | `/regions/:id`   |                                        |
| DELETE | `/regions/:id`   |                                        |

---

## `/chat`

Permission: `chat:use` (every authenticated role has this).

| Method | Path                          | Notes                                  |
| ------ | ----------------------------- | -------------------------------------- |
| GET    | `/chat/conversations`         | list current user's conversations      |
| GET    | `/chat/conversations/:id`     | conversation + messages                |
| POST   | `/chat/send`                  | send a message; runs the agent loop    |
| DELETE | `/chat/conversations/:id`     | delete a conversation (cascades to messages) |

### `POST /chat/send` request

```json
{ "message": "幫 ACME 開個 5 個 HW-MON-001 同 2 個 SVC-CONS-001 嘅 quotation", "conversationId": "..." }
```

`conversationId` is optional — omit to start a new conversation.

### `POST /chat/send` response

```json
{
  "conversationId": "...",
  "reply": "我幫你搞掂咗。Quotation Q-2026-0042 已經建立。",
  "toolCalls": [
    { "name": "search_companies", "args": { "query": "ACME" }, "result": { "items": [...] } },
    { "name": "search_products",  "args": { "query": "HW-MON-001" }, "result": { "items": [...] } },
    { "name": "draft_quotation",  "args": { "companyId": "...", "items": [...] }, "result": { "quotationId": "..." } }
  ],
  "usage": { "promptTokens": 1234, "completionTokens": 567, "totalTokens": 1801 }
}
```

See [`ai-agent.md`](./ai-agent.md) for the loop design and the
complete tool catalogue.

---

## `/audit`

Permission: `audit:read` (admin only).

| Method | Path             | Notes                                  |
| ------ | ---------------- | -------------------------------------- |
| GET    | `/audit`         | list; query: `actorId`, `action`, `resourceType`, `resourceId`, `from`, `to`, `limit`, `offset` |
| GET    | `/audit/actions` | full list of `AuditAction` enum values (for filter dropdown) |

---

## Error shapes

All non-2xx responses carry a JSON body. The `ApiError` class in the
frontend (`lib/api.ts`) attaches both `status` and `body` so callers
can do `if (e.status === 400) ...`.

| Status | Body                       | Meaning                          |
| ------ | -------------------------- | -------------------------------- |
| 400    | `{ "error": "..." }`       | Validation failure (Elysia `t.Object`) |
| 401    | `{ "error": "Unauthorized" }` | Missing or invalid JWT         |
| 403    | `{ "error": "..." }`       | Authenticated but lacks permission |
| 404    | `{ "error": "Not found" }` | Resource not found               |
| 409    | `{ "error": "..." }`       | Conflict (e.g. delete with FK references) |
| 500    | `{ "error": "..." }`       | Server error                     |

The seed user is **`admin@crm.local / admin123`** (or
`sales@crm.local / sales123`).
