-- Migration: add_audit_log
-- Generated for CRM Day 5 (User management + RBAC + Audit log)

-- Create AuditAction enum
DO $$ BEGIN
  CREATE TYPE "AuditAction" AS ENUM (
    'USER_LOGIN',
    'USER_LOGIN_FAILED',
    'USER_LOGOUT',
    'PASSWORD_CHANGED',
    'USER_CREATED',
    'USER_UPDATED',
    'USER_DEACTIVATED',
    'USER_REACTIVATED',
    'USER_DELETED',
    'PASSWORD_RESET',
    'QUOTATION_CREATED',
    'QUOTATION_UPDATED',
    'QUOTATION_DELETED',
    'QUOTATION_STATUS_CHANGED',
    'COMPANY_CREATED',
    'COMPANY_UPDATED',
    'COMPANY_DELETED',
    'CONTACT_CREATED',
    'CONTACT_UPDATED',
    'CONTACT_DELETED',
    'DEAL_CREATED',
    'DEAL_UPDATED',
    'DEAL_DELETED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" "AuditAction" NOT NULL,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");
CREATE INDEX IF NOT EXISTS "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");
CREATE INDEX IF NOT EXISTS "audit_logs_resourceType_resourceId_idx" ON "audit_logs"("resourceType", "resourceId");
CREATE INDEX IF NOT EXISTS "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
