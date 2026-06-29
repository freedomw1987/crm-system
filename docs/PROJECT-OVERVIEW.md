# CRM System — Project Overview

> **Status:** Day 18+ shipped. ~140 commits past initial scaffold.
> Core CRM + AI Assistant in production. Recent sprints landed
> standard versioning for quotations, sales-rep assignment,
> multi-currency snapshots (HKD / MOP), author-only Activity
> CRUD, and a Deals → Quotations → Activities drill-down
> navigation chain. Deployed via `docker compose up -d --build`;
> migrations auto-apply via the api container's entrypoint.

---

## 1. One-line summary

A bilingual (繁中 / English) CRM for small sales teams — sales reps
manage companies / deals / quotations / services; admins manage
users / roles / a man-day role pricing catalogue + system settings;
**and a built-in AI Assistant that talks to an admin-configured LLM
and can read + write CRM data via tool calling (with human-in-the-loop
confirmation on dangerous ops).**

---

## 2. Tech stack

| Layer        | Choice                                              | Why |
| ------------ | --------------------------------------------------- | --- |
| Frontend     | React 19 + Vite + TypeScript + TanStack Query      | Fast SPA, good DX, no SSR overhead |
| UI lib       | Tailwind CSS + shadcn-style primitives             | Customisable, no Material lock-in |
| Backend      | Elysia 1.2 (Bun)                                    | TS-first, fast, runs on Bun runtime |
| ORM          | Prisma 5.22 + PostgreSQL                            | Stable, good migration tooling |
| AI SDK       | `openai` (OpenAI-compatible)                        | One SDK covers OpenAI / Together / OpenRouter / vLLM / Ollama |
| Auth         | JWT (jose) + argon2id via `Bun.password.hash`      | Stateless, easy to inspect, dev-friendly |
| Storage      | Local FS under `DATA_DIR` for attachments          | Single-host deployment, simple to back up |
| Infra        | Docker Compose (api + web + postgres + adminer)    | Single `docker compose up` brings everything up |
| Reverse proxy| nginx 1.27-alpine (bundled in `crm-web`)           | SPA fallback + `/api` proxy to crm-api:3001 |
| Migrations   | Prisma-generated + manual for enum drift / DDL     | Entry point runs `prisma migrate deploy` on every `up -d` |

---

## 3. Repo layout

```
crm-system/
├── apps/
│   ├── api/                           Elysia backend
│   │   └── src/
│   │       ├── index.ts               App bootstrap + middleware
│   │       ├── routes/                One file per resource
│   │       │                           (auth, company, contact, deal,
│   │       │                           product, service, quotation,
│   │       │                           activity, region, role, user,
│   │       │                           settings, audit, ai-config, chat)
│   │       ├── lib/                    Context, helpers, adapters,
│   │       │                           excel helpers, audit retention
│   │       └── middleware/             RBAC + audit
│   └── web/                           React SPA
│       └── src/
│           ├── pages/                 One file per route (login,
│           │                           dashboard, companies, deals,
│           │                           deal-detail, quotations,
│           │                           quotation-detail, services,
│           │                           products, ai-chat, ai-config,
│           │                           settings/* subroutes, etc.)
│           ├── components/            Reusable UI (autocompletes,
│           │                           dialogs, activity feed, line
│           │                           item snapshot, markdown,
│           │                           quotation builder, …)
│           └── lib/                    api.ts (typed fetch),
│                                       auth.ts (zustand store),
│                                       utils (format*, runtime paths,
│                                       attachment download)
├── packages/
│   ├── db/                            Prisma schema + migrations +
│   │                                   seed + currency config
│   ├── ai/                            OpenAI-compatible agent loop +
│   │                                   tool registry + encryption +
│   │                                   human-in-the-loop confirmation
│   └── shared/                         RBAC permission enum (shared
│                                       between frontend + backend)
├── docs/                              This folder
└── docker-compose.yml
```

---

## 4. Day-by-day shipping history (high level)

| Day(s)  | Theme                                              | Ships                                                                                              |
| ------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1-5     | Auth, RBAC, companies, deals, quotations          | Core CRUD + JWT auth                                                                              |
| 6       | Polish + RWD                                       | nginx SPA fallback fix, defensive list-shape on the FE                                          |
| 7       | Services + dynamic RBAC + roles UI                | SOW pricing + custom roles; polymorphic QuotationItem (PRODUCT / SERVICE)                          |
| 8       | Regions + Deal Kanban                              | FK-based Region table; kanban board + drag-drop                                                    |
| 9       | Man-day role catalogue + Activity + attachments + Quotation GP% | Sales ops; ServiceStatus enum drift fixed via manual migration                       |
| **10**  | **AI Assistant**                                   | Singleton AiConfig (encrypted key), 11-tool registry, conversation memory                        |
| 10.1    | Streaming + tool pill UX (SSE)                    | `text/event-stream` response, inline tool pills                                                    |
| 11      | Settings + Pipeline CRUD + AI `list_pipelines`    | Day-11 settings + AI tool                                                                         |
| 14      | SystemConfig + Tax rate (US-S4)                   | Admin-editable tax rate, QuotationBuilder auto-prefill                                            |
| 14.7    | Settings refactor + 5 admin tabs                   | `/settings/*` subroutes, sidebar collapse                                                         |
| 15+     | Quotation GP% formula tests, audit retention        | Day-17 P1 sprint (P1-1..P1-10), TEC-DEBT cleanup                                                  |
| 16-17   | P0-SP1 hardening (security + RBAC)                | Self-registration lock, strong passwords, AI Config perm gate, etc.                              |
| **18+** | **Standard versioning for Quotations + sales-rep + multi-currency + Activity CRUD** | See §6 "Recent features" — Day 18 sprint net: parentQuotationId chain, salesRepId on Deal/Quotation, multi-currency HKD + MOP snapshot, author-only Activity edit/delete, Deal detail page with quotation + activity tabs, list-page edit fetch, snapshot precedence on read-only surfaces, etc. |

---

## 5. The 11 AI tools (Day 10 scope)

| Tool                  | R/W | Notes                                                  |
| --------------------- | --- | ------------------------------------------------------ |
| `search_companies`    | R   | Free-text + filter                                    |
| `get_company`          | R   | Single record with relations                          |
| `search_products`      | R   | SKU search                                             |
| `search_services`      | R   | SOW search                                             |
| `list_quotations`      | R   | With status / company filter                          |
| `list_deals`           | R   | With status / owner / company filter                  |
| `get_top_customers`    | R   | Revenue analytics                                      |
| `draft_quotation`      | **W** | Create DRAFT quotation with line items — **REQUIRES human confirmation (Day 17 RG-CHAT-002)** |
| `log_activity`         | **W** | Create activity log entry — **REQUIRES confirmation**   |
| `update_deal_stage`    | **W** | Move deal between kanban columns + log Activity — **REQUIRES confirmation** |

**Safety guardrail (Day 17, RG-CHAT-002):** the 3 write tools are tagged
`requiresConfirmation: true`. The agent emits a `confirmation_required`
SSE event with a stable `hashArgs` key; the route stores the proposal
and surfaces it to the frontend's Radix dialog. Audit log records
`AI_TOOL_CONFIRMED` or `AI_TOOL_DENIED` so the trail is reproducible.

---

## 6. Recent features (Day 16-18 sprint bundle)

| Feature                             | Where                                          | Behavior                                                                                              |
| ----------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **QuotationItem snapshot precedence on read-only surfaces** | QuotationDetailPage (normal + print) + Excel | Description, SOW / man-day breakdown, "(已刪除)" badge when the catalogue record was deleted (P1-10 → P2-snapshot-display). |
| **Deal ↔ Quotation drill-down**     | `/deals/:id`                                  | New page; lists all quotations on the deal + activity log. Kanban card now links here.                |
| **Standard versioning for Quotations** | `POST /quotations/:id/revise`, `parentQuotationId` FK | SENT-locked fields are immutable by design; user clicks "建立修訂" → new DRAFT linked via `parentQuotationId` with chain-aware `revisionNumber` + numbered `Q-YYYY-NNNN-R{N}`. Smoke-tested chain: R1 → R2 → R3. |
| **Sales-rep assignment on Deal + Quotation** | `ownerId` (Deal) + new `salesRepId` (Quotation)         | Owner selector in DealDialog; sales-rep selector in QuotationBuilder; surfaces on list, detail, kanban (owner-initial avatar). Separable from `createdById` so a sales engineer can build the quote while an account exec follows up. |
| **Quotation ↔ Deal linkage via PATCH** | `PATCH /quotations/:id` (dealId accepted)        | Was a void: PATCH body schema silently dropped `dealId`. Now sent + persisted. Sent the request to also relax the SENT lock around `dealId` (commit `02c333a`). |
| **List-page edit fetch fix**         | `/quotations` → 編輯 button                    | List endpoint returned `_count.items` only; opening edit opened an empty form. Now fetches full quotation first, then opens modal. |
| **Author-only Activity edit + delete** | `PATCH /activities/:id`, `DELETE /activities/:id` | Edit + delete affordances on the activity feed; backend 403 if requester isn't the author. |
| **Author-only attachment CRUD**      | Attachment routes                              | Mirror of the Activity rules — users can edit/delete their own uploads only.                       |
| **Multi-currency snapshots (HKD + MOP)** | `SystemConfig` keys, `Quotation.exchangeRateToHKD` + `totalHKD` (mirror) + `exchangeRateToMOP` + `totalMOP` | Each Quotation captures the customer's chosen currency at send time and the live rates; the Excel `sow` sheet renders the HKD (default) and MOP equivalent rows. Currency picker flows from system default → Deal → QuotationBuilder. |
| **Deal pipeline activity filter**    | `GET /activities?dealId` filter                | New filter chips on the Deals activity panel: 上週 / 上月 / 自訂 range.                               |

See `docs/REGRESSION-GUARD.md` for the bug entries the Day 16-18 sprint fixed.

---

## 7. Permissions model

`packages/shared/src/permissions.ts` is the single source of truth. The
backend `userHasPermission(userId, permission)` resolves the user's
`Role` and returns a boolean. The `Role` table is seeded with 3 system
roles (`ADMIN`, `SALES`, `VIEWER`); admins can create custom roles via
the UI at `/admin/roles`.

Permission catalogue (29 entries, see [`rbac.md`](./rbac.md) for the
full per-role matrix):

| Group         | Permissions |
| ------------- | ----------- |
| User / system admin | `user:read/create/update/delete`, `audit:read` |
| AI Assistant config  | `ai-config:read/update` (admin only)            |
| Service catalogue    | `service:read/create/update/delete` (service + man-day role + ServiceManDay) |
| Role management       | `role:read/create/update/delete` (admin only)  |
| CRM resources         | `company:*`, `contact:*`, `product:*` (SALES can read products only), `quotation:*` (incl. `quotation:send`), `deal:*` |
| AI agent             | `chat:use` (any authenticated user)            |
| System Configuration | `settings:read/update` (admin only)            |

All API routes that mutate state call `requirePermission(key)` after
`authContext` validates the JWT, so an unauthenticated request returns
401, and an authenticated-but-unauthorised request returns 403.

---

## 8. Where to read more

- [`database.md`](./database.md) — every model, field, index, enum, ERD
- [`api.md`](./api.md) — full HTTP endpoint reference
- [`ai-agent.md`](./ai-agent.md) — AI tool catalogue and conversation model
- [`frontend.md`](./frontend.md) — pages, components, and the API client
- [`rbac.md`](./rbac.md) — permission catalogue and enforcement
- [`architecture.md`](./architecture.md) — request lifecycle + wire-format conventions
- [`operations.md`](./operations.md) — env vars, Docker, migrations, deploy
- [`TECH-DEBT.md`](./TECH-DEBT.md) — tech debt register (P0..P2)
- [`QA-TRACKER.md`](./QA-TRACKER.md) — per-US status (Epic A-D + Settings + Admin epics)
- [`REGRESSION-GUARD.md`](./REGRESSION-GUARD.md) — every bug fix with its invariant
- [`PROGRESS.md`](./PROGRESS.md) — day-by-day shipping log (Days 1-18+)
