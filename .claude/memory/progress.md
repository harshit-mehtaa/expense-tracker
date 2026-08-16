# Task Progress

## Status: review-complete (awaiting COMMIT approval)
## Task: Subscription management — model owning its RecurringRule
## Steps Completed: analyze, plan, approve, implement, review

## Triple review run
Compliance PARTIAL · Quality FAIL (6 High) · Adversarial DESTROYED (2 blocking).
All accepted findings fixed. Full filter table is in the commit message body.

**The one that mattered most (adversarial F1):** the form's only date question is
"Start date", so answering it honestly ("Netflix, since 2020") set the rule's
nextRunDate to 2020. The scheduler runs unattended hourly and catches up to 366
occurrences — that silently posted ~80 real transactions across six financial years,
rewriting every report, budget and tax figure, with no warning and no undo. Fixed by
clamping: startDate is metadata, billing starts today at the earliest.

**Second blocking (F2/quality-High-1):** chaining `.transform()` after `.optional()`
also ran the transform on ABSENT keys, so a partial `PUT {name}` arrived as explicit
null for every other optional field and wiped them — including `trialEndDate`, which
the trial alert depends on, so the user would then be charged with no warning.

## Rejected / deferred (with reasons)
- **F5a template counted as spend in listTransactions/reports** — PRE-EXISTING, not
  introduced here: `git show HEAD:...recurringService.ts` creates templates identically.
  Fixing it repo-wide is its own task. Mitigated what is mine: templates now carry
  `balanceImpactApplied: false`, and `softDeleteTransaction` refuses to delete a template
  (which previously bricked billing permanently and silently).
- **Decimal-vs-float on the write path (quality Medium)** — reviewer could not
  demonstrate loss; `Decimal(15,2)` survives the round-trip. Noted, not reworked.

## Validation
- Backend 2134 tests, 100% lines/branches/functions/statements
- Frontend 712 tests, coverage gate exit 0; tsc + lint clean both packages
- Migration ROLLED BACK and re-applied after review changed it (deletedAt, enum without
  PAUSED, deduped index) so file and database agree. Verified in psql.
- **Live run 1: 15/15** — catch-up across a price rise billed [499,499,499,499] then
  [649,649]; ownership guard; cancel stops generation; cascade on delete.
- **Live run 2: 10/10** — a 2020 start date now yields 1 charge, not ~80; template
  delete blocked; trial extension moves the charge date; soft delete keeps price history
  and stops the money. 0 rows leaked.

## Known Flakes (pre-existing, NOT from this task)
- `dashboard.routes.test.ts > returns empty array when no alerts` (backend) — order-dependent
- `Dashboard.test.tsx` (frontend) — `findBy` timeouts under parallel load; passes on re-run

## QUEUED NEXT

### 1. dd/mm/yyyy dates across the product
- `emiDate`/`sipDate`/`premiumDueDate` are day-of-month Ints → render as *next occurrence*
- Convert the 19 plain `toLocaleDateString('en-IN')` sites; LEAVE the 6 deliberate variants

### 2. Debt from the loans review
- **M2 (security)** `normalizeRealEstateOwners` validates the RAW share before rounding,
  so 0.001 stores as 0 and — since `userRealEstateWhere` keys on membership alone — that
  0% row grants full view/edit/delete. AND `updateRealEstate` takes a non-empty owners
  array verbatim with `deleteMany: {}`, so a 1% co-owner can delete the primary owner.
  Both VERIFIED by reading the code. Fix when extracting `utils/ownerShares.ts`.
- **H3** MEMBER cannot add co-owners (no non-admin member-listing endpoint; product-wide)
- **M1** `realEstateInclude` returns the whole Loan row to RealEstate co-owners
- **M4** `Asset.value` never enters net worth
- **H6** No P3009 / rollback runbook in DEPLOY.md

### 3. Recurring-template ledger pollution (from this review, pre-existing)
Templates are ordinary EXPENSE rows with `isRecurring: true`; only the two new
subscription read paths exclude them. Reports, dashboard and listTransactions all count
money that never moved.
