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
- **Status:** ✅ Shipped (Day 10)
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
  - [ ] Tool calls are visible in the message stream (collapsible)
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
| US-C5 | "AI proposes, human confirms" mutation guardrail | Block dangerous tool calls behind a confirm dialog |
| US-C6 | Token-cost dashboard per user | Read from `ConversationMessage.promptTokens` / `completionTokens` |
| US-C7 | Streaming responses (SSE) | Currently batched on full completion |
| US-C8 | AI Assistant multi-language | Currently 繁中 only |
| US-C9 | Schedule send for quotations | Cron-backed send later |
| US-C10 | Mobile app (React Native) | Web is responsive but not native |

---

## Change log

| Date | Change | Why |
|------|--------|-----|
| 2026-06-09 | Day 10 US-B4 / B5 / C1-C4 added | AI Assistant ship |
| 2026-06-09 | US-C4 acceptance clarified | RG-002 fix: env-var check removed |
| 2026-06-07 | Day 9 US-A1-A3 / B1-B3 closed | SOW + GP ship |
| 2026-06-04 | Day 7 US-B2 added | Custom roles ship |
