ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "remark" TEXT;

UPDATE "Transaction"
SET "remark" = "description"
WHERE "remark" IS NULL;
