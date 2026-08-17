-- A recurring rule now carries its own specification instead of pointing at a Transaction.
--
-- The template used to be a real row in the ledger, so a specification masqueraded as
-- money: it had a date, an amount and a type, and every aggregate in the app counted a
-- charge that never happened. Excluding it would have meant filtering at seventeen read
-- sites, three of them raw SQL, and remembering to do so in every aggregate added later.
--
-- One file, because Prisma wraps each migration file in a single transaction. Every
-- statement here is transactional, so a failure at any point rolls back rather than
-- leaving a half-migrated database that blocks backend startup.

-- ── The specification, on the rule itself ────────────────────────────────────
-- Nullable to begin with: the columns must exist before the backfill can populate them,
-- and NOT NULL is applied afterwards once every row has a value.
ALTER TABLE "RecurringRule" ADD COLUMN "amount"        DECIMAL(15,2);
ALTER TABLE "RecurringRule" ADD COLUMN "type"          "TransactionType";
ALTER TABLE "RecurringRule" ADD COLUMN "description"   TEXT;
ALTER TABLE "RecurringRule" ADD COLUMN "categoryId"    TEXT;
ALTER TABLE "RecurringRule" ADD COLUMN "bankAccountId" TEXT;
ALTER TABLE "RecurringRule" ADD COLUMN "paymentMode"   "PaymentMode";
ALTER TABLE "RecurringRule" ADD COLUMN "tags"          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "RecurringRule" ADD COLUMN "gstAmount"     DECIMAL(15,2);

-- ── Backfill from the template each rule points at ───────────────────────────
UPDATE "RecurringRule" r
SET "amount"        = t."amount",
    "type"          = t."type",
    "description"   = t."description",
    "categoryId"    = t."categoryId",
    "bankAccountId" = t."bankAccountId",
    "paymentMode"   = t."paymentMode",
    "tags"          = t."tags",
    "gstAmount"     = t."gstAmount"
FROM "Transaction" t
WHERE t."id" = r."templateTransactionId";

-- A rule whose template row is missing entirely would otherwise fail the NOT NULL below
-- and abort the migration. The FK made that impossible, but defaulting costs nothing and
-- a migration that cannot run is worse than one that preserves a degraded row.
UPDATE "RecurringRule"
SET "amount" = COALESCE("amount", 0),
    "type" = COALESCE("type", 'EXPENSE'::"TransactionType"),
    "description" = COALESCE("description", 'Recurring transaction')
WHERE "amount" IS NULL OR "type" IS NULL OR "description" IS NULL;

ALTER TABLE "RecurringRule" ALTER COLUMN "amount"      SET NOT NULL;
ALTER TABLE "RecurringRule" ALTER COLUMN "type"        SET NOT NULL;
ALTER TABLE "RecurringRule" ALTER COLUMN "description" SET NOT NULL;

CREATE INDEX "RecurringRule_categoryId_idx"    ON "RecurringRule"("categoryId");
CREATE INDEX "RecurringRule_bankAccountId_idx" ON "RecurringRule"("bankAccountId");

ALTER TABLE "RecurringRule" ADD CONSTRAINT "RecurringRule_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RecurringRule" ADD CONSTRAINT "RecurringRule_bankAccountId_fkey"
FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Retire the template rows ─────────────────────────────────────────────────
-- SOFT delete, not hard: vision.md forbids new hard deletes on financial records, and
-- although a template never represented real money it may already have been referenced.
-- Soft-deleting removes it from every read, because every read filters deletedAt.
UPDATE "Transaction" t
SET "deletedAt" = CURRENT_TIMESTAMP, "isRecurring" = false
FROM "RecurringRule" r
WHERE r."templateTransactionId" = t."id" AND t."deletedAt" IS NULL;

ALTER TABLE "RecurringRule" DROP CONSTRAINT "RecurringRule_templateTransactionId_fkey";
DROP INDEX IF EXISTS "RecurringRule_templateTransactionId_key";
ALTER TABLE "RecurringRule" DROP COLUMN "templateTransactionId";
