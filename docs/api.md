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

### GET /deals/:id

### PATCH /deals/:id

### DELETE /deals/:id

### POST /deals/:id/activities
- **Auth:** `activity:create` (or via AI tool)
- **Body:** `{ type: "NOTE"|"CALL"|..., content, subject? }`

## Quotations

### GET /quotations
- **Auth:** `quotation:read`

### POST /quotations

### GET /quotations/:id

### PATCH /quotations/:id

### DELETE /quotations/:id

## Products

### GET /products
- **Auth:** `product:read`
- **Query:** `?query=&category=&status=ACTIVE&limit=`

### POST /products
- **Auth:** `product:create`

## Services

### GET /services
- **Auth:** `service:read`

### POST /services
- **Body:** `{ name, type: "catalogue"|"custom", description?, manDayLines: ServiceManDay[] }`

## Man-Day Roles

### GET /man-day-roles
- **Auth:** `man-day-role:read`

### POST /man-day-roles
- **Auth:** `man-day-role:create`

## Activity

### GET /activities
- **Auth:** `activity:read`
- **Query:** `?companyId=&dealId=&authorId=&since=&limit=`
- **200:** `Activity[]`

### GET /activities/recent
- **Auth:** `activity:read`
- **Query:** `?authorId=&since=&limit=50` (added Day 9+ for Kanban panel)
- **200:** `Activity[]`

### POST /activities
- **Auth:** `activity:create`

## Attachments

### GET /attachments?companyId=
- **Auth:** `attachment:read`

### POST /attachments/upload
- **Auth:** `attachment:create`
- **Body:** `multipart/form-data` with `file` + `companyId`
- **201:** `Attachment`

### GET /attachments/:id/download
- **200:** binary stream with `Content-Disposition: attachment; filename=…`

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
