ALTER TABLE "Transaction" ADD COLUMN "refundForTransactionId" TEXT;

CREATE INDEX "Transaction_refundForTransactionId_idx" ON "Transaction"("refundForTransactionId");

ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_refundForTransactionId_fkey"
FOREIGN KEY ("refundForTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
