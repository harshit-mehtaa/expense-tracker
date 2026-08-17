# Task Progress

## Status: idle

Last completed: dd/mm/yyyy dates across the product.

## QUEUED NEXT

### 1. Debt from the loans review
- **M2 (security)** `normalizeRealEstateOwners` validates the RAW share before rounding,
  so 0.001 stores as 0 and — since `userRealEstateWhere` keys on membership alone — that
  0% row grants full view/edit/delete. AND `updateRealEstate` takes a non-empty owners
  array verbatim with `deleteMany: {}`, so a 1% co-owner can delete the primary owner.
  Both VERIFIED by reading the code. Fix when extracting `utils/ownerShares.ts`.
- **H3** MEMBER cannot add co-owners (no non-admin member-listing endpoint; product-wide)
- **M1** `realEstateInclude` returns the whole Loan row to RealEstate co-owners
- **M4** `Asset.value` never enters net worth
- **H6** No P3009 / rollback runbook in DEPLOY.md

### 2. Recurring-template ledger pollution (pre-existing)
Templates are ordinary EXPENSE rows with `isRecurring: true`; only the two subscription
read paths exclude them. Reports, dashboard and listTransactions all count money that
never moved. `createRecurringRule` has done this since before subscriptions existed.

## Known Flakes (pre-existing)
- `dashboard.routes.test.ts > returns empty array when no alerts` (backend) — order-dependent
- `Dashboard.test.tsx` (frontend) — `findBy` timeouts under parallel load; passes on re-run
