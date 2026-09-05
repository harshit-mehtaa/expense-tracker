# Task Progress

## Status: review

## Task: [2/9 of a Dashboard improvement series] Add a spend-by-category
breakdown widget to the Dashboard.

## Steps Completed: analyze, plan, approve, implement, review

## Implementation Summary: Extracted reportCategoryName/sortReportCategories/
topReportCategoriesByTotal to chartUtils.tsx (now properly typed via
ReportCategoryLike/ReportTotalLike, no more `any`). New "Spend by Category"
card on Dashboard.tsx (MEMBER+ADMIN visible, top 5 by descending spend,
floored-denominator bar-width formula so negative-total categories render
0-width, not NaN/negative CSS). Shares Reports.tsx's exact query key/queryFn
(['report-spending', selectedFY, viewUserId]) via one extracted
fetchSpendingByCategory(). Reports.tsx also now uses reportCategoryName at
its 3 remaining inline `?? 'Uncategorized'` sites.

## Review Fixes Applied:
- [HIGH, quality] `['report-spending']` was never invalidated by any
  mutation → widget went stale after transactions changed. Fixed at all 4
  sites in Transactions.tsx that already invalidate `['profit-and-loss']`
  (SIP link/unlink, insurance link, refund link — the last being the exact
  scenario that produces negative per-category totals). Extracted a shared
  `invalidateFinancialReports(qc)` helper (Transactions.tsx:42-45) so the
  pair can't drift apart again.
- [MED, quality] Test asserting the 0-width-bar guard only exercised the
  numerator floor (denominator stayed positive) — added a real
  denominator<=0 case (all top-5 totals zero/negative) asserting every bar
  renders at 0%.
- [MED, quality] Brittle DOM-traversal test query
  (`.closest('div')?.parentElement` + class-selector) → added
  `data-testid="spend-category-row"`/`"spend-category-bar"`, rewrote to use
  them.
- [LOW, quality] JSDoc in api/dashboard.ts named the wrong query-key params
  (`fy, targetUserId` vs actual `selectedFY, viewUserId`) → fixed.
- [LOW, adversarial] `reportCategoryName` not adopted at Reports.tsx's 3
  remaining inline fallback sites → adopted at all 3.
- [LOW, adversarial] `reportCategoryName`/`sortReportCategories`/
  `topReportCategoriesByTotal` typed `any` despite two known concrete shapes
  → replaced with `ReportCategoryLike`/`ReportTotalLike` structural types;
  verified via tsc that both real callers (PnLCategoryRow[],
  SpendingByCategoryRow[]) still typecheck with no `any` left.

## Findings rejected/deferred (Co-Founder Filter):
- [MED, quality] Discarded loading/error state on the new query → REJECTED.
  Matches 3 sibling Dashboard cards (alerts/familyOverview/netWorthHistory)
  that also don't destructure isLoading/isError; app has a global
  `QueryCache.onError` (queryClient.ts) already surfacing failures via
  toast. Not a gap unique to this widget.
- [LOW, quality] Untested ₹1L+ INRDisplay branch → REJECTED. Already has
  dedicated coverage in INRDisplay.test.tsx; duplicating here is redundant.
- [LOW, quality] Negative-total row still uses the normal palette color
  (cosmetic) → ACCEPTED_DEFERRED, tech debt.
- [LOW, quality] chartUtils.tsx now mixes chart-rendering primitives with
  report-category helpers (cohesion drift) → ACCEPTED_DEFERRED, tech debt
  (candidate rename/split, not blocking).
- [MED, adversarial] `'report-spending'` literal duplicated across 3 files
  instead of a shared constant (P1 pattern) → CHALLENGED. Call-site
  duplication for invalidation is now collapsed into one
  `invalidateFinancialReports(qc)` helper. Full elimination needs a
  `queryKeys.ts` constants module covering all ~20+ query keys app-wide —
  zero precedent for that anywhere in this codebase today; a narrow fix for
  just this one key would be inconsistent. Logged as tech debt for a
  dedicated future task, not fixed narrowly here.
- **Broader pre-existing gap discovered, NOT fixed (out of scope)**: even
  the PRIMARY transaction create/edit/delete mutations
  (Transactions.tsx:715-729 editMutation, 1244-1255 deleteMutation, the
  add-transaction mutation) never invalidate `['dashboard']` or
  `['profit-and-loss']` at all — only 4 secondary modals (SIP/insurance/
  refund) do. This means the widget (and Dashboard/Reports generally) can
  still show stale data after a plain add/edit/delete, which this task's
  fix does not address. Needs its own dedicated task — likely a candidate
  for the same `invalidateFinancialReports` treatment, but auditing and
  fixing every primary CRUD site is bigger than this review's scope.

## Question Resolution (fresh reads at REVIEW time):
| # | Question | Result |
|---|---|---|
| VQ1 | Same query key/payload, no cache-key poisoning | PASS — Dashboard.tsx:63-64 and Reports.tsx:85-86 byte-identical queryFn |
| VQ2 | Scopes to selected member matching other cards | PASS — both call `fetchSpendingByCategory(selectedFY, isAdmin ? viewUserId : undefined)` |
| VQ3 | Handles zero-spending-this-FY gracefully | PASS — empty-state message + test |
| VQ4 | Extracted helper used by BOTH files, no leftover duplicate | PASS — Reports.tsx now imports all 3 helpers, no local redefinition |
| VQ5 | Follows INRDisplay/CHART_PALETTE conventions | PASS — INRDisplay short, CHART_PALETTE.categorical cycling |

## Full gate (post-review-fixes): frontend 902/902 tests, lint clean,
tsc --noEmit clean.

## Series plan (9 /task runs total, user-approved order) — 1 of 9 done, 2 of 9 in review:
1. [DONE] Bug fixes: UTC snapshot key + netWorthChangePct approximation
2. [IN REVIEW — ready for COMMIT] Spend-by-category breakdown widget
3. Tax-deduction snapshot (80C/80D) widget
4. Investment/loan summary tile
5. Alerts "view all" link
6. Quick-add shortcuts (add transaction / record income)
7. Fragile cash-flow month-click date parsing
8. Per-member drill-in on family spending breakdown
9. Dashboard.test.tsx coverage check + gap-fill

## Tech debt noted (not yet actioned) — carried forward + new this task:
- Primary transaction CRUD mutations don't invalidate dashboard/profit-and-
  loss/report-spending at all (see above — new, most significant finding).
- No app-wide query-key constants module; every query key is a bare string
  literal duplicated at every use/invalidate site (new, from adversarial
  review — pre-existing pattern, not unique to this task).
- Negative-total category row uses normal palette color, not a distinct
  "refund" treatment (new, cosmetic).
- chartUtils.tsx cohesion: now mixes chart primitives + report helpers (new).
- Backend global branch-coverage gate at 99.9% (loanService.ts:457,
  subscriptionService.ts:402-403) — pre-existing, needs dedicated fix task.
- Frontend `npm run typecheck:tests` pre-existing errors in
  apiNormalizers.test.ts and dateFormat.test.ts — pre-existing.
- Same `''`-coerces-to-0 Zod bug class unfixed in RealEstate.tsx:48,
  Accounts.tsx:124, TaxCentre.tsx (12 fields).
- Dashboard's `netWorth` field is always today's live figure regardless of
  `selectedFY`.
- UTC-vs-IST key-comparison bug class also exists in
  useRecurringAutoGenerate.ts:12 (self-corrects next day, low impact).

## Known Flakes: none currently tracked.
