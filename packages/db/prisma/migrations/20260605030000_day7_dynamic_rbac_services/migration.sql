-- Migration: day7_dynamic_rbac_services
-- Day 7: dynamic RBAC + Service catalogue with man-day breakdown +
--        polymorphic QuotationItem (PRODUCT | SERVICE)

-- ============================================================
-- 1. NEW TABLES
-- ============================================================

-- Roles + permissions
CREATE TABLE "roles" (
  "id"          TEXT PRIMARY KEY,
  "name"        TEXT NOT NULL UNIQUE,
  "displayName" TEXT NOT NULL,
  "description" TEXT,
  "isSystem"    BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL
);

CREATE TABLE "role_permissions" (
  "roleId"     TEXT NOT NULL,
  "permission" TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId", "permission"),
  CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId")
    REFERENCES "roles"("id") ON DELETE CASCADE
);
CREATE INDEX "role_permissions_permission_idx" ON "role_permissions"("permission");

-- Services + man-day breakdown
CREATE TABLE "services" (
  "id"          TEXT PRIMARY KEY,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "category"    TEXT,
  "unitPrice"   DECIMAL(12, 2) NOT NULL,
  "currency"    TEXT NOT NULL DEFAULT 'HKD',
  "status"      TEXT NOT NULL DEFAULT 'ACTIVE',
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL
);
CREATE INDEX "services_status_idx" ON "services"("status");
CREATE INDEX "services_category_idx" ON "services"("category");

CREATE TABLE "service_man_days" (
  "id"        TEXT PRIMARY KEY,
  "serviceId" TEXT NOT NULL,
  "role"      TEXT NOT NULL,
  "dayRate"   DECIMAL(12, 2) NOT NULL,
  "days"      DECIMAL(6, 2) NOT NULL,
  "subtotal"  DECIMAL(12, 2) NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "service_man_days_serviceId_fkey" FOREIGN KEY ("serviceId")
    REFERENCES "services"("id") ON DELETE CASCADE
);
CREATE INDEX "service_man_days_serviceId_idx" ON "service_man_days"("serviceId");

-- ============================================================
-- 2. MODIFY EXISTING TABLES
-- ============================================================

-- 2a. Add roleId to users
ALTER TABLE "users" ADD COLUMN "roleId" TEXT;
ALTER TABLE "users" ADD CONSTRAINT "users_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE SET NULL;
CREATE INDEX "users_roleId_idx" ON "users"("roleId");

-- 2b. QuotationItem polymorphic
ALTER TABLE "quotation_items" ADD COLUMN "itemType" TEXT NOT NULL DEFAULT 'PRODUCT';
ALTER TABLE "quotation_items" ADD COLUMN "serviceId" TEXT;
ALTER TABLE "quotation_items" ADD COLUMN "manDaySnapshot" JSONB;

-- Convert existing rows: any productId is PRODUCT, the rest are unknown (default to PRODUCT).
-- This is safe because Day 5+ all line items required a product, so existing rows are PRODUCT.
ALTER TABLE "quotation_items" ALTER COLUMN "itemType" DROP DEFAULT;

ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE SET NULL;
CREATE INDEX "quotation_items_serviceId_idx" ON "quotation_items"("serviceId");
CREATE INDEX "quotation_items_itemType_idx" ON "quotation_items"("itemType");

-- 2c. Enforce XOR at app level via CHECK constraint
-- (Optional — Prisma doesn't emit this by default but it's good defensive design)
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_xor_product_service"
  CHECK (
    (("productId" IS NOT NULL) AND ("serviceId" IS NULL)) OR
    (("productId" IS NULL) AND ("serviceId" IS NOT NULL)) OR
    (("productId" IS NULL) AND ("serviceId" IS NULL))
  );

-- ============================================================
-- 3. SEED 3 SYSTEM ROLES (from packages/shared/src/permissions.ts)
-- ============================================================
-- These IDs are stable cuids generated offline; do not regenerate on every migration.
INSERT INTO "roles" ("id", "name", "displayName", "description", "isSystem", "updatedAt")
VALUES
  ('role_admin_system_001',  'ADMIN',  '管理員',  'Full system access (all permissions)',         TRUE, NOW()),
  ('role_sales_system_001',  'SALES',  '銷售',    'Create/manage quotations, deals, customers',  TRUE, NOW()),
  ('role_viewer_system_001', 'VIEWER', '檢視者',  'Read-only access to CRM data',                 TRUE, NOW());

-- ADMIN gets all permissions from the PERMISSIONS list
-- We populate this in a follow-up step in application code (seed.ts) so that
-- adding a new permission to packages/shared/src/permissions.ts auto-flows
-- to ADMIN. For now, ADMIN gets all 25 permissions known at Day 7.

INSERT INTO "role_permissions" ("roleId", "permission") VALUES
  -- user mgmt
  ('role_admin_system_001', 'user:read'),
  ('role_admin_system_001', 'user:create'),
  ('role_admin_system_001', 'user:update'),
  ('role_admin_system_001', 'user:delete'),
  ('role_admin_system_001', 'user:reset_password'),
  -- audit
  ('role_admin_system_001', 'audit:read'),
  -- company
  ('role_admin_system_001', 'company:read'),
  ('role_admin_system_001', 'company:create'),
  ('role_admin_system_001', 'company:update'),
  ('role_admin_system_001', 'company:delete'),
  -- contact
  ('role_admin_system_001', 'contact:read'),
  ('role_admin_system_001', 'contact:create'),
  ('role_admin_system_001', 'contact:update'),
  ('role_admin_system_001', 'contact:delete'),
  -- product
  ('role_admin_system_001', 'product:read'),
  ('role_admin_system_001', 'product:create'),
  ('role_admin_system_001', 'product:update'),
  ('role_admin_system_001', 'product:delete'),
  -- service (NEW Day 7)
  ('role_admin_system_001', 'service:read'),
  ('role_admin_system_001', 'service:create'),
  ('role_admin_system_001', 'service:update'),
  ('role_admin_system_001', 'service:delete'),
  -- quotation
  ('role_admin_system_001', 'quotation:read'),
  ('role_admin_system_001', 'quotation:create'),
  ('role_admin_system_001', 'quotation:update'),
  ('role_admin_system_001', 'quotation:delete'),
  -- role management (NEW Day 7)
  ('role_admin_system_001', 'role:read'),
  ('role_admin_system_001', 'role:create'),
  ('role_admin_system_001', 'role:update'),
  ('role_admin_system_001', 'role:delete'),
  -- chat
  ('role_admin_system_001', 'chat:use'),
  -- deal
  ('role_admin_system_001', 'deal:read'),
  ('role_admin_system_001', 'deal:create'),
  ('role_admin_system_001', 'deal:update'),
  ('role_admin_system_001', 'deal:delete');

-- SALES gets everything except user/audit/role management
INSERT INTO "role_permissions" ("roleId", "permission") VALUES
  ('role_sales_system_001', 'company:read'),
  ('role_sales_system_001', 'company:create'),
  ('role_sales_system_001', 'company:update'),
  ('role_sales_system_001', 'contact:read'),
  ('role_sales_system_001', 'contact:create'),
  ('role_sales_system_001', 'contact:update'),
  ('role_sales_system_001', 'product:read'),
  ('role_sales_system_001', 'service:read'),
  ('role_sales_system_001', 'service:create'),
  ('role_sales_system_001', 'service:update'),
  ('role_sales_system_001', 'quotation:read'),
  ('role_sales_system_001', 'quotation:create'),
  ('role_sales_system_001', 'quotation:update'),
  ('role_sales_system_001', 'deal:read'),
  ('role_sales_system_001', 'deal:create'),
  ('role_sales_system_001', 'deal:update'),
  ('role_sales_system_001', 'chat:use');

-- VIEWER gets read-only across the board
INSERT INTO "role_permissions" ("roleId", "permission") VALUES
  ('role_viewer_system_001', 'company:read'),
  ('role_viewer_system_001', 'contact:read'),
  ('role_viewer_system_001', 'product:read'),
  ('role_viewer_system_001', 'service:read'),
  ('role_viewer_system_001', 'quotation:read'),
  ('role_viewer_system_001', 'deal:read'),
  ('role_viewer_system_001', 'chat:use');

-- ============================================================
-- 4. LINK EXISTING USERS TO SYSTEM ROLES
-- ============================================================
UPDATE "users" SET "roleId" = 'role_admin_system_001'  WHERE "role" = 'ADMIN';
UPDATE "users" SET "roleId" = 'role_sales_system_001'  WHERE "role" = 'SALES';
UPDATE "users" SET "roleId" = 'role_viewer_system_001' WHERE "role" = 'VIEWER';
-- Defensive: anyone without a roleId (shouldn't happen) defaults to VIEWER
UPDATE "users" SET "roleId" = 'role_viewer_system_001' WHERE "roleId" IS NULL;
