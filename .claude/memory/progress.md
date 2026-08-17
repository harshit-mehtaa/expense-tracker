# Task Progress

## Status: idle

Last completed: real-estate co-owner security (4 bugs) + shared ownerShares extraction.

## QUEUED NEXT

### 1. Recurring-template ledger pollution (pre-existing)
Templates are ordinary EXPENSE rows with `isRecurring: true`; only the two subscription
read paths exclude them. Reports, dashboard and listTransactions all count money that
never moved. `createRecurringRule` has done this since before subscriptions existed.
Wide blast radius: touches every aggregation.

### 2. `Asset.value` never enters net worth
A vehicle worth Rs 12L shows the AUTO loan as a liability with no offsetting asset.
Needs dedup design vs RealEstate/Gold.

### 3. MEMBER cannot add co-owners
No non-admin member-listing endpoint. Affects loans AND real estate. Widens data
exposure, so it is a product decision.

### 4. No P3009 / rollback runbook in DEPLOY.md
docker-compose.yml:41 blocks backend startup on migrate success; no documented recovery.

### 5. Native date pickers in Firefox/Safari
`lang="en-IN"` fixes Chromium only; Firefox and Safari read OS regional settings. The
cross-browser fix is a custom picker across 26 inputs, which costs the native mobile
date UI. Only worth doing if those browsers matter.

## Known Flakes (pre-existing)
- `dashboard.routes.test.ts > returns empty array when no alerts` (backend) — order-dependent
- `Dashboard.test.tsx` (frontend) — `findBy` timeouts under parallel load; passes on re-run
