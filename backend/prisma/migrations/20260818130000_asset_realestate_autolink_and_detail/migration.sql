-- ── Asset: per-type detail ──────────────────────────────────────────────────
CREATE TYPE "VehicleType" AS ENUM ('TWO_WHEELER', 'FOUR_WHEELER', 'OTHER');

ALTER TABLE "Asset" ADD COLUMN "purchaseDate" TIMESTAMP(3);
ALTER TABLE "Asset" ADD COLUMN "vehicleType" "VehicleType";

-- ── Asset ↔ RealEstate: cascade on delete ───────────────────────────────────
-- Was SET NULL. Every RealEstate row now gets an auto-created linked Asset (see
-- createRealEstate), so an orphaned Asset left behind by SET NULL would silently start
-- counting in net worth as a phantom, stale-valued item the moment its property is
-- deleted. deleteRealEstate blocks first if the linked asset secures an active loan;
-- once that's clear, cascading the Asset alongside its RealEstate is the correct outcome.
ALTER TABLE "Asset" DROP CONSTRAINT "Asset_realEstateId_fkey";
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_realEstateId_fkey"
FOREIGN KEY ("realEstateId") REFERENCES "RealEstate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Backfill: every RealEstate row created before createRealEstate auto-linked ─────────
-- Migration 20260816120000 already backfilled every property that existed at that time.
-- Anything created between then and this migration (createRealEstate didn't yet create
-- an Asset) is still missing one. Same id scheme, same idempotent ON CONFLICT guard.
-- Copies soldAt/salePrice too — an already-sold property backfilled without them would
-- get an asset that looks available as loan collateral, the exact bug
-- recordRealEstateSale's own asset-mirroring exists to prevent.
INSERT INTO "Asset" ("id", "userId", "assetType", "name", "value", "realEstateId", "purchaseDate", "soldAt", "salePrice", "createdAt", "updatedAt")
SELECT
    'ast_' || substr(md5("id"), 1, 20),
    "userId",
    'PROPERTY'::"AssetType",
    "propertyName",
    "currentValue",
    "id",
    "purchaseDate",
    "soldAt",
    "salePrice",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "RealEstate"
ON CONFLICT ("realEstateId") DO NOTHING;
