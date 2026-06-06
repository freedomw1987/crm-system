-- ============================================================================
-- Day N: Man-day role catalogue + Activity/Attachment + QuotationItem GP
-- ============================================================================
-- Three feature blocks land together because they share the Activity
-- authorId / uploaderId FKs and need the user-table additions to land first.
--
-- Block 1: Add ManDayRole catalogue + extend ServiceManDay with FK + cost
-- Block 2: Drop the unused ActivityLog (no code references), create
--          Activity + Attachment
-- Block 3: Extend QuotationItem with GP snapshot fields
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Block 1A: ManDayRole catalogue
-- ---------------------------------------------------------------------------
CREATE TABLE "man_day_roles" (
    "id"        TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "price"     DECIMAL(12,2) NOT NULL,
    "cost"      DECIMAL(12,2) NOT NULL DEFAULT 0,
    "isActive"  BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "man_day_roles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "man_day_roles_name_key" ON "man_day_roles"("name");
CREATE INDEX "man_day_roles_isActive_sortOrder_idx" ON "man_day_roles"("isActive", "sortOrder");

-- Block 1B: Extend ServiceManDay with manDayRoleId + costRate
ALTER TABLE "service_man_days"
    ADD COLUMN "manDayRoleId" TEXT,
    ADD COLUMN "costRate"     DECIMAL(12,2) NOT NULL DEFAULT 0;
CREATE INDEX "service_man_days_manDayRoleId_idx" ON "service_man_days"("manDayRoleId");

-- FK: ServiceManDay.manDayRoleId -> ManDayRole (SetNull so deleting a role
-- doesn't kill a service line — the line keeps its text snapshot).
ALTER TABLE "service_man_days"
    ADD CONSTRAINT "service_man_days_manDayRoleId_fkey"
    FOREIGN KEY ("manDayRoleId") REFERENCES "man_day_roles"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Block 2A: Drop unused ActivityLog (no code references confirmed)
-- ---------------------------------------------------------------------------
-- The legacy activity_logs table was never wired into any route (zero
-- code references in apps/). Dropping it lets us rename the new table to
-- `activities` cleanly and avoids ambiguity for future developers.
DROP TABLE IF EXISTS "activity_logs" CASCADE;

-- ---------------------------------------------------------------------------
-- Block 2B: New ActivityType enum (NOTE / CALL / EMAIL / MEETING only)
-- ---------------------------------------------------------------------------
CREATE TYPE "ActivityType_new" AS ENUM ('NOTE', 'CALL', 'EMAIL', 'MEETING');
-- We dropped activity_logs above so no rows need re-casting. The new
-- enum starts fresh and is named identically to the new column type.

-- ---------------------------------------------------------------------------
-- Block 2C: New Activity table
-- ---------------------------------------------------------------------------
CREATE TABLE "activities" (
    "id"           TEXT NOT NULL,
    "companyId"    TEXT,
    "dealId"       TEXT,
    "authorId"     TEXT NOT NULL,
    "assignedToId" TEXT,
    "type"         "ActivityType_new" NOT NULL DEFAULT 'NOTE',
    "content"      TEXT NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "activities_companyId_createdAt_idx" ON "activities"("companyId", "createdAt" DESC);
CREATE INDEX "activities_dealId_createdAt_idx"    ON "activities"("dealId",    "createdAt" DESC);
CREATE INDEX "activities_authorId_createdAt_idx"  ON "activities"("authorId",  "createdAt" DESC);
CREATE INDEX "activities_type_idx"                ON "activities"("type");

ALTER TABLE "activities"
    ADD CONSTRAINT "activities_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "activities"
    ADD CONSTRAINT "activities_dealId_fkey"
    FOREIGN KEY ("dealId") REFERENCES "deals"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "activities"
    ADD CONSTRAINT "activities_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "activities"
    ADD CONSTRAINT "activities_assignedToId_fkey"
    FOREIGN KEY ("assignedToId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Block 2D: Attachment table
-- ---------------------------------------------------------------------------
CREATE TABLE "attachments" (
    "id"           TEXT NOT NULL,
    "activityId"   TEXT NOT NULL,
    "fileName"     TEXT NOT NULL,
    "mimeType"     TEXT NOT NULL,
    "sizeBytes"    INTEGER NOT NULL,
    "storageKey"   TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "attachments_storageKey_key" ON "attachments"("storageKey");
CREATE INDEX "attachments_activityId_idx"   ON "attachments"("activityId");
CREATE INDEX "attachments_uploadedById_idx" ON "attachments"("uploadedById");

ALTER TABLE "attachments"
    ADD CONSTRAINT "attachments_activityId_fkey"
    FOREIGN KEY ("activityId") REFERENCES "activities"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attachments"
    ADD CONSTRAINT "attachments_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Block 2E: Replace the old ActivityType enum (used by ActivityLog
-- originally; now only used by `activities.type`). Postgres doesn't let
-- us rename enum types in place, so we drop the old and rename new.
-- ---------------------------------------------------------------------------
DROP TYPE IF EXISTS "ActivityType" CASCADE;
ALTER TYPE "ActivityType_new" RENAME TO "ActivityType";

-- ---------------------------------------------------------------------------
-- Block 3: QuotationItem GP snapshot fields
-- ---------------------------------------------------------------------------
ALTER TABLE "quotation_items"
    ADD COLUMN "costSnapshot"  DECIMAL(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN "lineGp"        DECIMAL(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN "lineGpPercent" DECIMAL(5,2)  NOT NULL DEFAULT 100;

-- ---------------------------------------------------------------------------
-- Block 4: Extend AuditAction enum with Man-day + Activity audit entries
-- ---------------------------------------------------------------------------
-- Postgres allows in-place enum additions. We do this AFTER the type rename
-- in Block 2E so the new values belong to the canonical "ActivityType" enum.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MAN_DAY_ROLE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MAN_DAY_ROLE_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MAN_DAY_ROLE_DELETED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ACTIVITY_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ACTIVITY_DELETED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ATTACHMENT_UPLOADED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ATTACHMENT_DELETED';
