# Task Progress

## Status: implement
## Task: How do we track early loan closure?
## Started: 2026-08-18
## Baseline Failures: 0 (backend 2268/2268, frontend 829/829)
## Design refinement made during IMPLEMENT: endDate is left COMPLETELY untouched on a
closing prepayment (either mode) — not even reduce_tenure's usual approximate recompute.
closedAt is the exact real event; endDate stays the last true projection, so
closedAt < endDate is always an honest, non-self-mutated comparison. This replaces (not
extends) reduce_tenure's existing full-payoff endDate-shortening — a quality improvement
within the approved scope, not a scope change.
## Validation Results: Live-verified — reduce_tenure full payoff, reduce_emi full payoff
(the original bug case), and a partial prepayment (must NOT close) all behaved correctly
against a running stack. Cleaned up, zero leftover rows. Backend 2272/2272 (4 new),
frontend 834/834 (5 new), both tsc clean.
## Steps Completed: analyze, plan, approve, implement

## Design Questions

**DQ1. Is early loan closure tracked anywhere today?**
No. `Loan` (schema.prisma) has no `status`, `isActive`, `isClosed`, or `closedAt` field —
confirmed by re-reading the full model. The only signal a loan is "done" is
`outstandingBalance` reaching 0. `getLoans` (`loanService.ts:132-139`, the query behind
the Loans page list) has zero filtering by balance or `endDate` — a fully paid loan stays
in the list forever, same card, same "Next: <EMI date>" line, same Prepayment Simulator,
nothing distinguishing it from an active one except a 100% progress bar
(`Loans.tsx:374,458,462`). Nothing anywhere records WHEN a loan closed or whether it
closed early vs on schedule.

**DQ2. Does the prepayment feature built this session (f2890d7) already handle full
payoff correctly?**
Partially, and there's a real bug in the untested branch. Live-verified: a lump-sum
prepayment in `reduce_tenure` mode that clears the whole balance correctly shortens
`endDate` to ~today (via `deriveEndDate`). But `reduce_emi` mode NEVER touches
`tenureMonths`/`endDate` by design (`recordLoanPrepayment`, "same schedule length, lower
payment") — so paying off the ENTIRE balance in `reduce_emi` mode leaves a loan with
`outstandingBalance: 0` but `endDate` still 15+ years in the future. Confirmed live: a
₹1,00,000 loan (endDate 2025-01-01) fully prepaid via `reduce_emi` today shows
`outstanding=0, endDate=2025-01-01 (unchanged)` — in that test the stale date happened to
already be in the past, masking the bug; a longer loan (e.g. a 20-year home loan) would
show a 0-balance liability claiming to run for another decade-plus.

**DQ3. Does this stale endDate actually corrupt net worth?**
No — checked directly. `dashboardService.ts`'s liability sum only adds a loan's
`outstandingBalance` `if (amt > 0)` (`loanBreakdown` reduction) — a 0-balance loan
contributes nothing regardless of whether `endDate` is stale, so the loan-visibility
`endDate >= now` filter being wrong doesn't change the net worth NUMBER. The blast radius
is display-only: the loan card would show a wrong "End Date" and would keep appearing in
dashboard breakdowns forever, but no money figure is wrong. `taxService.ts`'s projected
interest also derives from LIVE `outstandingBalance` via `buildAmortizationSchedule`
(returns an empty schedule at balance 0), so Section 24(b) projections are unaffected
too.

**DQ4. What does "closed EARLY" mean, distinct from "closed on schedule"?**
A loan reaching 0 through ordinary EMI-linked payments over time naturally arrives at
~`endDate` anyway — the existing schedule already represents that correctly, and needs no
new tracking. "Early" specifically means a lump-sum prepayment retiring the balance
before the originally scheduled `endDate` — i.e., exactly the `recordLoanPrepayment` path
built this session, not the generic EMI-linked-transaction decrement in
`transactionService.createTransaction` (any linked EXPENSE, used for normal monthly
payments too). Hooking only the prepayment path is well-scoped and matches what "early"
actually means; hooking the generic decrement path as well is a materially larger
change with its own design questions (was that transaction ALSO "prepayment-like," or a
routine EMI that happened to be the last one?) — flagged as a scope choice for APPROVE,
not decided here.

**DQ5. Minimal fix vs. durable tracking — real tradeoff, not a clear default.**
Two honest options:
(a) **Bug fix only, no schema change.** Always correct `endDate`/`tenureMonths` to the
actual closure date when a prepayment brings `outstandingBalance` to 0, in EITHER mode
(fixes DQ2's bug). Surface "closed N months early" as a one-time API response
field/toast at the moment it happens (the pre-update `loan.endDate` is available in
`recordLoanPrepayment` for the comparison). Cheap, fixes the real bug, but nothing
durable — "show me every loan ever closed early" isn't queryable later.
(b) **(a) plus a durable `closedAt DateTime?` column.** Same fix, plus a persisted
timestamp set exactly once, in the same transaction, when the prepayment zeroes the
balance. Makes "closed" and "closed early" (`closedAt < originalEndDate`, captured before
the update) permanently queryable and lets the Loans list badge/filter closed loans.
Needs a migration; `null` for the ~1 existing loan in the live DB (not currently closed,
so no backfill ambiguity).
Both fix the same underlying bug; (b) is what "tracking" most plausibly means if taken
literally, but is real added scope. Present both at APPROVE.

## Verification Questions

**VQ1.** Does a `reduce_emi`-mode prepayment that fully clears the balance now update
`endDate`/`tenureMonths` exactly like `reduce_tenure` mode does — no more silent staleness?
**VQ2.** If a `closedAt` column is added: is it set in the SAME transaction as the
balance-zeroing write (no window where balance is 0 but `closedAt` is still null)?
**VQ3.** Is "closed early" computed by comparing against the endDate captured BEFORE this
specific update (not the already-mutated one), so the comparison can't trivially be true?
**VQ4.** Does a NON-prepayment path that also happens to zero a loan (a manual
`updateLoan` edit, or the generic transactionService decrement) leave `closedAt` alone —
confirming the scope boundary from DQ4 is actually where the code draws it?
**VQ5.** Is the closed state visible somewhere in the UI (not just a column nobody
reads — the same defect class already found and fixed for LoanPrepayment itself)?
**VQ6.** Does a partial prepayment (balance stays > 0) leave everything about this
feature completely inert — zero behavior change for the common case?

## QUEUED NEXT (unrelated)
1. Credit card statement import [BLOCKED — needs a sample file]. Bank statements only
carry the bill payment (transfer, excluded from reports); card spend (~Rs29,689 Apr-May
2026) is invisible. Trap: two existing CC BillPay transfers have no importHash — dedup
won't catch a re-import.
2. Native date pickers in Firefox/Safari — only if those browsers matter.

## Tech debt noted
- Asset.value/RealEstate.currentValue can drift. Category delete needs 2 round trips.
- Transaction.isRecurring written, never read. NetWorthSnapshot.creditCards NULL pre-08-17.
- Loan prepayment: 2 bounded non-atomicity/race windows (see f2890d7 commit msg); no
  edit/delete for a logged prepayment (would need a new hard delete).
- Subscription startDate edit (abf841d): same bounded race class as loan prepayment.

## Known Flakes (pre-existing)
- `dashboard.routes.test.ts > returns empty array when no alerts` (backend) — order-dependent
- `Dashboard.test.tsx` (frontend) — `findBy` timeouts under parallel load; passes on re-run
