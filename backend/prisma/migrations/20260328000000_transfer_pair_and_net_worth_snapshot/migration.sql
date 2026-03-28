-- AlterTable: add transferPairId to Transaction
ALTER TABLE "Transaction" ADD COLUMN "transferPairId" TEXT;
CREATE INDEX "Transaction_transferPairId_idx" ON "Transaction"("transferPairId");

-- CreateTable: NetWorthSnapshot
CREATE TABLE "NetWorthSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "totalAssets" DECIMAL(15,2),
    "totalLiabilities" DECIMAL(15,2),
    "netWorth" DECIMAL(15,2),
    "bankBalances" DECIMAL(15,2),
    "fixedDeposits" DECIMAL(15,2),
    "recurringDeposits" DECIMAL(15,2),
    "investments" DECIMAL(15,2),
    "gold" DECIMAL(15,2),
    "realEstate" DECIMAL(15,2),
    "loans" DECIMAL(15,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NetWorthSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateUniqueIndex: one snapshot per user per month
CREATE UNIQUE INDEX "NetWorthSnapshot_userId_snapshotDate_key" ON "NetWorthSnapshot"("userId", "snapshotDate");

-- CreateIndex
CREATE INDEX "NetWorthSnapshot_userId_idx" ON "NetWorthSnapshot"("userId");
CREATE INDEX "NetWorthSnapshot_snapshotDate_idx" ON "NetWorthSnapshot"("snapshotDate");

-- AddForeignKey
ALTER TABLE "NetWorthSnapshot" ADD CONSTRAINT "NetWorthSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
