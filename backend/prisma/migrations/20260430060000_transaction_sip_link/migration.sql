ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "sipId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "sipTransactionId" TEXT;

CREATE INDEX IF NOT EXISTS "Transaction_sipId_idx" ON "Transaction"("sipId");
CREATE INDEX IF NOT EXISTS "Transaction_sipTransactionId_idx" ON "Transaction"("sipTransactionId");
CREATE UNIQUE INDEX IF NOT EXISTS "Transaction_sipTransactionId_key" ON "Transaction"("sipTransactionId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Transaction_sipId_fkey'
  ) THEN
    ALTER TABLE "Transaction"
      ADD CONSTRAINT "Transaction_sipId_fkey"
      FOREIGN KEY ("sipId") REFERENCES "SIP"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Transaction_sipTransactionId_fkey'
  ) THEN
    ALTER TABLE "Transaction"
      ADD CONSTRAINT "Transaction_sipTransactionId_fkey"
      FOREIGN KEY ("sipTransactionId") REFERENCES "SIPTransaction"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
