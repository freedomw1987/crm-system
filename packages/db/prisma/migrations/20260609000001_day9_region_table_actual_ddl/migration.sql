-- Day 9 missing DDL (the migration file was a no-op placeholder).
-- Idempotent: every step uses IF NOT EXISTS / IF EXISTS guards.

-- 1. Create regions table
CREATE TABLE IF NOT EXISTS regions (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  flag        TEXT,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Seed the 4 default regions
INSERT INTO regions (id, code, name, flag, "isActive", "sortOrder", "updatedAt")
VALUES
  ('seed_region_hk',     'HK',    'Hong Kong',       '🇭🇰', true, 10, CURRENT_TIMESTAMP),
  ('seed_region_mo',     'MO',    'Macau',           '🇲🇴', true, 20, CURRENT_TIMESTAMP),
  ('seed_region_cn',     'CN',    '中國 China',       '🇨🇳', true, 30, CURRENT_TIMESTAMP),
  ('seed_region_other',  'OTHER', 'Other / 自訂',     '🌐', true, 99, CURRENT_TIMESTAMP)
ON CONFLICT (code) DO NOTHING;

-- 3. Add regionId column if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'regionId'
  ) THEN
    ALTER TABLE "companies" ADD COLUMN "regionId" TEXT;
  END IF;
END$$;

-- 4. Backfill any existing rows from the legacy `region` enum.
-- The `region` column was already dropped by migration
-- 20260606000000_day9_region_table_quotation_item_string on databases
-- that have run that far, so this step is wrapped in an IF EXISTS
-- guard. The fresh-deploy race (steps 1-3 then 5-6 happening before
-- 4 could read `region`) is the original bug; this guard makes the
-- step a no-op in that case and lets the rest of the migration
-- complete cleanly.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'region'
  ) THEN
    UPDATE "companies" c
    SET "regionId" = r.id
    FROM regions r
    WHERE r.code = c."region"::text
      AND c."regionId" IS NULL;
  END IF;
END$$;

-- 5. Add the FK constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'companies_regionId_fkey'
  ) THEN
    ALTER TABLE "companies"
      ADD CONSTRAINT "companies_regionId_fkey"
      FOREIGN KEY ("regionId") REFERENCES regions("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "companies_regionId_idx" ON "companies"("regionId");

-- 6. Drop legacy enum column + type
ALTER TABLE "companies" DROP COLUMN IF EXISTS "region";
DROP TYPE IF EXISTS "Region";

-- NOTE: This migration was added on 2026-06-08 to fix a fresh-deploy
-- regression. The earlier "20260606000000_day9_region_table_..." migration
-- was a no-op placeholder (the original DDL was applied directly to a
-- live DB). On a fresh `migrate deploy`, the regionId column + regions
-- table were never created, causing `prisma.company.findMany()` to
-- throw "column companies.regionId does not exist" on the very first
-- request. This file is the missing piece and is fully idempotent.
