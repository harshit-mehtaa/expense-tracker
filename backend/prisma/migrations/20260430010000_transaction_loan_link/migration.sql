-- Align the database with the current Prisma schema. The application exposes
-- optional transaction-to-loan links for EMI/payment tracking.
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "loanId" TEXT;

CREATE INDEX IF NOT EXISTS "Transaction_loanId_idx" ON "Transaction"("loanId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Transaction_loanId_fkey'
  ) THEN
    ALTER TABLE "Transaction"
      ADD CONSTRAINT "Transaction_loanId_fkey"
      FOREIGN KEY ("loanId") REFERENCES "Loan"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
