# Task Progress

## Status: implement
## Task: Log prepayment for loans
## Started: 2026-08-18
## Baseline Failures: 0 (backend 2236/2236, frontend 816/816)
## Validation Results: Live-verified against running stack — created a throwaway loan,
recorded reduce_emi then reduce_tenure, confirmed outstandingBalance decremented exactly
once and matched the sum (1,000,000 -> 700,000), EMI/tenure/endDate recomputed via the
shared primitives, linked Transaction created and bank account decremented by the exact
amount, net worth unchanged (liability -300,000, cash -300,000), oversized-amount guard
rejected cleanly with balance untouched. All test artifacts cleaned up and confirmed zero
leftover rows. Backend 2256/2256 (20 new), frontend 824/824 (8 new), both tsc clean.
## Steps Completed: analyze, plan, approve, implement

## Design Questions

**DQ1. Does a way to record a prepayment already exist?**
No, and this is the actual gap. `simulatePrepayment` (`loanService.ts:302-347`) computes
what a prepayment WOULD do — `grep -n "prisma.loanPrepayment" src/` returns nothing
anywhere in the codebase — it never calls `prisma.loanPrepayment.create`, never updates
`loan.outstandingBalance`. The `LoanPrepayment` table (`schema.prisma`, `Loan.prepayments`
relation) and `Loan.prepaymentChargesAmount` have existed since the initial migration
(`20260320000000_init`) with zero writers. The frontend's "Prepayment Simulator" card
(`Loans.tsx:371-399`) is honestly labelled — it shows `prepayResult` and stops; there is
no "Record" action anywhere.

**DQ2. How does a real prepayment's money currently reduce `outstandingBalance`, if at all?**
An unrelated, already-working mechanism: any EXPENSE `Transaction` created with `loanId`
set decrements `loan.outstandingBalance` by the transaction amount
(`transactionService.ts:531,553-559`), after checking `amount <= outstandingBalance`
(`:483-485`) and loan ownership via `OR: [{userId}, {owners: {some: {userId}}}]`
(`:479-482`). The frontend exposes this only at transaction CREATE time — "Link to Loan
(optional)" (`Transactions.tsx:2246-2247`) — there is no retrofit modal for an existing
transaction (compare `LinkPolicyModal`/`LinkRefundModal` at `Transactions.tsx:1632,1752`;
no `LinkLoanModal` exists). This is the ONLY existing path that moves real money against a
loan balance, and it is generic — it has no concept of "prepayment," EMI/tenure
recalculation, or an audit trail of why the balance changed.

**DQ3. If prepayment recording only decrements `outstandingBalance` without moving money
out of an account, what breaks?**
Net worth. `fetchAssetBreakdown`/`computeNetWorthStatement` (`dashboardService.ts`) sum
`Loan.outstandingBalance` on the liability side directly — no other table mirrors it. If
the liability drops by ₹X with no matching asset (bank balance) drop of ₹X, net worth
silently INCREASES by ₹X with nothing to explain it. Established this exact class of bug
earlier this session (credit cards double-counted, then netted to hide debt) — must not
repeat it. `bankAccountId` on the linked Transaction is OPTIONAL everywhere else in this
app (`transactionService.ts:381`, `:545` guards the balance-decrement on `if
(data.bankAccountId)`), so this is a pre-existing, inherited permissiveness — a user CAN
already record any EXPENSE with no bank account and no cash movement — not a new gap this
feature introduces, but the money story must still be OFFERED, not skipped.

**DQ4. Must "record" reuse `simulatePrepayment`'s exact math, or can it recompute
independently?**
Must reuse. If recording used different arithmetic than the simulator the user just
looked at, the number they approved would not be the number applied — a correctness bug
users would only discover months later when the EMI doesn't match what they were shown.
`simulatePrepayment` already computes: `current` schedule (before), `newOutstanding =
outstanding - prepaymentAmount`, and for `reduce_emi` a `newEmi` via `computeEmi`
(`utils/loanMath.ts:29`, exported, pure), for `reduce_tenure` a same-EMI `afterSchedule`
whose `.length` is the new remaining-months count. `computeEmi` and
`buildAmortizationSchedule` (`loanService.ts:232`, exported) are the two primitives —
reusing them directly (not the simulate function's return shape, which strips useful
detail) removes the risk of the record path drifting from the simulate path.

**DQ5. What does `tenureMonths` mean on `Loan`, and how does a reduce_tenure prepayment
update it correctly?**
Total tenure from `firstEmiDate` (or `disbursementDate` if absent), NOT "months
remaining" — `deriveEndDate(disbursementDate, tenureMonths, firstEmiDate)`
(`utils/loanMath.ts:120-133`) is how `endDate` is derived at loan creation, and it counts
forward from the start, so `tenureMonths` must be the same total elsewhere or the two
figures for the same loan disagree. `buildAmortizationSchedule` run from TODAY returns
remaining months, not elapsed. So: `elapsedMonths = loan.tenureMonths -
current.length` (current = schedule from today at today's balance/EMI, i.e. months
remaining right now), and the new total = `elapsedMonths + afterSchedule.length`. New
`endDate` must be re-derived via the SAME `deriveEndDate` util used at creation, not
hand-rolled — a second implementation of "add tenure to a start date" is exactly the
"two writers, one field" class of bug already logged twice in this project's tech debt
(Asset.value/RealEstate.currentValue, category color).

**DQ6. Who may record a prepayment on a co-owned loan, and whose ledger does the money
leave from?**
Mirrors `userLoanWriteWhere` (`loanService.ts:33-41`): ADMIN, the loan's primary owner, or
any co-owner in `LoanOwner`. The linked Transaction (DQ2) must be created against
`loan.userId` (the loan's PRIMARY owner), not the requester — `createTransaction`'s bank
account ownership check is `{id: bankAccountId, userId}` (`:391`), and the loan's own
`outstandingBalance` already belongs to that same owner. A co-owner paying from THEIR OWN
account is out of scope — the loan itself has one owning user for balance/ledger purposes
today (`createLoan` already resolves one `ownerUserId` via `resolveWriteUserId`,
`routes/loans.ts:168`); solving split-owner payment attribution is a materially different
feature.

**DQ7. Can `recordLoanPrepayment` nest inside `createTransaction`'s own `prisma.$transaction`
for atomicity?**
No — `createTransaction` (`transactionService.ts:389`) opens its OWN
`prisma.$transaction` using the global `prisma` client; it takes no external `tx` handle
to join an outer transaction. Calling it from inside another `$transaction` would run as
a second, independent transaction, not atomically joined to the first. Two honest options:
(a) duplicate ~15 lines of transaction-creation + balance-decrement logic inside
loanService's own transaction block, or (b) call `createTransaction` first (its own
atomic unit — money movement + balance decrement always succeeds or fully rolls back),
then a second `loanService` transaction for the `LoanPrepayment` audit row + EMI/tenure
update. (b) is chosen: it reuses the balance-decrement logic with zero duplication (the
single most bug-prone part per this project's own history) and accepts a documented,
narrow non-atomic window where money moved correctly but the schedule-metadata write
could separately fail and be retried.

**DQ8. Should a delete/undo action ship in this task?**
No — scoped out, flagged for the user in APPROVE. `LoanPrepayment` has no `deletedAt`
column, so deleting one would be a genuinely new hard delete on a financial record;
`vision.md:85` is explicit: "No NEW hard deletes on financial records (8 already exist...
don't add more)." Adding soft-delete support is a schema migration beyond "log a
prepayment." V1 ships CREATE + LIST (view history) only — a write with no read would
repeat the exact defect just found in DQ1 (a table nobody reads is as broken as a
feature nobody can use), but correction workflow is a deliberate follow-up, not silently
dropped.

**DQ9. Should the prepayment charge (`Loan.prepaymentChargesAmount`) be automatically
folded into the recorded transaction amount?**
No, for V1. The simulator already surfaces it (`prepaymentCharges` in
`simulatePrepayment`'s return, `:347`) as informational. Auto-including it would change
what `amount` decrements `outstandingBalance` by vs. what leaves the bank account — the
charge is a fee, not principal, and folding it in silently would make the recorded
principal-reduction disagree with what the user typed. Surface it prominently in the
record confirmation UI (unchanged from today), but require the user to type the
inclusive amount themselves if they want the charge counted. Flagged as a named
follow-up, not silently out of scope.

## Verification Questions

**VQ1.** Does the recorded `LoanPrepayment` row's `reducedEmi`/`tenureReduced` exactly
match what `simulatePrepayment` would show for the same inputs at record time?
**VQ2.** Is `loan.outstandingBalance` decremented EXACTLY ONCE per prepayment (not once by
the linked Transaction and again by the prepayment-recording step)?
**VQ3.** For `reduce_tenure`, does the new `endDate` match `deriveEndDate` fed the new
`tenureMonths` — i.e., is there only one code path computing it, not a second hand-rolled
one?
**VQ4.** Can a co-owner (not the primary owner) successfully record a prepayment, and does
the resulting Transaction land in the PRIMARY owner's ledger, not the co-owner's?
**VQ5.** Does net worth (`computeNetWorthStatement`) move correctly: liability down by the
prepayment amount, asset (bank balance) down by the same amount when an account is
selected, net worth unchanged — verified against real numbers, not just unit mocks?
**VQ6.** Is prepayment history actually visible somewhere in the UI (not just a table with
rows and no reader)?
**VQ7.** Does attempting to prepay MORE than `outstandingBalance` fail cleanly (matching
the existing `createTransaction` guard), rather than driving the balance negative?
**VQ8.** Are all four combinations (ADMIN/MEMBER × own loan/co-owned loan) covered for
authorization, matching `userLoanWriteWhere`'s existing test coverage pattern in
`loanService.test.ts`?

## QUEUED NEXT (unrelated to current task)

### 1. Credit card statement import [BLOCKED — needs a sample file]
Bank statements carry only the monthly card bill payment, stored as a transfer pair and
excluded from every report (`transferPairId IS NULL`). Card spend is a hole: ~Rs29,689
across Apr+May 2026. User wants BOTH CSV and PDF; build CSV first.
**Trap:** the two existing "CC BillPay" transfers have hand-created card-side legs with
no `importHash` — dedup will NOT catch them; do not re-import Apr/May 2026 until handled.

### 2. Native date pickers in Firefox/Safari
`lang="en-IN"` fixes Chromium only. Only worth doing if those browsers matter.

## Tech debt noted
- `Asset.value` and `RealEstate.currentValue` can drift; RealEstate is authoritative.
- Category delete guards need two round trips for a category with children + transactions.
- `Transaction.isRecurring` is written but never read.
- `NetWorthSnapshot.creditCards` is NULL for the 4 pre-2026-08-17 rows. Do not backfill.

## Known Flakes (pre-existing)
- `dashboard.routes.test.ts > returns empty array when no alerts` (backend) — order-dependent
- `Dashboard.test.tsx` (frontend) — `findBy` timeouts under parallel load; passes on re-run
