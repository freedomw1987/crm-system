-- AlterTable
ALTER TABLE "quotations" ADD COLUMN     "parentQuotationId" TEXT,
ADD COLUMN     "revisionNumber" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "quotations_parentQuotationId_idx" ON "quotations"("parentQuotationId");

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_parentQuotationId_fkey" FOREIGN KEY ("parentQuotationId") REFERENCES "quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;