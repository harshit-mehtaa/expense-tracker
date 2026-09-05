# Task Progress

## Status: idle

No task in progress.

## Series plan (9 /task runs total, user-approved order) — 5 of 9 done:
1. [DONE] Bug fixes: UTC snapshot key + netWorthChangePct approximation
2. [DONE] Spend-by-category breakdown widget
3. [DONE] Tax-deduction snapshot (80C/80D) widget
4. [DONE] Investment/loan summary tile
5. [DONE] Alerts "view all" link (new Reminders page)
6. [QUEUED NEXT] Quick-add shortcuts (add transaction / record income)
7. Fragile cash-flow month-click date parsing
8. Per-member drill-in on family spending breakdown
9. Dashboard.test.tsx coverage check + gap-fill

## Tech debt inventory (see git log for full task-by-task detail):
- Primary transaction CRUD mutations don't invalidate dashboard/profit-
  and-loss/report-spending at all — only 4 secondary modals do.
- No app-wide query-key constants module — every query key is a bare
  string literal duplicated at every use/invalidate site.
- `computeTotalLiabilities` (dashboardService.ts:810-824) has an
  undocumented `endDate: {gte: new Date()}` filter that silently excludes
  loans past their scheduled end date — affects the Assets vs Liabilities
  pie AND the Net Worth StatCard, both of which can disagree with the
  Investments & Loans tile's correct "Loan Outstanding".
- `UpcomingAlert` type is duplicated (frontend/src/api/dashboard.ts +
  orphaned, already-drifted shared/types/index.ts copy with zero
  importers) and `getUpcomingAlerts` has no backend return-type
  annotation linking them — a new alert type compiles cleanly without
  updating Reminders.tsx's route map (runtime-guarded, but not
  type-safe). Needs a dedicated unification task.
- `viewUserId` (useMemberSelector) is local `useState`, not shared
  context/URL state — an ADMIN scoped to one member on Dashboard sees a
  wider "All Family" view after clicking "View all" to Reminders, with
  no visual cue the scope changed.
- BUDGET_ALERT rows display the budget LIMIT as "amount due" (not money
  owed), always sort to the top (daysUntilDue:0) — pre-existing backend
  data-shape inconsistency in the alert model.
- Admin member-selector header block (label+select+isMembersError) is
  now duplicated 14x+ across pages — component-extraction candidate.
- The 80C/80D bar-color threshold expression duplicated 4x.
- Progress bars across the app lack ARIA (role="progressbar" etc.).
- taxApi/insuranceApi/investmentsApi/loansApi wrapper functions mostly
  return `Promise<any>` — no compile-time safety on consumers.
- Backend global branch-coverage gate at 99.9% (loanService.ts:457,
  subscriptionService.ts:402-403).
- Frontend `npm run typecheck:tests` pre-existing errors in
  apiNormalizers.test.ts and dateFormat.test.ts.
- `''`-coerces-to-0 Zod bug class unfixed in RealEstate.tsx, Accounts.tsx,
  TaxCentre.tsx (12 fields).
- Dashboard's `netWorth` field is always today's live figure regardless
  of `selectedFY`.
- UTC-vs-IST key-comparison bug class also exists in
  useRecurringAutoGenerate.ts:12 (self-corrects next day, low impact).

## Process note: reviewer agents with Bash access can temporarily mutate
the working tree during "empirical proof" testing. Avoid concurrent Edit
calls on the same file while such an agent is active.

## Known Flakes: none currently tracked.
