# Task Progress

## Status: idle

No task in progress.

## Series plan (9 /task runs total, user-approved order) — 3 of 9 done:
1. [DONE] Bug fixes: UTC snapshot key + netWorthChangePct approximation
2. [DONE] Spend-by-category breakdown widget
3. [DONE] Tax-deduction snapshot (80C/80D) widget
4. [QUEUED NEXT] Investment/loan summary tile
5. Alerts "view all" link
6. Quick-add shortcuts (add transaction / record income)
7. Fragile cash-flow month-click date parsing
8. Per-member drill-in on family spending breakdown
9. Dashboard.test.tsx coverage check + gap-fill

## Tech debt inventory (see git log for full task-by-task detail):
- Primary transaction CRUD mutations (Transactions.tsx editMutation,
  deleteMutation, add) don't invalidate dashboard/profit-and-loss/report-
  spending at all — only 4 secondary modals (SIP/insurance/refund) do.
  Needs a dedicated task.
- No app-wide query-key constants module — every query key is a bare string
  literal duplicated at every use/invalidate site.
- Negative-total spend-category row uses normal palette color, no distinct
  "refund" treatment (cosmetic).
- chartUtils.tsx now mixes chart-rendering primitives with report-category
  helpers (cohesion drift).
- Dashboard's 3 tax-widget queries (profile/80C/80D) fire ungated/parallel
  even for New Regime users who discard 2 of 3 — matches TaxCentre.tsx's
  own pattern, not a regression, but worth a dashboard-perf pass once all
  9 series widgets are in.
- The 80C/80D bar-color threshold expression (`pct>=100 green, >=75
  yellow, else red`) is now duplicated 4x across TaxCentre.tsx,
  Tracker80DTab.tsx (x3), and Dashboard.tsx — candidate for a shared
  `getDeductionBarColor()` helper in a dedicated cleanup task.
- Progress bars across the app (Budget Health, Spend by Category, Tax
  Deductions, Tracker80DTab) lack ARIA (role="progressbar" etc.) — systemic
  gap, not any one widget's to fix in isolation.
- taxApi/insuranceApi wrapper functions all return `Promise<any>` — no
  compile-time safety on any consumer of tax/insurance API responses.
- Backend global branch-coverage gate at 99.9% (loanService.ts:457,
  subscriptionService.ts:402-403).
- Frontend `npm run typecheck:tests` pre-existing errors in
  apiNormalizers.test.ts and dateFormat.test.ts.
- `''`-coerces-to-0 Zod bug class unfixed in RealEstate.tsx:48,
  Accounts.tsx:124, TaxCentre.tsx (12 fields).
- Dashboard's `netWorth` field is always today's live figure regardless of
  `selectedFY`.
- 80C's LIC-premium leg (taxService.ts:324) has no date filter, unlike the
  investments/FDs legs — so "80C — FY X" is slightly imprecise (inherited
  from TaxCentre, not introduced by the Dashboard widget task).
- UTC-vs-IST key-comparison bug class also exists in
  useRecurringAutoGenerate.ts:12 (self-corrects next day, low impact).

## Known Flakes: none currently tracked.
