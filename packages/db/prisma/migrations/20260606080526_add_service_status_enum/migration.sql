-- Add ServiceStatus enum + convert services.status column
-- Day 9 follow-up: schema was tightened to use a typed enum but the
-- accompanying migration was never emitted (column was plain TEXT).
-- Existing rows are all 'ACTIVE' so the USING cast is safe.
CREATE TYPE "ServiceStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'DRAFT');

ALTER TABLE "services"
  ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "services"
  ALTER COLUMN "status" TYPE "ServiceStatus"
  USING "status"::"ServiceStatus";

ALTER TABLE "services"
  ALTER COLUMN "status" SET DEFAULT 'ACTIVE'::"ServiceStatus";
