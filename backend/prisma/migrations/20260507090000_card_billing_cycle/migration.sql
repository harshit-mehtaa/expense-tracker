ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'DEBIT_CARD';
ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'PREPAID_CARD';

ALTER TABLE "BankAccount" ADD COLUMN IF NOT EXISTS "creditLimit" DECIMAL(15,2);
ALTER TABLE "BankAccount" ADD COLUMN IF NOT EXISTS "billingCycleStartDay" INTEGER;
ALTER TABLE "BankAccount" ADD COLUMN IF NOT EXISTS "billingCycleEndDay" INTEGER;
ALTER TABLE "BankAccount" ADD COLUMN IF NOT EXISTS "paymentDueDay" INTEGER;

DO $$
BEGIN
  ALTER TABLE "BankAccount"
    ADD CONSTRAINT "BankAccount_creditLimit_nonnegative_check"
    CHECK ("creditLimit" IS NULL OR "creditLimit" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "BankAccount"
    ADD CONSTRAINT "BankAccount_billingCycleStartDay_range_check"
    CHECK ("billingCycleStartDay" IS NULL OR ("billingCycleStartDay" >= 1 AND "billingCycleStartDay" <= 31));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "BankAccount"
    ADD CONSTRAINT "BankAccount_billingCycleEndDay_range_check"
    CHECK ("billingCycleEndDay" IS NULL OR ("billingCycleEndDay" >= 1 AND "billingCycleEndDay" <= 31));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "BankAccount"
    ADD CONSTRAINT "BankAccount_paymentDueDay_range_check"
    CHECK ("paymentDueDay" IS NULL OR ("paymentDueDay" >= 1 AND "paymentDueDay" <= 31));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
