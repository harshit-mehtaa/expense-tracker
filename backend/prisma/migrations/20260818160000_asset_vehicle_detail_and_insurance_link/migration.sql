-- ── Asset: richer vehicle detail + an optional link to its insurance policy ────
CREATE TYPE "FuelType" AS ENUM ('PETROL', 'DIESEL', 'ELECTRIC', 'HYBRID', 'CNG', 'OTHER');

ALTER TABLE "Asset" ADD COLUMN "registrationNumber" TEXT;
ALTER TABLE "Asset" ADD COLUMN "make" TEXT;
ALTER TABLE "Asset" ADD COLUMN "model" TEXT;
ALTER TABLE "Asset" ADD COLUMN "fuelType" "FuelType";
ALTER TABLE "Asset" ADD COLUMN "insurancePolicyId" TEXT;

-- No UNIQUE constraint here, unlike goldHoldingId/realEstateId: those are identity links
-- that gate net-worth double-counting (InsurancePolicy never participates in net worth,
-- so no such invariant applies), and two vehicles sharing one policy is a real case.
CREATE INDEX "Asset_insurancePolicyId_idx" ON "Asset"("insurancePolicyId");

-- SET NULL, not CASCADE: the Asset is not the policy's own wrapper the way it is for a
-- realEstateId link — deleting a lapsed motor policy must never delete the vehicle.
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_insurancePolicyId_fkey"
FOREIGN KEY ("insurancePolicyId") REFERENCES "InsurancePolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
