# CRM System — API Reference

> Every HTTP endpoint exposed by the Elysia backend. All endpoints are
> mounted under `/api/*` by the nginx reverse proxy. All endpoints (except
> `/auth/login`) require a `Bearer` JWT in the `Authorization` header.

---

## Conventions

- **Base URL (dev):** `http://localhost/api`
- **Auth:** `Authorization: Bearer <token>` from `/auth/login`
- **Content-Type:** `application/json` for all bodies
- **Error shape:** `{ error: string, message?: string }` with appropriate 4xx/5xx status
- **Idempotency:** GETs are idempotent; POSTs are not; PUTs on singletons
  are idempotent (e.g. `/ai/config` upserts by `id=1`)
- **Pagination:** none yet — most lists are capped at 20-50 server-side
- **Filtering:** query string params, snake_case to match Prisma field names

---

## Auth

### POST /auth/login
- **Auth:** none
- **Body:** `{ email: string, password: string }`
- **200:** `{ token: string, user: { id, email, name, role } }`
- **401:** `{ error: "Invalid credentials" }`

### GET /auth/me
- **Auth:** required
- **200:** `{ id, email, name, role, roleId, ... }`

### POST /auth/logout
- **Auth:** required
- **200:** `{ success: true }` (token is client-side only; logout just clears localStorage)

### POST /auth/change-password
- **Auth:** required
- **Body:** `{ currentPassword: string, newPassword: string }` — `newPassword` validated by `validateStrongPassword` (P1-5): `minLength: 12` + at least one digit + at least one special character.
- **200:** `{ success: true }`
- **400:** if `newPassword` fails the strength policy (error message names the failing rule)
- **401:** if `currentPassword` doesn't match the authenticated user's existing hash.

## Users

### GET /users
- **Auth:** `user:read`
- **200:** `User[]`

### POST /users
- **Auth:** `user:create`
- **Body:** `{ email, name, password, role? }`
- **201:** `User`

### GET /users/:id
- **Auth:** `user:read`
- **200:** `User`

### PATCH /users/:id
- **Auth:** `user:update`
- **Body:** partial `User` fields
- **200:** `User`

### DELETE /users/:id
- **Auth:** `user:delete` (cannot delete self)
- **200:** `{ success: true }`

### POST /users/:id/reset-password
- **Auth:** `user:reset_password`
- **Body:** `{ newPassword: string }`
- **200:** `{ success: true }`

## Roles

### GET /roles
- **Auth:** `role:read`
- **200:** `Role[]` (with permission list embedded)

### POST /roles
- **Auth:** `role:create`
- **Body:** `{ name, displayName, description?, permissions: string[] }`

### PATCH /roles/:id
- **Auth:** `role:update` (system roles cannot be edited)
- **Body:** partial

### DELETE /roles/:id
- **Auth:** `role:delete` (system roles cannot be deleted)
- **200:** `{ success: true }`

## Companies

### GET /companies
- **Auth:** `company:read`
- **Query:** `?query=&industry=&status=&limit=`
- **200:** `Company[]` (with `_count.contacts` etc.)

### POST /companies
- **Auth:** `company:create`

### GET /companies/:id
- **Auth:** `company:read`
- **200:** `Company` with contacts, addresses, deals, quotations

### PATCH /companies/:id

### DELETE /companies/:id
- **Auth:** `company:delete`

## Deals

### GET /deals
- **Auth:** `deal:read`
- **Query:** `?status=&ownerId=&companyId=&stageId=`
- **200:** `Deal[]` (with company, owner, stage)

### POST /deals
- **Auth:** `deal:create`
- **Body:** `{ title, companyId, stageId, value, expectedCloseDate?, pipelineId?, ownerId?, description?, probability?, status?: 'OPEN'|'WON'|'LOST' }`
- **Validation (RG-2026-06-07-DEAL-AUTOCOMPLETE, 2026-06-07):**
  - `title` — required, 1-200 chars
  - `companyId` — required, non-empty string (must exist in `companies`)
  - `stageId` — required, non-empty string (must exist in `pipeline_stages`)
  - `value` — required, numeric (number or numeric string)
  - `expectedCloseDate` — optional ISO-8601 date
  - `pipelineId` — optional; auto-resolved from `stageId` if omitted
  - `ownerId` — optional; defaults to the calling user's id
  - `description` — optional, max 5000 chars
  - `probability` — optional, numeric
  - `status` — optional enum `'OPEN' | 'WON' | 'LOST'`, defaults to `'OPEN'`
- **Side effects:** Writes a `DEAL_CREATED` audit-log entry with the
  creating user's id.
- **201:** `Deal` (with company, owner, stage)
- **422:** Validation error (Elysia schema violation)
- **400:** Stage or owner not found

### GET /deals/:id

### PATCH /deals/:id
- **Auth:** `deal:update`
- **Body (Partial — all fields optional, RG-2026-06-07-DEAL-AUTOCOMPLETE):**
  `{ title?, value?, expectedCloseDate?, description?, probability? }`
- **Note:** Stage changes are NOT accepted on this endpoint — use
  `PATCH /deals/:id/stage` instead so the backend can derive the
  `status` and `closedAt` correctly.
- **200:** `Deal`

### DELETE /deals/:id

### POST /deals/:id/activities
- **Auth:** `activity:create` (or via AI tool)
- **Body:** `{ type: "NOTE"|"CALL"|..., content, subject? }`

### GET /deals/kanban
- **Auth:** `deal:read`
- **Query:** `companyId?` + `companyIds?` + `ownerId?` + `ownerIds?` + `pipelineId?`
- **200:** `{ pipeline: { id, name, isDefault }, buckets: [{ stage: { id, name, position, probability, color }, deals: Deal[] }] }`
  - Each deal is `{ id, title, companyId, ownerId, stageId, status, value, currency, expectedCloseDate, ... }`
  - `owner` and `stage` are inlined for the Kanban card render.

### PATCH /deals/:id/stage
- **Auth:** `deal:update`
- **Body:** `{ stageId: string, status?: 'OPEN' | 'WON' | 'LOST' }`
- **200:** Updated `Deal`. Side effects:
  - Stage name `Won` → `status = 'WON'` (unless explicit `status` provided)
  - Stage name `Lost` → `status = 'LOST'`
  - Otherwise `status = 'OPEN'`
  - Non-OPEN final state → `closedAt = now()`
- **404:** `{ error: 'Stage not found' }`
- **Audit log:** `DEAL_STAGE_CHANGED` with metadata `{ stage, status }`.

## Quotations

### GET /quotations
- **Auth:** `quotation:read`

### POST /quotations

### GET /quotations/:id

### PATCH /quotations/:id

### DELETE /quotations/:id

### GET /quotations/:id/export-xlsx
- **Auth:** `quotation:read` (same as `GET /:id`)
- **Query:**
  - `lang` — `"zh"` (default) | `"en"` — controls which `product_name*` /
    `notice*` / `sow*` / `assumption*` field to display.
  - `version` — `"v2"` (default) | `"v1"` — selects the price column set.
    `v2` uses `unit_price` / `subtotal` / `sales_cost`; `v1` uses the
    `*_v1` suffixed snapshot columns (legacy, kept for backward compat with
    `bc-quotation`'s old price-card layout).
- **200:** `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
  with `Content-Disposition: attachment; filename="<quotation.number>.xlsx"`.
  Body is the binary `.xlsx` buffer (typically 30-50 KB).
- **404:** `{ error: "Quotation not found" }`
- **Audit log:** writes a `QUOTATION_EXPORTED_XLSX` row with metadata
  `{ number, lang, version, fileSize }`. Best-effort — failure to log does
  NOT block the download.
- **Worksheets produced (in order):**
  1. `Quotation` — header (date, revision, ref, customer, sales, region,
     currency) + line items table + grand total.
  2. `SOW Details` — one row per non-MA line item with its SOW description.
  3. `Assumption` — deduped list of assumptions (one per line) from all
     line items that have non-empty `assumption`.
  4. `MA Details` — only included if any line item has `product.sku === "Barco-MA"`.
  5. `Server Requirements` — only included if any line item has
     `product.sku === "Barco-LIC-TM"` or `Barco-LIC-OCDP`. Combines both
     templates with a blank separator row.
- **Implementation:** see `apps/api/src/lib/excel/{quotation.ts, crm-adapter.ts,
  helpers/*_worksheet.ts}`. The Excel generation is a 1:1 port of
  `~/www/bc-quotation/src/{quotation.ts, helpers/*_worksheet.ts}` —
  the only new code is the Prisma-to-bc-shape adapter.

### POST /quotations/:id/revise
- **Auth:** `quotation:update`
- **Body:** _none_
- **201:** Full `Quotation` (status=`DRAFT`) cloned from the source.
  Response includes `parentQuotationId`, `revisionNumber` (chain-aware,
  BFS-counted), and `parentQuotation: { id, number }` for the detail page
  to render the "修訂自 X" chip without an extra fetch. The new `number`
  follows `Q-YYYY-NNNN-R{N}` (e.g. `Q-2026-0001-R1`, `R2`, ...).
- **404:** `{ error: "Source quotation not found" }`
- **409:** `{ error: "Source quotation is DRAFT — edit it directly instead of creating a revision." }`

Cloned fields: `companyId`, `dealId`, `salesRepId` (defaults to
`userId` if source has none), `title`, `notes`, `validUntil`, `taxRate`,
plus ALL line items with snapshot fields preserved (so a deleted /
renamed Product/Service still shows in the new draft). See
`docs/architecture/0016-quotation-revisions.md`.

### POST /quotations/:id/status
- **Auth:** `quotation:send`
- **Body:** `{ status: 'DRAFT' | 'SENT' | 'VIEWED' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'INVOICED' }`
- **200:** Updated `Quotation`. `sentAt` stamped on `→ SENT`,
  `acceptedAt` on `→ ACCEPTED`. Recalc runs only if transitioning to
  SENT (last chance to refresh GP% from live man-day role costs).
- **422:** If transitioning to SENT and a SERVICE line has `costSnapshot == 0`
  AND `lineTotal > 0` — i.e. a man-day role has no cost configured.
  Response body: `{ error, lines: [{ id, name }] }`.

### POST /quotations/:id/items
- **Auth:** `quotation:update` — **DRAFT only** (409 on SENT/VIEWED/ACCEPTED/etc.)
- **Body:** `{ itemType: 'PRODUCT' | 'SERVICE', productId?: string, serviceId?: string, sku?: string, name: string, description?: string, quantity: number, unitPrice: number, discount?: number, manDaySnapshot?: unknown }`
- **201:** Created `QuotationItem`. Recomputes header `subtotal` /
  `taxAmount` / `total` + per-line `costSnapshot` / `lineGp` /
  `lineGpPercent`.

### PATCH /quotations/:id/items/:itemId
- **Auth:** `quotation:update` — **DRAFT only**
- **Body:** Any subset of the POST fields
- **200:** Updated `QuotationItem` + recomputed totals.

### DELETE /quotations/:id/items/:itemId
- **Auth:** `quotation:update` — **DRAFT only**
- **200:** `{ success: true }`

## Products

### GET /products
- **Auth:** `product:read`
- **Query:** `?query=&category=&status=ACTIVE&limit=` (default limit 50)
- **200:** `Product[]` with `_count.quotationItems` per product

### POST /products
- **Auth:** `product:create`
- **Body:** `{ sku, name, unitPrice, currency?, description?, category?, costPrice?, trackInventory?, stockQuantity?, lowStockThreshold?, status?, imageUrl? }`
- **201:** `Product`

### GET /products/:id
- **Auth:** `product:read`
- **200:** `Product & { _count: { quotationItems: number } }`

### PATCH /products/:id
- **Auth:** `product:update`
- **Body:** Any subset of POST fields
- **200:** Updated `Product`

### DELETE /products/:id
- **Auth:** `product:delete`
- **200:** `{ success: true }`

## Services

### GET /services
- **Auth:** `service:read`
- **Query:** `?status=&category=&query=&limit=`
- **200:** `Service[]` with normalised `manDays` field (Prisma's `manDayLines` → frontend's `manDays`).

### POST /services
- **Body:** `{ name, type: "catalogue"|"custom", description?, manDayLines: ServiceManDay[] }`

### GET /services/:id
- **Auth:** `service:read`
- **200:** `Service & { manDayLines: ServiceManDay[] }`

### PATCH /services/:id
- **Auth:** `service:update`
- **Body:** Any subset of POST fields (including `manDayLines` — full replacement)
- **200:** Updated `Service`
- **Side effect:** Recomputes `subtotal` / `taxAmount` for any in-flight DRAFT Quotation that references this service (queued, not synchronous, handled by `recalcQuotationAndItems` on next save).

### DELETE /services/:id
- **Auth:** `service:delete`
- **200:** `{ success: true }`
- Side effect: existing QuotationItems referencing this Service retain their `manDaySnapshot` (the snapshot preserved their state at quote time). The Service row's `serviceId` FK on QuotationItem is `ON DELETE SET NULL`.

## Regions

### GET /regions
- **Auth:** public (no auth required — used by the company form's region picker)
- **200:** `Region[]` (HK / MO / CN / OTHER seeded, plus any admin-added entries)

### POST /regions
- **Auth:** `region:create` (admin only)
- **Body:** `{ code: string, name: string, flag?: string, isActive?: boolean, sortOrder?: number }`
- **201:** `Region`
- **409:** `{ error: 'code must be unique' }` if `code` already used

### GET /regions/:id
- **Auth:** public
- **200:** `Region & { _count: { companies: number } }`

### PATCH /regions/:id
- **Auth:** `region:update` (admin only)
- **Body:** Any subset of POST fields
- **200:** Updated `Region`

### DELETE /regions/:id
- **Auth:** `region:delete` (admin only)
- **200:** `{ success: true }` if no companies reference it; otherwise 409 with `companiesCount`.

## Man-Day Roles

### GET /man-day-roles
- **Auth:** `man-day-role:read`
- **Query:** `?isActive=` (default true)
- **200:** `ManDayRole[]` sorted by `sortOrder`.

### POST /man-day-roles
- **Auth:** `man-day-role:create`
- **Body:** `{ name, price, cost?, isActive?, sortOrder? }`
- **201:** `ManDayRole`

### GET /man-day-roles/:id
- **Auth:** `man-day-role:read`
- **200:** `ManDayRole & { _count: { serviceLines: number } }`

### PATCH /man-day-roles/:id
- **Auth:** `man-day-role:update`
- **Body:** Any subset of POST fields
- **200:** Updated `ManDayRole`
- **Side effect:** Existing ServiceManDay rows carrying `manDayRoleId = id` keep their snapshot `role` text + `dayRate` intact (the snapshot was captured at service-write time per ADR-0016-ish invariant). New services pick up the new price.

### DELETE /man-day-roles/:id
- **Auth:** `man-day-role:delete`
- **200:** `{ success: true }`
- Side effect: existing ServiceManDay rows have their `manDayRoleId` set to `NULL` (`ON DELETE SET NULL`); the snapshot `role` text + `dayRate` are preserved.

## Activity

### GET /activities
- **Auth:** `activity:read`
- **Query:** `?companyId=&dealId=&authorId=&type=&since=&limit=&offset=` (default limit 50)
- **200:** `{ items: Activity[], total: number }`

### GET /activities/recent
- **Auth:** `activity:read`
- **Query:** `?authorId=&since=&limit=50`
- **200:** `Activity[]`

### POST /activities
- **Auth:** `activity:create`
- **Body:** `{ type: 'NOTE'|'CALL'|'EMAIL'|'MEETING', companyId?, dealId?, content }`
- **201:** `Activity`

### PATCH /activities/:id
- **Auth:** author only (`activity.authorId === userId`); **403** for non-authors
- **Body:** `{ type?: 'NOTE'|'CALL'|'EMAIL'|'MEETING', content?: string }`
- **200:** Updated `Activity`
- **404:** `{ error: 'Activity not found' }`
- **403:** `{ error: 'Only the author can edit this activity.' }`
- **400:** `{ error: 'content cannot be empty' }` (if `content` is `''` or whitespace-only)

See `docs/architecture/0018-author-only-crud.md`.

### DELETE /activities/:id
- **Auth:** author only (`activity.authorId === userId`); **403** for non-authors
- **200:** `{ success: true }`
- Side effect: deletes ALL attachments of this Activity (and unlinks the
  files from `DATA_DIR`).
- **Audit log:** `ACTIVITY_DELETED` with metadata `{ attachmentsDeleted: N }`.

## Attachments

### GET /attachments?companyId=
- **Auth:** `attachment:read`
- **Query:** `?companyId=` (required)
- **200:** `{ items: Attachment[], total: number }`

### GET /activities/:id/attachments
- **Auth:** `attachment:read`
- **200:** `{ items: Attachment[], total: number }` (per-activity list, used by the activity feed's chip tray)

### POST /activities/:id/attachments
- **Auth:** `attachment:create`
- **Body:** `multipart/form-data` with `file` field
- **201:** `Attachment`
- **413:** File over 50MB (matches nginx `client_max_body_size`).
- **Audit log:** `ATTACHMENT_UPLOADED`.

### GET /attachments/:id/download
- **Auth:** `attachment:read`
- **200:** binary stream with `Content-Disposition: attachment; filename=…`

### PATCH /attachments/:id
- **Auth:** uploader only (`attachment.uploadedById === userId`); **403** for non-uploaders
- **Body:** `{ fileName?: string }` (currently the only mutable field; mime/size/storage are immutable post-upload)
- **200:** Updated `Attachment`
- **Audit log:** `ATTACHMENT_UPDATED`.

### DELETE /attachments/:id
- **Auth:** uploader only (`attachment.uploadedById === userId`); **403** for non-uploaders
- **200:** `{ success: true }`
- Side effect: unlinks the file from `DATA_DIR`.
- **Audit log:** `ATTACHMENT_DELETED`.

## Audit Log

### GET /audit
- **Auth:** `audit:read`
- **Query:** `?actorId=&action=&resourceType=&from=&to=&limit=50`
- **200:** `AuditLog[]` (with actor name)

---

## AI Configuration (Day 10)

> ⚠️ **All `/ai/config/*` endpoints (except `/status`) require
> `ai-config:read` or `ai-config:update` permission.** Status endpoint is
> accessible to any authenticated user so the chat page can show a "go
> configure" banner.

### GET /ai/config/status
- **Auth:** any authenticated user
- **200 (not configured):** `{ configured: false }`
- **200 (configured):** `{ configured: true, modelName: string, updatedAt: ISO }`

### GET /ai/config
- **Auth:** `ai-config:read` (admin)
- **200 (not configured):**
  ```json
  {
    "configured": false,
    "endpointUrl": "",
    "apiKeyMasked": "",
    "hasApiKey": false,
    "modelName": "",
    "systemPrompt": "",
    "updatedAt": null,
    "updatedByName": null
  }
  ```
- **200 (configured):**
  ```json
  {
    "configured": true,
    "endpointUrl": "https://api.openai.com/v1",
    "apiKeyMasked": "sk-...2345",
    "hasApiKey": true,
    "modelName": "gpt-4o",
    "systemPrompt": "…",
    "updatedAt": "2026-06-09T10:42:00.000Z",
    "updatedByName": "Admin User"
  }
  ```
- **403:** `{ error: "Forbidden: missing permission 'ai-config:read'" }` (RG-002 fix)

### PUT /ai/config
- **Auth:** `ai-config:update` (admin)
- **Body:** `{ endpointUrl: string, apiKey: string, modelName: string, systemPrompt?: string }`
- **Validation:** URL must be http/https, apiKey non-empty, modelName non-empty
- **200:** `{ success: true, updatedAt: ISO }`
- **Side effects:** API key encrypted with AES-256-GCM before insert;
  `AuditLog` row with `action: AI_CONFIG_UPDATED`

### POST /ai/config/test
- **Auth:** `ai-config:update` (admin)
- **Probes** the configured endpoint with a 1-token completion request
- **200:** `{ ok: true, latencyMs: number, model: string }`
- **4xx/5xx:** `{ ok: false, error: string, latencyMs: number }`

## AI Chat (Day 10)

### GET /chat/conversations
- **Auth:** required (returns only the caller's conversations)
- **200:** `ConversationSummary[]` (id, title, updatedAt, _count.messages)

### GET /chat/conversations/:id
- **Auth:** required (caller must own the conversation)
- **200:** `Conversation` (with all messages in order)
- **404:** if not found OR not owned by caller

### POST /chat/send
- **Auth:** required
- **Body:** `{ message: string, conversationId?: string }`
- **Pre-check (RG-002 fix):** if no `AiConfig` row exists, return 503
  ```
  { error: "AI Assistant is not configured",
    message: "Ask an admin to set up the AI Assistant at /admin/ai-config." }
  ```
- **200:** `AgentRunResult`
  ```json
  {
    "conversationId": "cmq…",
    "reply": "Here are the 5 open deals…",
    "toolCalls": [
      { "name": "list_deals", "args": {"status":"OPEN"}, "result": [...] }
    ],
    "usage": { "promptTokens": 412, "completionTokens": 87, "totalTokens": 499 }
  }
  ```
- **400:** if `message` missing
- **500:** if the LLM call fails (network, invalid key, rate limit, etc.)
  — body includes the upstream error message

### POST /chat/confirm/:id
- **Auth:** required (`chat:use`)
- **Body:** `{ confirm: 'approve' | 'deny' }` — `approve` accepts the pending tool proposal, `deny` skips it.
- **200:**
  ```json
  {
    "conversationId": "cmq…",
    "status": "approved" | "denied",
    "toolName": "create_quotation",
    "auditId": "audit_logs.cm_…"
  }
  ```
- **404:** if no pending confirmation exists for the conversation.
- **Behavior:** On approve, the route executes the previously-proposed
  tool args (the AI proposal is stored in `ConversationMessage`
  keyed by `aiToolConfirmationHash`) and writes an `AI_TOOL_CONFIRMED`
  audit log row. On deny, just writes an `AI_TOOL_DENIED` row.

This is the **user-side handshake** for the human-in-the-loop
guardrail (ADR-0018 + RG-CHAT-002). The agent emits a
`confirmation_required` SSE event with a stable `hashArgs()`; the
frontend surfaces a Radix Dialog with the diff preview; the
human's response hits this endpoint.

### DELETE /chat/conversations/:id
- **Auth:** required (caller must own)
- **200:** `{ success: true }`

---

## Settings (Day 11 Phase 1)

Admin-only configuration for sales pipelines. Phase 1 covers pipeline
stages; Phase 2 will add `/settings/system-configs` for global tax rate.

### GET /settings/pipelines
- **Auth:** required (`settings:read`)
- **200:** array of pipelines with nested stages ordered by `position`,
  plus a `_count.deals` per stage:
  ```json
  [
    {
      "id": "pl_…",
      "name": "Default Sales Pipeline",
      "isDefault": true,
      "stages": [
        { "id": "st_…", "name": "Lead", "position": 0, "probability": 10, "color": "#94A3B8", "_count": { "deals": 0 } }
      ]
    }
  ]
  ```
- **Used by:** AI tool `list_pipelines` (Day 11), Settings page Pipeline tab

### POST /settings/pipelines/stages
- **Auth:** required (`settings:update` — ADMIN only)
- **Body:**
  ```json
  { "name": "Negotiation", "probability": 75, "color": "#F97316", "pipelineId": "pl_…" }
  ```
  - `pipelineId` is optional; defaults to the `isDefault` pipeline
  - `probability` defaults to 0; `color` defaults to `null`
- **Position:** auto-assigned to `max(position) + 1` within the pipeline
- **201:** the created `PipelineStage`
- **404:** if the named `pipelineId` doesn't exist

### PATCH /settings/pipelines/stages/:id
- **Auth:** required (`settings:update` — ADMIN only)
- **Body:** any of `name`, `probability`, `color`, `position` (all optional)
- **Position swap:** if `position` changes, the backend swaps with
  whatever stage is currently at the target position so the DB
  `@@unique([pipelineId, position])` constraint never blocks the call
- **200:** the updated `PipelineStage`
- **404:** if the stage doesn't exist

### DELETE /settings/pipelines/stages/:id
- **Auth:** required (`settings:update` — ADMIN only)
- **200:** `{ "ok": true }`
- **409:** if any deal is currently on this stage:
  ```json
  {
    "error": "Stage has active deals",
    "dealCount": 2,
    "message": "Stage \"Proposal\" has 2 active deal(s). Reassign them to another stage before deleting."
  }
  ```
- **404:** if the stage doesn't exist

---

## Settings — Tax Rate (Day 14.7)

Global default tax rate (percent, 0–100) applied to NEW quotations.
Existing quotations keep their per-row `taxRate` snapshot — editing
this value does NOT retroactively rewrite history (Plan option A, see
`docs/retros/2026-06-07-system-settings.md`).

The Quotation builder reads GET at open time to prefill the tax input;
sales can still override per-quote.

### GET /settings/retention-policy
- **Auth:** `audit:read`
- **200:** `{ defaultRetentionDays: number, sensitiveRetentionDays: number, sensitiveActions: AuditAction[] }` (matches the constants in `apps/api/src/scripts/audit-log-prune.ts` per ADR-0014).

### GET /settings/tax
- **Auth:** required (any logged-in user — SALES / VIEWER can read so
  the quotation builder can prefill; we deliberately do NOT require
  `settings:read` here)
- **200:**
  ```json
  {
    "key": "default_tax_rate",
    "rate": 13,
    "description": "Default tax rate (%) applied to NEW quotations. Per-quotation override available; existing quotations keep their snapshot.",
    "updatedAt": "2026-06-07T11:40:00.000Z",
    "updatedBy": { "id": "u_…", "name": "Admin User", "email": "admin@crm.local" }
  }
  ```
- **Graceful degradation:** if the `SystemConfig` row is missing (seed
  hasn't run / row was deleted), the response returns `rate: 0` with
  `updatedAt: null` and `updatedBy: null` — NOT a 404. The frontend
  renders `0%` and the admin can save to create the row.
- **Storage:** `SystemConfig.value` is a `Json` Prisma column. The
  backend coerces the stored JSON number to a native `number` on read;
  clients never see the raw JSON shape.

### PUT /settings/tax
- **Auth:** required (`settings:update` — ADMIN only)
- **Body:**
  ```json
  { "rate": 13 }
  ```
  - `rate` must be a number in `[0, 100]`. Zod validates; anything else
    returns 422.
- **Upsert:** writes a single row keyed `key = 'default_tax_rate'`.
  Sets `value: rate`, `updatedById: <actor>`, refreshes `updatedAt`.
  On the first save, the `description` column is populated with the
  human-readable explanation.
- **Audit:** every successful PUT emits one `SYSTEM_CONFIG_UPDATED`
  row with:
  ```json
  {
    "action": "SYSTEM_CONFIG_UPDATED",
    "resourceType": "system_config",
    "resourceId": "default_tax_rate",
    "description": "Updated default tax rate: 6% → 13%",
    "metadata": { "key": "default_tax_rate", "oldValue": 6, "newValue": 13 }
  }
  ```
  This row is reachable from the Settings → Tax tab's "View audit log"
  link, which deep-links to `/settings/audit?action=SYSTEM_CONFIG_UPDATED`.
- **200:** the full `TaxConfig` row (same shape as GET).
- **422:** if `rate` is missing, non-numeric, or outside `[0, 100]`.
- **Used by:** Settings → Tax tab (`SettingsTaxPage`), SettingsLayout
  (for cross-link to audit), Quotation builder (mount-time prefill).

---

## Settings — Currency (Day 19)

Live exchange rates used as the source for `Quotation.{exchangeRate,
total}` snapshots. The admin sets `cny_to_hkd` + `hkd_to_mop` once;
subsequent Quotation creations snapshot the current rate. See
[`0017-multi-currency-snapshot.md`](./architecture/0017-multi-currency-snapshot.md)
for the snapshot semantics.

### GET /settings/currency
- **Auth:** `settings:read` (ADMIN by default; SALES reads too for the Quotation builder's HKD preview)
- **200:**
  ```json
  {
    "cny_to_hkd": 1.08,
    "hkd_to_mop": 1.16,
    "updatedAt": "2026-06-29T10:00:00.000Z",
    "updatedById": "user_…"
  }
  ```

### PUT /settings/currency
- **Auth:** `settings:update` (ADMIN only)
- **Body:** `{ cny_to_hkd: number, hkd_to_mop: number }` — both required, both must be `> 0`.
- **200:** Same shape as GET.
- **422:** if either rate is `<= 0`, `NaN`, or missing.
- **Side effect:** Only affects NEW Quotation snapshots. Existing quotations
  retain their captured rate per the ADR-0017 invariant.
- **Audit log:** `SYSTEM_CONFIG_UPDATED` with metadata `{ key, oldValue, newValue }`
  per rate key.

---

## Error codes

| Status | When |
|--------|------|
| 400 | Malformed body, missing required field |
| 401 | Missing / invalid / expired token |
| 403 | Authenticated but missing required permission |
| 404 | Resource not found OR not visible to caller (we don't distinguish) |
| 409 | Unique constraint violation (e.g. duplicate email) |
| 422 | Validation failed (e.g. invalid URL) |
| 429 | Rate limited (not yet implemented) |
| 500 | Server error — check server logs |
| 503 | AI Assistant not configured (RG-002/003) |
