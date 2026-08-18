# Task Progress

## Status: idle

Last completed: record loan prepayments, not just simulate them (f2890d7).

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
- Loan prepayment recording has two non-atomicity/race windows, both bounded (never
  corrupt money): (1) money movement and the LoanPrepayment/EMI-tenure write are two
  separate transactions — a failure in the second leaves a correct ledger entry with no
  schedule note, recoverable by retry; (2) two concurrent prepayments on the same loan
  could compute schedule math from a stale read. Accepted as-is for a 2-user household
  app; would need optimistic locking to fix properly.
- No edit/delete for a logged prepayment (LoanPrepayment has no deletedAt; adding one
  would be a new hard delete on a financial record, which vision.md forbids without a
  schema change first).

## Known Flakes (pre-existing)
- `dashboard.routes.test.ts > returns empty array when no alerts` (backend) — order-dependent
- `Dashboard.test.tsx` (frontend) — `findBy` timeouts under parallel load; passes on re-run
