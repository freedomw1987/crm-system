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
-- ---------------------------------------------------------------------------
-- Nullable so the column is non-breaking for existing rows. Populated by
-- the backend (`packages/ai/src/index.ts`) at the moment a tool is
-- executed (after confirmation) or denied. Format: 16-char hex of the
-- SHA-256 of the JSON-serialised args (first 8 bytes).
ALTER TABLE "ConversationMessage"
  ADD COLUMN IF NOT EXISTS "aiToolConfirmationHash" TEXT;
