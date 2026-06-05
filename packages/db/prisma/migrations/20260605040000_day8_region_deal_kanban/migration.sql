-- Day 8 migration: Region enum + Company.region + Company.customRegion + Quotation.dealId + dealId index
-- 1. Create Region enum
CREATE TYPE "Region" AS ENUM ('HK', 'MO', 'CN', 'OTHER');

-- 2. Add region + customRegion to companies
ALTER TABLE "companies" 
  ADD COLUMN "region" "Region" NOT NULL DEFAULT 'HK',
  ADD COLUMN "customRegion" TEXT;

-- 3. Add dealId to quotations (nullable FK)
ALTER TABLE "quotations"
  ADD COLUMN "dealId" TEXT;

-- 4. Index for the new FK
CREATE INDEX "quotations_dealId_idx" ON "quotations"("dealId");

-- 5. Add FK constraint with onDelete: SetNull (matches schema)
ALTER TABLE "quotations"
  ADD CONSTRAINT "quotations_dealId_fkey" 
  FOREIGN KEY ("dealId") REFERENCES "deals"("id") 
  ON DELETE SET NULL ON UPDATE CASCADE;
