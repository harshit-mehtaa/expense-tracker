-- CreateEnum
CREATE TYPE "CapitalGainAssetType" AS ENUM ('EQUITY_LISTED', 'EQUITY_MUTUAL_FUND', 'DEBT_MUTUAL_FUND', 'PROPERTY', 'BONDS', 'GOLD', 'OTHER');

-- CreateEnum
CREATE TYPE "OtherSourceType" AS ENUM ('FD_INTEREST', 'RD_INTEREST', 'SAVINGS_INTEREST', 'DIVIDEND', 'GIFT', 'OTHER');

-- CreateEnum
CREATE TYPE "HousePropertyUsage" AS ENUM ('SELF_OCCUPIED', 'LET_OUT', 'DEEMED_LET_OUT');

-- CreateTable
CREATE TABLE "CapitalGainEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fyYear" TEXT NOT NULL,
    "investmentId" TEXT,
    "assetName" TEXT NOT NULL,
    "assetType" "CapitalGainAssetType" NOT NULL,
    "purchaseDate" TIMESTAMP(3) NOT NULL,
    "saleDate" TIMESTAMP(3) NOT NULL,
    "purchasePrice" DECIMAL(15,2) NOT NULL,
    "salePrice" DECIMAL(15,2) NOT NULL,
    "indexedCost" DECIMAL(15,2),
    "isListed" BOOLEAN NOT NULL DEFAULT true,
    "isSection112AEligible" BOOLEAN NOT NULL DEFAULT false,
    "isPreApril2023Purchase" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CapitalGainEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtherSourceIncome" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fyYear" TEXT NOT NULL,
    "sourceType" "OtherSourceType" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "tdsDeducted" DECIMAL(15,2),
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OtherSourceIncome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HousePropertyDetail" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fyYear" TEXT NOT NULL,
    "realEstateId" TEXT,
    "propertyName" TEXT NOT NULL,
    "usage" "HousePropertyUsage" NOT NULL,
    "grossAnnualRent" DECIMAL(15,2),
    "municipalTaxesPaid" DECIMAL(15,2),
    "homeLoanInterest" DECIMAL(15,2),
    "isPreConstruction" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HousePropertyDetail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CapitalGainEntry_userId_fyYear_idx" ON "CapitalGainEntry"("userId", "fyYear");

-- CreateIndex
CREATE INDEX "CapitalGainEntry_assetType_idx" ON "CapitalGainEntry"("assetType");

-- CreateIndex
CREATE INDEX "CapitalGainEntry_deletedAt_idx" ON "CapitalGainEntry"("deletedAt");

-- CreateIndex
CREATE INDEX "OtherSourceIncome_userId_fyYear_idx" ON "OtherSourceIncome"("userId", "fyYear");

-- CreateIndex
CREATE INDEX "OtherSourceIncome_sourceType_idx" ON "OtherSourceIncome"("sourceType");

-- CreateIndex
CREATE INDEX "OtherSourceIncome_deletedAt_idx" ON "OtherSourceIncome"("deletedAt");

-- CreateIndex
CREATE INDEX "HousePropertyDetail_userId_fyYear_idx" ON "HousePropertyDetail"("userId", "fyYear");

-- CreateIndex
CREATE INDEX "HousePropertyDetail_deletedAt_idx" ON "HousePropertyDetail"("deletedAt");

-- AddForeignKey
ALTER TABLE "CapitalGainEntry" ADD CONSTRAINT "CapitalGainEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapitalGainEntry" ADD CONSTRAINT "CapitalGainEntry_investmentId_fkey" FOREIGN KEY ("investmentId") REFERENCES "Investment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtherSourceIncome" ADD CONSTRAINT "OtherSourceIncome_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousePropertyDetail" ADD CONSTRAINT "HousePropertyDetail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousePropertyDetail" ADD CONSTRAINT "HousePropertyDetail_realEstateId_fkey" FOREIGN KEY ("realEstateId") REFERENCES "RealEstate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
