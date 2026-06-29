# Database

Prisma schema lives at `packages/db/prisma/schema.prisma`. Migrations
are timestamp-prefixed SQL files in `packages/db/prisma/migrations/`
(applied in lexical order — newer numbers run after older).

For the day-by-day migration log, see [`PROGRESS.md`](./PROGRESS.md).

---

## ERD overview

```
                            ┌─────────────┐
                            │   Region    │
                            └──────┬──────┘
                                   │ FK (regionId)
                                   ▼
┌────────┐ 1   N ┌─────────┐ 1   N ┌─────────────┐
│  User  │───────│  Role   │       │   Company   │  (regionId FK, customRegion text)
└───┬────┘ N  1  └────┬────┘       └──────┬──────┘
    │                 │                   │ 1
    │ roleId FK       │ permissions        │
    ▼                 ▼                   ├──N──┐
┌──────────┐  ┌────────────────┐          │     │
│RolePerm. │  │Conversation    │          │     │
└──────────┘  └────┬───────────┘          │     ▼
                   │                      │  ┌─────────┐
                   │ N                    │  │ Contact │──N── Address (polymorphic)
                   ▼ 1                    │  └────┬────┘
            ┌─────────────────┐           │       │
            │ConversationMsg  │           │       │ 1
            └─────────────────┘           │       ▼
                                          │   ┌──────────┐ N   M  ┌────┐
                                          │   │ Activity │───────│Tag │
                                          │   └─────┬────┘       └────┘
                                          │         │                ▲
                                          │         │ N              │
                                          │         ▼                │
                                          │      (Company/Contact/   │
                                          │       Deal)              │
                                          │                          │
                                          ▼                          │
                                  ┌──────────┐                      │
                                  │   Deal   │──N── Quotation       │
                                  └────┬─────┘        │            │
                                       │              │ N          │
                                       │ N            ▼            │
                                       ▼       ┌──────────────┐     │
                                  ┌──────────┐ │ QuotationItem│     │
                                  │ Activity │─┤(polymorphic) │     │
                                  └──────────┘ │  PRODUCT     │     │
                                              │  SERVICE ────│─────┘
                                              └──────┬───────┘
                                                     │ N
                                                     ▼
                                              ┌──────────┐     ┌──────────────┐
                                              │ Product  │     │   Service    │
                                              └──────────┘     └──────┬───────┘
                                                                   1   │
                                                                        ▼ N
                                                              ┌──────────────────┐
                                                              │  ServiceManDay   │
                                                              └──────────────────┘

AuditLog (standalone — actorId FK to User, polymorphic resourceType+resourceId)
```

---

## Enums

| Enum              | Values                                                              | Models using it                                     |
| ----------------- | ------------------------------------------------------------------- | --------------------------------------------------- |
| `UserRole`        | `ADMIN`, `SALES`, `VIEWER`                                          | `User.role` (kept for back-compat; source of truth is `Role` table) |
| `AddressType`     | `BILLING`, `SHIPPING`, `OFFICE`, `OTHER`                            | `Address.type`                                       |
| `ProductStatus`   | `ACTIVE`, `ARCHIVED`, `DRAFT`                                       | `Product.status`                                     |
| `ServiceStatus`   | `ACTIVE`, `ARCHIVED`, `DRAFT`                                       | `Service.status`                                     |
| `QuotationStatus` | `DRAFT`, `SENT`, `VIEWED`, `ACCEPTED`, `REJECTED`, `EXPIRED`, `INVOICED` | `Quotation.status`                              |
| `DealStatus`      | `OPEN`, `WON`, `LOST`                                               | `Deal.status`                                        |
| `ActivityType`    | `CALL`, `EMAIL`, `MEETING`, `NOTE`, `TASK`, `QUOTATION_SENT`, `QUOTATION_VIEWED`, `DEAL_STAGE_CHANGED`, `SYSTEM` | `ActivityLog.type` |
| `AuditAction`     | 30+ values for create/update/delete/status on every auditable resource | `AuditLog.action`                              |

> **Note** — `QuotationItem.itemType` is **not** an enum; it's a plain
> `String` column with the two valid values `PRODUCT` and `SERVICE`.
> See the model below for why.

---

## Models

### 1. `User`

The account record. Authentication + ownership.

| Field            | Type          | Notes                                                            |
| ---------------- | ------------- | ---------------------------------------------------------------- |
| `id`             | `cuid`        |                                                                  |
| `email`          | `String`      | unique                                                          |
| `name`           | `String`      |                                                                  |
| `passwordHash`   | `String`      | Argon2id via `Bun.password.hash()`                              |
| `role`           | `UserRole`    | kept as a denormalised hint; new code reads `roleId`             |
| `roleId`         | `String?`     | FK to `Role.id` (Day 7) — `onDelete: SetNull`                  |
| `avatarUrl`      | `String?`     |                                                                  |
| `isActive`       | `Boolean`     | default `true` — login is refused if false                     |
| `lastLoginAt`    | `DateTime?`   | updated by `routes/auth.ts`                                     |
| `createdAt`      | `DateTime`    |                                                                  |
| `updatedAt`      | `DateTime`    |                                                                  |

**Indexes:** `email`, `role`, `roleId`
**Relations:** `roleRef` (Role), `createdQuotations`, `ownedDeals`,
`assignedActivities`, `conversations`, `auditEvents`

---

### 2. `Role` & 3. `RolePermission`

Dynamic RBAC. See [`rbac.md`](./rbac.md) for the full design.

| `Role` field     | Type     | Notes                                              |
| ---------------- | -------- | -------------------------------------------------- |
| `id`             | cuid     |                                                    |
| `name`           | String   | unique — e.g. `ADMIN`, `SALES`, `Senior Sales`     |
| `displayName`    | String   | human label                                        |
| `description`    | String?  |                                                    |
| `isSystem`       | Boolean  | `true` for seeded roles; cannot be deleted         |
| `createdAt`      | DateTime |                                                    |
| `updatedAt`      | DateTime |                                                    |

| `RolePermission` field | Type     | Notes                                       |
| ---------------------- | -------- | ------------------------------------------- |
| `roleId`               | String   | composite PK part 1; FK to `Role`           |
| `permission`           | String   | composite PK part 2; one of the Permission keys (e.g. `quotation:send`) |
| `createdAt`            | DateTime |                                             |

Composite PK: `(roleId, permission)`. `onDelete: Cascade` from `Role`.

---

### 4. `Region`

Day 9: replaced the previous `Region` enum with a table so admins can
add new regions without a DDL migration.

| Field       | Type       | Notes                                          |
| ----------- | ---------- | ---------------------------------------------- |
| `id`        | cuid       |                                                |
| `code`      | String     | unique — `HK`, `MO`, `CN`, `OTHER` or new      |
| `name`      | String     | human label, e.g. `香港` or `中國 China`         |
| `flag`      | String?    | emoji or short label                           |
| `isActive`  | Boolean    | default `true`                                  |
| `sortOrder` | Int        | default 0                                       |
| `createdAt` | DateTime   |                                                |
| `updatedAt` | DateTime   |                                                |

---

### 5. `Company`

A customer company.

| Field          | Type         | Notes                                                    |
| -------------- | ------------ | -------------------------------------------------------- |
| `id`           | cuid         |                                                          |
| `name`         | String       |                                                          |
| `legalName`    | String?      |                                                          |
| `taxId`        | String?      | 商業登記 / Tax ID                                         |
| `industry`     | String?      |                                                          |
| `website`      | String?      |                                                          |
| `phone`        | String?      |                                                          |
| `email`        | String?      |                                                          |
| `logoUrl`      | String?      |                                                          |
| `notes`        | String?      | Text                                                     |
| `source`       | String?      | `Website` / `Referral` / `Cold Call` / ...              |
| `status`       | String       | default `active` — `active` / `inactive` / `blacklisted` |
| `regionId`     | String?      | FK to `Region.id` (Day 9); `onDelete: SetNull`          |
| `customRegion` | String?      | free-form label used when `Region` is missing or `OTHER` |
| `creditLimit`  | Decimal?     | `Decimal(12, 2)`                                         |
| `paymentTerms` | String?      | e.g. `Net 30`                                            |
| `createdAt`    | DateTime     |                                                          |
| `updatedAt`    | DateTime     |                                                          |

**Indexes:** `name`, `status`
**Relations:** `region` (Region), `contacts`, `addresses`, `tags` (M2M via `CompanyTag`), `quotations`, `deals`, `activities`

---

### 6. `Contact`

A person at a company.

| Field        | Type      | Notes                                  |
| ------------ | --------- | -------------------------------------- |
| `id`         | cuid      |                                        |
| `companyId`  | String    | FK to `Company`, `onDelete: Cascade`   |
| `firstName`  | String    |                                        |
| `lastName`   | String    |                                        |
| `title`      | String?   | `CEO`, `Procurement Manager` ...       |
| `department` | String?   |                                        |
| `email`      | String?   |                                        |
| `phone`      | String?   |                                        |
| `mobile`     | String?   |                                        |
| `linkedin`   | String?   |                                        |
| `notes`      | String?   | Text                                   |
| `isPrimary`  | Boolean   | default `false` — primary for company  |
| `createdAt`  | DateTime  |                                        |
| `updatedAt`  | DateTime  |                                        |

**Indexes:** `companyId`, `email`, `(lastName, firstName)`
**Relations:** `company`, `addresses`, `activities`

---

### 7. `Address`

Polymorphic — belongs to either a Company or a Contact (one side at a time).

| Field        | Type         | Notes                                  |
| ------------ | ------------ | -------------------------------------- |
| `id`         | cuid         |                                        |
| `type`       | `AddressType`| default `SHIPPING`                     |
| `line1`      | String       |                                        |
| `line2`      | String?      |                                        |
| `city`       | String       |                                        |
| `state`      | String?      |                                        |
| `postalCode` | String?      |                                        |
| `country`    | String       | default `HK`                           |
| `isDefault`  | Boolean      |                                        |
| `companyId`  | String?      | FK, `onDelete: Cascade`                |
| `contactId`  | String?      | FK, `onDelete: Cascade`                |
| `createdAt`  | DateTime     |                                        |
| `updatedAt`  | DateTime     |                                        |

**Indexes:** `companyId`, `contactId`

---

### 8. `Tag` & 9. `CompanyTag`

Free-form tagging of companies.

| `Tag` field   | Type     | Notes                              |
| ------------- | -------- | ---------------------------------- |
| `id`          | cuid     |                                    |
| `name`        | String   | unique                             |
| `color`       | String?  | hex, e.g. `#3B82F6`                |
| `createdAt`   | DateTime |                                    |

`CompanyTag` is a join table:
- `companyId` (FK, `Cascade`)
- `tagId` (FK, `Cascade`)
- composite PK `(companyId, tagId)`

---

### 10. `Product`

Catalogue of physical / downloadable goods.

| Field               | Type            | Notes                                |
| ------------------- | --------------- | ------------------------------------ |
| `id`                | cuid            |                                      |
| `sku`               | String          | unique                               |
| `name`              | String          |                                      |
| `description`       | String?         | Text                                 |
| `category`          | String?         | free-form                            |
| `unitPrice`         | Decimal(12, 2)  |                                      |
| `costPrice`         | Decimal?        | `Decimal(12, 2)`                     |
| `currency`          | String          | default `HKD`                        |
| `trackInventory`    | Boolean         | default `false`                      |
| `stockQuantity`     | Int?            | null when not tracked                |
| `lowStockThreshold` | Int?            |                                      |
| `status`            | `ProductStatus` | default `ACTIVE`                     |
| `imageUrl`          | String?         |                                      |
| `metadata`          | Json?           | reserved for AI agent RAG tags       |
| `createdAt`         | DateTime        |                                      |
| `updatedAt`         | DateTime        |                                      |

**Indexes:** `sku`, `category`, `status`

---

### 11. `Service`

Catalogue of labour-based deliverables with a SOW (Statement of Work).

| Field         | Type            | Notes                                          |
| ------------- | --------------- | ---------------------------------------------- |
| `id`          | cuid            |                                                |
| `name`        | String          |                                                |
| `description` | String?         | Text — long-form SOW                            |
| `category`    | String?         | e.g. `Consulting`, `Implementation`, `Training` |
| `unitPrice`   | Decimal(12, 2)  | total price (sum of man-day subtotals)         |
| `currency`    | String          | default `HKD`                                  |
| `status`      | `ServiceStatus` | default `ACTIVE`                                |
| `sortOrder`   | Int             | default 0                                       |
| `createdAt`   | DateTime        |                                                |
| `updatedAt`   | DateTime        |                                                |

**Indexes:** `status`, `category`
**Relations:** `manDayLines`, `quotationItems`

---

### 12. `ServiceManDay`

A single role × day-rate × days row inside a Service.

| Field       | Type           | Notes                                  |
| ----------- | -------------- | -------------------------------------- |
| `id`        | cuid           |                                        |
| `serviceId` | String         | FK, `onDelete: Cascade`                |
| `role`      | String         | free-form, e.g. `Senior Consultant`     |
| `dayRate`   | Decimal(12, 2) |                                        |
| `days`      | Decimal(6, 2)  |                                        |
| `subtotal`  | Decimal(12, 2) | computed at write time = dayRate × days |
| `sortOrder` | Int            | default 0                              |
| `createdAt` | DateTime       |                                        |
| `updatedAt` | DateTime       |                                        |

**Indexes:** `serviceId`

---

### 12b. `ManDayRole`

Admin-managed catalogue of role types used by `ServiceManDay`. Lets
admins set the price + cost per man-day for roles like "Senior
Engineer", "Project Manager", "Designer", etc. — without hard-coding
those values into the per-service `ServiceManDay` row.

| Field        | Type           | Notes                                |
| ------------ | -------------- | ------------------------------------ |
| `id`         | cuid           |                                      |
| `name`       | String         | unique (e.g. `Senior Engineer`)      |
| `price`      | Decimal(12, 2) | sell per man-day                     |
| `cost`       | Decimal(12, 2) | cost per man-day (default 0)         |
| `isActive`   | Boolean        | default `true`                       |
| `sortOrder`  | Int            | default 0; UI ordering               |
| `createdAt`  | DateTime       |                                      |
| `updatedAt`  | DateTime       |                                      |

**Index:** `(isActive, sortOrder)`

> **Relationship to `ServiceManDay`.** Each `ServiceManDay` line may
> optionally reference a `ManDayRole` via `manDayRoleId` (nullable for
> legacy rows). When DRAFT services re-render, the current role
> price feeds into GP% computation; when a Quotation is built, the
> `ServiceManDay.role` text + `dayRate` are snapshotted into the
> QuotationItem (so the original role name + price are preserved
> even if the catalogue role is later renamed or repriced — see
> `QuotationItem.manDaySnapshot`).

---

### 13. `Quotation`

The quotation header.

| Field                | Type             | Notes                                                                                              |
| -------------------- | ---------------- | -------------------------------------------------------------------------------------------------- |
| `id`                 | cuid             |                                                                                                    |
| `number`             | String           | unique, e.g. `Q-2026-0001` (revision: `Q-2026-0001-R1`); auto-generated                          |
| `companyId`          | String           | FK to Company                                                                                      |
| `createdById`        | String           | FK to User (`QuotationCreatedBy`)                                                                  |
| `dealId`             | String?          | FK to Deal, `onDelete: SetNull` (Day 8); CRM metadata, editable across lifecycle                 |
| `salesRepId`         | String?          | FK to User (`QuotationSalesRep`), `onDelete: SetNull` (Day 18-C); the follow-up salesperson. Nullable so deleting a User doesn't block the quotation. Backend defaults to authenticated user on POST. CRM metadata. |
| `exchangeRateToHKD`  | Decimal?         | rate captured at create time (Day 19)                                                              |
| `totalHKD`           | Decimal?         | snapshot total in HKD                                                                              |
| `exchangeRateToMOP`  | Decimal?         | rate captured at create time                                                                       |
| `totalMOP`           | Decimal?         | snapshot total in MOP                                                                              |
| `parentQuotationId`  | String?          | FK to Quotation (`QuotationRevisions`), `onDelete: SetNull` (Day 18-D); null for the original; points to the immediate predecessor |
| `revisionNumber`     | Int              | default 0 (original); 1+ = nth revision                                                            |
| `status`             | `QuotationStatus`| default `DRAFT`                                                                                    |
| `issueDate`          | DateTime         | default `now()`                                                                                    |
| `validUntil`         | DateTime?        |                                                                                                    |
| `sentAt`             | DateTime?        | stamped when status → SENT                                                                          |
| `viewedAt`           | DateTime?        |                                                                                                    |
| `acceptedAt`         | DateTime?        |                                                                                                    |
| `subtotal`           | Decimal(12, 2)   | default 0                                                                                          |
| `taxRate`            | Decimal(5, 2)    | percentage, default 0                                                                              |
| `taxAmount`          | Decimal(12, 2)   | default 0                                                                                          |
| `discount`           | Decimal(12, 2)   | default 0                                                                                          |
| `total`              | Decimal(12, 2)   | default 0                                                                                          |
| `currency`           | String           | default `HKD`                                                                                      |
| `title`              | String?          |                                                                                                    |
| `notes`              | String?          | Text — internal                                                                                     |
| `termsAndConditions` | String?          | Text                                                                                                |
| `generatedByAi`      | Boolean          | default `false` — true if created by AI agent                                                       |
| `aiPrompt`           | String?          | Text — the original user prompt (audit trail)                                                       |
| `createdAt`          | DateTime         |                                                                                                    |
| `updatedAt`          | DateTime         |                                                                                                    |

**Indexes:** `companyId`, `status`, `issueDate`, `createdById`, `dealId`, `salesRepId`, `parentQuotationId`

> **Numbering.** The `number` is generated by the AI tool
> `draft_quotation` (see `ai-agent.md`); the manual API path
> (`POST /quotations`) auto-numbers in the same way as of Day 8.
> Format: `Q-<year>-<4-digit-seq>`. Revisions append `-R{N}` —
> see "Revision chain" below.
>
> **Revision chain (Day 18-D).** When the customer comes back with
> changes on a SENT quotation, the user clicks "建立修訂" → backend
> `POST /quotations/:id/revise` clones the source as a new DRAFT,
> linked via `parentQuotationId`, with `revisionNumber = source.revisionNumber + 1`.
> The new `number` is `root.number-R{N}` (where the root is the
> original via the `parentQuotationId` chain). The chain-aware
> helper `nextRevisionInfo` walks to root + BFS-counts descendants
> to handle branching without producing `number` collisions.
> `onDelete: SetNull` on `parentQuotationId` means deleting a row
> in the middle of a chain converts its descendants into new roots
> rather than orphaning them.

---

### 14. `QuotationItem`

A single line on a quotation. **Polymorphic** — exactly one of
`productId` / `serviceId` is set.

| Field            | Type            | Notes                                                       |
| ---------------- | --------------- | ----------------------------------------------------------- |
| `id`             | cuid            |                                                             |
| `quotationId`    | String          | FK, `onDelete: Cascade`                                    |
| `itemType`       | String          | `PRODUCT` or `SERVICE` (plain text, **not** an enum)        |
| `productId`      | String?         | FK to Product, `SetNull`                                    |
| `serviceId`      | String?         | FK to Service, `SetNull`                                    |
| `sku`            | String?         | product only; null for services                             |
| `name`           | String          | snapshot of the catalogue name at quotation time             |
| `description`    | String?         | Text — snapshot                                              |
| `manDaySnapshot` | Json?           | for SERVICE items — `{ lines: [{role, dayRate, days, subtotal}], notes }` |
| `quantity`       | Decimal(10, 2)  |                                                             |
| `unitPrice`      | Decimal(12, 2)  | snapshot                                                    |
| `discount`       | Decimal(5, 2)   | percentage                                                  |
| `lineTotal`      | Decimal(12, 2)  | `= quantity × unitPrice × (1 - discount/100)`              |
| `position`       | Int             | default 0 — display order                                  |

**Indexes:** `quotationId`, `productId`, `serviceId`, `itemType`

> **Snapshot integrity (P1-10, 2026-06-23 → P2-snapshot-display, 2026-06-26)** —
> The DB snapshot (`sku`, `name`, `description`, `unitPrice`,
> `manDaySnapshot`) is the **source of truth** for what the line
> displays, not the live `Product` / `Service` record. If the
> underlying Product/Service is later **deleted** (`onDelete: SetNull`
> on `productId` / `serviceId` leaves the FK dangling), the line keeps
> showing the old name/sku/price with a "(已刪除)" badge. If the
> underlying record is **renamed**, the line keeps showing the snapshot
> name — the quotation stays a faithful historical record of what the
> customer was quoted.
>
> Surfaces that honour this contract:
>
> 1. **Edit dialog** (`apps/web/src/components/quotation-builder.tsx` —
>    `ProductAutocomplete` / `ServiceAutocomplete`). P1-10, commit
>    3b36451. Precedence helper: `autocompleteLabel(snapshotName,
>    snapshotSku, live)` (snapshot wins, live is fallback). Tested in
>    `apps/web/src/components/__tests__/quotation-builder-snapshot.test.ts`.
>
> 2. **Quotation detail page — read-only line-items table** (normal +
>    print modes). P2-snapshot-display, commit 1464b4e. Uses the
>    shared `<LineItemSnapshotMeta>` component to render description,
>    a collapsible SOW / man-day breakdown for SERVICE items, and the
>    "(已刪除)" badge + "原紀錄已刪除,以下為 snapshot 資料" hint when
>    the catalogue record is gone. Helpers: `isLineItemDeleted(item)`
>    + `resolveLineItemDescription(item)` (snapshot wins, live is
>    fallback, null when nothing is available). Tested in
>    `apps/web/src/components/__tests__/quotation-line-item-snapshot.test.ts`.
>
> 3. **Excel export** (`apps/api/src/lib/excel/crm-adapter.ts`). The
>    `sow` / `sow_en` fields prefer `item.description` (snapshot) over
>    the live `service.description` / `product.description`, so an old
>    quotation whose service has been deleted still exports the SOW
>    the customer was originally quoted against. Pinned by 6 bun:test
>    cases in `crm-adapter.test.ts`.

> **Why is `itemType` not a Postgres enum?**
> See the comment block in the schema (line ~424-433). Short version:
> new item types (e.g. `SUBSCRIPTION`, `USAGE`) should not require a
> DDL migration, and the column was created as text originally
> before we tightened the type system elsewhere. The string
> constraint is enforced at the application layer; code MUST only
> pass `PRODUCT` or `SERVICE`.

---

### 15. `Pipeline` & 16. `PipelineStage`

Sales pipeline configuration. A Pipeline has ordered Stages; each
Deal sits in one Stage.

| `Pipeline` field | Type     | Notes                         |
| ---------------- | -------- | ----------------------------- |
| `id`             | cuid     |                               |
| `name`           | String   | unique                        |
| `isDefault`      | Boolean  | default `false`               |
| `createdAt`      | DateTime |                               |
| `updatedAt`      | DateTime |                               |

| `PipelineStage` field | Type    | Notes                                  |
| --------------------- | ------- | -------------------------------------- |
| `id`                  | cuid    |                                        |
| `pipelineId`          | String  | FK, `onDelete: Cascade`                |
| `name`                | String  | `Lead` / `Qualified` / `Won` / `Lost`  |
| `position`            | Int     | display order                          |
| `probability`         | Int     | 0-100, win probability %              |
| `color`               | String? | hex                                    |

Unique: `(pipelineId, position)`

---

### 17. `Deal`

A sales opportunity in a pipeline stage.

| Field              | Type         | Notes                                                |
| ------------------ | ------------ | ---------------------------------------------------- |
| `id`               | cuid         |                                                      |
| `title`            | String       |                                                      |
| `companyId`        | String       | FK to Company                                        |
| `ownerId`          | String       | FK to User (`DealOwner`) — the sales rep             |
| `pipelineId`       | String       | FK                                                   |
| `stageId`          | String       | FK to PipelineStage                                  |
| `status`           | `DealStatus` | default `OPEN`                                       |
| `value`            | Decimal(12, 2)|                                                     |
| `currency`         | String       | default `HKD`                                        |
| `expectedCloseDate`| DateTime?    |                                                      |
| `closedAt`         | DateTime?    | stamped when status → WON or LOST (see below)        |
| `description`      | String?      | Text                                                  |
| `lostReason`       | String?      | when status = LOST                                   |
| `aiInsights`       | Json?        | cached AI analysis (next-best-action, risk score)    |
| `createdAt`        | DateTime     |                                                      |
| `updatedAt`        | DateTime     |                                                      |

**Indexes:** `companyId`, `ownerId`, `stageId`, `status`, `expectedCloseDate`
**Relations:** `company`, `owner`, `pipeline`, `stage`, `quotations`, `activities`

> **Stage → Status side effect.** `PATCH /deals/:id/stage` automatically
> sets `status` (WON if stage name is `Won`, LOST if `Lost`, else OPEN)
> and stamps `closedAt` if not OPEN. The edit dialog piggybacks on this
> by making two calls: PATCH `/deals/:id` for the other fields, then
> PATCH `/deals/:id/stage` if the stage changed. See `architecture.md`
> § "Request lifecycle".

---

### 18. `Activity`

Polymorphic log of customer/deal interactions. A row can be tied
to a **company** OR a **deal** (exactly one — the application layer
enforces this; the schema allows both for migration flexibility).

| Field          | Type            | Notes                                                                                          |
| -------------- | --------------- | ---------------------------------------------------------------------------------------------- |
| `id`           | cuid            |                                                                                                |
| `type`         | `ActivityType`  | `NOTE` / `CALL` / `EMAIL` / `MEETING`                                                          |
| `companyId`    | String?         | FK to Company, `onDelete: Cascade`                                                            |
| `dealId`       | String?         | FK to Deal, `onDelete: Cascade`                                                               |
| `authorId`     | String          | FK to User (`ActivityAuthor`); required; the user who created the activity (Day N)            |
| `assignedToId` | String?         | FK to User (`ActivityAssignedTo`), `onDelete: SetNull`; currently unused (kept for future "follow up reminders") |
| `content`      | String          | Text; the body of the note/call/email/meeting                                                 |
| `createdAt`    | DateTime        | default `now()`                                                                                |
| `updatedAt`    | DateTime        |                                                                                                |

**Indexes:** `(companyId, createdAt DESC)`, `(dealId, createdAt DESC)`,
`(authorId, createdAt DESC)`, `(type, createdAt)`

> **Author-only edit + delete (Day 18-E).** Both `PATCH /activities/:id`
> and `DELETE /activities/:id` are author-only — `actorId` must equal
> the requester's `userId`, otherwise the route returns 403. The audit
> log records `ACTIVITY_UPDATED` / `ACTIVITY_DELETED` accordingly.
> See `docs/REGRESSION-GUARD.md` for the rationale + invariants.

---

### 19. `Attachment`

File metadata for an upload attached to an Activity. Files live under
`DATA_DIR` (default `/app/data/uploads`) keyed by a uuid + original
extension — the **storageKey** (relative key) is stored, not the
absolute path, so the container host can be swapped without rewriting
rows.

| Field         | Type     | Notes                                                                |
| ------------- | -------- | -------------------------------------------------------------------- |
| `id`          | cuid     |                                                                      |
| `activityId`  | String   | FK to Activity, `onDelete: Cascade`                                  |
| `fileName`    | String   | user-visible name                                                    |
| `mimeType`    | String   |                                                                      |
| `sizeBytes`   | Int      |                                                                      |
| `storageKey`  | String   | unique; relative path under `DATA_DIR`                               |
| `uploadedById`| String   | FK to User (`AttachmentUploader`)                                    |
| `createdAt`   | DateTime |                                                                      |

**Indexes:** `activityId`, `uploadedById`

> **50MB hard cap.** Both nginx (`client_max_body_size 50m`) and the
> Elysia route enforce it. MIME whitelist deferred (P2-5).
>
> **Author-only edit + delete (Day 19-E-fix).** Same shape as Activity:
> only `uploadedById === userId` may edit/delete. 403 otherwise.

---

### 20. `AiConfig`

Singleton (always `id=1`) row storing the AI Assistant's LLM connection.
Designed per "T2 spec: API key, model, endpoint are admin-controlled;
no env-var fallback."

| Field             | Type      | Notes                                                                  |
| ----------------- | --------- | ---------------------------------------------------------------------- |
| `id`              | Int       | primary key; always `1`                                               |
| `endpointUrl`     | String    | e.g. `https://api.openai.com/v1`                                      |
| `apiKeyCipher`    | String    | Text — AES-256-GCM encrypted at rest                                  |
| `modelName`       | String    | e.g. `gpt-4o`, `claude-3-5-sonnet`                                      |
| `systemPrompt`    | String?   | Text; optional override of the package default                         |
| `createdAt`       | DateTime  |                                                                        |
| `updatedAt`       | DateTime  |                                                                        |
| `updatedById`     | String?   | FK to User (`AiConfigUpdater`), `onDelete: SetNull`                    |

> **Endpoints:**
> - `GET  /ai/config/status` (was: anonymous; gated by `ai-config:read` per P1-7)
> - `GET  /ai/config` (admin; returns masked key `sk-…2345`)
> - `PUT  /ai/config` (admin; upserts by `id=1`; audit `AI_CONFIG_UPDATED`)

---

### 21. `SystemConfig`

Generic key-value store for admin-managed system defaults. Single
source of truth at runtime for things like tax rate, currency rates,
etc. Every change is audit-logged with before/after diff per ADR-0014.

| Field         | Type     | Notes                                                                                  |
| ------------- | -------- | -------------------------------------------------------------------------------------- |
| `key`         | String   | natural primary key; admin-facing stable identifier (e.g. `default_tax_rate`, `cny_to_hkd`, `hkd_to_mop`) |
| `value`       | Json     | typed payload (numbers, strings, nested objects)                                        |
| `description` | String?  |                                                                                        |
| `updatedAt`   | DateTime | default `now()`                                                                        |
| `updatedById` | String?  | FK to User (`SystemConfigUpdater`), `onDelete: SetNull`                                |

> **Seeded keys (Day 14 / Day 19):**
> - `default_tax_rate` (number; admin-editable; QuotationBuilder auto-prefills)
> - `cny_to_hkd` (number; system-default HKD rate)
> - `hkd_to_mop` (number; system-default MOP rate)

---

### 22. `Conversation` & 23. `ConversationMessage`

AI Agent memory. Each user has many conversations; each conversation
has many messages (user / assistant / tool roles).

| `Conversation` field | Type     | Notes                                       |
| -------------------- | -------- | ------------------------------------------- |
| `id`                 | cuid     |                                             |
| `userId`             | String   | FK, `onDelete: Cascade`                    |
| `title`              | String?  | auto-generated from first message           |
| `context`            | Json?    | snapshot of CRM data the agent had access to|
| `createdAt`          | DateTime |                                             |
| `updatedAt`          | DateTime |                                             |

| `ConversationMessage` field        | Type      | Notes                                                       |
| ---------------------------------- | --------- | ----------------------------------------------------------- |
| `id`                               | cuid      |                                                             |
| `conversationId`                   | String    | FK, `onDelete: Cascade`                                     |
| `role`                             | String    | `user` / `assistant` / `tool`                               |
| `content`                          | String    | Text                                                        |
| `toolName`                         | String?   | for `role=tool`                                             |
| `toolArgs`                         | Json?     |                                                             |
| `toolResult`                       | Json?     |                                                             |
| `aiToolConfirmationHash`          | String?   | Day 17: SHA-256 hash of proposed tool args for `confirmation_required` SSE events; lets us correlate the persisted row with the matching `AI_TOOL_CONFIRMED` / `AI_TOOL_DENIED` audit log entry without storing PII |
| `promptTokens`                     | Int?      | for cost monitoring                                         |
| `completionTokens`                 | Int?      |                                                             |
| `createdAt`                        | DateTime  |                                                             |

**Indexes:** `(conversationId, createdAt)`

---

### 24. `AuditLog`

Admin-visible trail of every create/update/delete/state-change.

| Field          | Type          | Notes                                       |
| -------------- | ------------- | ------------------------------------------- |
| `id`           | cuid          |                                             |
| `actorId`      | String?       | FK to User, `SetNull` — null for anonymous |
| `action`       | `AuditAction` |                                             |
| `resourceType` | String?       | e.g. `quotation`, `user`                    |
| `resourceId`   | String?       |                                             |
| `description`  | String?       | Text                                         |
| `metadata`     | Json?         | before/after diff, `{ manDayCount: N }`, …  |
| `ipAddress`    | String?       |                                             |
| `userAgent`    | String?       | Text                                         |
| `createdAt`    | DateTime      |                                             |

**Indexes:** `(actorId, createdAt)`, `(action, createdAt)`, `(resourceType, resourceId)`, `createdAt`

---

## Migration history

| Timestamp              | Name                                                       | Day    |
| ---------------------- | ---------------------------------------------------------- | ------ |
| 20260605014842         | `init`                                                     | 1      |
| 20260605020000         | `add_audit_log`                                            | 7      |
| 20260605030000         | `day7_dynamic_rbac_services`                               | 7      |
| 20260605030001         | `day7_extend_audit_enum`                                   | 7      |
| 20260605040000         | `day8_region_deal_kanban`                                  | 8      |
| 20260606000000         | `day9_region_table_quotation_item_string`                  | 9      |
| 20260606080526         | `add_service_status_enum` *(manual)*                       | 9      |
| 20260606120000         | `man_day_role_activity_attachment_gp`                      | N (Day N — `ManDayRole` + `Activity` rename + `Attachment`) |
| 20260607000000         | `day14_system_config`                                      | 14     |
| 20260608000000         | `p1-1_audit_action_enum`                                   | 17 (P1-1) |
| 20260609000000         | `day10_ai_config`                                          | 10     |
| 20260609000001         | `day9_region_table_actual_ddl` *(manual)*                  | 9 (Day 9 enum drift follow-up) |
| 20260609000002         | `day17_ai_tool_confirmation`                               | 17 (US-C5) |
| 20260626000000         | `p2_quotation_sales_rep`                                   | 18-C   |
| 20260627000000         | `p2_quotation_revisions`                                   | 18-D   |
| 20260629120000         | `p2_multi_currency_snapshot_hkd`                           | 19     |
| 20260629140000         | `p2_multi_currency_snapshot_mop`                           | 19     |

Migrations are applied in lexical timestamp order. Manual migrations
follow the recipe in the `prisma-migrate-private-rds` skill. All
non-manual migrations are Prisma-generated (the `d9f93a4` doc
commit explains why we stopped hand-writing them).

---

## Useful queries

```ts
// Top customers by revenue (also exposed as the get_top_customers AI tool)
const grouped = await prisma.quotation.groupBy({
  by: ['companyId'],
  where: { status: { in: ['ACCEPTED', 'INVOICED'] } },
  _sum: { total: true },
  _count: { id: true },
  orderBy: { _sum: { total: 'desc' } },
  take: 5,
});

// Kanban view
const stages = await prisma.pipelineStage.findMany({
  where: { pipeline: { isDefault: true } },
  orderBy: { position: 'asc' },
  include: { deals: { include: { company: true, owner: true } } },
});
```

See `apps/ai/src/tools.ts` for the production versions of the same
queries.
