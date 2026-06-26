-- ============================================================================
-- P2: Add follow-up salesperson (salesRepId) to Quotation
-- ============================================================================
-- User-reported (2026-06-26): "I want Deal and Quotation to both have a
-- salesperson for following up." Deal already had `ownerId`; Quotation
-- only had `createdById` (the creator, not the follow-up rep). This
-- migration adds a nullable `sales_rep_id` FK to `quotations` and
-- backfills from `created_by_id` so existing rows have a sales rep.
--
-- Why nullable (vs NOT NULL with FK):
--   1. Deleting a User must not cascade-block the quotation. With
--      `onDelete: SetNull`, removing the sales rep detaches the link
--      without losing the quotation. The UI falls back to
--      `created_by_id` for display when `sales_rep_id` is null.
--   2. Allows future "no sales rep assigned" states without forcing a
--      placeholder User row.
--
-- Backfill: copies `created_by_id` → `sales_rep_id` so every existing
-- quotation has a sales rep assigned. The API additionally defaults
-- `sales_rep_id` to the authenticated user on create, so newly-
-- created rows are also never null unless explicitly cleared.
-- ============================================================================

-- Block 1: Add column
ALTER TABLE "quotations"
  ADD COLUMN "sales_rep_id" TEXT;

-- Block 2: Add FK constraint with ON DELETE SET NULL
ALTER TABLE "quotations"
  ADD CONSTRAINT "quotations_sales_rep_id_fkey"
  FOREIGN KEY ("sales_rep_id") REFERENCES "users"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

-- Block 3: Index (matches the @@index([salesRepId]) in schema.prisma)
CREATE INDEX "quotations_sales_rep_id_idx" ON "quotations"("sales_rep_id");

-- Block 4: Backfill — every existing quotation gets its creator as
-- the sales rep. Safe to run after the FK is in place because the
-- referenced users(id) rows already exist (created_by_id has been
-- NOT NULL since Day 1).
UPDATE "quotations"
  SET "sales_rep_id" = "created_by_id"
  WHERE "sales_rep_id" IS NULL;

-- ============================================================================
-- Apply recipe (manual, per docs/PROGRESS.md Day 9 pattern)
-- ============================================================================
-- Per the Day 9 migration recipe for manual SQL files:
--
--   1. Apply the SQL above to the running DB:
--        docker compose exec postgres psql -U crm -d crm_system -f \
--          /docker-entrypoint-initdb.d/20260626000000_p2_quotation_sales_rep.sql
--      (or paste into adminer / psql directly)
--
--   2. Insert the _prisma_migrations row so `prisma migrate deploy`
--      on subsequent deploys doesn't try to re-apply:
--
--        INSERT INTO "_prisma_migrations"
--          ("id", "checksum", "finished_at", "migration_name", "logs",
--           "rolled_back_at", "started_at", "applied_steps_count")
--        VALUES (
--          gen_random_uuid()::text,
--          '651cc537fed6d12d1a9b59b542210a3d69498dcc9c8e88d8d5043d7ab9d2c264',
--          now(), '20260626000000_p2_quotation_sales_rep', NULL, NULL,
--          now(), 1
--        );
--
--   3. cp the migration folder into the api container so the next
--      container start picks it up:
--        docker cp packages/db/prisma/migrations/20260626000000_p2_quotation_sales_rep \
--          crm-api:/app/packages/db/prisma/migrations/
--
--   4. `bunx prisma generate` (regenerate client with the new
--      salesRepId / salesRep fields on Quotation)
-- ============================================================================
