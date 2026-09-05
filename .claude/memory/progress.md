# Task Progress

## Status: analyze

## Task: [4/9 of a Dashboard improvement series] Add an investment/loan
summary tile to the Dashboard — total portfolio value + total outstanding
loan balance at a glance.

## Steps Completed: analyze, plan, approve, implement

## Implementation Summary: Added 2 queries to Dashboard.tsx
(investmentsApi.getPortfolioSummary, loansApi.getAll) with query keys
byte-matched to Investments.tsx/Loans.tsx for cache sharing. New
"Investments & Loans" card (Landmark icon) between Tax Deductions and Net
Worth Trend: gated on both queries settling (return null while loading,
matching Task 3's pattern — avoids a false "₹0/₹0" flash). Two rows:
"Portfolio Value" (Link to /investments) + "Loan Outstanding" (Link to
/loans, computed via loans.reduce with outstandingBalanceShare ??
outstandingBalance, copied verbatim from Loans.tsx:940-943 — deliberately
matches Loans.tsx's own ground truth, NOT the Assets-vs-Liabilities pie
chart's Liabilities number, which excludes loans past their scheduled end
date via a separate undocumented filter in computeTotalLiabilities,
logged as tech debt below). Added MSW handlers for the 2 new endpoints to
Dashboard.test.tsx (both dashboardHandlers() and the hand-rolled "fires
only once" list) and App.test.tsx's shellHandlers(). 3 new tests: populated
data + View-all link hrefs (default family-wide ADMIN view, mixed
share/no-share loan fixture), zero loans, zero portfolio.

## Steps Completed: analyze, plan, approve, implement, review

## Review: quality verdict PASS_WITH_NOTES (2 High), adversarial verdict
BRUISED (2 Medium — same underlying issues as quality's 2 High, different
severity calibration). No critical/high blocking issue.

## Co-Founder Filter:
- [HIGH/MED, both reviewers] No `isError` handling on either query — a
  backend 500 would silently render "₹0.00", indistinguishable from a
  genuine zero-investments/zero-loans state, inconsistent with the
  immediately-preceding Tax Deductions widget's own established pattern
  in this same file → ACCEPTED, fixed. Added `isError` capture + per-row
  "Unable to load" fallback, matching Tax Deductions' style exactly.
- [HIGH/MED, both reviewers] The 3 new tests only asserted label/link
  presence, never the actual rendered amount — adversarial reviewer
  EMPIRICALLY PROVED this by substituting garbage values (9999999, -1)
  into the widget and re-running: all 3 tests still passed → ACCEPTED,
  fixed. Added exact-amount assertions (₹3,50,000.00 / ₹2,00,000.00 /
  ₹0.00 cases) plus a new 4th test for the fetch-error state.
- [MED, adversarial] The pie-chart-divergence code comment only warned
  about the Assets vs Liabilities pie — `computeTotalLiabilities` (the
  same buggy-filter function) ALSO feeds the "Net Worth" StatCard at the
  top of the page (`summary.netWorth`), a MORE prominent number than the
  pie. So the divergence risk was under-documented, not just the pie →
  ACCEPTED, fixed. Expanded the comment to name both call sites.
- [MED, quality] Pie-chart/Net-Worth divergence has no user-facing signal
  (tooltip/footnote), only a code comment → ACCEPTED_DEFERRED. Reviewer's
  own verdict: "not a blocker for this LOW-risk task." Logged as tech
  debt below — the real fix is the underlying `computeTotalLiabilities`
  filter, not a UI band-aid on this one widget.
- [LOW, quality] No test for the loading-gate itself (asserting the
  widget body is absent while queries are in flight) → ACCEPTED_DEFERRED,
  low value relative to churn, logged as tech debt.
- [LOW, quality] No test for member-switch refetch on these 2 new queries
  → REJECTED. Query-key structure is byte-identical to the already-tested
  80C member-switch pattern; mechanically guaranteed identical behavior,
  redundant assertion adds no real coverage.

## Incident during REVIEW: the adversarial reviewer agent (which has Bash
access) temporarily patched Dashboard.tsx locally to empirically prove the
weak-test finding, running concurrently with an orchestrator Edit call on
the same file — the isError destructure was lost in the race (JSX
referencing `portfolioError`/`loansError` survived, the `useQuery`
destructure adding them did not), causing a build failure caught
immediately by the next test run. Fixed by re-adding the destructure and
verifying via `git status` that no other file was affected. Process note
for future tasks: avoid concurrent Edit calls on a file while a
Bash-capable review agent is active on it.

## Full gate (post-review-fixes): frontend 914/914 tests, lint clean,
tsc --noEmit clean.

## Question Resolution (fresh reads at REVIEW time):
| # | Question | Result |
|---|---|---|
| VQ1 | Avoids literal duplicate of Assets vs Liabilities | PASS — compact list-row shape, distinct labels/links, not a 2nd pie |
| VQ2 | Shares cache with Investments.tsx/Loans.tsx | PASS — both reviewers independently verified byte-identical keys/queryFns |
| VQ3 | Same role/targetUserId scoping as every other card | PASS — both reviewers traced backend authorization independently, no MEMBER leak path |
| VQ4 | Correctly excludes selectedFY from both query keys | PASS |
| VQ5 | Handles zero-investments/zero-loans gracefully | PASS — now with exact-amount test assertions, not just label checks |

## Plan (revised after plan-challenger NEEDS_WORK — 2 must_fix resolved):
1. [LOW] Two useQuery hooks in Dashboard.tsx: `{data: portfolio}` key
   `['portfolio', viewUserId]` via `investmentsApi.getPortfolioSummary(
   viewUserId ? {targetUserId: viewUserId} : undefined)` — byte-identical
   to Investments.tsx:171-174; `{data: loans = [], isLoading: loansLoading}`
   key `['loans', viewUserId]` via `loansApi.getAll(viewUserId)` —
   byte-identical to Loans.tsx:653-655. Also capture `isLoading` for
   portfolio.
2. [LOW] `totalOutstanding = loans.reduce((s,l) => s + (l.outstandingBalanceShare
   ?? l.outstandingBalance), 0)` — copied verbatim from Loans.tsx:940-943
   (comment cross-references it). **Deliberately does NOT match the
   Assets-vs-Liabilities pie chart's Liabilities number** — must_fix
   resolution: `computeTotalLiabilities` (dashboardService.ts:810-824) has
   an undocumented `endDate: {gte: new Date()}` filter that silently
   excludes loans running past their scheduled end date even if still
   open with a real balance — verified via direct read, no test covers
   this exact edge case, looks like a pre-existing bug, not intentional
   design. This widget matches Loans.tsx's own ground truth (what the user
   sees on the Loans page) instead of propagating that filter into a 2nd
   place. The pie chart's exclusion is logged as tech debt below, NOT
   fixed in this task (cross-cutting net-worth/snapshot blast radius, out
   of proportion for "add a tile").
3. [LOW] "Investments & Loans" card (Landmark icon) between Tax Deductions
   and Net Worth Trend. No FY suffix in header. Two rows: "Portfolio
   Value" (Link to /investments) + "Loan Outstanding" (Link to /loans),
   INRDisplay amount short.
4. [LOW] **Revised per should_fix**: gate the body on
   `portfolioLoading || loansLoading` (return null while loading, matching
   Task 3's Tax Deductions pattern) instead of a naive `?? 0` fallback —
   avoids a false "₹0/₹0" flash for a user with real balances while the
   two independent queries (not covered by the page's top-level
   summaryLoading gate) are still in flight.
5. [LOW] Confirm viewUserId scoping (no new logic) + explicit family-wide
   ADMIN test case (should_fix — outstandingBalanceShare semantics differ
   when scopedUserId is undefined, defaults sharePercent to 100).
6. [MED] **New — must_fix #2**: add MSW handlers for `GET
   /investments/portfolio-summary` and `GET /loans` to Dashboard.test.tsx's
   `dashboardHandlers()` BEFORE adding widget-specific tests — all 28
   existing Dashboard tests would hard-fail under onUnhandledRequest:'error'
   otherwise. Also add to App.test.tsx's shellHandlers().
7. [LOW] New tests: populated data, zero loans, zero/undefined portfolio,
   "View all" link hrefs, family-wide ADMIN view.
8. [LOW] tsc --noEmit + lint + full suite.

## Plan-Challenger: verdict NEEDS_WORK on first pass. All 4 DQ answers
individually confirmed correct. 2 must_fix resolved above (pie-chart
numeric-divergence risk — verified real, pre-existing `endDate` filter bug
in computeTotalLiabilities, resolved by matching Loans.tsx's ground truth
and logging the pie's exclusion as separate tech debt rather than
propagating it; missing MSW handlers would have broken all 28 existing
Dashboard tests). 2 should_fix resolved (loading-state gating, family-wide
ADMIN test case). 1 nice_to_fix resolved (icon: Landmark).

## Design Questions:
DQ1: Is this widget redundant with Dashboard's existing Assets vs
Liabilities pie chart?
Evidence: Dashboard.tsx:277-305's pie chart sources `summary.totalAssets`/
`totalLiabilities` (dashboardService.ts:14-91,690-826) — MERGED aggregates
(assets = bank+FD+RD+investments+gold+real estate+other; liabilities =
loans+credit cards). Neither isolates investment-portfolio-value-only or
loan-balance-only. NOT a literal duplicate, but conceptually adjacent —
worth an explicit framing decision (standalone tile vs. enriching the
existing pie chart), not silently assumed.

DQ2: What's the data-fetching approach given no loan-summary endpoint
exists?
Evidence: `investmentsApi.getPortfolioSummary({targetUserId})` already
exists and is reusable as-is (investments.ts:26-30, Investments.tsx:
171-174) — {totalInvested, totalCurrentValue, absoluteGain,
absoluteReturnPct, xirr, byType}. NO loan-summary endpoint exists
anywhere (`backend/src/routes/loans.ts` has only `GET /loans`);
Loans.tsx itself computes `totalOutstanding` CLIENT-SIDE by reducing the
full loan list (Loans.tsx:940-943:
`l.outstandingBalanceShare ?? l.outstandingBalance`). Confirmed
Loans.tsx's query key is `['loans', viewUserId]` — if Dashboard uses the
identical key/queryFn, it shares cache with Loans.tsx rather than
double-fetching.

DQ3: FY-scoping?
Evidence: Both numbers are live/current (getPortfolioSummary has no fy
param; loan outstandingBalance is a running balance) — should NOT include
selectedFY in either query key, matching the precedent already set by
Task 3's 80D query (Dashboard.tsx:81-87).

DQ4: Param-name consistency risk?
Evidence: investments route uses `?userId=`, loans route uses
`?targetUserId=` — inconsistent at the raw route level, but already
abstracted by `investmentsApi.getPortfolioSummary({targetUserId})` and
`loansApi.getAll(targetUserId)` wrapper functions. Using those wrappers
(not raw fetch) makes this a non-issue, same as prior widgets.

## Verification Questions:
VQ1: Does the widget avoid being a literal duplicate of the existing
Assets vs Liabilities numbers, per DQ1's resolution?
VQ2: Does the widget share cache (identical query key/queryFn) with
Investments.tsx/Loans.tsx rather than double-fetching?
VQ3: Same role/targetUserId scoping pattern as every other Dashboard
card?
VQ4: Correctly excludes selectedFY from both query keys (DQ3)?
VQ5: Handles zero-investments/zero-loans gracefully?

## Series plan (9 /task runs total, user-approved order) — 3 of 9 done:
1. [DONE] Bug fixes: UTC snapshot key + netWorthChangePct approximation
2. [DONE] Spend-by-category breakdown widget
3. [DONE] Tax-deduction snapshot (80C/80D) widget
4. [IN PROGRESS] Investment/loan summary tile
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
