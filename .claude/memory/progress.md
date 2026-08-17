# Task Progress

## Status: idle

Last completed: inline asset creation can link to the record that already tracks it,
closing a live double-count on new property and gold assets.

## QUEUED NEXT

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
- `Asset.value` and `RealEstate.currentValue` hold the same number in two columns and can
  drift. RealEstate is authoritative for net worth now, but nothing keeps them in step.
- Category delete guards run children -> budgets -> transactions, so a category with both
  children and transactions needs two round trips to remove. Correct precedence, mildly
  annoying; surface all blockers at once if it becomes a nuisance.
- `Transaction.isRecurring` is now written but never read. It was the (unreliable) proxy
  for "is a template"; templates are no longer transactions, so nothing filters on it.
  It stays user-settable via the API. Drop it when next touching that schema area.

## Known Flakes (pre-existing)
- `dashboard.routes.test.ts > returns empty array when no alerts` (backend) — order-dependent
- `Dashboard.test.tsx` (frontend) — `findBy` timeouts under parallel load; passes on re-run
