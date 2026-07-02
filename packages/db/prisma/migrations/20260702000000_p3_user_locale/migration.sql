-- ============================================================================
-- P3 i18n (Day 21): per-user UI locale preference
-- ============================================================================
-- Sales team request (2026-07-02):
--   Users can switch the UI between English (default), Taiwan Traditional
--   Chinese (zh-TW), and Simplified Chinese (zh-CN). Preference is persisted
--   on the `users` row so it survives across devices (unlike localStorage).
--
-- This migration:
--   1. Adds `locale TEXT NOT NULL DEFAULT 'en'` to the `users` table.
--      Plain TEXT (not enum) so adding more locales later doesn't require
--      a DDL migration — same convention as `quotation_items.itemType`
--      (see that model's note in schema.prisma).
--   2. Valid values are enforced server-side via Zod enum on
--      PATCH /auth/me/preferences (`apps/api/src/routes/auth.ts`).
--      The DB column is intentionally permissive so a bad write doesn't
--      brick existing rows; the API rejects unknown locales at the boundary.
--
-- Backfill: existing users get `'en'` via the column default — no UPDATE
-- needed (the default applies on insert AND on the ALTER for existing rows
-- that get re-read, since the column is NOT NULL with a constant default).
-- ============================================================================

ALTER TABLE "users"
  ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';