# Task Progress

## Status: idle

No task in progress.

## Series plan (9 /task runs total, user-approved order) — 6 of 9 done:
1. [DONE] Bug fixes: UTC snapshot key + netWorthChangePct approximation
2. [DONE] Spend-by-category breakdown widget
3. [DONE] Tax-deduction snapshot (80C/80D) widget
4. [DONE] Investment/loan summary tile
5. [DONE] Alerts "view all" link (new Reminders page)
6. [DONE] Quick-add shortcuts (Add Expense / Add Income on Dashboard)
7. [QUEUED NEXT] Fragile cash-flow month-click date parsing
8. Per-member drill-in on family spending breakdown
9. Dashboard.test.tsx coverage check + gap-fill

## Tech debt inventory (see git log for full task-by-task detail):
- Primary transaction CRUD mutations (edit/delete/import/bulk/recurring-
  apply) still don't invalidate dashboard/profit-and-loss/report-
  spending/accounts — only the create path (fixed in Task 6) and 4
  secondary modals (SIP/insurance/refund) do. `lib/queryInvalidation.ts`
  is the natural home for a shared `invalidateAfterTransactionChange`
  covering all ~7 sites.
- No app-wide query-key constants module.
- `computeTotalLiabilities` (dashboardService.ts:810-824) has an
  undocumented `endDate: {gte: new Date()}` filter that silently
  excludes loans past their scheduled end date — affects the Assets vs
  Liabilities pie AND the Net Worth StatCard.
- `UpcomingAlert` type duplicated (api/dashboard.ts + orphaned, drifted
  shared/types/index.ts copy) — needs unification.
- `useAccounts`/`useCategories` independently duplicated across
  useTransactionFormOptions.ts, Accounts.tsx, Budgets.tsx,
  RecurringRules.tsx, admin/Categories.tsx (5-way) — same query key,
  separate definitions; a queryFn drift would silently corrupt shared
  cache entries.
- `selectedMemberName` derivation duplicated in Dashboard.tsx and
  Transactions.tsx — candidate to return from useMemberSelector.
- `PageHeader` component has zero production usages; Dashboard's Task 6
  header is its 9th hand-rolled duplicate — adopt-or-delete decision.
- ADMIN sees no Dashboard quick-add buttons by default (family-wide
  view, matches 8 other pages' convention) but Transactions.tsx's own
  Add flow auto-selects the admin as target instead of hiding — open
  product question, not resolved either way.
- No modal in the app has role="dialog"/focus-trap/Escape-to-close (12
  modals checked) — systemic a11y gap.
- `viewUserId` is local useState, not shared context/URL state.
- BUDGET_ALERT rows display the budget LIMIT as "amount due".
- 80C/80D bar-color threshold duplicated 4x. Progress bars lack ARIA.
- taxApi/insuranceApi/investmentsApi/loansApi mostly return `Promise<any>`.
- Backend branch-coverage gate at 99.9% (loanService.ts:457,
  subscriptionService.ts:402-403).
- `''`-coerces-to-0 Zod bug class unfixed in RealEstate.tsx, Accounts.tsx,
  TaxCentre.tsx (12 fields).
- Dashboard's `netWorth` always today's live figure regardless of
  `selectedFY`. UTC-vs-IST bug class also in useRecurringAutoGenerate.ts:12.

## Known Flakes: none currently tracked.
