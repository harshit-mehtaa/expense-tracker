-- CreateEnum
CREATE TYPE "ForeignAssetCategory" AS ENUM ('BANK_ACCOUNT', 'EQUITY_AND_MF', 'DEBT', 'IMMOVABLE_PROPERTY', 'OTHER');

-- AlterEnum
ALTER TYPE "CapitalGainAssetType" ADD VALUE 'FOREIGN_EQUITY';

-- AlterEnum
ALTER TYPE "OtherSourceType" ADD VALUE 'FOREIGN_DIVIDEND';

-- AlterTable
ALTER TABLE "CapitalGainEntry" ADD COLUMN     "exchangeRateAtSale" DECIMAL(15,4),
ADD COLUMN     "foreignTaxPaid" DECIMAL(15,2);

-- CreateTable
CREATE TABLE "ForeignAssetDisclosure" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fyYear" TEXT NOT NULL,
    "category" "ForeignAssetCategory" NOT NULL,
    "country" TEXT NOT NULL,
    "assetDescription" TEXT NOT NULL,
    "acquisitionCostINR" DECIMAL(15,2) NOT NULL,
    "peakValueINR" DECIMAL(15,2) NOT NULL,
    "closingValueINR" DECIMAL(15,2) NOT NULL,
    "incomeAccruedINR" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForeignAssetDisclosure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ForeignAssetDisclosure_userId_fyYear_idx" ON "ForeignAssetDisclosure"("userId", "fyYear");

-- CreateIndex
CREATE INDEX "ForeignAssetDisclosure_deletedAt_idx" ON "ForeignAssetDisclosure"("deletedAt");

-- AddForeignKey
ALTER TABLE "ForeignAssetDisclosure" ADD CONSTRAINT "ForeignAssetDisclosure_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
