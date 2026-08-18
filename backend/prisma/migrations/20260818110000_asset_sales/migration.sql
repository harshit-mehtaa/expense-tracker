-- Record when RealEstate, GoldHolding, and Asset rows are actually sold.
--
-- The only existing mechanism to remove any of these was a hard delete, which destroys
-- purchase price, purchase date, and every other detail — leaving no record a sale ever
-- happened, for how much, or when. `soldAt`/`salePrice` are set exactly once, by
-- recording a sale, never by delete. Mirrors `Loan.closedAt` from earlier this session:
-- NULL means still owned, and nothing else on the row is touched.
--
-- Every column is nullable with no default; existing rows read as "not sold," which is
-- correct for every row in the live database today.

ALTER TABLE "RealEstate" ADD COLUMN "soldAt" TIMESTAMP(3);
ALTER TABLE "RealEstate" ADD COLUMN "salePrice" DECIMAL(15,2);

ALTER TABLE "GoldHolding" ADD COLUMN "soldAt" TIMESTAMP(3);
ALTER TABLE "GoldHolding" ADD COLUMN "salePrice" DECIMAL(15,2);

ALTER TABLE "Asset" ADD COLUMN "soldAt" TIMESTAMP(3);
ALTER TABLE "Asset" ADD COLUMN "salePrice" DECIMAL(15,2);
