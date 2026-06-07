# CRM System — Project Overview

> **Status:** Day 10 shipped. AI Assistant infrastructure complete (DB schema,
> AI package, routes, UI, FAB). Three audit bugs fixed in this batch (RG-002/003/004).

---

## 1. One-line summary

A bilingual (繁中/English) CRM for small sales teams — sales reps manage
companies / deals / quotations / services; admins manage users / roles / a
man-day role pricing catalogue; **and a built-in AI Assistant (Day 10) that
talks to an admin-configured LLM and can read + write CRM data via tool
calling.**

## 2. Tech stack

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | React 19 + Vite + TypeScript + TanStack Query | Fast SPA, good DX, no SSR overhead |
| UI lib | Tailwind CSS + shadcn-style primitives | Customisable, no Material lock-in |
| Backend | Elysia 1.2 (Bun) | TS-first, fast, runs on Bun runtime |
| ORM | Prisma 5.22 + PostgreSQL | Stable, good migration tooling |
| AI SDK | `openai` (OpenAI-compatible) | One SDK covers OpenAI / Together / OpenRouter / vLLM / Ollama |
| Auth | JWT (jose) + bcrypt | Stateless, easy to inspect, dev-friendly |
| Infra | Docker Compose (api + web + postgres) | Single `docker compose up` brings everything up |
| Reverse proxy | nginx (bundled in `crm-web`) | SPA fallback + `/api` proxy to crm-api:3001 |

## 3. Repo layout

```
crm-system/
├── apps/
│   ├── api/                     Elysia backend
│   │   └── src/
│   │       ├── index.ts         App bootstrap + middleware
│   │       ├── routes/          One file per resource (auth, company, deal, …, ai-config, chat)
│   │       └── middleware/      rbac.ts, audit.ts
│   └── web/                     React SPA
│       └── src/
│           ├── pages/           One file per route (login, dashboard, …, ai-chat, ai-config)
│           ├── components/      Reusable UI (form fields, dialogs, ai-fab, …)
│           └── lib/             api.ts (typed fetch wrappers), auth.ts (AuthContext)
├── packages/
│   ├── db/                      Prisma schema + migrations + seed
│   ├── ai/                      OpenAI-compatible agent loop + tool registry + encryption
│   └── shared/                  Permission enum shared by frontend + backend
├── docs/                        (this folder)
└── docker-compose.yml
```

## 4. Day-by-day shipping history (high level)

| Day | Theme | Ships |
|-----|-------|-------|
| 1-5 | Auth, RBAC, companies, deals, quotations | Core CRM |
| 6 | Polish + RWD | Login, mobile nav |
| 7 | Services + dynamic RBAC + roles UI | SOW pricing + custom roles |
| 8 | Regions + deal kanban | Pipeline view |
| 9 | Man-day role catalogue + activity log + attachments + quotation GP | Sales ops |
| **10** | **AI Assistant (this batch)** | **Settings + chat + 11 tools** |

## 5. Day 10 — AI Assistant in one paragraph

`packages/ai` ships a `runAgent(userId, message, conversationId?)` function
that:

1. Loads the singleton `AiConfig` row from the DB (admin-set endpoint URL,
   encrypted API key, model name, optional system prompt).
2. Constructs an `OpenAI({ apiKey, baseURL })` client.
3. Pulls the conversation history (last 20 messages) and replays it as
   `OpenAI.Chat.ChatCompletionMessageParam[]`.
4. Loops up to 6 times: call the LLM with the 11-tool registry; on
   `tool_calls`, execute each via `prisma.*`; persist assistant+tool messages;
   feed results back; continue. On final reply, persist and return.
5. All persistence goes through `Conversation` + `ConversationMessage` so a
   user can resume any chat later from `/ai`.

The frontend `/ai` page (left sidebar = past conversations, right pane =
active chat) calls `POST /chat/send` and shows streaming-style incremental
rendering via React Query mutation state.

## 6. The 11 AI tools (Q2=C — full CRUD scope)

| Tool | Read/Write | Why |
|------|-----------|-----|
| `search_companies` | R | Free-text + filter |
| `get_company` | R | Single record with relations |
| `search_products` | R | SKU search |
| `search_services` | R | SOW search |
| `list_quotations` | R | With status/company filter |
| `list_deals` | R | With status/owner/company filter |
| `get_top_customers` | R | Revenue analytics |
| `draft_quotation` | **W** | Create DRAFT quotation with line items |
| `log_activity` | **W** | Create activity log entry |
| `update_deal_stage` | **W** | Move deal between kanban columns (logs Activity) |

**Safety guardrail (Day 10+ scope):** mutations still require admin
`ai-config:update` permission to even start a chat (RBAC on the chat route),
but the dangerous ops (draft_quotation, update_deal_stage) are unconstrained
inside the tool executor — a follow-up "AI proposes, human confirms" layer
is on the roadmap.

## 7. Permissions model

`packages/shared/src/permissions.ts` is the single source of truth. The
backend `userHasPermission(userId, permission)` resolves the user's `Role` and
returns a boolean. The `Role` table is seeded with 4 system roles
(`ADMIN`, `SALES`, `MANAGER`, `VIEWER`) and admins can create custom roles
via the UI at `/admin/roles`.

## 8. Where to read more

- `docs/PRD.md` — User Stories + acceptance criteria
- `docs/DESIGN.md` — UI/UX tokens, layout, component library
- `docs/API.md` — Every HTTP endpoint with auth, request, response
- `docs/architecture/0001-ai-assistant-architecture.md` — Why we built
  our own agent loop instead of using LangGraph/Mastra
- `docs/QA-TRACKER.md` — Status of every US
- `docs/REGRESSION-GUARD.md` — Every bug we've ever fixed, with the
  invariant that must hold forever
