# Task Progress

## Status: idle

Last completed: category management — tree view, usage stats, merge, safe delete.

## QUEUED NEXT

### 1. `Asset.value` never enters net worth
A vehicle worth Rs 12L shows the AUTO loan as a liability with no offsetting asset.
Needs dedup design vs RealEstate/Gold.

### 2. MEMBER cannot add co-owners
No non-admin member-listing endpoint. Affects loans AND real estate. Widens data
exposure, so it is a product decision.

### 3. No P3009 / rollback runbook in DEPLOY.md
docker-compose.yml:41 blocks backend startup on migrate success; no documented recovery.

### 4. Native date pickers in Firefox/Safari
`lang="en-IN"` fixes Chromium only; Firefox and Safari read OS regional settings. The
cross-browser fix is a custom picker across 26 inputs, which costs the native mobile
date UI. Only worth doing if those browsers matter.

## Tech debt noted
- Category delete guards run children -> budgets -> transactions, so a category with both
  children and transactions needs two round trips to remove. Correct precedence, mildly
  annoying; surface all blockers at once if it becomes a nuisance.
- `Transaction.isRecurring` is now written but never read. It was the (unreliable) proxy
  for "is a template"; templates are no longer transactions, so nothing filters on it.
  It stays user-settable via the API. Drop it when next touching that schema area.

## Known Flakes (pre-existing)
- `dashboard.routes.test.ts > returns empty array when no alerts` (backend) — order-dependent
- `Dashboard.test.tsx` (frontend) — `findBy` timeouts under parallel load; passes on re-run
