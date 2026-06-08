-- ============================================================================
-- Day 17: AI tool "propose then confirm" guardrail (US-C5)
-- ============================================================================
-- David's P0: AI should never silently mutate CRM data. The 3 write tools
-- (create_quotation, update_deal_stage, log_activity) now require a
-- human-in-the-loop confirmation step. This migration:
--
--   1. Extends AuditAction enum with AI_TOOL_CONFIRMED and AI_TOOL_DENIED
--      so the audit log can capture the user's decision on every
--      confirmation-required tool call.
--   2. Adds `aiToolConfirmationHash` (String?) to ConversationMessage so
--      we can correlate the persisted row with the audit log entry
--      (used for replay / debugging — the args may contain PII, so we
--      hash them rather than store verbatim in the audit log).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Block 1: Extend AuditAction enum
-- ---------------------------------------------------------------------------
-- ADD VALUE IF NOT EXISTS is idempotent in PG 9.6+ and works inside a
-- transaction. Two values: one for the confirm path, one for the deny
-- path. The description field of the AuditLog row carries the tool name
-- and the hash; the full proposed args live in the ConversationMessage
-- row that the audit log row references.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'AI_TOOL_CONFIRMED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'AI_TOOL_DENIED';

-- ---------------------------------------------------------------------------
-- Block 2: ConversationMessage.aiToolConfirmationHash
--
-- NOTE (2026-06-08): the init migration created this table with the
-- snake_case name `"conversation_messages"`, but the Prisma model is
-- `ConversationMessage`. Prisma's client code emits the PascalCase
-- identifier in queries and PG's case-folding handles it because
-- Prisma-generated queries go through the lowercased identifier
-- (and the model's generated SQL is consistent). HOWEVER, raw SQL
-- in this migration must reference the actual on-disk name. We
-- use `"conversation_messages"` here to match what init created.
ALTER TABLE "conversation_messages"
  ADD COLUMN IF NOT EXISTS "aiToolConfirmationHash" TEXT;
