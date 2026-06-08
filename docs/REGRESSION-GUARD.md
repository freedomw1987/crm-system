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
