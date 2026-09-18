-- AlterTable
ALTER TABLE "BankAccount" ADD COLUMN     "openingBalance" DECIMAL(15,2),
ADD COLUMN     "openingBalanceDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "balanceSupersededByAnchor" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Transaction_bankAccountId_date_idx" ON "Transaction"("bankAccountId", "date");
