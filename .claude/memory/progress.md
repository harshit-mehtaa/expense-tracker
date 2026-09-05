# Task Progress

## Status: idle

No task in progress.

## Series plan (9 /task runs total, user-approved order) — 4 of 9 done:
1. [DONE] Bug fixes: UTC snapshot key + netWorthChangePct approximation
2. [DONE] Spend-by-category breakdown widget
3. [DONE] Tax-deduction snapshot (80C/80D) widget
4. [DONE] Investment/loan summary tile
5. [QUEUED NEXT] Alerts "view all" link
6. Quick-add shortcuts (add transaction / record income)
7. Fragile cash-flow month-click date parsing
8. Per-member drill-in on family spending breakdown
9. Dashboard.test.tsx coverage check + gap-fill

## Tech debt inventory (see git log for full task-by-task detail):
- Primary transaction CRUD mutations (Transactions.tsx editMutation,
  deleteMutation, add) don't invalidate dashboard/profit-and-loss/report-
  spending at all — only 4 secondary modals (SIP/insurance/refund) do.
- No app-wide query-key constants module — every query key is a bare
  string literal duplicated at every use/invalidate site.
- `computeTotalLiabilities` (dashboardService.ts:810-824) has an
  undocumented `endDate: {gte: new Date()}` filter that silently excludes
  loans past their scheduled end date even if still open with a real
  balance — affects the Assets vs Liabilities pie AND the Net Worth
  StatCard's `summary.netWorth`, both of which can now visibly disagree
  with the Investments & Loans tile's "Loan Outstanding" (which correctly
  matches Loans.tsx's own ground truth). Needs a dedicated fix task —
  likely just dropping the filter, but check git history/tests first for
  why it's there.
- The 80C/80D bar-color threshold expression duplicated 4x (TaxCentre.tsx,
  Tracker80DTab.tsx x3, Dashboard.tsx) — candidate shared helper.
- Progress bars across the app lack ARIA (role="progressbar" etc.) —
  systemic gap.
- taxApi/insuranceApi/investmentsApi/loansApi wrapper functions mostly
  return `Promise<any>` — no compile-time safety on consumers.
- Backend global branch-coverage gate at 99.9% (loanService.ts:457,
  subscriptionService.ts:402-403).
- Frontend `npm run typecheck:tests` pre-existing errors in
  apiNormalizers.test.ts and dateFormat.test.ts.
- `''`-coerces-to-0 Zod bug class unfixed in RealEstate.tsx:48,
  Accounts.tsx:124, TaxCentre.tsx (12 fields).
- Dashboard's `netWorth` field is always today's live figure regardless
  of `selectedFY`.
- 80C's LIC-premium leg has no date filter, unlike investments/FDs.
- UTC-vs-IST key-comparison bug class also exists in
  useRecurringAutoGenerate.ts:12 (self-corrects next day, low impact).

## Process note: reviewer agents with Bash access (reviewer-adversarial,
test-runner) can temporarily mutate the working tree during "empirical
proof" testing. Avoid concurrent Edit calls on the same file while such
an agent is active — caused a lost update (isError destructure) during
Task 4's review, caught immediately by the next test run.

## Known Flakes: none currently tracked.
