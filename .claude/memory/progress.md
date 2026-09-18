# Task Progress

## Status: review-complete
## Task: Opening-balance-as-of-date anchor per BankAccount, all balances/reports adjust.
## Steps Completed: analyze, plan, approve, implement (11/11 steps), review

## Review outcome: triple-reviewer pass found 2 real money-correctness bugs (applyAnchor's
## Serializable+retry didn't protect against concurrent READ COMMITTED writers;
## reconcileAccount corrupted the invariant on a same-day anchor) — both fixed via a
## SELECT...FOR UPDATE row-lock helper (accountService.lockAccountsForBalanceWrite) wired
## into every balance-mutating transaction, plus a same-day-anchor reject in reconcile.
## Several Medium findings also fixed (timeout, P2034 UX, dedup query, defensive guards,
## frontend IST bug); a few explicitly declined with reasoning (see conversation/commit
## message). Re-verified for real: rebuilt backend container, ran
## backend/scripts/validate-opening-balance.ts inside it against live Postgres — 31/31
## checks pass, both concurrency probes now show real contention caught (proof the lock
## works), zero residue after cleanup.

## Final state: backend 2567/2567 tests, frontend 1065/1065, tsc+eslint clean both
## packages, 100% branch coverage on all new/touched code (one pre-existing unrelated gap
## in reportService.ts confirmed via git stash to predate this task).

## Also flagged (not fixed, pre-existing, unrelated): schema.prisma has CategoryType
## ASSET/LIABILITY + a Category unique-index change + a RecurringRule FK with NO matching
## migration file anywhere — drift from earlier uncommitted work, will make a fresh
## `prisma migrate deploy` diverge from schema.prisma. Surface to user at COMMIT.

## Current Step: none — entering COMMIT phase
