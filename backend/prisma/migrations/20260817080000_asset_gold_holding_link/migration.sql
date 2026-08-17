-- Let a gold Asset point at the GoldHolding it represents.
--
-- An Asset records what secures a loan; RealEstate and GoldHolding are the detailed
-- trackers. `realEstateId` already lets a property asset defer to its RealEstate record
-- so net worth counts it once. Gold had no equivalent, so gold pledged against a loan AND
-- tracked as a holding would be counted twice with nothing able to detect it.
--
-- One file, and every statement is transactional, so a failure rolls the whole thing back
-- rather than leaving a half-migrated database that blocks backend startup.

ALTER TABLE "Asset" ADD COLUMN "goldHoldingId" TEXT;

-- UNIQUE for the same reason realEstateId is: two assets claiming the same holding would
-- make "is this already counted?" ambiguous, and both would be skipped or neither.
CREATE UNIQUE INDEX "Asset_goldHoldingId_key" ON "Asset"("goldHoldingId");

ALTER TABLE "Asset" ADD CONSTRAINT "Asset_goldHoldingId_fkey"
FOREIGN KEY ("goldHoldingId") REFERENCES "GoldHolding"("id") ON DELETE SET NULL ON UPDATE CASCADE;
