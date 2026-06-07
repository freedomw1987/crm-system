-- ============================================================================
-- Day 10+: AI Configuration singleton (admin-controlled LLM connection)
-- ============================================================================
-- David's T2 spec: API key, endpoint URL, and model name are user-
-- configurable from /admin/ai-config and stored in the database. The
-- api key is encrypted at rest using AES-256-GCM keyed off the server-
-- side AI_CONFIG_ENCRYPTION_KEY env var. No env-var fallback exists
-- for the LLM settings — if the AiConfig row is missing, the chat
-- route returns 503.
--
-- This migration:
--   1. Extends the AuditAction enum with AI_CONFIG_UPDATED
--   2. Creates the ai_config singleton table (id=1)
--   3. Wires an optional updatedById FK to users
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Block 1: Extend AuditAction enum
-- ---------------------------------------------------------------------------
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'AI_CONFIG_UPDATED';

-- ---------------------------------------------------------------------------
-- Block 2: ai_config singleton table
-- ---------------------------------------------------------------------------
-- id is INTEGER DEFAULT 1 + PRIMARY KEY so the schema enforces a single
-- row. App code uses `prisma.aiConfig.upsert({ where: { id: 1 }, ... })`
-- to create/update the row.
CREATE TABLE "ai_config" (
    "id"            INTEGER NOT NULL DEFAULT 1,
    "endpointUrl"   TEXT NOT NULL,
    "apiKeyCipher"  TEXT NOT NULL,
    "modelName"     TEXT NOT NULL,
    "systemPrompt"  TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,
    "updatedById"   TEXT,
    CONSTRAINT "ai_config_pkey" PRIMARY KEY ("id")
);
-- Defensive: enforce the singleton invariant in the DB even if app code
-- ever tries to insert id=2. CHECK is cheaper than a partial unique index
-- and Postgres evaluates it on every INSERT/UPDATE.
ALTER TABLE "ai_config"
    ADD CONSTRAINT "ai_config_singleton"
    CHECK ("id" = 1);

-- ---------------------------------------------------------------------------
-- Block 3: FK to users (the admin who last updated the config)
-- ---------------------------------------------------------------------------
ALTER TABLE "ai_config"
    ADD CONSTRAINT "ai_config_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
