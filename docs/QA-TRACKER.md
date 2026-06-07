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
| C1 | Chat UI + FAB | ✅ PASS | P0 | Day 10 | FAB hides on /ai, hover label works |
| C2 | Read tools (×7) | ✅ PASS | P0 | Day 10 | 7 read tools verified; 6-iter loop cap prevents runaway |
| C3 | Write tools (×3) | 🟨 PARTIAL | P1 | Day 10 | Tools work but no "AI proposes, human confirms" guardrail yet (US-C5) |
| C4 | DB-driven config | ✅ PASS | P0 | **Day 10 + RG-002 fix** | Pre-check 503 (no env fallback). See RG-002 |

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

## Open follow-ups (post-ship)

| Item | Why | Owner |
|------|-----|-------|
| US-C5 "AI proposes, human confirms" guardrail | Day 10 ships full CRUD by design but humans should confirm dangerous ops | Next sprint |
| US-C6 Token-cost dashboard | We already store `promptTokens` / `completionTokens` per message | Next sprint |
| US-C7 Streaming responses | Currently batched on full completion | Next sprint |
| Test framework | TEST-COVERAGE has too many 🟨 rows | Sprint N+1 |
| E2E suite (Playwright) | 1 critical regression (RG-001) would have been caught | Sprint N+1 |
