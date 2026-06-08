-- ============================================================================
-- P1-1 (2026-06-08): extend AuditAction enum with values referenced by
-- the route handlers but missing from the Day 1 schema.
-- ============================================================================
-- Five enum values are used in production code paths but were never
-- added to the schema's AuditAction enum:
--   - DEAL_STAGE_CHANGED (deal.ts:153)
--   - REGION_CREATED / REGION_UPDATED / REGION_DELETED (region.ts)
--   - CREATE / UPDATE / DELETE (settings.ts) — generic settings audit
--
-- All of these were masked by `@ts-nocheck` (filed as P2-10) so the
-- code shipped without typecheck catching the missing enum values.
-- Production runtime works only because:
--   (a) the audit log column is typed as AuditAction in Prisma but
--       the DB column is a PG ENUM, and
--   (b) the existing code that called these strings actually
--       hit the typecheck error at compile time only.
-- In production, writing 'DEAL_STAGE_CHANGED' as the action would
-- have failed with a PG enum value error.
-- ============================================================================

-- P1-1: extend AuditAction enum.
-- ALTER TYPE ... ADD VALUE IF NOT EXISTS is idempotent in PG 9.6+.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DEAL_STAGE_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'REGION_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'REGION_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'REGION_DELETED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CREATE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'UPDATE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DELETE';
