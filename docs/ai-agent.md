# AI Agent

The CRM system has a built-in OpenAI function-calling agent. The
web UI is at `/ai-chat`; the HTTP API is at `POST /api/chat/send`.

Source: `packages/ai/src/index.ts` (loop) and
`packages/ai/src/tools.ts` (8 tools).

---

## Loop

```
User message
   │
   ▼
load conversation history (last N turns) from DB
   │
   ▼
system prompt + history + user message  ──►  OpenAI chat.completions
   │                                            model: env.OPENAI_MODEL (default gpt-4o-mini)
   │                                            tools: toolRegistry
   ▼
if response.tool_calls is non-empty:
   for each call:
      1. validate args against tool.parameters (JSON schema)
      2. execute(args, { userId })
      3. persist ConversationMessage(role=tool, toolName, toolArgs, toolResult)
      4. send tool result back to the model
      5. loop
else:
   final assistant text
   persist ConversationMessage(role=assistant, content=reply, promptTokens, completionTokens)
   │
   ▼
return { conversationId, reply, toolCalls, usage }
```

### Key implementation details

- **Tool calls persist as messages** so the conversation is
  replayable and inspectable in the audit trail.
- **Token usage is recorded** on the assistant message for cost
  monitoring. The dashboard at `/dashboard` sums these by user / day.
- **Errors from tool execution** are returned to the model as
  `tool_result` with an `error` field, and the model is expected to
  recover (e.g. search again with a different query). Catastrophic
  failures short-circuit the loop.
- **The agent never calls `prisma` directly** — it goes through the
  `toolRegistry`, which is the only surface where DB access is
  permitted from the AI context. This keeps prompt injection attacks
  scoped.
- **System prompt** lives in `packages/ai/src/prompts.ts` and
  contains the CRM-aware persona + a reminder of the tool catalogue
  (so the model doesn't hallucinate tool names).

---

## Tools

Each tool defines a JSON-Schema `parameters` object that matches
OpenAI's function-calling format. The agent picks the right tool
based on the schema's `description`.

### 1. `search_companies`

Search for customer companies.

| Parameter  | Type   | Required | Notes                                         |
| ---------- | ------ | -------- | --------------------------------------------- |
| `query`    | string |          | Matches `name`, `legalName`, `email`           |
| `industry` | string |          |                                               |
| `status`   | enum   |          | `active` / `inactive` / `blacklisted`          |
| `limit`    | number |          | default 10                                    |

Returns an array of `{ id, name, industry, status, contactCount, quotationCount, dealCount }`.

---

### 2. `get_company`

Get a single company with everything attached.

| Parameter   | Type   | Required | Notes                |
| ----------- | ------ | -------- | -------------------- |
| `companyId` | string | ✓        |                      |

Returns the full Company record with `contacts`, `addresses`, last
10 `quotations`, and last 10 `deals` included.

---

### 3. `search_products`

Product catalogue search.

| Parameter  | Type   | Required | Notes                                      |
| ---------- | ------ | -------- | ------------------------------------------ |
| `query`    | string |          | Matches `name`, `sku`, `description`         |
| `category` | string |          |                                            |
| `limit`    | number |          | default 20                                 |

Filters to `status: 'ACTIVE'` only. Returns
`{ id, sku, name, description, category, unitPrice, currency, stockQuantity }`.

---

### 4. `list_quotations`

Recent quotations with optional filters.

| Parameter   | Type   | Required | Notes                                          |
| ----------- | ------ | -------- | ---------------------------------------------- |
| `companyId` | string |          |                                                |
| `status`    | enum   |          | one of the `QuotationStatus` values             |
| `limit`     | number |          | default 20                                     |

Returns each quotation with `{ company: { id, name }, _count: { items } }`.

---

### 5. `list_deals`

Recent deals.

| Parameter   | Type   | Required | Notes                                |
| ----------- | ------ | -------- | ------------------------------------ |
| `status`    | enum   |          | `OPEN` / `WON` / `LOST`              |
| `ownerId`   | string |          |                                      |
| `companyId` | string |          |                                      |
| `limit`     | number |          | default 20                           |

Returns each deal with `{ company: { id, name }, owner: { id, name }, stage: { name, probability } }`.

---

### 6. `draft_quotation`

Create a DRAFT quotation from a structured item list. **The agent
should resolve every product by SKU first via `search_products`,
then pass the resolved IDs in here.**

| Parameter  | Type     | Required | Notes                                                                              |
| ---------- | -------- | -------- | ---------------------------------------------------------------------------------- |
| `companyId`| string   | ✓        | must be resolved via `search_companies` first                                       |
| `items`    | array    | ✓        | each: `{ productId?, sku?, name, quantity, unitPrice, discount? }` — at minimum `name`, `quantity`, `unitPrice` required |
| `title`    | string   |          |                                                                                    |
| `notes`    | string   |          |                                                                                    |
| `taxRate`  | number   |          | percentage, default 0                                                              |
| `prompt`   | string   |          | the original user prompt (stored on the quotation as `aiPrompt` for audit)          |

Side effects:
- Auto-generates `number` as `Q-<year>-<NNNN>`.
- Computes `subtotal`, `taxAmount`, `total` server-side.
- Sets `generatedByAi: true` and `aiPrompt: <prompt>` on the new row.
- Creates `QuotationItem` rows in one transaction.

Returns `{ quotationId, number, company, total, itemCount }`.

> The agent does **not** handle `SERVICE` items yet — only products.
> If the user mentions a service by name, the agent should say so
> and ask the user to add it via the UI (or, in a future iteration,
> we'd add a `search_services` tool).

---

### 7. `log_activity`

Log a sales activity against a company, contact, or deal.

| Parameter   | Type   | Required | Notes                                                  |
| ----------- | ------ | -------- | ------------------------------------------------------ |
| `type`      | enum   | ✓        | `CALL` / `EMAIL` / `MEETING` / `NOTE` / `TASK`         |
| `subject`   | string | ✓        |                                                        |
| `body`      | string |          |                                                        |
| `companyId` | string |          |                                                        |
| `contactId` | string |          |                                                        |
| `dealId`    | string |          |                                                        |
| `dueAt`     | string |          | ISO datetime, for `TASK`                               |

The actor (`assignedToId`) is set from the JWT's `userId`. Side
effect: writes an `ActivityLog` row.

---

### 8. `get_top_customers`

Revenue analysis.

| Parameter      | Type   | Required | Notes                                       |
| -------------- | ------ | -------- | ------------------------------------------- |
| `limit`        | number |          | default 5                                    |
| `statusFilter` | enum   |          | `all` (default) / `accepted` / `invoiced`    |

Groups quotations by company, sums `total`, returns
`{ companyId, companyName, industry, totalRevenue, quotationCount }`.

---

## Tool registry

```ts
// packages/ai/src/tools.ts
export const toolRegistry: Tool[] = [
  searchCompanies,
  getCompany,
  searchProducts,
  listQuotations,
  listDeals,
  draftQuotation,
  logActivity,
  getTopCustomers,
];
```

---

## Conversation model

See [`database.md` § "Conversation & ConversationMessage"](./database.md#19-conversation--20-conversationmessage)
for the storage shape. The `/ai-chat` page is a thin React wrapper
that POSTs to `/api/chat/send` and renders the returned `toolCalls[]`
in a collapsible panel below the assistant's reply.

### Tool-call rendering

Each `toolCalls[i]` row shows:

- the tool name (monospace, e.g. `draft_quotation`)
- the args (pretty-printed JSON)
- the result (pretty-printed JSON, collapsed by default)
- a hyperlink to any created resource (e.g. for `draft_quotation`,
  a link to `/quotations/<id>`)

This makes the agent's reasoning transparent and gives the user a
quick path to verify the work.

---

## Prompt patterns

A few well-tested prompts in 繁體中文 (Cantonese-style):

> 「ACME 嘅最近 5 個 quotation 點?」

→ triggers `search_companies` then `list_quotations`.

> 「幫我喺 ACME 開個 quotation, 5 個 HW-MON-001, 2 個 SVC-CONS-001」

→ triggers `search_companies` (resolve ACME) → `search_products`
(resolve both SKUs) → `draft_quotation`.

> 「Log 個 call with Globex 嘅 Sarah, outcome interested」

→ triggers `search_companies` (resolve Globex) → `log_activity` with
`type: CALL`.

If the user prompt is too vague, the agent should ask a clarifying
question rather than guessing.

---

## Adding a new tool

1. Add a `Tool` literal to `packages/ai/src/tools.ts` with `name`,
   `description`, `parameters` (JSON schema), and `execute`.
2. Push it into the `toolRegistry` array.
3. Document it in this file under [Tools](#tools).
4. Add a corresponding test (if a test infrastructure exists) and
   verify the agent picks it in a smoke test against a real
   conversation.

The system prompt in `prompts.ts` enumerates the tool names to the
model, so the new tool is immediately callable.
