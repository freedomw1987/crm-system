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
| A3 | Quotation builder + GP% | 🟨 PARTIAL | P0 | Day 9 | GP% formula correct but not unit-tested (TEST-COVERAGE) |

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

## Open follow-ups (post-ship)

| Item | Why | Owner |
|------|-----|-------|
| US-C5 "AI proposes, human confirms" guardrail | Day 10 ships full CRUD by design but humans should confirm dangerous ops | Next sprint |
| US-C6 Token-cost dashboard | We already store `promptTokens` / `completionTokens` per message | Next sprint |
| US-C8 Multi-language | Currently 繁中 only | Future |
| Test framework | TEST-COVERAGE has too many 🟨 rows | Sprint N+1 |
| E2E suite (Playwright) | 1 critical regression (RG-001) would have been caught | Sprint N+1 |
