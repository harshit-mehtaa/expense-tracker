# Task Progress

## Status: idle

Last completed: auto-link RealEstate to a collateral Asset (no manual duplicate-entry
step), track purchase date + vehicle subtype on the generic Asset model.

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
- RealEstate/vehicle autolink (1bdf346): Asset is single-owner-scoped while RealEstate/
  Loan support co-ownership — a co-owner can already fully edit/delete a shared RealEstate
  row, and that delete now cascades to an Asset scoped to a different owner. Not a new
  bypass (RealEstate delete was already unguarded before this task), but the
  ownership-model mismatch is now more visible. Needs a real design decision, not a
  one-line fix.
- Vehicle auto-detection from insurance policies was explicitly declined (sumAssured
  isn't the same as market value; no make/model/registration on a policy to seed from) —
  a "nudge" pattern (detect a VEHICLE policy with no matching asset, prefill an add-asset
  form) was proposed as the alternative but not built; revisit only if requested again.

## Known Flakes (pre-existing)
- `dashboard.routes.test.ts > returns empty array when no alerts` (backend) — order-dependent
- `Dashboard.test.tsx` (frontend) — `findBy` timeouts under parallel load; passes on re-run
