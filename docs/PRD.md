# CRM System — Product Requirements Document

> **Status legend:** ⬜ Pending · 🟨 In progress · ✅ Shipped · 🟥 Blocked · 🟪 Deprecated
> **Priority legend:** P0 = must-have · P1 = should-have · P2 = nice-to-have

---

## Epic A — Sales operations

### US-A1: Sales rep can manage customer companies
- **Status:** ✅ Shipped (Day 1-5)
- **Priority:** P0
- **As a** sales rep, **I want to** create / edit / search customer companies
  with contacts, addresses, and notes **so that** I have a single source of
  truth for the accounts I'm working.
- **Acceptance:**
  - [ ] Company list page (`/companies`) loads in < 500 ms
  - [ ] Free-text search matches name, legal name, email
  - [ ] Filter by industry and status
  - [ ] Inline edit dialog updates fields without page reload
  - [ ] Company detail page shows recent deals + quotations + activities

### US-A2: Sales rep can track deals in a Kanban pipeline
- **Status:** ✅ Shipped (Day 8)
- **Priority:** P0
- **Acceptance:**
  - [ ] Drag-drop between stages persists
  - [ ] Edit dialog shows correct stage (no stale data)
  - [ ] Each stage shows count + total value
  - [ ] Filter by owner

### US-A3: Sales rep can draft and send quotations
- **Status:** ✅ Shipped (Day 5-9)
- **Priority:** P0
- **Acceptance:**
  - [ ] Quotation builder supports products (SKU) and services (man-day roles)
  - [ ] Live GP% preview (Day 9)
  - [ ] Status flow: DRAFT → SENT → VIEWED → ACCEPTED / REJECTED → INVOICED
  - [ ] Print-ready PDF

### US-A5: Sales rep can download a Quotation as a 5-worksheet Excel file
- **Status:** 🟨 PARTIAL (shipped with known content gaps — see Gaps)
- **Priority:** P1
- **Date added:** 2026-06-07
- **As a** sales rep, **I want to** download a Quotation as a 5-worksheet
  .xlsx (Quotation / SOW Details / Assumption / MA Details / Server Requirements)
  in the same format Barco's legacy `bc-quotation` system produced, **so that**
  I can re-send a polished Excel to the customer without leaving the CRM.
- **Acceptance:**
  - [x] `GET /api/quotations/:id/export-xlsx?lang=zh&version=v2` returns a
        valid `.xlsx` file (Content-Type
        `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
        Content-Disposition `attachment; filename="<quotation.number>.xlsx"`).
  - [x] Workbook contains all 5 worksheets (Quotation / SOW Details /
        Assumption / MA Details / Server Requirements) in the same layout as
        `bc-quotation` (1:1 port of `src/helpers/*_worksheet.ts`).
  - [x] Quotation-detail page has a "⬇️ 下載 Excel" button next to "列印",
        available for **all** statuses (DRAFT / SENT / ACCEPTED / REJECTED /
        EXPIRED / INVOICED).
  - [x] Audit-log entry `QUOTATION_EXPORTED_XLSX` written for each download
        (best-effort, does not block the response).
  - [x] Authentication required: any user who can `GET /:id` can download
        (read-scope matches existing GET /:id).
  - [ ] **GAPS (carried over to US-A6, see Notes):**
        CRM `QuotationItem` is missing the `notice / sow / assumption / sector /
        isOptional / isIncluded / salesCost / barcoSaleCost` fields that the
        bc-quotation format expects. Adapter hard-codes these to `""` / `0`
        for now. US-A6 will add the missing schema fields and re-derive them
        from `Product` / `QuotationItem` so the Excel content is fully
        populated.
- **Implementation notes:**
  - Ported source from `~/www/bc-quotation/src/{quotation.ts, helpers/*_worksheet.ts,
    constants/worksheet_field.ts}` into `apps/api/src/lib/excel/`.
  - 3 xlsx templates (`ma_sow.xlsx`, `terraMind_server.xlsx`, `OCDP_server.xlsx`)
    copied into `apps/api/src/lib/excel/assets/`.
  - `ma_worksheet.ts` / `server_worksheet.ts` use `import.meta.url` to resolve
    the assets directory at runtime (bc-quotation used `path.resolve("assets/...")`
    which assumed cwd was project root — broken in Docker / Elysia).
  - New `crm-adapter.ts` flattens Prisma's `Quotation + items[].product/service +
    company.region + createdBy` into the shape that bc-quotation's 5 worksheet
    helpers consume. Region label maps CRM `Region.code` to the bc-quotation
    strings (`"HK 香港"` / `"MO 澳門"` / `"CN 中國"` / `"OTHER 其他"`).
  - Sales-cost derivation: PRODUCT → `product.costPrice`; SERVICE →
    `costSnapshot / qty` (per-man-day) + `costSnapshot` (line subtotal),
    matching the bc-quotation `sales_cost` vs `sales_cost_subtotal` semantics.
  - `Region` is queried via `prisma.company.findUnique({ include: { region: true } })`
    to handle multi-currency correctly. Falls back to `"OTHER 其他"` for
    companies without a region FK.
  - Frontend `quotationsApi.downloadExcel()` uses raw `fetch` (the standard
    `request<T>` helper hard-codes `application/json` Content-Type which is
    wrong for binary downloads). Triggers a browser download dialog via
    `URL.createObjectURL(blob)` + temporary `<a download>` click.
- **Risk / known limitations:**
  - 1 unit test written for the adapter; integration test for the endpoint
    pending — must run with a real DB to exercise the audit log + RBAC path.
  - The MA Details / Server Requirements worksheets are still loaded from
    the 3 template xlsx files; the templates are not under version control
    diff (binary), so any layout change to those sheets requires a manual
    re-export from the original `bc-quotation` repo.

## Epic B — Admin operations

### US-B1: Admin can manage users and roles
- **Status:** ✅ Shipped (Day 1-5)
- **Priority:** P0
- **Acceptance:**
  - [ ] Create / edit / deactivate users
  - [ ] Reset password
  - [ ] Assign role to user
  - [ ] Audit log shows every action

### US-B2: Admin can define custom roles
- **Status:** ✅ Shipped (Day 7)
- **Priority:** P1
- **Acceptance:**
  - [ ] Role editor dialog with permission checkboxes
  - [ ] System roles (ADMIN/SALES/MANAGER/VIEWER) cannot be edited
  - [ ] Custom roles can be edited / deleted
  - [ ] Permission changes take effect on next request (no cache poisoning)

### US-B3: Admin can manage man-day role pricing catalogue
- **Status:** ✅ Shipped (Day 9)
- **Priority:** P1
- **Acceptance:**
  - [ ] `/man-day-roles` (admin nav) — list + create + edit + delete
  - [ ] Sales reps pick from catalogue via dropdown in Service form
  - [ ] Renaming a role does not break existing service snapshots

### US-B4: Admin can configure the AI Assistant
- **Status:** ✅ Shipped (Day 10)
- **Priority:** P0
- **As an** admin, **I want to** set the LLM endpoint URL, API key, and model
  name **so that** the AI Assistant can talk to whichever OpenAI-compatible
  provider I want (OpenAI, Anthropic-via-proxy, OpenRouter, vLLM, Ollama).
- **Acceptance:**
  - [ ] `/admin/ai-config` page (admin only) with 4 fields: endpointUrl,
        apiKey (password input, never pre-filled), modelName, systemPrompt
  - [ ] API key is stored AES-256-GCM encrypted at rest
  - [ ] API key is NEVER returned in plaintext (only masked: `sk-...1234`)
  - [ ] On PUT, must always re-enter the API key (defence in depth)
  - [ ] Every config change is written to the audit log
  - [ ] A `POST /ai/config/test` endpoint probes the LLM with a 1-token call
  - [ ] `GET /ai/config/status` returns `configured: false` to any
        authenticated user (so the chat page can show a setup banner)

### US-B5: Admin can see AI Assistant audit trail
- **Status:** ✅ Shipped (Day 10)
- **Priority:** P1
- **Acceptance:**
  - [ ] Every AI config change is logged with `AI_CONFIG_UPDATED`
  - [ ] Description includes what changed (endpoint / model / key rotation)
  - [ ] No API key plaintext ever appears in the audit log

## Epic C — AI Assistant (Day 10)

### US-C1: Any user can chat with the AI Assistant
- **Status:** ✅ Shipped (Day 10, **streaming + tool pill UX upgraded Day 10.1**)
- **Priority:** P0
- **As any** user with a valid session, **I want to** open the AI Assistant
  from anywhere in the app **so that** I can ask natural-language questions
  about my CRM data and have it perform writes on my behalf.
- **Acceptance:**
  - [ ] Floating Action Button (FAB) visible on every page (bottom-right)
  - [ ] FAB hides on `/ai` route to avoid covering the chat composer
  - [ ] `/ai` page has a 2-pane layout: conversation list (left) + active chat (right)
  - [ ] New conversation button creates a fresh `Conversation` row
  - [ ] Send button POSTs to `/chat/send` with `{ message, conversationId? }`
  - [ ] **Streaming (Day 10.1):** Server returns `text/event-stream` with
        one frame per LLM token; the UI renders the assistant's reply
        token-by-token as the LLM produces it (no waiting for full
        completion). The cursor blinks in the streaming bubble.
  - [ ] **Tool call inline pill (Day 10.1):** Tool invocations are
        displayed as small inline pills above the assistant's reply
        (NOT as separate message bubbles). Each pill shows the tool
        name, a "running" / "ok" / "failed" status, and a caret to
        expand args + result JSON.
  - [ ] **Tool pill animation (Day 10.1):** While the tool is running
        the pill is bordered in brand colour and pulses; once complete
        it dims to muted-foreground.
  - [ ] Conversation list shows last 50, sorted by `updatedAt desc`
  - [ ] Delete button removes a conversation (with confirm)

### US-C2: AI Assistant can read CRM data via tool calling
- **Status:** ✅ Shipped (Day 10)
- **Priority:** P0
- **Acceptance:**
  - [ ] Agent has access to 7 read tools (search/get/list/top_customers ×
        companies, products, services, quotations, deals)
  - [ ] LLM can chain multiple tool calls in one turn (up to 6 iterations)
  - [ ] Tool errors are returned to the LLM as `{ error: ... }` so it can
        try a different approach (graceful degradation)

### US-C3: AI Assistant can write CRM data via tool calling
- **Status:** ✅ Shipped (Day 10, FULL CRUD per David's Q2=C)
- **Priority:** P1 (full CRUD was the explicit Q2 answer)
- **Acceptance:**
  - [ ] `draft_quotation` creates a DRAFT quotation with line items +
        auto-generated `Q-YYYY-NNNN` number
  - [ ] `log_activity` creates an activity log entry attached to a
        company/contact/deal
  - [ ] `update_deal_stage` moves a deal between kanban columns + writes
        an Activity for audit trail
  - [ ] All three writes use `ctx.userId` as the actor (the user who
        initiated the chat, not the admin who set up the AI)

### US-C4: AI Assistant uses admin-configured LLM, never env vars
- **Status:** ✅ Shipped (Day 10, **fixed in this batch** — see RG-002)
- **Priority:** P0
- **Acceptance:**
  - [ ] `runAgent()` reads from DB `AiConfig` only (no env fallback)
  - [ ] If config missing, throw `AiNotConfiguredError`
  - [ ] Chat route pre-checks `AiConfig` and returns 503 + helpful message
        when missing (no LLM key guess from env)
  - [ ] **No LLM request is ever made using an env var**

### US-C5: "AI proposes, human confirms" mutation guardrail
- **Status:** 🟨 PARTIAL (Day 10 wrote a note; shipped in Day 17 with
  RG-CHAT-002)
- **Priority:** P0 (David: AI should never silently mutate CRM data)
- **Risk class:** HIGH — once AI can `create_quotation`,
  `update_deal_stage`, or `log_activity`, a hallucinated tool call
  can write to the DB with no human in the loop. Day 10 shipped the
  write tools by design with a follow-up US-C5 to add the guardrail.
- **Acceptance:**
  - [ ] Each tool in the registry carries a `requiresConfirmation:
        boolean` flag (default: false). The 3 write tools
        (`create_quotation`, `update_deal_stage`, `log_activity`)
        are flagged `true`.
  - [ ] `runAgentStream` pauses BEFORE executing a confirmation-
        required tool and emits a `confirmation_required` SSE event
        with the full proposed args + a human-readable diff.
  - [ ] The frontend shows a modal (Radix Dialog) with the diff,
        [Cancel] and [Confirm & execute] buttons.
  - [ ] The user replies by sending a new SSE `confirmation_response`
        event (id matches the `confirmation_required` id).
  - [ ] If approved: tool executes normally and result feeds back
        to LLM. If denied: a synthetic `{error: "denied by user",
        denied: true}` result is fed back to the LLM so it can
        gracefully explain to the user.
  - [ ] Cancellation: if the client disconnects while waiting for
        a confirmation, the agent run is cancelled and a "user
        abandoned" sentinel is written to the conversation (so
        re-opening the conversation shows the pending state).
  - [ ] Read tools (`list_*`, `get_*`, `search_*`) NEVER trigger
        a confirmation — they're idempotent and have no side
        effects.
  - [ ] The 3 write tools NEVER bypass the guardrail — even if
        the LLM claims to be in a "trusted" path.
  - [ ] Audit log: every confirmation / denial writes an
        `AI_TOOL_CONFIRMED` / `AI_TOOL_DENIED` row with the
        user, the tool name, and a hash of the proposed args.

## Epic D — Mobile / responsive (running thread)

### US-D1: All pages are RWD-mobile compatible
- **Status:** ✅ Shipped (Day 6+)
- **Priority:** P1
- **Acceptance:**
  - [ ] Sidebar collapses to hamburger on `< lg`
  - [ ] FAB adjusts margin to avoid iOS Safari URL bar overlap
  - [ ] All forms work with virtual keyboard
  - [ ] Tables → card view on mobile

---

## Backlog (not yet scheduled)

| ID | Title | Notes |
|----|-------|-------|
| US-C6 | Token-cost dashboard per user | Read from `ConversationMessage.promptTokens` / `completionTokens` |

### US-C7: AI Assistant streams responses (SSE)
- **Status:** ✅ Shipped (Day 10.1)
- **Priority:** P0 (Day 10.1 retrofit — David feedback: agent felt unresponsive
  without streaming)
- **Acceptance:**
  - [ ] `/chat/send` returns `Content-Type: text/event-stream`
  - [ ] Each SSE frame is `data: {json}\n\n` (one event per frame)
  - [ ] Event types: `token` (LLM text delta), `tool_start`,
        `tool_end`, `done` (with usage stats), `error`
  - [ ] The LLM call uses `stream: true` + `stream_options: { include_usage: true }`
  - [ ] Tool calls execute serially within a single run; the tool
        result feeds back into the LLM for the next iteration
  - [ ] On premature client disconnect, the agent's run is cancelled
        (Node ReadableStream cancel propagates to `for await` loop)
  - [ ] `Cache-Control: no-cache, no-transform` + `X-Accel-Buffering: no`
        response headers so nginx doesn't buffer the stream

### US-S1: 系統設置 entry + Pipeline tab (Day 11 Phase 1)
- **Status:** ✅ Shipped (Day 11)
- **Priority:** P0
- **Why:** David wants admins to manage sales pipeline stages
  without DB access (positions, names, probability, color). Phase 1
  covers the page shell + Pipeline tab. Phase 2 adds the Tax rate
  tab (deferred).
- **Acceptance:**
  - [ ] New `/settings` page reachable from the admin nav (Settings
        icon, only visible to `user.role === 'ADMIN'`)
  - [ ] Page renders a "Pipeline" tab + disabled "Tax rate" tab
        (Phase 2 placeholder)
  - [ ] Pipeline tab shows the default pipeline's stages in
        `position` order, with `name` / `probability` / `color`
        editable inline
  - [ ] Each row is drag-and-drop reorderable; reorder fires
        `PATCH /settings/pipelines/stages/:id` with the new
        `position` (backend swaps with the stage currently there)
  - [ ] "Add stage" appends a new stage at the end (position =
        max + 1)
  - [ ] DELETE is blocked with a 409-style dialog when the stage
        has any active deals; otherwise a `confirm()` prompt
- **Permissions:** `settings:read` (any logged-in user) +
  `settings:update` (ADMIN only)

### US-S2: Sales pipeline config — backend (Day 11 Phase 1)
- **Status:** ✅ Shipped (Day 11)
- **Priority:** P0
- **Acceptance:**
  - [ ] `GET /settings/pipelines` returns all pipelines with their
        stages (ordered by position) and a `_count.deals` per
        stage — any logged-in user (settings:read)
  - [ ] `POST /settings/pipelines/stages` creates a stage in the
        default pipeline, auto-assigning `position = max + 1` —
        ADMIN only (settings:update)
  - [ ] `PATCH /settings/pipelines/stages/:id` updates
        name/probability/color/position — ADMIN only
  - [ ] `DELETE /settings/pipelines/stages/:id` returns 409 with
        `dealCount` if any deal is currently on the stage
  - [ ] All mutations write a row to `audit_logs` with action
        `CREATE` / `UPDATE` / `DELETE`

### US-S3: AI tool `list_pipelines` (Day 11 Phase 1)
- **Status:** ✅ Shipped (Day 11)
- **Priority:** P1
- **Why:** Sales reps occasionally ask the AI "what's our sales
  pipeline?" or "what stage is this deal in?". Today the AI can
  only mutate (`update_deal_stage`); it can't introspect.
- **Acceptance:**
  - [ ] New tool `list_pipelines` available in the AI agent
  - [ ] Returns `{ id, name, isDefault, stages: [{ id, name,
        position, probability, color, dealCount }] }`
  - [ ] Empty-string `pipelineId` is treated as "no filter"
        (defensive — LLMs often send `''` for optional args)
  - [ ] System prompt updated to mention the tool

## Backlog (not yet scheduled)

| ID | Title | Notes |
|----|-------|-------|
| US-S4 | Phase 2: Tax rate tab on Settings | `system_configs` table + `DEFAULT_TAX_RATE` key + Quotation create flow change |
| US-C8 | AI Assistant multi-language | Currently 繁中 only |
| US-C9 | Schedule send for quotations | Cron-backed send later |
| US-C10 | Mobile app (React Native) | Web is responsive but not native |

---

## Change log

| Date | Change | Why |
|------|--------|-----|
| 2026-06-09 | Day 11 Phase 1 US-S1 / S2 / S3 shipped | Settings page + Pipeline CRUD + AI `list_pipelines` tool |
| 2026-06-09 | Day 10.1 US-C7 streaming + tool pill UX | David feedback: agent felt unresponsive; tool calls looked like messages |
| 2026-06-09 | Day 10 US-B4 / B5 / C1-C4 added | AI Assistant ship |
| 2026-06-09 | US-C4 acceptance clarified | RG-002 fix: env-var check removed |
| 2026-06-07 | Day 9 US-A1-A3 / B1-B3 closed | SOW + GP ship |
| 2026-06-04 | Day 7 US-B2 added | Custom roles ship |
