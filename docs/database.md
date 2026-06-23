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

### 13. `Quotation`

The quotation header.

| Field                | Type             | Notes                                            |
| -------------------- | ---------------- | ------------------------------------------------ |
| `id`                 | cuid             |                                                  |
| `number`             | String           | unique, e.g. `Q-2026-0001`; auto-generated       |
| `companyId`          | String           | FK to Company                                    |
| `createdById`        | String           | FK to User (`QuotationCreatedBy`)                |
| `dealId`             | String?          | FK to Deal, `onDelete: SetNull` (Day 8)          |
| `status`             | `QuotationStatus`| default `DRAFT`                                  |
| `issueDate`          | DateTime         | default `now()`                                  |
| `validUntil`         | DateTime?        |                                                  |
| `sentAt`             | DateTime?        | stamped when status → SENT                        |
| `viewedAt`           | DateTime?        |                                                  |
| `acceptedAt`         | DateTime?        |                                                  |
| `subtotal`           | Decimal(12, 2)   | default 0                                        |
| `taxRate`            | Decimal(5, 2)    | percentage, default 0                            |
| `taxAmount`          | Decimal(12, 2)   | default 0                                        |
| `discount`           | Decimal(12, 2)   | default 0                                        |
| `total`              | Decimal(12, 2)   | default 0                                        |
| `currency`           | String           | default `HKD`                                    |
| `title`              | String?          |                                                  |
| `notes`              | String?          | Text — internal                                   |
| `termsAndConditions` | String?          | Text                                              |
| `generatedByAi`      | Boolean          | default `false` — true if created by AI agent     |
| `aiPrompt`           | String?          | Text — the original user prompt (audit trail)     |
| `createdAt`          | DateTime         |                                                  |
| `updatedAt`          | DateTime         |                                                  |

**Indexes:** `companyId`, `status`, `issueDate`, `createdById`, `dealId`

> **Numbering.** The `number` is generated by the AI tool
> `draft_quotation` (see `ai-agent.md`); the manual API path
> (`POST /quotations`) auto-numbers in the same way as of Day 8.
> Format: `Q-<year>-<4-digit-seq>`.

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

> **Snapshot integrity (P1-10, 2026-06-23)** — The DB snapshot
> (`sku`, `name`, `description`, `unitPrice`, `manDaySnapshot`) is the
> **source of truth** for what the line displays, not the live
> `Product` / `Service` record. If the underlying Product/Service is
> later **deleted** (`onDelete: SetNull` on `productId` / `serviceId`
> leaves the FK dangling), the line keeps showing the old name/sku/price
> with a "(已刪除)" badge in the edit dialog's autocomplete
> (`apps/web/src/components/quotation-builder.tsx` — `ProductAutocomplete`
> / `ServiceAutocomplete`). If the underlying record is **renamed**,
> the line keeps showing the snapshot name — the quotation stays a
> faithful historical record of what the customer was quoted.
> Precedence helper: `autocompleteLabel(snapshotName, snapshotSku, live)`
> (snapshot wins, live is fallback). Tested in
> `apps/web/src/components/__tests__/quotation-builder-snapshot.test.ts`.

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

### 18. `ActivityLog`

Polymorphic log of customer/deal interactions. A row can be tied to
a company, contact, or deal (any combination; at least one FK is
typically set).

| Field          | Type            | Notes                                          |
| -------------- | --------------- | ---------------------------------------------- |
| `id`           | cuid            |                                                |
| `type`         | `ActivityType`  |                                                |
| `companyId`    | String?         | FK, Cascade                                    |
| `contactId`    | String?         | FK, Cascade                                    |
| `dealId`       | String?         | FK, Cascade                                    |
| `assignedToId` | String?         | FK to User                                     |
| `subject`      | String?         |                                                |
| `body`         | String?         | Text                                            |
| `metadata`     | Json?           | e.g. `{duration: 1800, outcome: "interested"}` |
| `dueAt`        | DateTime?       | for `TASK`                                     |
| `completedAt`  | DateTime?       |                                                |
| `createdAt`    | DateTime        |                                                |

**Indexes:** `companyId`, `contactId`, `dealId`, `type`, `createdAt`

---

### 19. `Conversation` & 20. `ConversationMessage`

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

| `ConversationMessage` field | Type      | Notes                                  |
| --------------------------- | --------- | -------------------------------------- |
| `id`                        | cuid      |                                        |
| `conversationId`            | String    | FK, `onDelete: Cascade`                |
| `role`                      | String    | `user` / `assistant` / `tool`          |
| `content`                   | String    | Text                                   |
| `toolName`                  | String?   | for `role=tool`                        |
| `toolArgs`                  | Json?     |                                        |
| `toolResult`                | Json?     |                                        |
| `promptTokens`              | Int?      | for cost monitoring                    |
| `completionTokens`          | Int?      |                                        |
| `createdAt`                 | DateTime  |                                        |

**Index:** `(conversationId, createdAt)`

---

### 21. `AuditLog`

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

| Timestamp         | Name                                            | Day |
| ----------------- | ----------------------------------------------- | --- |
| 20260605014842    | `init`                                          | 1   |
| 20260605020000    | `add_audit_log`                                 | 7   |
| 20260605030000    | `day7_dynamic_rbac_services`                    | 7   |
| 20260605030001    | `day7_extend_audit_enum`                        | 7   |
| 20260605040000    | `day8_region_deal_kanban`                       | 8   |
| 20260606000000    | `day9_region_table_quotation_item_string`       | 9   |
| 20260606080526    | `add_service_status_enum` *(manual)*            | 9   |

Migrations are applied in lexical timestamp order. Manual migrations
follow the recipe in the `prisma-migrate-private-rds` skill.

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
