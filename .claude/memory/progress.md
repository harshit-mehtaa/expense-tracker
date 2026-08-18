# Task Progress

## Status: implement
## Task: Let a subscription's start date be edited after creation
## Started: 2026-08-18
## Baseline Failures: 0 (backend 2256/2256, frontend 825/825)
## Validation Results: Live-verified against running stack. Real subscription (single
price row): moved startDate, confirmed opening price row moved with it, amount preserved
(299), then restored to original value and confirmed exact match. Throwaway subscription
with a real second price row: guard rejected both on-the-boundary and past-the-boundary
dates with the correct message; a valid earlier edit moved only the opening row, second
row (249@2025-07-01) fully untouched. Cleaned up, confirmed zero leftover rows.
Backend 2268/2268 (12 new), frontend 829/829 (4 new), both tsc clean.
## Steps Completed: analyze, plan, approve, implement

## Design Question Answers (evidence, condensed)
DQ1: Lock is deliberate, grouped with `amount` — real incident where `startDate` fed
`nextRunDate` and posted ~80 phantom transactions (`subscriptionService.ts:216-227`).
Still enforced elsewhere (`firstRun` clamps to today); untouched by this task.
DQ2: `startDate` feeds exactly one write: opening `SubscriptionPrice.effectiveFrom`
(`:254`). No other backend read. Editing is safe only if that row moves with it.
DQ3: No `isOpening` flag — the opening row is the EARLIEST `effectiveFrom` among price
rows, not creation order (`recordPriceChange` can backdate before startDate today).
DQ4: New startDate must stay strictly before the second-earliest price row's date, or
ordering breaks / a same-date edit trips the `@@unique` constraint as an unhandled P2002.
DQ5: Frontend already sends `startDate` on update (`stripBlanks` submits the whole form);
it's inert only because `updateSchema` never declared it. No new field, no new API shape.

## Plan
1. `routes/subscriptions.ts`: add `startDate` to `updateSchema` (create's validator,
   `.optional()`), add to `UpdateSubscriptionInput`. [LOW]
2. `services/subscriptionService.ts`: in `updateSubscription`'s transaction, when
   `data.startDate !== undefined`: fetch price rows ordered by `effectiveFrom` asc; if a
   second row exists and new date `>=` it, throw badRequest; else update
   `Subscription.startDate` + earliest row's `effectiveFrom` (amount/note untouched) in
   the same transaction. Zero rows: update startDate only. [MED]
3. `Subscriptions.tsx`: remove `disabled`/`readOnly` from `startDate` input only; fix the
   "Amount and start date are fixed" copy. [LOW]
4. Backend tests: VQ1-VQ4, VQ6. 5. Frontend test: field editable, submits, amount still
   disabled.

## Task Classification
risk_level: medium (money-adjacent, narrowly scoped). task_type: feature.

## Validation Strategy
Live-verify: edit a real subscription's start date (single price row), confirm the
opening row moved and amount didn't; also verify the guard against a second price row.
Clean up test data.

## Verification Questions (all → step 2, except VQ5 → step 3)
VQ1: opening SubscriptionPrice.effectiveFrom moves with startDate, amount/note untouched.
VQ2: a second (real) price row is never moved or overwritten.
VQ3: moving startDate on/after a second row's date fails cleanly, not a raw P2002.
VQ4: nextRunDate/schedule completely unaffected — DQ1's incident not reintroduced.
VQ5: "Amount and start date are fixed" copy corrected.
VQ6: the common single-price-row case updates with no edge-case failure.

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

## Known Flakes (pre-existing)
- `dashboard.routes.test.ts > returns empty array when no alerts` — order-dependent
- `Dashboard.test.tsx` — findBy timeouts under parallel load; passes on re-run
