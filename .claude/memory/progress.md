# Task Progress

## Status: analyze
## Task: Fix CI-blocking backend branch-coverage gap (loanService.ts:457, subscriptionService.ts:402-403)
## Started: 2026-09-06
## Steps Completed: analyze, plan
## Task Classification: risk_level=low, task_type=test (plan-challenger skipped: trivial,
## fully-verified test-only addition, zero production code changes, no architectural tradeoffs)
## Steps Completed: analyze, plan, approve, implement, review (PASS)
## Validation Results: npm run test:coverage exits 0 (was exiting 1 for 3+ weeks). 2401 tests
## pass. 100% statements/branches/functions/lines across EVERY file, zero uncovered lines
## anywhere in the repo. tsc --noEmit clean.

## Plan:
1. [LOW] Add SHORT_TENURE_LOAN fixture + test in loanService.test.ts (recordLoanPrepayment
   describe block): {...MOCK_LOAN, outstandingBalance:10000, interestRate:10, emiAmount:2000,
   emiDate:5, tenureMonths:1, disbursementDate:2020-01-01, firstEmiDate:null, endDate:2020-06-01}.
   Override loanMock.findFirst for this one test only. Call recordLoanPrepayment with
   amount:9999.7, mode:'reduce_tenure' -> newOutstanding~0.3 (afterSchedule.length=0),
   elapsedMonths=1-6=-5, newTenureMonths=-5 <=0 -> deriveEndDate returns null -> ?? loan.endDate fires.
2. [LOW] Assert BOTH loanMock.update's data.endDate === SHORT_TENURE_LOAN.endDate (unchanged,
   proves fallback fired) AND data.tenureMonths === -5 (proves co-write) in the same call.
3. [LOW] Add 2 tests in subscriptionService.test.ts (same describe as existing paymentMode/
   bankAccountId/categoryId tests): updateSubscription({bankAccountId:null}) and
   updateSubscription({categoryId:null}), each asserting ruleMock.update's data matches
   {bankAccountId:null}/{categoryId:null} respectively - mirrors existing paymentMode:null test.
4. [LOW] Run npm run test:coverage - confirm loanService.ts:457 and subscriptionService.ts:402-403
   no longer appear in uncovered lines, no other gaps in either file, coverage threshold passes.
5. [LOW] Run full backend suite - confirm no regressions, no mock leakage from per-test overrides.

## Design Questions:
1. [loanService.ts:457] `deriveEndDate(loan.disbursementDate, newTenureMonths, loan.firstEmiDate) ?? loan.endDate`
   — `deriveEndDate` (utils/loanMath.ts:120-135... actually re-exported via loanService,
   defined in loanService.ts area) returns `null` only when `!(tenureMonths > 0)` or the
   disbursement date is NaN. In `recordLoanPrepayment` (loanService.ts:390+), is there a
   realistic, reachable input combination where `newTenureMonths = elapsedMonths +
   afterSchedule.length <= 0` while NOT hitting the earlier `isFullPayoff` branch (which
   returns before this code) and NOT `reduce_emi` mode? Verified by hand (node repl):
   with `buildAmortizationSchedule`'s `while (balance > 0.5 && rows.length < 360)` loop
   (loanService.ts:256), a prepayment leaving `newOutstanding` in (0, 0.5] produces
   `afterSchedule.length === 0` (not a full payoff, since balance > 0). Combined with a
   loan whose `tenureMonths` is smaller than `current.length` (the schedule computed from
   today's real balance/rate/emi — can be arbitrarily larger than the nominal
   `tenureMonths` field if the loan is running slow), `elapsedMonths` goes negative,
   making `newTenureMonths <= 0` reachable. This is a genuine, reachable branch, not
   dead code — no `c8 ignore` needed, just a missing test.
2. [subscriptionService.ts:402-403] `...(data.bankAccountId !== undefined && { bankAccountId: data.bankAccountId ?? null })`
   and the categoryId equivalent. `UpdateSubscriptionInput` (subscriptionService.ts:296-297)
   types both as `string | null`, and an adjacent, already-tested case
   (`subscriptionService.test.ts:523`, "clears a payment field on explicit null") proves
   `null` is a real, supported "clear this link" input for `paymentMode` — but no
   equivalent test exists for `bankAccountId`/`categoryId`. Existing tests
   (`:511`, `:516`) only pass truthy string values, so the `?? null` right-hand side of
   the `??` operator (taken only when the value is literally `null`) has never executed.
   Genuinely reachable, not dead code — a missing test, matching the sibling pattern
   already established for `paymentMode`.

## Verification Questions:
1. Does the new loanService test assert BOTH that `endDate` falls back to
   `loan.endDate` unchanged AND that `tenureMonths` is still written (the surrounding
   object literal at loanService.ts:455-458 always sets both keys) — so the test
   actually exercises the `?? loan.endDate` right-hand side, not just a passing shape?
2. Do the new subscriptionService tests assert the null is passed through to
   `ruleMock.update`'s data object specifically (not just "didn't throw"), matching the
   assertion style of the existing sibling `paymentMode: null` test at `:523`?
3. Does adding these tests bring branch coverage to exactly 100% (not just "higher") —
   confirmed by re-running `npm run test:coverage` and checking the summary table shows
   no uncovered lines for either file?
4. Are there any OTHER currently-uncovered branches in these two files beyond the two
   named ones (the task names exactly loanService.ts:457 and subscriptionService.ts:402-403
   — confirm via the coverage report there are no others hiding in the same files)?
