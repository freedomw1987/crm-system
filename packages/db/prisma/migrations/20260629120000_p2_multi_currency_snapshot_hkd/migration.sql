-- ============================================================================
-- P2 multi-currency: RMB default + HKD snapshot
-- ============================================================================
-- Sales team's request (2026-06-29):
--   1. New monetary records default to RMB (人民幣) instead of HKD.
--   2. Admin can set RMB→HKD and RMB→MOP exchange rates in /settings/currency.
--   3. When a sales rep picks the billing currency on a Quotation, the system
--      auto-calculates and PERSISTS the HKD equivalent on the row, so future
--      rate changes do not rewrite historical reports.
--
-- This migration:
--   1. Adds two snapshot columns to `quotations`:
--        - exchangeRateToHKD (the rate that was applied, Decimal(10,6))
--        - totalHKD          (the HKD equivalent of `total`, Decimal(12,2))
--   2. Backfills totalHKD = total for legacy rows (they were all HKD-
--      denominated before this migration, so HKD == native total and the
--      rate was effectively 1). exchangeRateToHKD defaults to 1, which
--      is correct for legacy rows.
--   3. Flips the Prisma default of `currency` from HKD to RMB on the four
--      tables that store a currency (products, services, quotations, deals).
--      Prisma's ALTER only changes the column default; existing data is NOT
--      modified — legacy rows keep their `currency = 'HKD'` literal, which
--      matches what was on the printed quote when it was issued.
--
-- Mirrors the existing `default_tax_rate` snapshot pattern in
-- `20260607000000_day14_system_config` — admin sets a default, app reads
-- it at runtime, historical rows are immutable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Block 1: Add the two snapshot columns with safe defaults
-- ---------------------------------------------------------------------------
-- `exchangeRateToHKD DEFAULT 1` is correct for legacy rows: every pre-
-- migration quotation was HKD-denominated, so 1 HKD == 1 HKD.
-- `totalHKD DEFAULT 0` is a defensive guard; the UPDATE below fills it.
ALTER TABLE "quotations"
  ADD COLUMN "exchangeRateToHKD" DECIMAL(10, 6) NOT NULL DEFAULT 1,
  ADD COLUMN "totalHKD"          DECIMAL(12, 2) NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- Block 2: Backfill totalHKD = total for existing rows
-- ---------------------------------------------------------------------------
-- The WHERE clause is intentionally narrow so the UPDATE is idempotent
-- (re-running on already-filled rows is a no-op).
UPDATE "quotations"
SET "totalHKD" = "total"
WHERE "totalHKD" = 0;

-- ---------------------------------------------------------------------------
-- Block 3: Flip Prisma default of `currency` from HKD to RMB
-- ---------------------------------------------------------------------------
-- These ALTERs only change the column default. Existing rows keep their
-- `currency = 'HKD'` literal (intentional — see header comment).
ALTER TABLE "products"   ALTER COLUMN "currency" SET DEFAULT 'RMB';
ALTER TABLE "services"   ALTER COLUMN "currency" SET DEFAULT 'RMB';
ALTER TABLE "quotations" ALTER COLUMN "currency" SET DEFAULT 'RMB';
ALTER TABLE "deals"      ALTER COLUMN "currency" SET DEFAULT 'RMB';
