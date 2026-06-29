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

| US  | Title                                              | Status     | Priority | Owner            | Gaps / Notes                                                                                                                                              |
| --- | -------------------------------------------------- | ---------- | -------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Companies CRUD                                     | ✅ PASS    | P0       | Day 1-5         | —                                                                                                                                                        |
| A2  | Deal Kanban                                        | ✅ PASS    | P0       | Day 8           | Drag-drop test done                                                                                                                                     |
| A3  | Quotation builder + GP%                            | ✅ PASS    | P0       | **Day 17**      | GP% formula pinned by 14 unit tests in `apps/api/src/__tests__/quotation-gp.test.ts` (extracted to `lib/quotation-gp.ts` for testability). See **RG-2026-06-08-A3**. |
| A4  | Deal Autocomplete + Quick-Create in QuotationBuilder | ✅ PASS | P0       | 2026-06-07     | **RG-2026-06-07-DEAL-AUTOCOMPLETE** — backend validation 10/10 PASS, frontend `DealAutocomplete` + `DealDialog` pre-fill (+90d close date) shipped       |
| A5  | Quotation 5-worksheet Excel download (bc-quotation parity) | ✅ PASS | P1 | 2026-06-07 / 2026-06-26 | Endpoint + adapter + 5 worksheet helpers ported; **P2-snapshot-display** extended `sow` / `sow_en` to prefer `item.description` over the live catalogue. 14 crm-adapter bun:test cases pass. |
| **A6** | Multi-currency snapshots (HKD + MOP)            | ✅ PASS    | P1       | Day 19          | `Quotation.exchangeRateToHKD` + `totalHKD` (mirror `…ToMOP` / `totalMOP`); system-default currency picker on Deal / Product / Service / Quotation; HKD + MOP rows on the Excel `sow` sheet |
| **A7** | Standard versioning for Quotations                | ✅ PASS    | P1       | Day 18-D        | `POST /quotations/:id/revise`; `parentQuotationId` FK; chain-aware `revisionNumber` + `Q-2026-NNNN-R{N}` numbering; 「建立修訂」button + 「修訂自 X」chip |
| **A8** | Sales-rep assignment                              | ✅ PASS    | P1       | Day 18-C        | `Quotation.salesRepId String?` FK to User; `Deal.ownerId` is now editable via `DealDialog`; surfaces on list / detail / Kanban (owner-initial avatar) |
| **A9** | Quotation ↔ Deal link via PATCH                   | ✅ PASS    | P0       | Day 18-B (fix)  | **RG-quotation-deal-link** — was a silent drop; backend now accepts + persists `dealId`; frontend includes on save              |
| **A10** | List-page edit opens full quotation              | ✅ PASS    | P0       | Day 18-B (fix)  | **RG-list-page-edit** — was opening an empty form because the list endpoint excludes `items[]`; now fetches the full quotation first       |

## Epic B — Admin

| US  | Title                                              | Status     | Priority | Owner            | Gaps / Notes                                                                                                                                              |
| --- | -------------------------------------------------- | ---------- | -------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Users + roles                                     | ✅ PASS    | P0       | Day 1-5         | —                                                                                                                                                        |
| B2  | Custom roles editor                               | ✅ PASS    | P1       | Day 7           | System role protection verified                                                                                                                         |
| B3  | Man-day role catalogue                            | ✅ PASS    | P1       | Day 9           | —                                                                                                                                                        |
| B4  | AI Config page                                    | ✅ PASS    | P0       | Day 10          | Encryption round-trip verified; status endpoint gated by `ai-config:read` (P1-7)                                                                       |
| B5  | AI Config audit                                   | ✅ PASS    | P1       | Day 10          | `AI_CONFIG_UPDATED` logged, no plaintext key ever                                                                                                         |
| B6  | Tax rate (default tax for Quotations)             | ✅ PASS    | P1       | Day 14          | `system_configs.default_tax_rate` row; `QuotationBuilder` auto-prefills (race-safe via `userTouchedTax`)                                              |
| B7  | System Settings refactor (sub-route tabs)         | ✅ PASS    | P0       | Day 14.7        | 7 tabs under `/settings/*`: pipelines / users / roles / ai / man-day / tax / audit                                                                       |
| B8  | Settings: currency                                 | ✅ PASS    | P1       | Day 19          | `GET/PUT /settings/currency` (admin) — `cny_to_hkd` + `hkd_to_mop` rates; default flows into Deal / Product / Service / Quotation      |

## Epic C — AI Assistant

| US  | Title                                              | Status     | Priority | Owner            | Gaps / Notes                                                                                                                                              |
| --- | -------------------------------------------------- | ---------- | -------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Chat UI + FAB                                      | ✅ PASS    | P0       | Day 10          | FAB hides on /ai, hover label works. **Day 10.1**: streaming + inline tool pill                                                                     |
| C2  | Read tools (×7)                                    | ✅ PASS    | P0       | Day 10          | 7 read tools verified; 6-iter loop cap prevents runaway                                                                                                   |
| C3  | Write tools (×3)                                   | ✅ PASS    | P1       | Day 10+         | **RG-CHAT-002 Day 17**: all 3 write tools now `requiresConfirmation` (human-in-the-loop). Backend complete; see C5.                                |
| C4  | DB-driven config                                   | ✅ PASS    | P0       | Day 10          | Pre-check returns 503 with helpful message if missing (RG-002 / RG-003).                                                                                |
| C5  | "AI proposes, human confirms" guardrail            | 🟨 PARTIAL | P0       | **Day 17**      | Backend complete: registry `requiresConfirmation` flag on 3 write tools + `runAgentStream` intercepts + `confirmation_required` SSE event + `AI_TOOL_CONFIRMED` / `AI_TOOL_DENIED` audit logging via stable `hashArgs()`. Pinned by 13 unit tests in `packages/ai/src/__tests__/confirm.test.ts`. **Frontend gap (Day 18+ punted)**: Radix Dialog with diff preview and Confirm/Cancel buttons — `confirmation_required` SSE events are currently ignored client-side. |
| C7  | Streaming responses (SSE)                          | ✅ PASS    | P0       | Day 10.1        | Token-by-token + tool pills. See RG-005                                                                                                                  |

## Epic D — Mobile

| US  | Title                                              | Status     | Priority | Owner   | Gaps / Notes                                            |
| --- | -------------------------------------------------- | ---------- | -------- | ------- | ------------------------------------------------------ |
| D1  | RWD across pages                                   | ✅ PASS    | P1       | Day 6+  | iOS Safari URL bar overlap mitigated                  |

## Epic E — Sales activity (Day N — Activity log + attachments)

| US  | Title                                              | Status     | Priority | Owner       | Gaps / Notes                                                                                                                |
| --- | -------------------------------------------------- | ---------- | -------- | ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| E1  | Activity log on company / deal context             | ✅ PASS    | P0       | Day N       | Composer at the top of `ActivityFeed`; type + content + attachments in one flow                          |
| E2  | Activity attachments (upload / list / download)    | ✅ PASS    | P1       | Day N       | 50MB per-file cap (nginx + Elysia); MIME whitelist deferred (P2-5)                              |
| **E3** | Author-only Activity edit + delete              | ✅ PASS    | P1       | Day 18-E    | Backend tightened: `PATCH /activities/:id` + `DELETE /activities/:id` are now author-only (403 otherwise). Frontend mounts ✏️ + 🗑️ inline edit + delete affordances on `ActivityItem` (visible only when `author.id === currentUser.id`).                                                                                                       |
| **E4** | Author-only attachment CRUD                     | ✅ PASS    | P1       | Day 19 (E-fix) | Same shape as E3 for the per-attachment edit/delete — uploader-only (403 otherwise)                                       |
| **E5** | Deal pipeline activity filter                   | ✅ PASS    | P2       | Day N+      | New filter chips on `DealsActivityPanel`: 上週 / 上月 / 自訂 range; ties to `GET /activities?dealId=…`              |

## Epic F — Deal drill-down

| US  | Title                                              | Status     | Priority | Owner   | Gaps / Notes                                                                                                                |
| --- | -------------------------------------------------- | ---------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| **F1** | Deal detail page (`/deals/:id`)                | ✅ PASS    | P0       | Day 18-F | New page with header (deal info, owner, stage badge) + tab nav. **`Quotations` tab** lists all quotations linked to the deal (read-only table). **`Activity` tab** shows the deal's activity log. Kanban card click now navigates here. |

---

## Day 17 P1 sprint shipped (2026-06-08)

(See `docs/TECH-DEBT.md` § "Day 17 P1 sprint shipped" for the full list —

| Item                                            | Linked RG           | Commit  |
| ----------------------------------------------- | ------------------- | ------- |
| `/ai/config/status` perm gate                  | RG-007 fix          | `290a6ce` |
| Strong password policy                         | RG-006              | `571bb02` |
| Audit log retention script + endpoint          | RG-005 follow-up    | `7982d3d` |
| Typecheck critical errors (PARTIAL: 11/36 fixed) |                     | `f7eb183` |
| Per-route audit boilerplate (`withAuditDelete`) |                     | `42ef13b` + `7d79357` |
| `toIdArray` query helper de-duplication         |                     | `726b23c` |
| QuotationItem snapshot preserved on PATCH        |                     | `3b36451` |
| Frontend delete + edit on Companies/Deals/Quotations lists |       | `fca07ee` + `c578759` |
| Docker base-image floating tag + Bun cache      | RG-CHAT-002 follow-up | `eb776a8` |
| AI tool confirmation migration applied to prod | RG-007              | `9829de2` |
| AI tool human-in-the-loop guardrail             | RG-CHAT-002         | `fcfbc29` |
| Frontend CRUD surface regression guard            |                     | `c578759` |

---

## Day 18+ P2 sprint shipped (2026-06-26 / 2026-06-30)

| Tag                       | What                                                                  | Commit  |
| ------------------------- | --------------------------------------------------------------------- | ------- |
| **P2-snapshot-display**  | QuotationItem snapshot on read-only surfaces (detail + print + Excel) | `1464b4e` + `9b1da86` |
| **P2-list-page-edit**     | List-page 編輯 now fetches full quotation first                       | `b95abae` |
| **P2-quotation-deal-link** | PATCH accepts + persists `dealId` on Quotation                       | `d2f2444` |
| **P2-sales-rep**          | `Quotation.salesRepId` FK + UI surfaces (Deal dialog + builder + lists) | `9d4accd` + `a023536` |
| **P2-sales-rep followup** | Drop `dealId` from SENT lock (it was incorrectly locked)            | `02c333a` |
| **P2-quotation-revisions**| `parentQuotationId` + `revisionNumber` + `POST /:id/revise`         | `7173f0a` + `7a3ee6f` |
| **Quotation-revisions parse fix** | Drop orphaned quick-hack `.post` that broke Bun parsing    | `214f255` |
| **Day 18-C docs**         | Schemas use prisma-generated migration (no more manual SQL)            | `d9f93a4` |
| **P2 Activity edit/delete** | Author-only Activity edit + delete (E3)                          | `0da8766` |

---

## Open follow-ups (post-Day-18 ship)

| Item                                              | Why                                                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| US-C5 frontend dialog (Radix + diff preview)     | Backend guardrail ships; frontend UX still punted                                          |
| Audit log retention cron scheduling               | Manual script ships; cron left for US-OPS-2                                              |
| Email notifications (quotation SENT)              | SMTP / SES integration                                                                    |
| Customer-facing quotation view                     | Public share link / accept-quote flow                                                    |
| Inventory alerts                                  | `lowStockThreshold` storage is there, no background job                                   |
| Production AWS deploy                             | CDK infra-as-code for ECS / RDS / CloudFront                                              |
| CI/CD                                             | GitHub Actions / CodePipeline                                                            |
| E2E suite (Playwright)                            | 1 critical regression (RG-001) would have been caught earlier; P2-13 still open            |
