-- ── Per-user cash account ───────────────────────────────────────────────────────
-- isCashAccount is the identity flag used to find/guard "the" cash account — the
-- AccountType.CASH value (added in the prior migration) is for display/filtering only,
-- since BankAccount has no per-user uniqueness on accountType.
ALTER TABLE "BankAccount" ADD COLUMN "isCashAccount" BOOLEAN NOT NULL DEFAULT false;

-- Partial unique index: at most one cash account per user. Defense-in-depth against the
-- find-then-create race in accountService.ensureCashAccount (Prisma's default read-committed
-- isolation does not itself prevent two concurrent provisioning calls from both passing
-- findFirst before either commits create).
CREATE UNIQUE INDEX "BankAccount_userId_isCashAccount_key"
ON "BankAccount"("userId")
WHERE "isCashAccount" = true;
