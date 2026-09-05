# Task Progress

## Status: idle

No task in progress.

## Series plan (9 /task runs total, user-approved order) — 9 of 9 done. Series complete.
1. [DONE] Bug fixes: UTC snapshot key + netWorthChangePct approximation
2. [DONE] Spend-by-category breakdown widget
3. [DONE] Tax-deduction snapshot (80C/80D) widget
4. [DONE] Investment/loan summary tile
5. [DONE] Alerts "view all" link (new Reminders page)
6. [DONE] Quick-add shortcuts (Add Expense / Add Income on Dashboard)
7. [DONE] Fragile cash-flow month-click date parsing (was a live crash)
8. [DONE] Per-member drill-in on family spending breakdown
9. [DONE] Dashboard.test.tsx coverage check + gap-fill (14 new tests, 66 total)

## Tech debt inventory (see git log for full task-by-task detail):
- `frontend/src/lib/accountFormat.ts:46`'s owner-name-shown branch (`showOwner ?
  (userName || fallbackOwnerName) : undefined`) has zero test coverage anywhere —
  `showAccountOwner`/`fallbackAccountOwnerName` are passed by Dashboard.tsx but never
  observed with a real owner name in any test. Needs an accounts fixture with a
  distinguishable userName in AddTransactionModal.test.tsx.
- `resolveTargetUserId` (backend) only checks `deletedAt`, not `isActive` — broader,
  pre-existing gap affecting every caller (Task 8's deep link mitigates client-side only).
- `spendingByCat` query in Reports.tsx has no isError handling, unlike its P&L/Trial
  Balance siblings.
- Primary transaction CRUD mutations (edit/delete/import/bulk/recurring-apply) still
  don't invalidate dashboard/profit-and-loss/report-spending/accounts.
- `CashflowMonth`/`UpcomingAlert` types independently duplicated; `useAccounts`/
  `useCategories` duplicated 5-way; `selectedMemberName` derivation duplicated
  (Dashboard.tsx/Transactions.tsx).
- `computeTotalLiabilities` has an undocumented endDate filter excluding overdue loans.
- `PageHeader` component has zero production usages.
- No modal has role="dialog"/focus-trap/Escape-to-close; chart click-handlers are
  mouse-only — systemic a11y gap.
- `viewUserId` is local useState, not shared context/URL state.
- BUDGET_ALERT rows display the budget LIMIT as "amount due".
- 80C/80D bar-color threshold duplicated 4x. taxApi/insuranceApi/investmentsApi/loansApi
  mostly return `Promise<any>`.
- Backend branch-coverage gate at 99.9% (loanService.ts:457, subscriptionService.ts:402-403).
- `''`-coerces-to-0 Zod bug class unfixed in RealEstate.tsx, Accounts.tsx, TaxCentre.tsx.
- Dashboard's `netWorth` always today's live figure regardless of `selectedFY`.

## Known Flakes: none currently tracked.
