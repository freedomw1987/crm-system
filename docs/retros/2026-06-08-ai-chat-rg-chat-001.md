# Day 16 — AI Chat Fix: empty bubble + Markdown/chart support (RG-CHAT-001)

> **Branch:** `main`
> **Commit:** `8484b9a` (pushed)
> **Date:** 2026-06-08
> **Reviewer:** Developer

---

## TL;DR

Two regressions in the AI assistant UI, fixed in one commit:

| # | Symptom | Fix | Smoke |
|---|---------|-----|-------|
| 1 | Empty grey assistant bubble rendered between user question and reply whenever the agent invoked a tool | Marker rows persisted as `content: "🔧 {toolName}"` sentinel; frontend `isToolMarker()` detects and renders as inline metadata pill | David verified ✅ |
| 2 | Assistant replies were plain text — no formatting, no tables, no charts | New `<MarkdownContent>` (react-markdown 10 + remark-gfm 4) + `<ChartBlock>` (chart.js 4 + react-chartjs-2 5); LLM taught ` ```chart ` fence syntax in system prompt | David verified ✅ |

**1 commit, 801 lines added, 27 removed.** Includes 7 unit tests
pinning the marker-row contract and a `REGRESSION-GUARD.md` entry
(RG-CHAT-001) with invariants.

---

## Root cause recap

### Bug 1 — empty bubble

`packages/ai/src/index.ts` has been persisting a marker row for
every tool invocation as `role: 'assistant', content: '', toolName:
'foo'`. This row is structurally required — the next turn's LLM
history reconstructor (lines 97-127) reads it back to rebuild the
OpenAI `tool_calls` shape. But the frontend `MessageBubble` had no
special case for `role: 'assistant' + toolName + empty content`, so
it fell through to the generic assistant branch and rendered the
empty `content` as a fully styled but completely empty grey box
between the user's question and the actual reply.

### Bug 2 — no Markdown / charts

`apps/web/src/pages/ai-chat.tsx` rendered `message.content` as
plain text via `{message.content}` + `whitespace-pre-wrap`. No
formatting of any kind. For the analytics-heavy questions the AI
assistant is meant to answer ("top 5 customers by revenue",
"revenue trend over Q1-Q4"), the result was unreadable walls of
text.

---

## What changed

### Backend — `packages/ai/src/index.ts`

- Marker row's `content` is now written as `` `🔧 ${toolName}` ``
  (sentinel string). Both old and new format are accepted by the
  frontend detector.
- The LLM history reconstructor coerces marker `content` to `null`
  before pushing into the OpenAI request — required by
  chat-completions spec for an assistant message that only carries
  `tool_calls`. Pre-fix this was already `m.content || null`, but
  with the new sentinel that would have shipped `"🔧 foo"` as
  `content` to OpenAI, which can 400 on some providers.
- Type cast on the in-loop tool_calls push relaxed (the
  `ChatCompletionMessage` type expects a `refusal` field that the
  request-side `ChatCompletionMessageParam` does not need).

### Backend — `packages/ai/src/prompts.ts`

Added a "Markdown and charts" section to `SYSTEM_PROMPT` teaching
the model:

- Replies are rendered as Markdown — use bold, lists, GFM tables,
  fenced code blocks, headings freely.
- For numeric comparisons or trends, emit a chart in addition to
  any text using the `` ```chart `` fenced-code-block syntax with a
  strict JSON spec (`{type, data: {labels, datasets}}`).
- 4 supported chart types: `bar`, `line`, `pie`, `doughnut`.
- ≤ 2 datasets per chart unless comparing more.

### Frontend — new components

- `apps/web/src/components/MarkdownContent.tsx` — splits source
  string on `` ```chart ``` fences, renders text segments with
  `react-markdown` + `remark-gfm`, renders chart segments with
  `<ChartBlock>`. Exports `<MarkdownContent>` for persisted
  messages and `<StreamingMarkdown>` for the in-flight reply (holds
  back rendering when a fence is still open to avoid half-rendered
  broken code blocks).
- `apps/web/src/components/ChartBlock.tsx` — Chart.js v4 wrapper
  with explicit `Chart.register(...)` for the controllers / scales
  / elements we need (bar, line, pie, doughnut). Default 8-color
  palette rotates per dataset. Graceful failure modes for malformed
  JSON and incomplete specs (raw JSON inside a small error card
  rather than a broken page).
- `apps/web/src/lib/chat-helpers.ts` — extracted `isToolMarker()` as
  a pure function for testability. The 7 unit tests live here.

### Frontend — `apps/web/src/pages/ai-chat.tsx`

- Imports `MarkdownContent`, `StreamingMarkdown`, and `isToolMarker`.
- `MessageBubble` now treats `role: 'tool'` AND
  `isToolMarker(message)` as inline metadata pills (not bubbles).
- Assistant messages render through `<MarkdownContent>`; user
  messages stay as plain `<div className="whitespace-pre-wrap">`
  (deliberate — user-typed text is NOT trusted to be safe
  Markdown, so we don't parse it as such).
- `StreamingBotMessage` uses `<StreamingMarkdown>` instead of raw
  text + cursor.

### Tests — `apps/web/src/lib/__tests__/chat-helpers.test.ts`

7 cases pinning the marker contract:

- new sentinel `"🔧 foo"` → detected
- new sentinel `"🔧 foo (failed)"` → detected (future-proofing)
- legacy empty content + toolName → detected (pre-fix DB rows
  still render correctly after deploy)
- normal assistant reply with prose → not detected
- defensive: assistant with toolName + real prose → not detected
  (prose wins, render as bubble)
- user message even with sentinel toolName → not detected
- `role: 'tool'` result row → not detected (handled separately)

```
$ cd apps/web && bun test src/lib/__tests__/chat-helpers.test.ts
 7 pass
 0 fail
```

### Docs — `docs/REGRESSION-GUARD.md`

Added **RG-CHAT-001** entry with:

- Symptom
- Root cause (2 parts)
- Prevention (frontend detector, sentinel contract, sentinel
  coerce on backend, streaming hold-back)
- Invariants (marker predicate is single source of truth; OpenAI
  content=null contract; `🔧` family is reserved)
- Re-test command
- Future work note (chart type extension path)

---

## Why these design choices

### Why react-markdown, not a from-scratch parser

`react-markdown` is the de facto safe Markdown renderer for React.
XSS surface is closed by construction (no `dangerouslySetInnerHTML`
in the default path). `remark-gfm` adds the GitHub-flavored
extensions (tables, strikethrough, task lists, autolinks) that the
existing data tables and bullet-heavy tool outputs will benefit
from. Bundle cost is +~30KB gzipped for both — acceptable for a
CRM feature that gets most of its value from data-dense answers.

### Why a ` ```chart ` fence, not inline JSX or a separate API

We considered two alternatives:

1. **Custom `<chart type="bar" data=... />` syntax in the LLM's
   output.** Rejected: the LLM would have to learn JSX attribute
   syntax, which is error-prone and harder to debug.
2. **A separate `chart_payload` field on the SSE event stream.**
   Rejected: it requires the backend to intercept the LLM's
   natural-language output, parse it, and split it from the
   surrounding prose — fragile and breaks the streaming UX (the
   chart would have to wait for the entire message to finish).

The fenced code block with a `chart` language tag is the cleanest
of the three. It's literally Markdown (so the raw text still
renders sensibly if the renderer doesn't understand the fence), the
JSON is trivially parseable, and the LLM already knows how to
emit fenced code blocks.

### Why the `🔧` sentinel, not just always render tool rows as pills

The backend persists a `role: 'assistant' + toolName` row AND a
`role: 'tool' + toolResult` row for every tool call. The latter is
the "this is the tool's response" record, already rendered as a
pill. The former is the "I invoked this tool" marker, with empty
`content` and a `toolName`. Without a distinguishing sentinel, the
two are easily confused. Using `🔧 {toolName}` makes the marker's
intent obvious in the DB itself, which is much easier to reason
about during support / debugging than "empty content + toolName
populated". The contract is documented in both files (backend
comment + frontend comment + REGRESSION-GUARD).

### Why `null` for marker content in the LLM request

OpenAI's chat-completions API allows `content: null` on an
assistant message that only carries `tool_calls`, and actively
discourages the alternative of passing the prose + tool_calls (some
providers / versions 400 on it). The pre-fix code happened to work
because `m.content || null` collapsed an empty string to `null`.
The new sentinel would have been passed as a real string and
risked 400s. Coercing to `null` unconditionally for marker rows is
the safer contract.

---

## What I learned

- **Pure-function extraction is a 5-minute investment that pays
  forever.** Pulling `isToolMarker` out of the React component
  took 30 lines of net change and gave me 7 testable contracts.
  Without it, the only way to test the empty-bubble fix would be
  to spin up the full chat UI with a fake SSE stream, which is
  hours of work and high-flake.
- **TypeScript's "missing property X" LSP errors are often
  red-herrings.** The `refusal`-missing complaint on the SDK type
  was pointing at a field that genuinely isn't part of the
  request-side type I was using. The fix wasn't to add the field,
  it was to relax the cast. Knowing when to listen to LSP vs.
  when to bypass it is a skill.
- **Sentinel design beats runtime introspection.** Using
  `content: "🔧 {toolName}"` to mark tool-marker rows is more
  debuggable than a `metadata` field, and easier to reason about
  than a regex on the message ID. Sentinels in the data beat
  sentinels in the schema.

---

## Out of scope (filed for later)

- **Chart sandbox expansion.** Currently limited to bar / line /
  pie / doughnut. If the user asks for scatter or radar, the
  Chart.js controller registration needs to grow. The recipe is
  noted in REGRESSION-GUARD.
- **Chart theming.** The 8-color palette is a placeholder. If the
  CRM's brand colors are standardized, plumb a theme through.
- **Interactive charts.** No click-to-drill-down yet. Chart.js
  supports it but the click handler would need to wire back into
  React Query to refetch a detail view — non-trivial scope, would
  need its own user story.
- **Markdown for user messages.** Deliberately excluded. A user
  could paste a malicious `javascript:` link or a `<script>` tag;
  parsing it as Markdown is a XSS vector. The textarea input is
  echoed verbatim. If the user actually wants to share formatted
  text, the right answer is a different product feature (rich
  text editor), not making the chat input Markdown-aware.

---

## Verification artefacts

- Commit: `8484b9a` (pushed to `origin/main`)
- Build: `bun run --filter '@crm/web' typecheck` → exit 0
- Tests: `bun test src/lib/__tests__/chat-helpers.test.ts` →
  7/7 pass
- Containers: `crm-web` + `crm-api` rebuilt and restarted, new
  image SHAs (David confirmed in his follow-up)
- Runtime: David smoke-tested "邊 5 個客戶最大貢獻 revenue?" and
  confirmed the empty bubble is gone and the chart renders.

---

## Files touched

| File | Lines |
|---|---|
| `apps/web/package.json` | +4 deps (react-markdown, remark-gfm, chart.js, react-chartjs-2) |
| `bun.lock` | +202 |
| `apps/web/src/components/MarkdownContent.tsx` | +129 (new) |
| `apps/web/src/components/ChartBlock.tsx` | +188 (new) |
| `apps/web/src/lib/chat-helpers.ts` | +35 (new) |
| `apps/web/src/lib/__tests__/chat-helpers.test.ts` | +80 (new) |
| `apps/web/src/pages/ai-chat.tsx` | +49 / -27 |
| `packages/ai/src/index.ts` | +24 / -7 |
| `packages/ai/src/prompts.ts` | +36 / -1 |
| `docs/REGRESSION-GUARD.md` | +65 |
| **Total** | **+801 / -27** |
