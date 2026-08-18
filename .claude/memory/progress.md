# Task Progress

## Status: idle

Last completed: track vehicle make/model/registration/fuel type + an optional link to an
existing VEHICLE-type insurance policy.

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
  same underlying gap (delete is still the only removal mechanism) but were scoped out.
- RealEstate/vehicle autolink (1bdf346): Asset is single-owner-scoped while RealEstate/
  Loan support co-ownership — a co-owner can already fully edit/delete a shared RealEstate
  row, and that delete cascades to an Asset scoped to a different owner. Needs a real
  design decision, not a one-line fix.
- Vehicle detail (3ae47a7): VEHICLE_ONLY_FIELDS (assetService.ts) and the Zod field list
  (routes/assets.ts) are two hand-maintained lists that must stay in sync — fine at 6
  fields today, extract a shared constant the first time they drift or a 7th field
  appears. investmentService.ts's nested Asset-create bypasses clearVehicleOnlyFields
  (safe today — hardcodes assetType=PROPERTY) but is a second, un-enforced write path
  for the same invariant. If a 5th type-specific field group ever appears on Asset,
  consider a 1:1 satellite table instead of another nullable column.
- Vehicle auto-detection from insurance policies was explicitly declined (sumAssured
  isn't the same as market value; no make/model/registration on a policy to seed from —
  though now that Asset itself has make/model/registration, this may be worth
  reconsidering if requested again).

## Known Flakes (pre-existing)
- `dashboard.routes.test.ts > returns empty array when no alerts` (backend) — order-dependent
- `Dashboard.test.tsx` (frontend) — `findBy` timeouts under parallel load; passes on re-run
