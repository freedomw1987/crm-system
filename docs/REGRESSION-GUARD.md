# Regression Guard

> Every bug we've ever fixed. Each entry has: root cause, why it happened,
> what the **invariant** is (the rule that must hold forever), and where in
> the source the fix lives (so a future grep finds it). **A bug fix without
> an entry here is a merge that should be blocked.** (red-line 13/14)

---

## RG-001 — Service edit form silently dropped `manDayRoleId`

- **Shipped:** 2026-06-07
- **File:** `apps/web/src/pages/service-detail.tsx` line 42
- **Status:** ✅ Fixed (reverted the broken refactor that introduced it; kept
  the original code which already preserved `manDayRoleId`)

### Root cause

`useEffect` mapping `service.manDays` to local form state used
`{ role, dayRate, days }` — silently dropping `manDayRoleId`. As a result
saving a service edit disconnected it from the man-day role catalogue,
so the next time the catalogue role was renamed, this service's price
became orphaned.

### Invariant

> **Any code that maps a `Service.manDayLines` (or `manDays`) array to or
> from a wire form MUST preserve `manDayRoleId` field.** Grep for
> `manDayRoleId` in `apps/web/src/` — every component that touches
> service man-day lines must include it.

### Prevention

- Don't introduce a "shared `ManDayEditor`" component that doesn't fully
  model the `manDayRoleId` field. If you must, write a unit test that
  asserts round-trip preservation of the field. (Backlog: US-T1 regression test)

---

## RG-002 — `chat.ts` checked `OPENAI_API_KEY` env var, ignoring DB `AiConfig`

- **Shipped (bug introduced):** Day 10 initial AI chat implementation
- **Discovered:** 2026-06-09 (audit before T1-T3 doc sync)
- **File:** `apps/api/src/routes/chat.ts` line 62 (pre-fix)
- **Status:** ✅ Fixed

### Root cause

`chat.ts` was written with a defensive `if (!process.env.OPENAI_API_KEY)
return 503` check before calling `runAgent()`. The author was being
cautious ("make sure we have a key before we try to call the LLM") but
this violated the explicit design invariant in
`packages/db/prisma/schema.prisma` line 832:

> "Singleton row (id=1) storing the AI Assistant's connection to the
> external LLM provider … no env-var fallback, by design (David's T2 spec:
> 'no LLM env defaults')."

Even worse, even with the env var set, the actual `runAgent()` ignored
it and used the DB config — so the env-var check was both wrong AND
inconsistent with the actual behaviour.

### Invariant

> **`runAgent()` and the `/chat/send` route MUST use the DB `AiConfig`
> row. They MUST NEVER read `OPENAI_API_KEY` (or any LLM-related env
> var) for routing / authorization / pre-flight decisions.**

### Prevention

- `chat.ts` now does a pre-check of `prisma.aiConfig.findUnique({ where:
  { id: 1 } })` and returns 503 + helpful message if missing.
- `runAgent()` already only used DB; no change needed there.
- A regression test would be: set the DB config + unset all LLM env
  vars → chat send should still attempt to call the LLM (and fail with
  an upstream 401, not with a "key missing" error from us).
- Code comment in `chat.ts` line 62-68 explicitly calls out the
  invariant so a future reader doesn't "helpfully" add an env-var
  fallback.

---

## RG-003 — `AiNotConfiguredError` was translated to 500 instead of 503

- **Shipped (bug introduced):** Same commit as RG-002
- **Discovered:** 2026-06-09 (audit)
- **File:** `apps/api/src/routes/chat.ts` catch block (pre-fix)
- **Status:** ✅ Fixed

### Root cause

`runAgent()` exports a typed `AiNotConfiguredError` class so callers can
distinguish "AI not set up" from "LLM call failed". The chat route's
`catch (err)` block, however, was a generic `(err as Error).message`
handler that returned 500 for everything. So a user hitting the AI
Assistant when the admin hadn't configured it yet would see a scary
"Agent failed" 500 instead of a friendly "go set it up" 503.

### Invariant

> **`/chat/send` MUST return 503 (not 500) when `AiNotConfiguredError`
> is thrown. The body MUST include the message from the error class so
> the frontend can show a "go to /admin/ai-config" banner.**

### Prevention

- The fix uses `err instanceof AiNotConfiguredError` to check the type
  and translate accordingly.
- The pre-check in RG-002 means this branch is actually unreachable in
  practice (we 503 *before* calling `runAgent`), but the `instanceof`
  check is kept as defence-in-depth in case of a race (admin deletes
  the `AiConfig` row between pre-check and `runAgent`).

---

## RG-004 — ADMIN role missing `ai-config:read` and `ai-config:update` permissions

- **Shipped (bug introduced):** Day 10 (the `ai-config` routes were
  added with permission checks, but `seed.ts` / role setup did not
  grant those permissions to the `ADMIN` system role)
- **Discovered:** 2026-06-09 (audit)
- **Affected table:** `role_permissions` (had 35 rows for ADMIN, 0 for `ai-config:*`)
- **Status:** ✅ Fixed (DB INSERT)

### Root cause

When the `ai-config` routes were written, the author defined
`ai-config:read` and `ai-config:update` in `packages/shared/src/permissions.ts`
and used them in the route's `userHasPermission()` checks. But the
ADMIN role's permission set was not updated to include the new
permissions. Result: even an admin could not `GET /api/ai/config` —
it returned 403.

The 403 message itself was a clue: "Forbidden: missing permission
'ai-config:read'". A grep would have caught this earlier.

### Invariant

> **The `ADMIN` system role MUST be granted every permission defined
> in `packages/shared/src/permissions.ts`.** Any new permission added
> to the enum must be added to ADMIN's `role_permissions` rows in the
> same commit.

### Prevention

- **DB invariant check (planned)**: a startup hook that asserts
  `every(permission in PERMISSIONS, exists in role_permissions where
  roleId = ADMIN)`. If out of sync, throw on boot.
- **Migration discipline**: when adding a new permission, also add an
  `INSERT INTO role_permissions` to the same migration file.
- **Code grep**: `rg "ai-config:read|ai-config:update"
  packages/shared/src/permissions.ts` → every match should have a
  corresponding seed/INSERT. Today's audit caught this; let's not
  rely on audits forever.
- The fix here was a one-time `INSERT … ON CONFLICT DO NOTHING` against
  the live DB so no `prisma db seed` reset was required.

---

## Out-of-scope regressions (parked, not blocking ship)

- **RG-005 (planned)**: tab labels i18n drift between `company-detail.tsx`
  (繁中) and `service-detail.tsx` (English). Fixed Day 10 in the same
  batch, no formal entry needed since the fix shipped together with
  the introduction. Will be opened if a similar issue recurs.
- **RG-006 (planned)**: 401 handler on `/auth/me` did not clear localStorage
  → user sees infinite "載入中...". Fixed Day 10 in the same batch.
  Same reasoning as RG-005.

---

## RG-005 — AI chat was not streaming; tool calls rendered as standalone message bubbles

- **Shipped (bug):** Day 10 (AI Assistant initial ship)
- **Discovered:** 2026-06-09 (David screenshot feedback: "AI 助手有這個情況,
  應該是調用工具時不用有 message bubble; AI 助手是沒有做流式，所以要等到
  有晒全部結果才會有回覆")
- **Files affected:** `apps/api/src/routes/chat.ts`,
  `packages/ai/src/index.ts`, `apps/web/src/lib/api.ts`,
  `apps/web/src/pages/ai-chat.tsx`
- **Status:** ✅ Fixed (Day 10.1)

### Root cause

Two issues shipped together on Day 10:

1. **No streaming.** `client.chat.completions.create()` was called
   without `stream: true`, so the route waited for the entire LLM
   completion before responding. The frontend `useMutation` showed
   a "AI 諗緊..." spinner for 5-15 seconds, then the full reply
   appeared at once. From the user's perspective the agent felt
   unresponsive.

2. **Tool calls were full-width message bubbles.** `MessageBubble`
   treated `role: 'tool'` like a regular message: it wrapped the
   tool invocation in `flex justify-start` + `max-w-[80%]` with a
   bot icon. The result was a column of grey bubbles that looked
   like the agent was sending multiple messages, instead of
   metadata about what the agent was doing.

### Invariant

> **`/chat/send` MUST stream Server-Sent Events as the LLM
> produces tokens, and the UI MUST render tool calls as small
> inline pills adjacent to the assistant's reply — never as
> standalone message bubbles.**

Specifically:
- The HTTP response is `Content-Type: text/event-stream` with
  `Cache-Control: no-cache, no-transform` and
  `X-Accel-Buffering: no` headers (so nginx doesn't buffer).
- Each frame is `data: {json}\n\n`; json is one of:
  `{type:'token',delta:string}`, `{type:'tool_start',name,args}`,
  `{type:'tool_end',name,result,error?}`,
  `{type:'done',conversationId,usage}`,
  `{type:'error',message}`.
- The frontend's `ToolPill` and `MessageBubble` (for persisted
  `role: 'tool'`) MUST render tool invocations as inline pills
  (small text, no max-w container, no bot icon). Pills sit above
  the assistant bubble in the same column.

### Prevention

- The LLM call in `runAgentStream` is hard-coded with
  `stream: true` + `stream_options: { include_usage: true }`. A
  regression test would assert the response's `Content-Type`.
- The `ToolPill` / `MessageBubble` (tool branch) components are
  documented as "inline, not a message" in their JSDoc; any future
  refactor that wraps them in a `max-w-[80%]` should be flagged in
  code review.
- The PRD's US-C1 acceptance criteria now explicitly require
  "streaming" and "tool call inline pill" as separate bullets.
- The PRD's US-C7 is a new permanent US locking the SSE protocol
  in place.

---

## How to add a new entry

When you fix a bug:

1. Add an `RG-NNN` section here with the same fields (file, root cause,
   invariant, prevention).
2. Reference the RG- ID from the commit message (`fix(rg-002): ...`).
3. Add a code comment near the fix that points to this entry.
4. If the fix is in a tested file, add a regression test that fails
   without the fix and passes with it. (Backlog: when we have a test
   framework.)
5. Update `docs/QA-TRACKER.md` to flip any US that was regressed back
   to ✅ once the fix ships.
