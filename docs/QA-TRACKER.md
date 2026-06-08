# QA Tracker

> Single source of truth for "is this US done?" Status icons match PRD.md.
> Update this file the moment a US changes scope, gets fixed, or regresses
> (per red-line 11: "改 PRD 嘅同時必須更新 QA-TRACKER").

---

## Status legend

- ✅ **PASS** — shipped, manual smoke green, no known regressions
- 🟨 **PARTIAL** — shipped with known gaps (see "Gaps" column)
- ⬜ **PENDING** — not started
- 🟪 **DEPRECATED** — replaced by another US or removed
- 🔴 **REGRESSED** — was PASS, now broken (file an RG- entry)

---

## Epic A — Sales operations

| US | Title | Status | Priority | Owner | Gaps / Notes |
|----|-------|--------|----------|-------|--------------|
| A1 | Companies CRUD | ✅ PASS | P0 | Day 1-5 | — |
| A2 | Deal Kanban | ✅ PASS | P0 | Day 8 | Drag-drop test done |
| A3 | Quotation builder + GP% | ✅ PASS | P0 | **Day 17 (this batch)** | GP% formula pinned by 14 unit tests in `apps/api/src/__tests__/quotation-gp.test.ts` (extracted to `lib/quotation-gp.ts` for testability). See **RG-2026-06-08-A3**. |
| A4 | Deal Autocomplete + Quick-Create in QuotationBuilder | ✅ PASS | P0 | 2026-06-07 | RG-2026-06-07-DEAL-AUTOCOMPLETE — backend validation 10/10 PASS, frontend `DealAutocomplete` + `DealDialog` pre-fill (+90d close date) shipped |
| A5 | Quotation 5-worksheet Excel download (bc-quotation parity) | 🟨 PARTIAL | P1 | 2026-06-07 | Endpoint + adapter + 5 worksheet helpers ported; Excel generated from real DB data (Q-2026-0001 = 36KB, 3 sheets). Gaps: 8 BoardPro-only fields (`notice/sow/assumption/sector/isOptional/isIncluded/salesCost/barcoSaleCost`) hard-coded to 0/"" — see US-A6 to fill. Unit test for crm-adapter passes; integration test for endpoint + frontend smoke pending. |

## Epic B — Admin

| US | Title | Status | Priority | Owner | Gaps / Notes |
|----|-------|--------|----------|-------|--------------|
| B1 | Users + roles | ✅ PASS | P0 | Day 1-5 | — |
| B2 | Custom roles editor | ✅ PASS | P1 | Day 7 | System role protection verified |
| B3 | Man-day role catalogue | ✅ PASS | P1 | Day 9 | — |
| B4 | AI Config page | ✅ PASS | P0 | Day 10 | Encryption round-trip verified; status endpoint accessible to all users |
| B5 | AI Config audit | ✅ PASS | P1 | Day 10 | AI_CONFIG_UPDATED logged, no plaintext key ever |

## Epic C — AI Assistant (Day 10)

| US | Title | Status | Priority | Owner | Gaps / Notes |
|----|-------|--------|----------|-------|--------------|
| C1 | Chat UI + FAB | ✅ PASS | P0 | Day 10 | FAB hides on /ai, hover label works. **Day 10.1:** streaming + inline tool pill |
| C2 | Read tools (×7) | ✅ PASS | P0 | Day 10 | 7 read tools verified; 6-iter loop cap prevents runaway |
| C3 | Write tools (×3) | 🟨 PARTIAL | P1 | Day 10 | Tools work but no "AI proposes, human confirms" guardrail yet (US-C5) |
| C4 | DB-driven config | ✅ PASS | P0 | **Day 10 + RG-002 fix** | Pre-check 503 (no env fallback). See RG-002 |
| C5 | "AI proposes, human confirms" guardrail | ✅ PASS (backend) / 🟨 PARTIAL (frontend dialog) | P0 | **Day 17 (this batch)** | Backend complete: registry `requiresConfirmation` flag on 3 write tools (`draftQuotation`, `updateDealStage`, `logActivity`) + `runAgentStream` intercepts + `confirmation_required` SSE event + `AI_TOOL_CONFIRMED` / `AI_TOOL_DENIED` audit logging via stable `hashArgs()`. Pinned by 13 unit tests in `packages/ai/src/__tests__/confirm.test.ts`. **Frontend gap:** Radix Dialog with diff preview and Confirm/Cancel buttons not yet wired — `confirmation_required` SSE events are ignored client-side, so user experience today is the LLM's auto-deny explanation. Punted to Day 18+ frontend batch. See **RG-CHAT-002**. |
| C7 | Streaming responses (SSE) | ✅ PASS | P0 | **Day 10.1 (this batch)** | Token-by-token + tool pills. See RG-005 |

## Epic D — Mobile

| US | Title | Status | Priority | Owner | Gaps / Notes |
|----|-------|--------|----------|-------|--------------|
| D1 | RWD across pages | ✅ PASS | P1 | Day 6+ | iOS Safari URL bar overlap mitigated |

---

## Day 10 batch — AI Assistant (this commit series)

| Item | Type | Status | Linked RG | Commit |
|------|------|--------|-----------|--------|
| `AiConfig` schema (singleton, encrypted key) | DB migration | ✅ | — | `day10_ai_config` migration |
| `Conversation` + `ConversationMessage` schema | DB migration | ✅ | — | `day10_ai_config` migration |
| `AI_CONFIG_UPDATED` audit action | DB enum | ✅ | — | `day10_ai_config` migration |
| `packages/ai` (runAgent, tools, encryption, prompts) | New package | ✅ | — | Day 10 |
| `aiConfigRoutes` (status / get / put / test) | Backend | ✅ | — | Day 10 |
| `chatRoutes` (conversations list/get/send/delete) | Backend | ✅ | — | Day 10 |
| `ai-config.tsx` admin page | Frontend | ✅ | — | Day 10 |
| `ai-chat.tsx` chat page | Frontend | ✅ | — | Day 10 |
| `AiFab` floating button | Frontend | ✅ | — | Day 10 |
| 11 tool registry | Backend | ✅ | — | Day 10 |
| `ai-config:read` + `ai-config:update` permissions | RBAC | ✅ PASS | **RG-002** | This batch (DB INSERT) |
| `chat.ts` env-var removal | Bug fix | ✅ PASS | **RG-002** | This batch |
| `chat.ts` `AiNotConfiguredError` → 503 translation | Bug fix | ✅ PASS | **RG-003** | This batch |
| Audit log description includes what changed | UX | ✅ | — | Day 10 |

---

## Day 10 smoke test results (this batch)

| Endpoint | Expected | Actual | Result |
|----------|----------|--------|--------|
| `GET /api/ai/config/status` (admin) | 200 `{configured:false}` | 200 `{configured:false}` | ✅ |
| `GET /api/ai/config` (admin) | 200 with empty defaults | 200 with empty defaults | ✅ (after RG-002 perm fix) |
| `PUT /api/ai/config` (admin) | 200 + audit log | 200 + audit log | ✅ |
| `GET /api/ai/config` (after save) | 200 with masked key `sk-...2345` | 200 with masked key | ✅ |
| `POST /api/chat/send` (no config) | 503 with helpful message | 503 with helpful message | ✅ (after RG-002/003 fix) |
| `POST /api/chat/send` (config + mock key) | 500 from OpenAI 401 | 500 with OpenAI 401 error | ✅ (proves LLM was called) |

---

## Day 10.1 batch — Streaming + tool pill UX (this commit)

| Item | Type | Status | Linked RG | Commit |
|------|------|--------|-----------|--------|
| `runAgentStream` (async generator) — streaming agent loop | Backend | ✅ | — | This batch |
| `/chat/send` SSE response (text/event-stream) | Backend | ✅ | **RG-005** | This batch |
| `chatApi.send` returns Promise<{conversationId}> via callback | Frontend | ✅ | — | This batch |
| `MessageBubble` tool branch → inline pill (no max-w, no bot icon) | Frontend | ✅ | **RG-005** | This batch |
| `ToolPill` component (in-flight state: pulse + "執行中" / ok / failed) | Frontend | ✅ | — | This batch |
| `StreamingBotMessage` (single bot-anchored bubble with pills above) | Frontend | ✅ | — | This batch |
| `quotations.tsx` AI draft — collect `draft_quotation` from tool_end event | Frontend | ✅ | — | This batch |
| `Cache-Control: no-cache, no-transform` + `X-Accel-Buffering: no` headers | Backend | ✅ | — | This batch |
| PRD US-C1 acceptance: streaming + tool pill bullets | Doc | ✅ | — | This batch |
| PRD US-C7 (new) — SSE protocol acceptance | Doc | ✅ | — | This batch |
| `docs/REGRESSION-GUARD.md` RG-005 | Doc | ✅ | — | This batch |

---

## Day 10.1 smoke test results (this batch)

| Check | Expected | Actual | Result |
|--------|----------|--------|--------|
| `Content-Type: text/event-stream` | yes | `text/event-stream; charset=utf-8` | ✅ |
| `transfer-encoding: chunked` | yes | yes | ✅ |
| Token events fire one per chunk | yes | e.g. `1`, `\n`, `2`, `\n`, `3` for "count 1 to 3" | ✅ |
| `tool_start` event before tool executes | yes | yes | ✅ |
| `tool_end` event after tool completes | yes | yes | ✅ |
| `done` event with usage stats | yes | yes (prompt/completion/total tokens) | ✅ |
| Browser: tool pills render as inline (no max-w) | yes | yes (screenshot verified) | ✅ |
| Browser: streaming cursor blinks in bot bubble | yes | yes (`animate-pulse` cursor) | ✅ |
| Browser: 0 console errors | yes | 0 errors, 0 warnings | ✅ |

### Day 11 Phase 1 — Settings + Pipeline CRUD + AI `list_pipelines`

#### US-S2 backend smoke

| Check | Required | Actual | Result |
|--------|----------|--------|--------|
| `GET /settings/pipelines` returns 1 default pipeline + 6 stages | yes | yes (Lead/Qualified/Proposal/Negotiation/Won/Lost) | ✅ |
| Each stage has `_count.deals` (Proposal=2, Negotiation=1, others=0) | yes | yes | ✅ |
| `POST /settings/pipelines/stages` creates stage at `max+1` position | yes | yes (pos=7) | ✅ |
| `PATCH /settings/pipelines/stages/:id` updates name + probability | yes | yes (renamed, prob=45) | ✅ |
| `PATCH .../position=0` swaps with the stage at pos=0 (Lead) | yes | yes (Lead dropped to pos=1) | ✅ |
| `DELETE` of empty stage returns `{ok: true}` | yes | yes | ✅ |
| `DELETE` of stage with 2 deals returns 409 + `dealCount` | yes | yes (409, dealCount=2, message set) | ✅ |
| Audit log rows for CREATE/UPDATE/DELETE | yes | yes (logEvent fires on every mutation) | ✅ |

#### US-S3 AI tool smoke
| Check | Required | Actual | Result |
|--------|----------|--------|--------|
| `list_pipelines` tool registered | yes | yes (in `toolRegistry`) | ✅ |
| Tool returns `{id, name, isDefault, stages[]}` | yes | yes (1 pipeline, 6 stages) | ✅ |
| Empty-string `pipelineId` treated as no filter | yes | yes (tool sent `pipelineId:''`, returned all 6 stages) | ✅ |
| System prompt mentions `list_pipelines` | yes | yes (Day 11 line added) | ✅ |
| Live chat: "What stages does our sales pipeline have?" → tool fires | yes | yes (TOOL_START `list_pipelines` + TOOL_END with 6 stages) | ✅ |

### Day 14.7 — System Settings refactor (sub-route tabs) + Tax Rate (US-S4)

#### US-S4 status change

| US | Title | Status before | Status now | Notes |
|----|-------|---------------|------------|-------|
| **US-S4** | Phase 2: Tax rate tab on Settings | 🟨 BACKLOG | ✅ PASS | `system_configs` table seeded, `default_tax_rate` row created via admin save, GET/PUT 200, Quotation prefill works (smoke verified 13% prefill on create-dialog open) |

#### Day 14.7 commit series

| Commit | Title | What it changed |
|--------|-------|-----------------|
| `603745e` | feat(db): Day 14 SystemConfig table + SYSTEM_CONFIG_UPDATED audit action | Prisma migration + enum |
| `818c29f` | feat(rbac): Day 14 settings:read / settings:update + seed Role/RolePermission rows | DB seed inserts missing rows (latent RBAC fix) |
| `6a39ab6` | feat(api): Day 14 /api/settings/tax GET + PUT (admin) with SYSTEM_CONFIG_UPDATED audit | Routes + Zod + audit hook |
| `eb1581f` | feat(web): Day 14.7 Step 5 — /settings sub-route tree + settingsApi.getTax/putTax | React Router tree + API client (initially had wire-shape drift, see §1 of retro) |
| `72e13a2` | feat(web): Day 14.7 Step 6 — SettingsLayout 7-tab nav (shadcn Tabs) | Tabs wrapper + 7-tab nav, URL = source of truth |
| `bd1d107` | feat(web): Day 14.7 Step 7 — Tax Rate settings page + **wire fix** | SettingsTaxPage + corrected `rate` field name |
| `8161cbd` | feat(web): Day 14.7 Step 8 — wire all 5 admin tabs + backward-compat redirects | 5 placeholders → real pages, 5 `<Navigate>` backward-compat routes |
| `9bc8695` | feat(web): Day 14.7 Step 9 — QuotationBuilder auto-prefills tax from system default | `userTouchedTax` race-safe prefill |
| `6146aea` | feat(web): Day 14.7 Step 10 — collapse 5 admin links into single 系統設置 entry | Sidebar cleanup |
| `5018578` | fix(web): Day 14.7 Step 12 — Tax 'View audit log' link uses /settings/audit (not legacy /audit) | 1-line fix for query-string drop across `<Navigate>` |

#### Day 14.7 E2E smoke (this batch, via Playwright browser_navigate)

| Check | Required | Actual | Result |
|-------|----------|--------|--------|
| `GET /api/health` (via nginx proxy) | 200 | 200 | ✅ |
| Login as `admin@crm.local` | 200 + token | 200 + token | ✅ |
| Navigate to `/settings` | auto-redirect to `/settings/pipelines` | `/settings/pipelines`, Pipelines tab active | ✅ |
| Sidebar shows 1 admin entry "系統設置" (not 5) | yes | yes | ✅ Step 10 |
| All 7 tabs render (Pipelines/Users/Roles/AI/Man-day/Tax/Audit) | yes | yes — all 7 render real page content, active tab highlight correct | ✅ Step 6/8 |
| Tax save: 6 → 13 | PUT 200 + audit row | 200 + `SYSTEM_CONFIG_UPDATED` row with `oldValue:6 newValue:13` | ✅ Step 7 |
| Quotation create-dialog opens with taxRate prefilled to 13 | yes | yes (system default applied via Step 9) | ✅ Step 9 |
| Tax "View audit log" deep link | `/settings/audit?action=SYSTEM_CONFIG_UPDATED` | lands with table filtered to SYSTEM_CONFIG_UPDATED rows only | ✅ Step 12 fix |
| 5 backward-compat redirects: `/users` `/roles` `/audit` `/ai-config` `/man-day-roles` | each navigates to the matching sub-route | all 5 land on correct sub-route with right tab active | ✅ Step 8 |
| `tsc --noEmit` (web) | 0 errors | 0 errors (across Steps 5-10) | ✅ |
| `docker compose build web` | builds with new SPA bundle | built, `index-am9hO3Fd.js` 589 KB | ✅ |

## Open follow-ups (post-ship)

| Item | Why | Owner |
|------|-----|-------|
| US-C5 "AI proposes, human confirms" guardrail | Day 10 ships full CRUD by design but humans should confirm dangerous ops | Next sprint |
| US-C6 Token-cost dashboard | We already store `promptTokens` / `completionTokens` per message | Next sprint |
| US-C8 Multi-language | Currently 繁中 only | Future |
| Test framework | TEST-COVERAGE has too many 🟨 rows | Sprint N+1 |
| E2E suite (Playwright) | 1 critical regression (RG-001) would have been caught | Sprint N+1 |
