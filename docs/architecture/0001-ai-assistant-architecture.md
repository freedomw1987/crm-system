# ADR 0001: AI Assistant — build our own agent loop vs. use a framework

**Status:** Accepted (2026-06-09)
**Author:** David Chu + developer
**Supersedes:** —

---

## Context

We needed a way for the CRM's users to ask natural-language questions and
have the LLM take actions on their behalf (create a draft quotation, log an
activity, move a deal between kanban columns). This is the classic "agent
with tools" pattern. The main architectural choice is **how** to implement
the agent loop:

| Option | Examples | Trade-off |
|--------|----------|-----------|
| **A** Roll our own (use the `openai` SDK directly) | This project | Full control, no transitive deps, ~250 lines |
| B LangGraph | LangGraph | Heavy framework, opinionated graph model, lots of features we don't need |
| C Mastra | Mastra | Newer, React-friendly, but adds another abstraction layer |
| D Vercel AI SDK | `ai` + `@ai-sdk/openai` | Great DX, but couples us to Vercel's data-streaming protocol |
| E Custom agent on top of raw `fetch` to OpenAI | This project (without SDK) | Even less control over retries / streaming |

The team has limited bandwidth and the requirements are:
1. Read 7 entities (companies, products, services, quotations, deals,
   activities, attachments)
2. Write 3 things (draft quotation, log activity, update deal stage)
3. Persist conversation history so users can resume
4. Stay under the project's "one bun runtime, no Node-only deps" constraint

## Decision

**Build our own agent loop in `packages/ai/` using the `openai` SDK (which
is OpenAI-compatible).** ~250 lines of code, zero framework deps beyond
`openai` and `@crm/db`.

## Rationale

1. **Bun compatibility** — LangGraph and Mastra are Node-first and pull
   in transitive deps that broke in our previous Bun + arm64 Docker
   builds. The `openai` SDK is a single small package and works on Bun.

2. **Full control over the loop** — our loop is:
   ```
   load config → ensure conversation → save user msg → load history
   → for up to 6 iterations:
       call LLM with tool defs
       if no tool_calls: save final reply, return
       for each tool_call:
           execute (prisma) → save assistant+tool messages
           append tool result to messages
   ```
   That's 60 lines of actual logic. A framework would obscure this.

3. **Tool calls are first-class in our DB** — every `assistant` and
   `tool` message is persisted in `conversation_messages` with the
   `toolName`, `toolArgs`, `toolResult` fields. This means we can
   reconstruct the entire conversation exactly, and we can audit
   later what the agent did.

4. **Graceful degradation is one line** — if a tool throws, we catch
   the error and feed `{ error: "..." }` back to the LLM so it can
   try a different approach (instead of crashing the whole request).

5. **We can swap LLM providers trivially** — `OpenAI({ apiKey, baseURL })`
   works for OpenAI, Together, OpenRouter, vLLM, Ollama — anything
   that speaks the OpenAI Chat Completions API. The admin's
   `endpointUrl` config is exactly this.

6. **Streaming is a future add** — when US-C7 lands, we'll switch
   `client.chat.completions.create()` to `client.chat.completions.create({
   stream: true })` and pipe the chunks back as SSE. No framework
   refactor needed.

## Consequences

### Positive
- ~250 lines of code we fully understand
- No new framework on the critical path (only `openai` SDK, which
  was already approved)
- Conversation history is queryable in plain SQL
- Adding a new tool is ~30 lines in `tools.ts`

### Negative
- We own the agent loop's correctness (no community-tested framework
  backing us up)
- If we ever need 100+ tools, the JSON schema size will grow and we
  may hit context-window limits (today: 11 tools, ~2.5 KB of JSON
  schema — well under any limit)
- The 6-iteration cap is a magic number; if a real-world query needs
  7+, we need to bump it. Monitor via the `usage.totalTokens` log.

### Risks mitigated

- **Encryption at rest** — API key is AES-256-GCM encrypted with a
  master key from `AI_CONFIG_ENCRYPTION_KEY` env var. Decryption
  happens in-memory only, never logged. (`packages/ai/src/encryption.ts`)
- **Permission boundary** — chat route requires a valid JWT; the
  tools use `ctx.userId` as the actor (not the admin who configured
  the AI). The `AiConfig` endpoints require `ai-config:read` /
  `ai-config:update` permission.
- **No env-var fallback** — `runAgent()` only reads from DB. Env var
  is never checked (RG-002 invariant).
- **Friendly 503 when not configured** — `chat.ts` pre-checks
  `AiConfig` and returns 503 + helpful message instead of crashing
  the LLM call (RG-002/003 fix).

## Tool registry policy

| Direction | Approval |
|-----------|----------|
| Add a read tool | Trivial — append to `tools.ts` |
| Add a write tool | Requires ADR update + product owner signoff (David) |
| Change a tool's schema | Update the tool description, bump nothing (LLM re-reads tools each call) |
| Remove a tool | Bump conversation schema or accept that old conversations reference missing tool names |

## Alternatives we considered

- **LangGraph** — beautiful for complex multi-agent flows (e.g.
  researcher + writer), overkill for our 11-tool single-agent case.
  Adds 12 transitive deps.
- **Mastra** — newer, nicer DX, but our team has zero prior
  experience with it. The "roll our own" approach matches our
  existing codebase style (each package is small + focused).
- **Vercel AI SDK** — great DX, but the data-streaming protocol
  would require Elysia to speak a specific SSE format, and we'd
  lose the easy "persist message + tool_call" flow.

## References

- `packages/ai/src/index.ts` — the loop
- `packages/ai/src/tools.ts` — the 11 tools
- `packages/ai/src/encryption.ts` — AES-256-GCM
- `packages/ai/src/prompts.ts` — the system prompt
- `packages/ai/src/config.ts` — DB-backed config loader
- `docs/REGRESSION-GUARD.md` — RG-002 (env-var drift) invariant
- `docs/PRD.md` — Epic C US-C1..C4
