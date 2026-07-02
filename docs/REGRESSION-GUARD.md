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

---

## RG-2026-06-07-DEAL-AUTOCOMPLETE — QuotationBuilder's Deal field + POST /deals validation + Prisma relation mapping

- **Shipped:** 2026-06-07
- **Files:**
  - `apps/api/src/routes/deal.ts` (POST + PATCH body validation, relation
    mapping, Elysia 1.2 userId fallback, audit actorId fix)
  - `apps/web/src/components/deal-autocomplete.tsx` (new — pattern
    mirrors `CompanyAutocomplete`)
  - `apps/web/src/components/quotation-builder.tsx` (replaced plain
    `<Select>` with `<DealAutocomplete>`; removed the inline
    `useEffect` that fetched `/api/deals?companyId=...`)
  - `apps/web/src/pages/deals.tsx` (`DealDialog.onSaved` widened from
    `() => void` to `Optional<(deal?: Deal) => void>`; added
    `defaultExpectedCloseDateOffsetDays` prop)
- **Status:** ✅ Fixed (smoke-tested 10/10 PASS in `/tmp/rg_deal_smoke.ts`)

### Root cause (3 issues, all addressed in this change)

1. **No body validation on POST /deals or PATCH /deals/:id.** The
   handlers did `prisma.deal.create({ data: body as never })` and
   `prisma.deal.update({ data: body as never })` — the `as never` cast
   hid the fact that the body wasn't validated against any schema.
   A malformed payload would either fail with an opaque Prisma error
   or — worse — silently drop a field. With the new Elysia
   `body: t.Object({...})` schema, callers now get a clean 422 with
   a field-level error message on any unknown / wrong-typed input.

2. **Prisma relation mapping was wrong for flat-FK payloads.** The
   Deal model declares `company Company @relation` /
   `stage PipelineStage @relation` / etc., so Prisma requires either
   a nested `connect` shape OR a `Prisma.DealUncheckedCreateInput`
   type — but not both. The previous code passed the flat object
   (with bare `companyId` etc.) and relied on the `as never` cast to
   suppress the type error. At runtime, Prisma rejected every
   `POST /deals` with `Argument company is missing`. The fix
   explicitly types the data as `Prisma.DealUncheckedCreateInput`
   and additionally resolves `pipelineId` from `stageId` when the
   caller doesn't supply it (and defaults `ownerId` to the calling
   user when not supplied).

3. **QuotationBuilder's Deal field was a plain `<Select>`** with no
   inline create. Sales had to leave the quotation-builder flow,
   navigate to the Deals kanban, create a deal, come back, and
   refresh the dropdown before the new deal was selectable. The new
   `<DealAutocomplete>` wraps the shared `<Autocomplete>` and
   exposes a "+ 新增 Deal" affordance that opens the existing
   `DealDialog` pre-filled with the quotation's customer, the
   default-pipeline first stage, value=0, and
   `expectedCloseDate = today + 90 days` (David's preferred default
   for enterprise close cycles). On save the new deal is
   auto-selected and added to the local catalogue without a
   parent re-render.

### Invariant

> **Any flat-FK API endpoint backed by a Prisma model with
> `@relation` columns MUST use either `Prisma.<Model>UncheckedCreateInput`
> or the nested `connect` shape — never both, never a bare object
> cast through `as never`.** Grep for `prisma\.\w+\.create\(\{ data: body
> as never` in `apps/api/src/routes/` — every match is a P1 that needs
> a typed body schema and an explicit UncheckedCreateInput cast.

> **The QuotationBuilder's Deal field MUST always go through
> `<DealAutocomplete>` (or a future `autocomplete`-based variant)
> — never re-introduce a plain `<Select>` here.** A plain `<Select>`
> forces Sales to leave the flow to create a deal, which breaks
> the "quote a deal in one go" promise of the QuotationBuilder.

### Prevention

- Don't re-introduce `as never` casts in `apps/api/src/routes/*.ts`.
  Add a `t.Object({...})` body schema and explicit
  `Prisma.<Model>UncheckedCreateInput` typing.
- The `getUserIdFromRequest` fallback (used in POST /deals) is a
  **workaround** for the Elysia 1.2 derive-context-loss bug
  documented in `apps/api/src/middleware/rbac.ts:67-75`. Don't
  remove it without first verifying the derive chain works in
  Elysia 1.2 (we have not yet upgraded to 1.3+ where this is
  fixed).
- The new `<DealAutocomplete>` must always be paired with a
  react-query `deals-by-company` cache key so other components
  (e.g. the Deals kanban) can `invalidateQueries` on Quick-Create.
- Always pre-fill `expectedCloseDate` via
  `defaultExpectedCloseDateOffsetDays` (currently +90 days) for
  any future caller of `DealDialog` that wants the same
  "minimum-friction" UX the QuotationBuilder gets.

### Smoke test

Run from inside the crm-api container:

```
docker cp /tmp/rg_deal_smoke.ts crm-api:/tmp/rg_deal_smoke.ts
docker exec crm-api bun run /tmp/rg_deal_smoke.ts
```

Expected: `=== ALL PASS ===` (10 assertions covering
POST valid + 3 negative cases + PATCH + DELETE cleanup + audit
log entry).

---

## RG-2026-06-07-EXPORT-XLSX — `bc-quotation` xlsx helpers must be ported, not proxied

- **Shipped:** 2026-06-07
- **Files:**
  - `apps/api/src/lib/excel/{quotation.ts, crm-adapter.ts, helpers/*.ts, constants/*.ts}`
  - `apps/api/src/lib/excel/assets/{ma_sow, terraMind_server, OCDP_server}.xlsx`
  - `apps/api/src/routes/quotation.ts` (route handler)
  - `apps/web/src/lib/api.ts` (`quotationsApi.downloadExcel`)
  - `apps/web/src/pages/quotation-detail.tsx` (button)
- **Status:** ✅ Fixed (port-and-adapt path chosen over the proxy-to-bc-quotation
  path, see the original question in the conversation for rationale)

### Root cause

CRM had no Quotation Excel export. The user requested parity with the
legacy `~/www/bc-quotation` system. Two options were considered:

1. **Proxy** the CRM request to bc-quotation's `/download?rowid=<BoardProId>`.
   This requires every CRM Quotation to carry a BoardPro rowid and adds
   a runtime HTTP dependency on a service that is being phased out.
2. **Port** the 5 worksheet helpers (1:1 source copy) into CRM and
   adapt Prisma's `Quotation + QuotationItem + Company + User` shape into
   the bc-quotation shape that the helpers consume.

Option 2 was chosen because it makes the CRM self-contained, removes
the runtime dependency, and avoids the data-sync burden of keeping
CRM `quotationId ↔ BoardPro rowid` in step.

### Invariant

> **CRM `GET /api/quotations/:id/export-xlsx` must produce a .xlsx whose
> 5 worksheets are byte-for-byte equivalent (modulo the dynamic cell
> values) to what `bc-quotation` produced for the same data.** A change
> that drops a worksheet, removes a column, or renames a worksheet must
> be flagged in the PR description with a before/after diff of the
> generated xlsx structure.

### Prevention

- A `crm-adapter.test.ts` (Bun test) snapshots the shape that
  `adaptCrmQuotationForExcel` produces for 3 fixture scenarios
  (product-only, service-only, mixed). If a future refactor changes
  the field names or units, the snapshot test will fail and force
  the author to update the snapshot.
- The 3 xlsx templates (`ma_sow`, `terraMind_server`, `OCDP_server`)
  are committed as binary files. A change to one of them must be
  accompanied by an update to the corresponding layout spec in
  `docs/architecture/0007-quotation-excel.md` (TODO US-A6).
- Adding a new worksheet? Add a new branch in
  `apps/api/src/lib/excel/quotation.ts`'s `generateQuotationExcel()`
  **and** add a row to the smoke test fixture so the new worksheet
  shows up in the next `/tmp/quotation-smoke.xlsx` run.

## RG-CHAT-001 — AI assistant: empty bubble on tool call, no Markdown / charts (2026-06-08)

**Symptom (David, 2026-06-08)**: when the AI agent invoked any
tool, the chat UI rendered an empty assistant bubble (just a grey
box with `max-w-[80%] rounded-lg px-4 py-2` and nothing inside)
between the user's question and the actual reply. Additionally,
assistant replies were rendered as plain text — no Markdown, no
charts, no formatting of any kind.

**Root cause** (two parts):
1. `packages/ai/src/index.ts` persists a marker row for every
   tool invocation as `role: 'assistant', content: '', toolName: 'foo'`.
   This row is needed to reconstruct the LLM history (tool_calls
   shape on subsequent turns). The frontend fell through to the
   generic assistant bubble branch and rendered the empty `content`
   as a styled box.
2. `apps/web/src/pages/ai-chat.tsx` rendered `message.content` as
   plain text (`{message.content}` + `whitespace-pre-wrap`). No
   Markdown parsing, no chart support.

**Prevention**:
- The marker row's `content` is now written as `` `🔧 ${toolName}` ``
  (sentinel string). The frontend detects it via
  `isToolMarker()` (in `lib/chat-helpers.ts`, extracted for
  testability) and renders it as an inline metadata pill instead
  of a bubble. Pinned by 7 unit tests in
  `apps/web/src/lib/__tests__/chat-helpers.test.ts`.
- Assistant messages are now rendered through
  `<MarkdownContent source={...} />` (in
  `apps/web/src/components/MarkdownContent.tsx`), which uses
  `react-markdown` + `remark-gfm` and supports a
  `` ```chart `` fence that maps to a `<ChartBlock />`
  (`apps/web/src/components/ChartBlock.tsx`, react-chartjs-2
  wrapping Chart.js v4). The LLM is taught the chart syntax in
  `packages/ai/src/prompts.ts` (Markdown and charts section).
- The streaming path uses `<StreamingMarkdown />` which holds
  back rendering when a ```chart fence is still open (so a
  partial fence doesn't get half-rendered as a broken code block).

**Invariants**:
- An assistant message with `role: 'assistant'`, `toolName` set,
  and `content` matching `^🔧` (or empty) MUST be treated as
  metadata, not a bubble. `isToolMarker()` is the single source
  of truth.
- The LLM history reconstructor (lines 97-127 of
  `packages/ai/src/index.ts`) coerces marker `content` to `null`
  before pushing into the OpenAI request — required by
  chat-completions spec for an assistant message that only
  carries `tool_calls`.
- Any future "marker" row the backend writes MUST start with
  `🔧` (sentinel family is reserved). Anything else is prose and
  will render as a real bubble.

**Re-test**:
```
cd apps/web && bun test src/lib/__tests__/chat-helpers.test.ts
# 7 pass, 0 fail
```

**Future work** (not part of this fix): the chart sandbox is
intentionally limited to bar / line / pie / doughnut. If we want
scatter, radar, or mixed charts, add the controller registration
in `ChartBlock.tsx` and extend the union in
`packages/ai/src/prompts.ts`.

## RG-2026-06-08-A3 — Quotation GP% formula was un-tested, P0 PARTIAL closed

**Symptom (Day 9 → 2026-06-08)**: US-A3 (`Quotation builder + GP%`)
shipped Day 9 with the formula coded correctly, but without
unit tests. The QA-TRACKER flagged it 🟨 PARTIAL P0 for the same
reason (`GP% formula correct but not unit-tested`).

**Root cause**: `gpOf()` and `costPerManDayFromSnapshot()` lived
as private functions inside `apps/api/src/routes/quotation.ts`,
alongside the Elysia route definition. Importing the file to
test the helpers would have spun up the Elysia app, the Prisma
client, and the DB connection — too heavy for a unit test, and
frowned on as a test pattern.

**Fix**: extracted both helpers into
`apps/api/src/lib/quotation-gp.ts` (no behavioural change to the
formula, just relocated). The route file now imports them. The
new module is testable in isolation. 14 unit tests in
`apps/api/src/__tests__/quotation-gp.test.ts` pin the formulas.

**Re-test**:
```
cd apps/api && bun test src/__tests__/quotation-gp.test.ts
# 14 pass, 0 fail
```

**Invariants**:
- `gpOf('PRODUCT', total, cost)` MUST return `{lineGp: total,
  lineGpPercent: 100}` regardless of `cost` (PRODUCT lines have
  no man-day cost).
- `gpOf('SERVICE', 0, cost)` MUST return `{lineGp: -cost,
  lineGpPercent: 0}` (not NaN) — the lineTotal = 0 case is
  guarded.
- `gpOf(<unknown>, total, cost)` MUST fall through to the
  SERVICE branch (so future item types get the correct GP% by
  default, not a forced 100%).
- `costPerManDayFromSnapshot()` MUST return 0 (not throw) for
  `null`, `undefined`, non-objects, snapshots with no `lines`
  array, and snapshots with all-zero days.

**Future work**: US-A3 status flips from PARTIAL to PASS in
`docs/QA-TRACKER.md` (Day 17 batch).

## RG-CHAT-002 — AI tool confirmation guardrail: never bypassed, audit-logged, testable (2026-06-08)

**Symptom (David, 2026-06-08)**: US-C5 (`"AI proposes, human
confirms" mutation guardrail`) is the highest-risk P0 in the AI
assistant. The PRD acceptance criteria explicitly state that the
guardrail MUST NOT be bypassable — even if the LLM claims to be
in a "trusted" path. Day 10 shipped the 3 write tools
(`draftQuotation`, `updateDealStage`, `logActivity`) with the
flag, and Day 17 (this entry) added the dispatch interception
in `runAgentStream`, the audit-log wiring, and the test coverage
to pin the contract.

**Root cause**: The guardrail is the linchpin of "AI doesn't
silently mutate the CRM". A regression where the dispatch loop
forgets to check `requiresConfirmation`, or where `hashArgs()`
becomes unstable, would silently re-open the hole. The
acceptance criteria are 8 items long and span backend (registry
+ dispatch + audit) and frontend (Radix Dialog).

**Prevention**:
- The 3 write tools in `packages/ai/src/tools.ts` carry
  `requiresConfirmation: true` (lines 239, 338, 527). Read tools
  do NOT have the flag, so the default `false` is the safe path
  for any new tool.
- `runAgentStream` (in `packages/ai/src/index.ts:339-410`)
  intercepts the tool execution, yields a `confirmation_required`
  SSE event with the full proposed args, awaits the controller
  response, and either executes (approved) or feeds a synthetic
  denial result to the LLM (denied). The synthetic result has
  `{denied: true, reason: '...', error: 'denied by user'}` so the
  LLM can gracefully explain to the user.
- `hashArgs()` produces a stable 16-char hex of
  `JSON.stringify(args)` with keys sorted. The audit log
  (`AI_TOOL_CONFIRMED` / `AI_TOOL_DENIED` rows in
  `AuditLog.metadata.hash`) and the conversation tool-call row
  both carry this hash, so support can join them.
- `AuditAction` enum in `prisma/schema.prisma` has
  `AI_TOOL_CONFIRMED` and `AI_TOOL_DENIED` (lines 798-799).
- 13 unit tests in
  `packages/ai/src/__tests__/confirm.test.ts` pin `hashArgs()`
  stability and the `createConfirmationController()` timeout /
  no-op / concurrent-pending behaviour.

**Invariants** (the things a future refactor MUST NOT break):
- `hashArgs(a)` MUST equal `hashArgs(b)` when `a` and `b` have
  the same key/value pairs, even if the keys are in different
  order. (Audit-log join invariant.)
- `hashArgs(null)` and `hashArgs(undefined)` MUST return a valid
  16-char hex string, not throw.
- `createConfirmationController()`'s `respond(id, ...)` MUST
  return `false` (not throw) for an unknown id.
- `createConfirmationController()`'s `awaitResponse(id, ...)`
  MUST reject (not hang) on timeout. The timeout default is
  5 minutes.
- A late `respond()` after timeout MUST be a no-op, not a stale
  resolve that affects a subsequent request.
- The 3 write tools (`draftQuotation`, `updateDealStage`,
  `logActivity`) MUST keep `requiresConfirmation: true`. Adding
  a new write tool? Set the flag explicitly. Don't rely on
  defaults.

**Re-test**:
```
cd packages/ai && bun test src/__tests__/confirm.test.ts
# 13 pass, 0 fail
```

**What's still pending** (Day 18+ scope, NOT part of this fix):
- Frontend Radix Dialog with the proposed-args diff and
  Confirm/Cancel buttons (`apps/web/src/pages/ai-chat.tsx`).
- Frontend handling of the `confirmation_required` SSE event
  (currently the frontend ignores it, so the dialog never
  appears; the backend's auto-deny kicks in and the LLM gets
  a "denied by user" result that it surfaces as a plain text
  explanation).
- Client-disconnect handling: the spec says "if the client
  disconnects while waiting for a confirmation, the agent run
  is cancelled and a 'user abandoned' sentinel is written".
  Currently the auto-deny path runs and the conversation
  records the denial, but the run isn't explicitly cancelled
  and no "abandoned" sentinel is written. Punted to the
  frontend-Round-2 batch.

**Future work**:
- `US-C5` status flips from PARTIAL to PASS in
  `docs/QA-TRACKER.md` (Day 17 batch, this entry).

---

## RG-006 — Weak password policy (no complexity, min 6/8)

- **Shipped (vulnerability existed since):** Day 1 (initial auth routes)
- **Discovered:** 2026-06-07 (Security A review in TECH-DEBT.md P1-5)
- **Fixed:** 2026-06-08 (Day 17 P1 sprint)
- **File:** `apps/api/src/lib/password-policy.ts` + `apps/api/src/routes/auth.ts`
- **Status:** ✅ Fixed (server-side; login grandfathered — see Migration)

### Root cause

`/auth/login` accepted `minLength: 6`, `/auth/register` and
`/auth/change-password` accepted `minLength: 8`. No complexity
requirement at all. `Bun.password.hash` uses argon2id (good) but
the input space was too small to be safe against dictionary attacks
at scale. Brute-force / credential-stuffing threshold was effectively
the size of the 6-8 character dictionary.

### Invariant

> **All password-creation endpoints (`/auth/register`,
> `/auth/change-password`) MUST enforce: ≥12 chars + ≥1 digit +
> ≥1 special character. The server is the source of truth — the
> client UI can hint, but cannot relax, this policy.** Login does
> not enforce the new policy (see Migration below).

The invariant is enforced by `validateStrongPassword` in
`apps/api/src/lib/password-policy.ts`. Grep for that export name
to find every enforcement point.

### Prevention

- Unit test in `apps/api/src/lib/__tests__/password-policy.test.ts`
  covers length rule, digit rule, special-char rule, and the full
  ASCII special-char set (32 chars). 40 tests, all pass.
- `t.String({ minLength: 12 })` on the Elysia body schema gives
  shape-level rejection (400-class) before the handler runs, so
  the complexity check is a defence-in-depth 422 on top.
- Any future "we just need a quick reset endpoint" must call
  `validateStrongPassword` from the shared helper, NOT a local
  one-off check.

### Migration (login floor)

`/auth/login` still accepts `minLength: 6` because we cannot
retroactively reject existing users with 6–11 char passwords
without locking them out. A separate migration (proposed, not
yet scheduled) will bump the floor on next successful login:
when a user with a sub-12 password successfully authenticates,
silently force them to `/auth/change-password` before issuing
the JWT. Tracking lives in
[ADR-0014-followup](architecture/0014-audit-log-retention.md) (to
be extended) and in the Day 18+ backlog.

### Future work

- Day 18+: add the login-floor migration described above.
- Day 18+: add frontend hints (e.g. zxcvbn-style strength meter
  on the register + change-password forms) so users don't get
  surprised by 422s.
- Day 18+: rate limiting on `/auth/login` (P2-6) becomes
  urgent now that passwords are stronger — a strong password is
  no defence against a million-guess brute force.

---

## RG-007 — Day 17 AI tool confirmation migration not applied to prod DB

- **Shipped (bug introduced):** 2026-06-08 (commit 8484b9a, US-C5)
- **Discovered:** 2026-06-08 (during P1-1 typecheck work in Day 17 P1 sprint)
- **File:** `packages/db/prisma/migrations/20260609000002_day17_ai_tool_confirmation/migration.sql` (lines 28-32)
- **Status:** ✅ Fixed (migration applied; column + enum values now in prod)

### Root cause

US-C5 added a new migration that:
1. Extended `AuditAction` enum with `AI_TOOL_CONFIRMED` / `AI_TOOL_DENIED`
2. Added `aiToolConfirmationHash TEXT` column to the
   `ConversationMessage` table

The commit landed in `main` (commit 8484b9a → fcfbc29 chain) but
the **runtime Docker image was not rebuilt** before being deployed.
The Dockerfile bakes the migrations folder into the image at build
time (see `apps/api/Dockerfile` + `docker-entrypoint.sh`), so a
`docker compose up -d` against the existing image runs `migrate
deploy` against the OLD folder contents — it never saw the new
migration.

**Symptoms in production**:
- `_prisma_migrations` table had 11 rows (latest
  `20260609000001_day9_region_table_actual_ddl`), 0 of which were
  Day 17's `20260609000002_day17_ai_tool_confirmation`.
- DB schema had no `aiToolConfirmationHash` column on
  `conversation_messages` (which is the actual on-disk table name —
  see below).
- DB enum `AuditAction` had no `AI_TOOL_CONFIRMED` / `AI_TOOL_DENIED`
  values.

This means every `AI_TOOL_CONFIRMED` / `AI_TOOL_DENIED` write to
`audit_logs.action` would have failed with a PG enum type error
the first time a user confirmed or denied a tool call in chat.
US-C5's "human-in-the-loop guardrail" silently never wrote a
confirmation record to the audit log.

### Two compounding bugs

1. **Migration never ran** (above)
2. **Migration SQL had a typo**: the new migration used
   `ALTER TABLE "ConversationMessage"` (PascalCase) but the table
   on disk is `"conversation_messages"` (snake_case, created by
   the Day 1 init migration). The init migration explicitly
   double-quotes the snake_case name, making it case-sensitive
   and NOT subject to PG's default case-folding. So even if the
   migration had run as-is, it would have failed with
   `relation "ConversationMessage" does not exist`.

### Fix

- Edited `20260609000002_day17_ai_tool_confirmation/migration.sql`
  to use `"conversation_messages"` (matching the init migration).
- `docker cp` the corrected migration folder into the running
  container (since the image is not being rebuilt today).
- `prisma migrate resolve --rolled-back 20260609000002_day17_ai_tool_confirmation`
  to clear the failed-migration marker.
- `prisma migrate deploy` to apply the now-corrected migration.
- Verified: column `aiToolConfirmationHash` exists on
  `conversation_messages`; enum `AuditAction` now has
  `AI_TOOL_CONFIRMED` and `AI_TOOL_DENIED` as the last two values.

### Invariant

> **Every Prisma migration file MUST reference on-disk table /
> column names exactly as the init migration created them, not
> the Prisma model name. The init migration uses double-quoted
> snake_case identifiers (`"conversation_messages"`,
> `"audit_logs"`, etc.); subsequent raw-SQL migrations must
> follow the same convention.** Grep the migration history for
> `ALTER TABLE "C` (PascalCase after `ALTER TABLE`) and you'll
> find any drift; this entry exists because one slipped through.

> **A migration in `main` MUST be in the runtime image before
> `migrate deploy` will see it. The Dockerfile bakes the
> migrations folder in at build time. After landing a migration
> commit, rebuild the image AND restart the container, in that
> order. The `docker compose up -d` workflow without `--build`
> is a silent foot-gun for schema changes.**

### Prevention

- **CI / pre-deploy check**: a `migrate status` smoke test in the
  ship gate that compares `ls prisma/migrations/` on the host
  vs. inside the running container. Mismatch = block deploy.
- **Schema change SOP**: any PR that adds a migration file
  MUST also update the `migrations_baked_at` tag in
  `docker-compose.yml` (or a similar build-time marker) so it's
  obvious the image needs a rebuild.
- **Lint rule**: a custom `migration-lint.sh` that greps
  `ALTER TABLE "C` / `CREATE TABLE "C` in every new migration
  and fails if PascalCase is used where the init migration's
  style is snake_case. Filed as a backlog task (US-OPS-1, not yet
  scheduled).
- **Day 18**: schedule a full migration-applied audit — re-run
  `prisma migrate status` in prod for every deployed commit since
  Day 1 and verify nothing else was lost.

---

## RG-018-SNAPSHOT-DISPLAY — Quotation read-only surfaces showed deleted/renamed Product/Service as blank

- **Shipped (bug discovered):** 2026-06-26 (user-reported)
- **Fixed in:** commit `1464b4e` + docs `9d1da86`
- **Files:** `apps/web/src/pages/quotation-detail.tsx`, `apps/api/src/lib/excel/crm-adapter.ts`
- **Status:** ✅ Fixed

### Root cause

`Quotation` had snapshot fields (name, description, sku, unitPrice,
manDaySnapshot) at the line-item level since Day 7 (P1-10), and
the `QuotationBuilder` autocompletes (Day 17, P1-10) honoured
"snapshot wins, live is fallback" so an old quotation's edit
dialog would still show the product/service it was originally
quoted against. But the READ-ONLY surfaces were never updated:

- `QuotationDetailPage` (normal + print mode tables) rendered only
  `item.name` + `item.sku` + `unitPrice` etc. — and the `manDaySnapshot`
  / `description` were never displayed. So a SENT quotation whose
  Service had been edited later showed only the name + sku, with
  no SOW breakdown.
- `crm-adapter.ts` (Excel export) emitted `sow` / `sow_en` from
  `service?.description ?? product?.description` — never `item.description`
  (the snapshot). So a deleted Service produced a blank SOW sheet.

### Invariant

> **For any line-item rendered or exported from a Quotation, prefer
> the line-item snapshot fields over the live catalogue record.
> Helpers live in `apps/web/src/components/quotation-line-item-snapshot.tsx`:
> `isLineItemDeleted(item)` (true when `product`/`service` relation is
> null), `resolveLineItemDescription(item)` (snapshot > live catalogue > null),
> and the `<LineItemSnapshotMeta item={...} [print] />` presentational
> component. The Excel path uses the same precedence in
> `crm-adapter.ts:generate.().sow / sow_en`.** Pinned by 8 vitest cases
> in `quotation-line-item-snapshot.test.ts` and 6 bun:test cases in
> `crm-adapter.test.ts`.

### Prevention

- Any new read-only surface (list page, kanban card, dashboard widget,
  export) that displays line items must use the helper or import the
  `QuotationItemSnapshotMeta` component. Grep for `item.name` /
  `item.description` on render paths that don't go through
  `<LineItemSnapshotMeta>` — the only acceptable exception is the edit
  builder, which uses the autocomplete.
- Future addition of a line-item clone / split helper should preserve
  the snapshot precedence verbatim.

---

## RG-019-LIST-PAGE-EDIT — 編輯 button on /quotations opened an empty form

- **Shipped (bug discovered):** 2026-06-26 (user-reported)
- **Fixed in:** commit `b95abae`
- **File:** `apps/web/src/pages/quotations.tsx`
- **Status:** ✅ Fixed

### Root cause

`GET /api/quotations` (the list endpoint) deliberately does not
include `items[]` in its response — only `_count.items` for the row
badge. The detail endpoint (`GET /api/quotations/:id`) includes the
full line items. So:

1. The list page stored the list-shape quotation in `editing` state
   with no `items` field.
2. `<QuotationBuilder existing={editing}>` opened.
3. `linesFromQuotation(editing)` returned `[emptyLine()]` because
   `editing.items === undefined`.
4. The form opened with no historical line items at all.

The detail page didn't have this bug because it already calls
`quotationsApi.get(id!)` which returns the full data.

### Invariant

> **The list page edit flow MUST call `quotationsApi.get(id)` before
> opening `QuotationBuilder` in edit mode.** `linesFromQuotation`
> (in `quotation-builder.tsx`) trusts that `existing.items` is present
> — callers are responsible for fetching the full row. The helper `openEdit(q)`
> on `quotations.tsx` line ~134 now does this and also pre-seeds the
> React Query cache under `['quotation', q.id]` so a subsequent
> navigation to `/quotations/:id` doesn't refetch.

### Prevention

- Same shape would apply to any future list-with-edit pattern (companies,
  deals, services). The fix is the same: the row's edit click handler
  should always fetch the full row first.
- A defensive guard inside `QuotationBuilder` could throw if
  `existing` is provided but `existing.items` is missing — would
  catch a future regression automatically. Filed as a follow-up
  (no commit yet).

---

## RG-020-QUOTATION-DEAL-LINK — PATCH /quotations silently dropped `dealId`

- **Shipped (bug discovered):** 2026-06-26 (user-reported)
- **Fixed in:** commit `d2f2444`
- **Files:** `apps/api/src/routes/quotation.ts` (body typecast + update
  object), `apps/web/src/lib/api.ts` (Pick type), `apps/web/src/components/quotation-builder.tsx` (PATCH body)
- **Status:** ✅ Fixed

### Root cause

Three bugs collided to drop the Deal association silently on
Quotation edit:

1. The backend PATCH route's body typecast
   `({ title?, notes?, validUntil?, taxRate?, status? })` did not
   include `dealId`. The `update` object construction didn't process
   a `dealId` field. So even when the frontend sent it, the value
   was dropped on the floor.
2. The frontend `quotationsApi.update` wrapper type was
   `Partial<Pick<Quotation, 'title' | 'notes' | 'taxRate' | 'status' | 'validUntil'>>`
   — TypeScript would reject any attempt to send `dealId`.
3. The frontend `QuotationBuilder` edit-mode PATCH body omitted
   `dealId` entirely.

The Quotation model already had `dealId String?` in the schema, the
GET response already included it, and the list-detail column was
already rendered. There just wasn't a write path.

### Invariant

> **`PATCH /quotations/:id` accepts `dealId` (string to link,
> null/empty to clear). Same for `salesRepId`. Both are CRM
> metadata — NOT contractual — so they are NOT protected by the
> SENT lock alongside title/notes/taxRate/validUntil.**
> The frontend type wrapper must match: `Pick<Quotation, …>` includes
> both fields. If a future PR adds another optional quote field
> (e.g. `assignedToId`, `expiresAt`), follow the exact same pattern:
> add to backend typecast, add to `update` object, add to frontend
> `Pick`, include in the PATCH body if the edit UI exposes it.

### Prevention

- The PATCH route body typecast is intentionally implicit (no
  `body: t.Object(...)` validator) for backwards-compatibility with
  older callers. The "did you forget to handle a field?" question
  lives in code review. A future defensive guard could grep the
  PATCH body keys against a whitelist before constructing `update` —
  but that's strict and would break forward-compat.

---

## RG-021-SENT-LOCK-REGRESSION — P2-sales-rep accidentally locked `dealId` against SENT edits

- **Shipped (bug introduced):** 2026-06-26 (commit `9d4accd`)
- **Discovered:** 2026-06-26 (user-reported the very next commit)
- **Fixed in:** commit `02c333a`
- **File:** `apps/api/src/routes/quotation.ts` (SENT-lock guard)
- **Status:** ✅ Fixed (revert)

### Root cause

The P2-sales-rep commit (`9d4accd`) added `dealId` to the SENT-lock
guard with this comment:

```
// 2026-06-26: also include dealId in the SENT lock — moving a
// sent quotation to a different deal would silently change the
// sales-attribution trail.
```

That reasoning was wrong on two counts:

1. Sales attribution is `salesRepId` / `createdById`, not `dealId`.
   A Deal is a CRM container, not a commission rule.
2. The user flow that broke: a sales rep sends a quote standalone,
   then a pipeline opportunity opens and they want to attach the
   quote to it retroactively. Forcing them to create a revision
   just to set a CRM classification is friction without a payoff.

### Invariant

> **The SENT lock on `PATCH /quotations/:id` covers what the customer
> sees on the document, not what the CRM classifies the quotation as:**
>
> | Locked (contractual, customer-visible)     | Unlocked (CRM metadata)         |
> | ---------------------------------------- | ------------------------------- |
> | `title`                                   | `dealId`                        |
> | `notes`                                   | `salesRepId`                     |
> | `taxRate`                                 | `status` (already excluded by `if`) |
> | `validUntil`                              |                                 |
> | `line items` (separate routes, all 409 on non-DRAFT) | |
>
> Day-18's mistake was treating `dealId` as a contractual concern.
> It's not — it's a CRM classification. If you find yourself
> wanting to lock another field, first ask "does the customer see
> this on the document they signed?". If no, do not add it to the
> lock.

### Prevention

- PR review check: any change to the SENT-lock guard must justify
  each added field with a "customer-visible" argument or it gets
  rejected.
- Future fields added to `Quotation`: the default assumption is
  unlocked. Only move into the locked set with an explicit comment
  naming the contractual reason.

---

## RG-022-QUOTATION-PERM-GAP — quotation.ts route file has zero `requirePermission` calls

- **Discovered:** 2026-06-30 (code review, no live bug reported yet)
- **File:** `apps/api/src/routes/quotation.ts` (the entire route group)
- **Status:** 🔴 OPEN — P0-2-class gap, comparable to RG-006 / RG-007

### Root cause

`quotationRoutes` only adds `.use(authContext)` at the top of the
chain. There is **no `.use(requirePermission(...))` anywhere** in
the 1066-line file. Every endpoint — `GET /quotations`, `GET /quotations/:id`,
`POST /quotations`, `POST /quotations/:id/revise`, `PATCH /quotations/:id`,
`POST /quotations/:id/status`, `POST /quotations/:id/items`,
`PATCH /quotations/:id/items/:itemId`, `DELETE /quotations/:id/items/:itemId`,
`DELETE /quotations/:id`, `GET /quotations/:id/export-xlsx` — runs for
**any authenticated user**, including a VIEWER role.

Compare this to the other route groups which were fixed in the
P0-2 sprint: `company.ts`, `contact.ts`, `deal.ts`, `product.ts`,
`service.ts`, `roles.ts`, `users.ts` all gate their writes with
`.use(requirePermission('…:write'))`. `quotation.ts` is the largest
route group by far and has zero of those gates.

### Invariant

> **`quotationRoutes` gates EACH verb with the matching
> `quotation:<action>` permission.** Reads use `quotation:read`,
> writes use `quotation:update|create|delete|send`. The `/:id/revise`
> route uses `quotation:update` (same as PATCH). Status transitions
> use `quotation:send` (already in `PERMISSIONS`). Item routes
> inherit `quotation:update`. A user with only `quotation:read`
> must get 403 on every mutating verb.

> **Defense-in-depth: also disable the Quotation tab in the
> sidebar for VIEWER.** Otherwise the user clicks "編輯", the form
> opens, the first save returns 403, and the form is now open over
> a half-typed state with no way to revert.

### Suggested test port

`apps/api/src/routes/quotation.test.ts` (new bun:test file, route-level
test via `app.handle(new Request(...))`):

```
test('GET /quotations requires quotation:read', async () => {
  // VIEWER role: 200 OK, list returned
  // SALES role: 200 OK
  // no auth header: 401
});

test('POST /quotations rejects user without quotation:create', async () => {
  // VIEWER: 403
  // SALES: 200
});

test('PATCH /quotations/:id rejects user without quotation:update', async () => {
  // VIEWER: 403
});

test('DELETE /quotations/:id rejects user without quotation:delete', async () => {
  // VIEWER: 403
});

test('POST /quotations/:id/revise requires quotation:update', ...)
test('POST /quotations/:id/status requires quotation:send', ...)
test('item routes /:id/items* require quotation:update', ...)
```

Pin: rolePermission seeded in `bun:test`'s `beforeEach` matches
`PERMISSIONS` so future permission-key additions surface here.

---

## RG-023-QUOTATION-DELETE-NO-STATUS-GUARD — DELETE /quotations/:id doesn't check `status`

- **Discovered:** 2026-06-30 (code review)
- **File:** `apps/api/src/routes/quotation.ts` DELETE handler (line 877-892)
- **Status:** 🔴 OPEN — silent data-loss bug for contract-bearing records

### Root cause

`DELETE /quotations/:id` (line 877) finds the row, then `await
prisma.quotation.delete({...})` without any check on `before.status`.
A SENT / VIEWED / ACCEPTED / INVOICED quotation — i.e. a
**contract-bearing record** — can be deleted with a single DELETE
request.

Compare this to the line-item handlers (`:id/items`, `:id/items/:itemId`)
which all check `quotation.status !== 'DRAFT'` and 409. The pattern
"once SENT, contractual fields are immutable" should extend to
DELETE the quotation itself. Otherwise the audit log records the
deletion but the user's history of "I sent this to ACME on 2026-05-12"
disappears.

### Invariant

> **DELETE /quotations/:id refuses non-DRAFT status with 409.**
> The only way to "remove" a SENT quotation is to keep the audit
> trail — record an explicit `QUOTATION_DELETED` action, but keep
> the row. If the user truly wants to purge, an admin can hard-delete
> via a separate `admin:quotation:purge` permission (not in scope
> today). A future enhancement could mark the row as `deletedAt` (soft
> delete) and hide it from default list views; for now, refusing the
> delete is the safer default.

### Suggested test port

Add to `apps/api/src/routes/quotation.test.ts`:

```
test('DELETE /quotations/:id refuses SENT status with 409', async () => {
  // arrange: create DRAFT, transition to SENT
  // act: send DELETE
  // assert: 409, error message names "contract" or "non-DRAFT",
  //         row still exists in DB
});
test('DELETE /quotations/:id is allowed only when status === DRAFT', async () => {
  // parametrized: ['DRAFT' → 200, 'SENT' → 409, 'VIEWED' → 409,
  //               'ACCEPTED' → 409, 'INVOICED' → 409, 'REJECTED' → 200 (?)
  //               decide: should REJECTED be allowed to delete? — yes,
  //               no contract on a rejected quote, but be defensive
});
```

---

## RG-024-QUOTATION-PATCH-NO-BODY-VALIDATOR — `body as {...}` raw typecast on PATCH /quotations/:id

- **Discovered:** 2026-06-30 (code review)
- **File:** `apps/api/src/routes/quotation.ts` PATCH handler (line 666-775)
- **Status:** 🟨 OPEN — known gap (raised as RG-020 followup, not closed)

### Root cause

`PATCH /quotations/:id` uses a raw `body as { title?; notes?; ... }`
typecast. There is no `body: t.Object({...})` validator (Elysia's
runtime schema check). Consequences:

1. Field renames are silent. If the frontend sends `{ heading: 'X' }`
   hoping it maps to `title`, the value is dropped with no 4xx — the
   user thinks they edited the title but it didn't change.
2. Wrong types (e.g. `taxRate: "abc"`) pass through and let Prisma
   surface a 500 instead of a clean 400.
3. Extra fields (e.g. `description: 'X'`) pass through; only the
   explicitly destructured fields are read. The frontend can grow new
   fields client-side without server validation, which is dangerous.

The README / api.md indicates this is intentional for backwards
compat with older callers, but it means the contract surface is
implicit.

### Invariant

> **`PATCH /quotations/:id` MUST validate its body via a
> `t.Object({...})` schema.** Required-fields-with-types is non-
> negotiable for our API surface; the previous freedom was a Day-5
> shortcut when Elysia's t.Object mode was unstable. Now stable. The
> schema should accept the 7 mutable fields (`title`, `notes`,
> `validUntil`, `taxRate`, `dealId`, `salesRepId`, `currency`) and
> reject unknowns with 422 so frontend contract drifts surface
> immediately.

### Suggested test port

`apps/api/src/routes/quotation.test.ts`:

```
test('PATCH /quotations/:id rejects unknown fields with 422', async () => {
  const body = { title: 'X', heading: 'X' };
  const res = await app.handle(makeRequest('PATCH', '/quotations/:id', body));
  expect(res.status).toBe(422);
});
test('PATCH /quotations/:id rejects taxRate: "abc" with 422', async () => {
  // wrong type
});
test('PATCH /quotations/:id accepts null validUntil (clears)', async () => {
  // null is the explicit-clear signal
});
test('PATCH /quotations/:id rejects dealId: "" (treats as null)', async () => {
  // backend coerces but server-side validation must allow it
});
```

---

## RG-025-QUOTATION-EDIT-BUILDER-COMPANY-NOT-DISABLED — edit-mode user can change Company but PATCH ignores it

- **Discovered:** 2026-06-30 (code review)
- **File:** `apps/web/src/components/quotation-builder.tsx` line 545
- **Status:** 🟨 OPEN — UX bug; the field looks editable but isn't

### Root cause

`<CompanyAutocomplete value={companyId} onChange={setCompanyId} />` is
unconditionally rendered without a `disabled={isEdit}` prop. In edit
mode the user can pick a different company from the dropdown, the
local React state updates to the new id, but the PATCH body
(`quotationsApi.update(...)`) does NOT include `companyId` — the
backend PATCH handler doesn't accept companyId either (see
RG-022 / RG-024).

So the change is silently lost on save. The state shows the new
company until the user clicks save and the modal closes; on reopen
from /quotations/:id the original company is restored. The user
experiences this as "the form ate my edit" with no error message.

`apps/web/src/pages/deals.tsx` (the DealDialog) uses
`<CompanyAutocomplete disabled={isEdit} />` — the deal side already
has this right. The quotation side does not.

### Invariant

> **In edit mode, the CompanyAutocomplete MUST be `disabled={true}`.**
> The Quotation ↔ Company relationship is contractual — the customer
> on the document doesn't change between revisions; that's what
> REVISIONS (Day 18-D) are for, not in-place company swap. Either:
> 1. Add `disabled={isEdit}` to the builder (matches the DealDialog
>    pattern), or
> 2. Add `companyId` to PATCH (requires backend schema change + UX
>    caveat: this would silently redirect a SENT quotation, breaking
>    the audit trail).
>
> **Choose option 1** — matches existing pattern, no schema change.

### Suggested test port

Vitest with RTL (`apps/web/src/components/__tests__/quotation-builder-rg-025.test.tsx`):

```
test('CompanyAutocomplete is disabled in edit mode (RG-025)', async () => {
  render(<QuotationBuilder existing={mockQuotation} ... />);
  const companyInput = screen.getByPlaceholderText(/搜尋客戶/);
  expect(companyInput).toBeDisabled();
});
test('CompanyAutocomplete is enabled in create mode', async () => {
  render(<QuotationBuilder ... />);  // no existing=
  const companyInput = screen.getByPlaceholderText(/搜尋客戶/);
  expect(companyInput).not.toBeDisabled();
});
```

The disabled property checks the React `disabled` attribute on the
underlying input. No need to mount the autocomplete's popover.

---

## RG-026-ROUTER-DECISION-TREE-MISSING-PERMS — unused permission keys or routes that ignore the chain

- **Discovered:** 2026-06-30 (code review)
- **File:** `apps/api/src/routes/ai-config.ts` (no `.use(requirePermission)` calls)
- **Status:** 🟨 OPEN — parallel auth system that bypasses the central RBAC

### Root cause

`apps/api/src/routes/ai-config.ts` imports `requirePermission` but
**never calls `.use(requirePermission(...))`**. Every handler does
its own inline check:

```ts
const allowed = await import('../middleware/rbac').then((m) =>
  m.userHasPermission(userId, 'ai-config:read')
);
if (!allowed) { set.status = 403; return ... }
```

This is fragile in two ways:

1. **Inconsistency** — the rest of the codebase uses the chain pattern
   (`.use(requirePermission('…'))`); this one route file reverts to
   hand-rolled inline checks. A new contributor adding a route
   here will copy the surrounding pattern and the route will skip
   the permission entirely.
2. **Dynamic import** — `await import('../middleware/rbac').then(...)`
   is used because `userHasPermission` isn't in the static import
   on line 34. The static import only pulls `getUserIdFromRequest`
   and `requirePermission`. Adding `userHasPermission` to the static
   import would let us drop the dynamic import dance.
3. **Missing chain enforcement** — every method (GET /status, GET /,
   PUT /, POST /test) requires the same check as a `.use()` would do,
   but they're spelled out in handler code. If a new method is added
   (e.g. `DELETE /ai/config` for an "AI reset" feature), the
   permission gate has to be remembered by the author.

### Invariant

> **`ai-config.ts` uses the same `.use(requirePermission(...))` chain
> pattern as every other route file.** `getUserIdFromRequest` is
> fine to keep (Elysia 1.2 has authContext-not-reaching-handler
> issues), but the per-perm check should be a plugin chain, not
> inline JS. Inline checks ARE acceptable for "defense-in-depth"
> secondary checks, but must not be the only check.

### Suggested test port

`apps/api/src/routes/ai-config.test.ts` (route-level bun:test):

```
test('GET /ai/config/status requires ai-config:read (already enforced)', () => {}); // existing
test('GET /ai/config requires ai-config:read', ...);
test('PUT /ai/config requires ai-config:update', ...);
test('POST /ai/config/test requires ai-config:update', ...);
test('userHasPermission static-imported (no dynamic import)', () => {
  // grep test: assert no `await import('../middleware/rbac')` in the built output
});
```

The "no dynamic import" test is informal but easily enforceable
via a build artifact grep.

---

## RG-027-CHAT-CONFIRMATION-IN-MEMORY-MAP — confirmation state lost on server restart

- **Discovered:** 2026-06-30 (code review)
- **File:** `apps/api/src/routes/chat.ts` line 50-60 (pendingConfirmations Map)
- **Status:** 🟨 OPEN — graceful degradation only; not a correctness bug

### Root cause

`pendingConfirmations` is a module-level `Map<id, { controller, userId }>`
held in process memory. When the user is mid-confirmation and the
api container restarts (e.g. `docker compose restart api` for a
deploy), the map is wiped. The next `/chat/confirm/:id` returns 404
("No pending confirmation with that id").

Mitigation: the LLM-side handler that created the confirmation
request will eventually hit the SSE timeout (configurable, default
no explicit timeout) and either re-emit a new proposal or error
out — the user's action is recoverable, just annoying.

### Invariant

> **`pendingConfirmations` map state is best-effort, in-memory
> only.** A graceful 404 on confirm-after-restart is acceptable
> for Day 18; persistence (Redis / DB) is a future enhancement
> (filed under "future ops"). The current invariant: **the user
> can always re-send their chat message** — restart does not lose
> unsaved chat content (the conversation row is in `prisma`), only
> the in-flight confirmation nonce.

### Suggested test port

```
test('pendingConfirmations is wiped on restart (graceful)', ...)
test('/chat/confirm/:id after restart returns 404 with explanatory message', ...)
test('user can re-send and re-receive confirmation_required', ...)
```

These are opportunistic tests; the main value is documenting
behavior, not regression-catching. Mark test as 🟨 expected.

---

## RG-028-LIST-EDIT-FETCH-PATTERN-OTHER-LISTS — same trap as RG-019 in non-quotation lists (deferred)

- **Discovered:** 2026-06-30 (code review)
- **Files:**
  - `apps/web/src/pages/man-day-roles.tsx`
  - `apps/web/src/pages/companies.tsx`
  - `apps/web/src/pages/products.tsx`
- **Status:** 🟢 MONITORED — no live bug, but track for future list-edit additions

### Root cause

The list-edit fetch-before-edit pattern (RG-019) was applied to
`pages/quotations.tsx` after the bug surfaced (the list endpoint
deliberately omits `items[]`). For ManDayRoles, Companies, Products,
Services — the list endpoints include enough fields for the edit
dialog, so a fetch-before-edit isn't needed today.

But: this is a project-policy invariant, not a per-route proof.
If a future list endpoint is added with the same "omit detail fields
for list-shape" optimization (e.g. `GET /quotations` already did
this for `items`), the same bug will recur unless the policy is
codified.

### Invariant

> **For any `ListPage → EditDialog` flow, the edit-dialog "open"
> handler MUST either:**
> 1. Fetch the full row via `<resource>Api.get(id)` before opening
>    the dialog, **OR**
> 2. Document explicitly that the list endpoint returns the full
>    shape needed by the edit dialog (the current `deals.tsx`,
>    `companies.tsx`, `products.tsx`, `man-day-roles.tsx` fall in
>    this bucket).
>
> Option 2 is acceptable if the list endpoint is read-heavy and the
> "full shape" is small. For Quotation specifically, option 1 is
> required (list endpoint omits `items[]` for performance).
>
> **Codify this as a CODEOWNERS / lint rule** — when a route module
> exports a list-shaped endpoint AND a list-edit flow, the list-edit
> handler MUST either fetch or document the full-shape contract.
> Suggested linter: a grep that fails `pages/*` files where
> `setEditing(...)` is called without `await *Api.get(...)` OR
> without an explicit "list endpoint returns full shape" comment.

### Suggested test port

Vitest (frontend) — `apps/web/src/lib/__tests__/list-edit-policy.test.ts`:

```
test('quotations.tsx openEdit calls quotationsApi.get(id)', ...)
test('companies.tsx onEdit does NOT fetch — list endpoint returns full shape', ...)
test('deals.tsx onEdit does NOT fetch — kanban endpoint returns full shape', ...)
```

The test simply checks for the presence (or absence) of the
`await *Api.get` pattern in the relevant handlers; a regression
where someone silently changes a list endpoint shape would surface
here.

---

## RG-029-QUOTATION-BUILDER-EDIT-MISSING-COMPANY-DISABLED — duplicate / consolidated with RG-025

(This entry has been consolidated into RG-025. QuotationBuilder
lacks `disabled={isEdit}` on `CompanyAutocomplete`, which is the
single source of truth for this invariant.)

---

## RG-030-ROUTER-PERMS-DROPPED-FROM-NEWER-MUTATIONS — registration-on-update path doesn't check perm

- **Discovered:** 2026-06-30 (code review)
- **File:** `apps/api/src/routes/users.ts` line 116-162 (PATCH /users/:id)
- **Status:** 🟨 DEFERRED — admin-only path, less risky than RG-022

### Root cause

`users.ts` DOES call `requirePermission('user:update')` for PATCH
(line 116), so this is fine. But adjacent code paths (RESET
PASSWORD endpoint at line 188 `POST /users/:id/reset-password`)
was not re-audited for `requirePermission` during this review.

Spot-check: `apps/api/src/routes/users.ts` line 188 → looks at
`requirePermission('user:create')` (intentional — only ADMIN can
reset). Probably fine. Filed as "always re-audit on the next
permission-key change".

### Invariant

> **Every mutating user endpoint MUST be gated by the matching
> `user:<verb>` permission.** Spot-audits on each new route
> addition. Suggested: a custom lint that grep + grep-flags-a-warning
> for `^(post|patch|put|delete)` in `apps/api/src/routes/users.ts`
> without `requirePermission` within ±10 lines.

### Suggested test port

`apps/api/src/routes/users.test.ts`:

```
test('POST /users/:id/reset-password requires user:create', ...)
test('GET /users/:id requires user:read', ...)
```

---

## RG-031-CHAT-SSE-CONTROLLER-CLOSED — `Invalid state: Controller is already closed` crashes /chat/send

- **Discovered:** 2026-07-02 (Day 21, AI Draft Quotation flow)
- **File:** `apps/api/src/routes/chat.ts:149` (`start(controller)` of the SSE `ReadableStream`)
- **Status:** 🟢 CLOSED (Day 21)

### Root cause

When the client disconnects mid-stream (browser tab close, network
drop, `AbortController` cancel), Bun's runtime auto-closes the
underlying `ReadableStreamDefaultController`. The agent loop's
`for await (const event of runAgentStream(...))` is still yielding
events; each subsequent `controller.enqueue(...)` throws
`TypeError: Invalid state: Controller is already closed`. The
catch block attempted to enqueue an `error` SSE event (also threw),
then `finally { controller.close() }` ran on an already-closed
controller (threw again). All three throws propagated as unhandled
errors in the stream.

### Invariant

> **`/chat/send` MUST survive client disconnects without throwing.**
>
> Two parts:
>
> 1. Every `controller.enqueue(...)` and `controller.close()` call
>    in the SSE handler MUST go through `makeSafeStreamController`
>    (`apps/api/src/lib/chat-sse.ts`) so a torn-down controller
>    short-circuits instead of throwing. The route MUST check
>    `r.ok` on every enqueue and break out of the loop when
>    `false`.
> 2. `runAgentStream` MUST receive `request.signal` so the agent
>    loop throws `AiAbortError` at the next checkpoint when the
>    client is gone — preventing wasted LLM tokens on a stream
>    nobody is listening to.

A future refactor that inlines `controller.enqueue(...)` again,
or removes the `signal` plumbing, re-introduces the bug.

### Fix shape

```ts
// apps/api/src/routes/chat.ts (post-fix)
const safe = makeSafeStreamController(controller);
try {
  for await (const event of runAgentStream({
    userId, message, conversationId,
    confirmationController: wrappedController,
    signal: request.signal,
  })) {
    const r = safe.enqueue(encoder.encode(sseFrame(event)));
    if (!r.ok) break; // client gone — stop yielding
  }
} catch (err) {
  if (err instanceof AiAbortError) { /* silent close */ }
  else if (!safe.isClosed()) { /* emit error event */ }
} finally {
  safe.close();
}
```

### Suggested test port

Pinned by:

- `apps/api/src/lib/__tests__/chat-sse.test.ts` — 6 tests for
  `makeSafeStreamController` (enqueue/close idempotency, closed-
  state tracking, swallow-on-runtime-error)
- `packages/ai/src/__tests__/abort.test.ts` — 4 tests pinning the
  `AiAbortError` public contract (`name === 'AbortError'`,
  `instanceof Error`, distinguishable from `AiNotConfiguredError`)

The full route-level integration (client aborts mid-stream,
server stops without throwing) is a manual smoke step: open
`/ai`, start "Draft a quotation for ...", close the tab while
tokens are streaming, watch the api container logs — must show
**no** `Invalid state: Controller is already closed` line.

---


## RG-029-I18N-NS-SHADOWED-BY-DEFAULTNS — `t('dashboard.title')` returned the literal key in every locale

**Symptom:** Dashboard rendered `dashboard.title`, `dashboard.welcomeBack`, `dashboard.kpi.companies`, `nav.appName`, `nav.dashboard`, etc. (literal i18n keys) instead of translated strings, in **all three** locales. The page logged in successfully, fetched data (KPIs, recent quotations) — only the chrome labels were broken.

**Root cause:** `apps/web/src/i18n/index.ts` had a wrapper around `i18n.t` to rewrite `dashboard.title` → `dashboard:title` (namespace-prefix style). The wrapper short-circuited on any `{ns: ...}` option:

```ts
if (opts && typeof opts.ns === 'string' && opts.ns.length > 0) {
  return originalT(key, options);  // BUG: bail out
}
```

`react-i18next`'s `useTranslation()` passes `{ns: 'common'}` (the configured `defaultNS`) on **every** call. So the wrapper bailed out for every cross-namespace key, the original t looked up `dashboard.title` in the `common` namespace, the lookup missed, and i18next returned the key as a fallback.

**Fix (2026-07-02):** the wrapper now ALWAYS applies the namespace-prefix rewrite when the key's first dot-segment matches a registered namespace, then **strips the `ns` option** from the call to `originalT` so the rewritten `head:rest` form isn't shadowed:

```ts
const cleanOptions =
  opts && Object.prototype.hasOwnProperty.call(opts, 'ns')
    ? { ...opts, ns: undefined }
    : options;
return originalT(`${head}:${rest}`, cleanOptions);
```

**Pinned by:**
- `apps/web/src/i18n/__tests__/namespace-resolution.test.ts` (9 tests). The previous version had a test `t("nav.appName", {ns:"common"}) → "nav.appName"` (asserted the bug); it is now flipped to `→ "CRM"`, plus a new test that `t("save", {ns: "nav"})` (no namespace prefix) DOES honour the explicit `ns` option.
- Manual Playwright smoke at `apps/web/scripts/i18n-smoke.mjs` — visits 11 pages in both zh-TW and zh-CN, scans the rendered body for `namespace.subkey` patterns that look like literal i18n keys. Must report `22/22 pass`.

**Symptom-scanner (cheap CI guard):** add a one-liner check in any future E2E:

```js
const literals = bodyText.match(/\b(common|nav|auth|role|status|errors|dashboard|settings|company|deal|quotation|product|service|contact|user|audit|ai|activity|attachment)\.[a-z][a-zA-Z0-9.]*/g);
if (literals?.length) throw new Error(`literal i18n keys rendered: ${literals.join(', ')}`);
```

**Lesson:** wrappers around third-party APIs have to honour ALL the ways the real caller invokes them, not just the one we tested. react-i18next's `useTranslation()`-injected `ns` option was the silent killer here — it would have shown up in a Playwright run, not in a unit test of the wrapper in isolation.

## RG-030-PIPELINES-PAGE-UNTRANSLATED — `/settings/pipelines` chrome was hardcoded English

**Symptom:** `/settings/pipelines` rendered "Drag rows to reorder. 改 name / probability / color 然後點擊 Save 或 Tab 走個 focus 即 save。" — the zh-TW/zh-CN `pipelineHelp` value was itself half-translated (mixed CJK + English field names + English UI verbs), AND the page itself had 10+ hardcoded English strings (`Add stage`, `Delete stage`, `Save changes`, `No stages yet`, `Cannot delete stage`, `Delete stage "X"?`, `Stage name`, `Stage color`, `Drag to reorder`, `{{count}} active deal(s) using this stage`, etc). The seeded pipeline name `Default Sales Pipeline` also showed in English regardless of locale.

**Root cause:** `apps/web/src/pages/settings.tsx` was never migrated when the Phase-2 i18n pass extracted strings from the other pages. The page was a `Day 11` page that pre-dated the i18n work, and the catalog values were written as Chinese-annotated English ("改 name / probability / color") instead of getting properly translated.

**Fix (2026-07-02):**
1. Added `settings.pipelines.*` (20 keys) and `settings.audit.*` (3 keys) to all three locales with proper Chinese — `拖曳行以重新排序。修改 名稱 / 機率 / 顏色 後,按儲存或離開焦點即自動儲存。` (zh-TW) / `拖动行以重新排序。修改 名称 / 概率 / 颜色 后,按保存或离开焦点即自动保存。` (zh-CN).
2. Added `settings.pipelines.defaultPipelineName` and a conditional render in `SettingsPage` so the seed name shows localised (`預設銷售流程` / `默认销售流程`) — but only when `defaultPipeline.name === 'Default Sales Pipeline'` (the canonical seed value). User-edited names pass through untouched.
3. Added `common.countDeals_one/_other` for the per-stage deal-count badge (uses i18next's plural rule so `count: 1` → `1 筆商機` and `count: 5` → `5 筆商機`).
4. Wrapped every JSX literal in the page (and in the `SortableStageRow` sub-component) with `t('settings.pipelines.X')`, including the `confirm()` in `requestDelete` and the `aria-label` / `title` / `placeholder` attributes.
5. Cleaned up the `settings.description` in zh-TW/zh-CN — was "...和 audit log。" (mixed CJK + English), now "...和稽核紀錄。" / "...和审计日志。"

**Pinned by:**
- `apps/web/scripts/i18n-smoke.mjs` — added `/settings/pipelines` to the page list (12 pages × 2 locales = 24/24 pass).
- A focused Playwright probe at `apps/web/scripts/i18n-pipelines-probe.mjs` (transient, not committed) that asserts the help text is fully translated AND that no leftover English strings appear on the page.
- `apps/web/src/i18n/__tests__/catalog-completeness.test.ts` — 6 tests confirm the new `settings.pipelines.*`, `settings.audit.*`, and `common.countDeals_*` keys exist in all three locales with identical key sets.

**Lesson:** when shipping i18n in waves (per-page), keep a running list of "pages that haven't been touched yet" and add a regression test that fails if a NEW page is added without a corresponding catalog update. The `i18n-smoke.mjs` page list is that mechanism — adding `/settings/pipelines` to the list was the moment this gap was forced open.

## RG-031-AI-CHAT-EMPTYSTATE-NO-SPINNER — first message from EmptyState had no loading indicator

**Symptom:** When the user lands on `/ai` with no active conversation (the `EmptyState` view) and types + sends a message, the buttons go `disabled` and the page sits visually frozen for several seconds before the first SSE `token` event arrives. From the user's perspective: "looks dead." The active-conversation view (`/ai` with an active id) DID show a `<Loader2 />` + "thinking" indicator at lines 280-285 — but that indicator lives inside the active-conversation JSX, not the EmptyState JSX.

**Root cause:** `apps/web/src/pages/ai-chat.tsx` `EmptyState` component (lines 321-394) handled the `disabled` prop only by greying out the example chips + submit button. It rendered no thinking indicator of its own. So when `setSubmitInFlight(true)` flipped `disabled` to true at the start of `handleSend`, the EmptyState had no UI signal that work was happening — and the page would not swap to the active-conversation view until the backend's `done` event created the row and re-queried the conversation list (multiple round-trips).

**Fix (2026-07-03):**
1. Added a thinking indicator inside `EmptyState` itself, gated by `disabled`:
   ```tsx
   {disabled && (
     <div
       className="mt-6 flex items-center gap-2 text-sm text-muted-foreground"
       data-testid="empty-state-thinking"
     >
       <Loader2 className="h-4 w-4 animate-spin" />
       {t('ai.chat.thinking')}
     </div>
   )}
   ```
   The translation key `ai.chat.thinking` already exists (used by the active-conversation path); no catalog change needed.
2. Comment block above the indicator explains why both paths now show it (no double-send, visual confirmation that the active-conversation view is about to swap in).

**Pinned by:**
- `apps/web/src/pages/ai-chat.tsx` — `data-testid="empty-state-thinking"` is a stable selector. A Playwright probe can grep for it after `await emptyInput.fill(...); await page.locator('button[type="submit"]').first().click();` and assert `waitFor({ state: 'visible', timeout: 5000 })`.
- Manual probe at `/tmp/pw-test/probe-empty-state-spinner.mjs` (transient) — clicks the sidebar "New Chat" button to enter EmptyState, sends a message, asserts the spinner is visible within 5s. PASS as of 2026-07-03.

**Lesson:** "Both branches must render the same loading state" is a pairing invariant — any time one branch of a conditional view (here, `!activeId` vs. `activeId`) shows a transient loading indicator, the OTHER branch must show it too, even if the user is about to swap views. The fix had no behaviour change beyond UX feedback — the SSE pipeline, message persistence, and conversation-swap are unchanged.

## RG-032-AI-CHAT-SALES-NAME-LOOKUP — AI forced UserId input for salesperson queries

**Symptom:** When the user asked the AI assistant "what has Admin User been doing lately?" or "David 最近 sales 情況", the AI replied with "please provide a UserId" instead of resolving the name. The only sales-by-user tool was `list_deals(ownerId=...)` which required a UUID; nothing in the tool registry could resolve a name to a user. Existing conversation transcripts show the AI literally listing its missing-tool inventory ("❌ 冇 (冇 search_users)", "❌ 冇 (冇 list_activities by user)").

**Root cause:** The original AI tool registry (`packages/ai/src/tools.ts`) was designed around entity IDs — every user-scoped query (`list_deals(ownerId)`, `get_company(id)`, `search_companies(query)`) accepted either an ID or a name-search-friendly string. But there's no `users` table equivalent — there's `list_companies` by name but no `list_users` by name. The sales-team workflow the AI is meant to support (managers asking about their reps, reps asking about each other) is name-first, not ID-first, so this was a usability blocker.

**Fix (2026-07-03):** Three new tools + one extension, all read-only (no confirmation gate):

1. **`search_users(query, role?, limit?)`** — substring-match on `User.name` and `User.email` (case-insensitive), filters to `isActive: true`, returns `{id, name, email, role}`. Capped at 50 results.
2. **`get_user_recent_activity(userId, type?, daysBack?, limit?)`** — `prisma.activity.findMany({ where: { authorId, createdAt: { gte: since } } })` ordered by `createdAt desc`, joined with company + deal. Hits the `[authorId, createdAt desc]` index on Activity. `daysBack` hard-capped at 365; `limit` hard-capped at 100.
3. **`get_salesperson_summary(userId, daysBack?)`** — 4 parallel aggregates (`Promise.all` of deals/quotations/activities/user), returns counts by status + total pipeline value (excludes LOST). Use this for "how is X doing" questions; cheaper than chaining list_deals + get_user_recent_activity.
4. **`list_deals(ownerName?)`** — new optional parameter alongside the existing `ownerId`. Server-side resolves the name to a userId via `prisma.user.findFirst({ where: { isActive: true, name: { contains, mode: 'insensitive' } } })`. If `ownerName` doesn't resolve, returns `[]` (empty list beats error). If both `ownerId` and `ownerName` are supplied, `ownerId` wins (explicit > fuzzy).

System prompt (`packages/ai/src/prompts.ts`) updated with a new `# Looking up people by name` section that:
- Tells the AI to call `search_users` whenever the user prompt contains a person reference
- Tells the AI to surface the matched name back to the user ("Found David Chu (admin@crm.local)...")
- Tells the AI to ask for disambiguation ONLY if multiple matches AND intent is ambiguous
- Provides a tool-selection matrix: row-level activity → `get_user_recent_activity`, aggregate → `get_salesperson_summary`, deals-by-name → `ownerName` param on `list_deals`.

**Pinned by:**
- `packages/ai/src/__tests__/tools.test.ts` line ~107-122 — pins the 3 new wire-format names (`search_users`, `get_user_recent_activity`, `get_salesperson_summary`) in the `READ_TOOLS` pin list. The existing partition invariant `WRITE_TOOLS ∪ READ_TOOLS == toolRegistry` (line 104) automatically validates the count.
- Manual Playwright probe at `/tmp/pw-test/probe-name-lookup.mjs` (transient) — sends "What has Admin User been doing in the last 30 days?" via the EmptyState composer, waits for the AI to finish streaming, asserts:
  - The conversation panel shows `search_users` and `get_user_recent_activity` tool pills (proves the AI called the new tools, not asked for a UserId).
  - The response contains a markdown table of real activity rows joined with company + deal.
  - The response surfaces the resolved name ("Here's what Admin User (admin@crm.local) has been doing…").
  - PASS as of 2026-07-03.

**Lesson:** when designing a tool registry, "what makes sense as an input parameter" and "what's natural for the user to provide" can diverge. `list_deals(ownerId)` is the correct wire format (UUIDs are stable, name changes don't break references), but the user-facing entry point is a name. The right answer is a thin **resolution layer** at the front of the chain — `search_users` + auto-resolution in `list_deals(ownerName)` — rather than asking the user to bridge the gap manually. Same pattern would apply to `list_quotations(salesRepName=...)` and `get_company(slugOrName=...)` if those workflows ever come up.
