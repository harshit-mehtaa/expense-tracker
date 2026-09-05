# Task Progress

## Status: plan
## Task: Each user should have a cash account. Cash withdrawals mark the transaction accordingly, reduce balance from the source account, and add to the user's cash account. Expenses made in cash adjust the balance against the user's cash account.
## Started: 2026-09-06
## Steps Completed: analyze, plan, approve, implement, review (FAIL then fixed, verified PASS)

## Baseline Failures: none (2353 backend / 981 frontend tests, all passing pre-change).
## Post-implement: 2371 backend tests pass (100% branch coverage maintained except
## pre-existing loanService.ts:457, subscriptionService.ts:402-403 gaps); 999 frontend
## tests pass; tsc/lint clean both sides.
## Validation Results: prisma generate succeeded (schema valid). `prisma migrate dev`
## against a live Postgres could NOT be run — no docker/DB available in this sandbox.
## Migration SQL manually reviewed against repo convention (ALTER TYPE ADD VALUE kept
## in its own file, per documented precedent in 20260816120000_.../migration.sql).
## Flagged to user for a real migration dry-run before deploy.

## Task Classification: risk_level=high, task_type=feature

## Plan (condensed — full detail held in conversation, presented to user at APPROVE):
1. [MED] Schema: add AccountType.CASH + BankAccount.isCashAccount Boolean
2. [MED] accountService.ensureCashAccount(tx, userId) idempotent find-or-create
3. [MED] Wrap authService.createUser + adminService.createUser in $transaction, call ensureCashAccount
4. [LOW] Backfill script prisma/backfill-cash-accounts.ts for existing users
5. [MED] transactionService.createTransaction: auto-resolve bankAccountId to user's
   cash account when paymentMode=CASH, bankAccountId unset, type!==TRANSFER
6. [MED] Guard: exclude CASH from createAccountSchema enum + accountService.createAccount
   throw; deleteAccount throw if isCashAccount; ALSO guard updateAccount so
   isActive=false / accountType change on a cash account throws (must_fix from challenger:
   PUT /accounts/:id was a second unguarded deactivation path)
6b. [LOW] Migration adds a raw-SQL partial unique index on BankAccount
   (userId WHERE isCashAccount=true) as defense-in-depth against the ensureCashAccount
   findFirst-then-create race (should_fix from challenger); ensureCashAccount catches
   the unique-violation and re-findFirst's instead of erroring
7. [LOW] Frontend: add CASH label, exclude from BANK_ACCOUNT_TYPES/CARD_ACCOUNT_TYPE_OPTIONS,
   disable deactivate for cash rows
8. [LOW] Frontend: label cash-funded TRANSFER/EXPENSE distinctly (Cash Withdrawal/Deposit)
9. [LOW] Backend tests for all new branches (100% coverage gate)
10. [LOW] Frontend tests for new branches (per-directory coverage gate)

## Decisions (resolved with user before APPROVE):
- Import scope: DEFERRED. bulkImportTransactions (bank-statement import) will NOT be
  wired to cash-account logic in this task; log as tech debt in vision.md.
- Deactivation: unconditional block (cash account can never be deactivated).
- INCOME symmetry: CASH paymentMode auto-resolves for BOTH EXPENSE and INCOME.
- DB uniqueness: partial unique index added as defense-in-depth (step 6b).
