-- Loans: generic Asset link, multi-owner shares, prepayment charges as an amount,
-- and a real pre-EMI period.
--
-- ONE FILE ON PURPOSE. Prisma wraps each migration file in a single transaction, so
-- everything here applies or nothing does. Splitting this across three files would make
-- each file atomic but the SET non-atomic — a failure in the third would leave the first
-- two applied, which is exactly the half-applied state that breaks the app (the code
-- expects prepaymentChargesAmount to exist the moment prepaymentChargesPct is gone).
--
-- Deliberately avoids ALTER TYPE ... ADD VALUE and CREATE INDEX CONCURRENTLY: both
-- break out of the surrounding transaction and would silently defeat that guarantee.

-- ── Asset ────────────────────────────────────────────────────────────────────
CREATE TYPE "AssetType" AS ENUM ('PROPERTY', 'VEHICLE', 'GOLD', 'OTHER');

CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assetType" "AssetType" NOT NULL,
    "name" TEXT NOT NULL,
    "value" DECIMAL(15,2) NOT NULL,
    "realEstateId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Asset_realEstateId_key" ON "Asset"("realEstateId");
CREATE INDEX "Asset_userId_idx" ON "Asset"("userId");
CREATE INDEX "Asset_assetType_idx" ON "Asset"("assetType");

ALTER TABLE "Asset" ADD CONSTRAINT "Asset_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Asset" ADD CONSTRAINT "Asset_realEstateId_fkey"
FOREIGN KEY ("realEstateId") REFERENCES "RealEstate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Every existing property becomes an Asset, so no property is orphaned once loans are
-- required to point at one. Deterministic id keeps this idempotent on re-run.
INSERT INTO "Asset" ("id", "userId", "assetType", "name", "value", "realEstateId", "createdAt", "updatedAt")
SELECT
    'ast_' || substr(md5("id"), 1, 20),
    "userId",
    'PROPERTY'::"AssetType",
    "propertyName",
    "currentValue",
    "id",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "RealEstate"
ON CONFLICT ("realEstateId") DO NOTHING;

-- ── Loan: new columns ────────────────────────────────────────────────────────
ALTER TABLE "Loan" ADD COLUMN "assetId" TEXT;
ALTER TABLE "Loan" ADD COLUMN "preEmiAmount" DECIMAL(15,2);
ALTER TABLE "Loan" ADD COLUMN "firstEmiDate" TIMESTAMP(3);

CREATE INDEX "Loan_assetId_idx" ON "Loan"("assetId");

-- RESTRICT, not SET NULL: the CHECK below requires a secured loan to have an asset, so
-- SET NULL would have the database itself produce a row that violates its own constraint
-- on any deletion path that bypasses assetService.deleteAsset (a User cascade, manual
-- psql cleanup, a future admin tool). RESTRICT makes the DB agree with the service guard.
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_assetId_fkey"
FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Prepayment charges: percentage -> flat amount ────────────────────────────
-- NOT a column rename. A rename would keep the stored value, so a row holding `2`
-- meaning "2%" would silently come to mean "Rs 2". It also could not widen the type:
-- DECIMAL(5,2) caps at 999.99, which a converted charge on any real loan overflows.
ALTER TABLE "Loan" ADD COLUMN "prepaymentChargesAmount" DECIMAL(15,2) NOT NULL DEFAULT 0;

UPDATE "Loan"
SET "prepaymentChargesAmount" = ROUND("principalAmount" * "prepaymentChargesPct" / 100, 2)
WHERE "prepaymentChargesPct" > 0;

ALTER TABLE "Loan" DROP COLUMN "prepaymentChargesPct";

-- ── LoanOwner ────────────────────────────────────────────────────────────────
CREATE TABLE "LoanOwner" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sharePercent" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanOwner_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LoanOwner_loanId_userId_key" ON "LoanOwner"("loanId", "userId");
CREATE INDEX "LoanOwner_userId_idx" ON "LoanOwner"("userId");

ALTER TABLE "LoanOwner" ADD CONSTRAINT "LoanOwner_loanId_fkey"
FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LoanOwner" ADD CONSTRAINT "LoanOwner_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing loans become 100%-owned by their current userId, preserving today's meaning.
INSERT INTO "LoanOwner" ("id", "loanId", "userId", "sharePercent", "createdAt")
SELECT 'lno_' || substr(md5("id"), 1, 20), "id", "userId", 100.00, CURRENT_TIMESTAMP
FROM "Loan"
ON CONFLICT ("loanId", "userId") DO NOTHING;

-- ── Link existing secured loans to their collateral ──────────────────────────
-- Before the CHECK below can be validated, any pre-existing secured loan needs an asset.
-- RealEstate.loanId already records which property a home loan financed, so that link
-- transfers deterministically to the Asset just created for that property.
UPDATE "Loan" l
SET "assetId" = a."id"
FROM "RealEstate" re
JOIN "Asset" a ON a."realEstateId" = re."id"
WHERE re."loanId" = l."id" AND l."assetId" IS NULL;

-- Any secured loan still unlinked gets a placeholder asset, so the constraint can be
-- validated without dropping data. Named so it is obvious it needs attention: the
-- alternative is aborting the migration on every database that has one.
INSERT INTO "Asset" ("id", "userId", "assetType", "name", "value", "createdAt", "updatedAt")
SELECT
    'ast_ph_' || substr(md5(l."id"), 1, 17),
    l."userId",
    'OTHER'::"AssetType",
    'Unspecified collateral (' || l."lenderName" || ') — please update',
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Loan" l
WHERE l."loanType" IN ('HOME', 'AUTO', 'LAP', 'GOLD') AND l."assetId" IS NULL
ON CONFLICT ("id") DO NOTHING;

UPDATE "Loan" l
SET "assetId" = 'ast_ph_' || substr(md5(l."id"), 1, 17)
WHERE l."loanType" IN ('HOME', 'AUTO', 'LAP', 'GOLD') AND l."assetId" IS NULL;

-- ── Secured loans must name their collateral ─────────────────────────────────
-- Validated, not NOT VALID. NOT VALID would skip existing rows but still enforce on
-- UPDATE, so a legacy secured loan without an asset would become uneditable — bricked
-- rather than grandfathered. A validated constraint fails loudly at migration time if
-- such rows exist, which is the honest outcome.
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_secured_requires_asset"
CHECK ("loanType" NOT IN ('HOME', 'AUTO', 'LAP', 'GOLD') OR "assetId" IS NOT NULL);
