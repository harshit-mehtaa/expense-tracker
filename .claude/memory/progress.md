# Task Progress

## Status: review-complete (awaiting COMMIT approval)
## Task: Loans — auto-fill, pre-EMI, prepayment amount, multi-owner, asset link
## Steps Completed: analyze, plan, approve, implement, review

## Review Result
Triple review done. Quality FAIL / compliance PARTIAL / adversarial DESTROYED (4 criticals).
All accepted findings fixed. Full Co-Founder Filter is in the commit message body.

Deferred to their own tasks (recorded so they are not lost):
- **H3** MEMBER cannot add co-owners — needs a non-admin member-listing endpoint.
  `RealEstate.tsx:67` has the identical limitation, so this is product-wide, not a loans bug.
- **H6** No P3009 / rollback runbook in `DEPLOY.md`.
- **M1** `realEstateInclude` returns the whole `Loan` row to RealEstate co-owners — narrow to a `select`.
- **M2** `normalizeLoanOwners` duplicates `normalizeRealEstateOwners` — extract to `utils/ownerShares.ts`.
- **M4** `Asset.value` never enters net worth — needs dedup design vs RealEstate/Gold.

## Known Flake (pre-existing, NOT from this task)
`dashboard.routes.test.ts > returns empty array when no alerts` — order-dependent;
passes in isolation and on re-run.

## Final Gates
- Backend 1995 tests, 100% lines/branches/functions/statements
- Frontend 694 tests, coverage gate exit 0
- tsc CLEAN both packages; frontend lint CLEAN
- Migration applies to an empty DB (18/18) and to a DB holding a legacy secured loan

## QUEUED NEXT (in order)

### 1. dd/mm/yyyy dates across the product
Decisions locked:
- `emiDate` / `sipDate` / `premiumDueDate` are day-of-month `Int`s → render as *next occurrence*
- Convert the 19 plain `toLocaleDateString('en-IN')` sites
- LEAVE the 6 deliberate variants alone (chart axes, long-form prose)

### 2. Subscription management
User chose a real `Subscription` model (trials, cancellation URL, price-change history,
usage tracking) — NOT a filtered view over RecurringRule.
**Design constraint:** a Subscription must OWN its RecurringRule, not sit beside it,
or there are two sources of truth for the same money.
