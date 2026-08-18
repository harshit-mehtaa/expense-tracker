# Task Progress

## Status: idle

Last completed: track the sale of real estate, gold, and other assets (061fa1e).

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
- Loan closedAt (3837329): scoped to the prepayment path only — manual balance edits and
  ordinary EMI-linked payments do not set it.
- Asset sales (061fa1e): CapitalGainEntry (tax) remains fully disconnected from a real
  sale — recording a sale does not create/prefill a tax entry. Investment sales share the
  same underlying gap (delete is still the only removal mechanism) but were scoped out —
  partial-quantity sales and the existing capital-gains machinery make it a materially
  different problem.

## Known Flakes (pre-existing)
- `dashboard.routes.test.ts > returns empty array when no alerts` (backend) — order-dependent
- `Dashboard.test.tsx` (frontend) — `findBy` timeouts under parallel load; passes on re-run
