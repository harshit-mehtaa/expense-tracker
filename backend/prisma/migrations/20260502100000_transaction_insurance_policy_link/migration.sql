ALTER TABLE "Transaction" ADD COLUMN "insurancePolicyId" TEXT;

CREATE INDEX "Transaction_insurancePolicyId_idx" ON "Transaction"("insurancePolicyId");

ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_insurancePolicyId_fkey"
FOREIGN KEY ("insurancePolicyId") REFERENCES "InsurancePolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
