-- ============================================================================
-- Day 14+: System Configuration table + SYSTEM_CONFIG_UPDATED audit action
-- ============================================================================
-- Day 14 plan (2026-06-07 review): centralise admin-managed system defaults
-- (default tax rate, future default currency / pipeline, etc.) into a
-- generic key-value table rather than per-feature env-var coupling.
-- Admins edit values from the Settings UI; the application layer reads
-- them at runtime; every change is audited (SYSTEM_CONFIG_UPDATED) per
-- ADR-0014 12-month retention.
--
-- This migration:
--   1. Extends the AuditAction enum with SYSTEM_CONFIG_UPDATED
--   2. Creates the system_config key-value table
--   3. Wires an optional updatedById FK to users
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Block 1: Extend AuditAction enum
-- ---------------------------------------------------------------------------
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SYSTEM_CONFIG_UPDATED';

-- ---------------------------------------------------------------------------
-- Block 2: system_config table
-- ---------------------------------------------------------------------------
-- key is the natural primary key — admin-facing stable identifiers like
-- 'default_tax_rate', 'default_currency', etc. value is a JSON column
-- so the same table can hold numbers, strings, or nested objects without
-- per-feature migrations.
CREATE TABLE "system_config" (
    "key"         TEXT NOT NULL,
    "value"       JSONB NOT NULL,
    "description" TEXT,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" TEXT,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("key")
);

-- ---------------------------------------------------------------------------
-- Block 3: updatedById FK to users (optional)
-- ---------------------------------------------------------------------------
-- ON DELETE SET NULL: deleting an admin user does not lose config rows
-- (they just become "system updated").
ALTER TABLE "system_config" ADD CONSTRAINT "system_config_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
