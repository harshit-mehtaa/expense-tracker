# Task Progress

## Status: analyze

## Task: [7/9 of a Dashboard improvement series] Fix fragile cash-flow
month-click date parsing on Dashboard.

## Steps Completed: analyze, plan, approve, implement

## Implementation Summary: Extracted the cash-flow chart's onClick
handler into a named, exported `handleCashflowClick(chartData,
navigate)` function in Dashboard.tsx. Replaced the fragile label-
reparsing (`.split(' ')`, hardcoded month-name array, `2000 +
parseInt(yr,10)` year hack — which threw `TypeError` in production
since the real backend never sends the `"Apr '24"` format the code
assumed) with direct reads of `payload.monthIndex`/`payload.year`,
which were already structured fields on the same payload. Added a
malformed-payload guard (recharts types `activePayload` as `any[]`, so
the type cast alone gave no runtime protection). Corrected the
Dashboard.test.tsx CASHFLOW fixture, which had the wrong shape
(0-indexed monthIndex, "Apr '25" with year suffix) relative to the real
backend (1-indexed, bare "Apr") — no other test depended on the wrong
shape, confirmed by full-suite run.

8 new unit tests directly on `handleCashflowClick` (no page mount, no
recharts mock — sidesteps the fact that Dashboard renders a SECOND,
unrelated AreaChart with no onClick, which a naive mock would have
collided with): April, January (FY-year-rollover), non-leap Feb (28
days), leap Feb (29 days), December (day-0-of-next-month trick doesn't
roll into January), no-activePayload guard, empty-array guard,
malformed-payload guard (3 sub-cases).

## Steps Completed: analyze, plan, approve, implement, review

## Review: quality verdict PASS, adversarial verdict RESILIENT (no
critical/high — adversarial reviewer hand-verified date math for 2
months the tests didn't cover, live-simulated removing the guard to
prove the malformed-payload tests are non-vacuous).

## Co-Founder Filter:
- [LOW, adversarial] Malformed-payload guard used `typeof x !== 'number'`
  — but `typeof NaN === 'number'` is true, so a literal NaN slips past
  and still produces a silent `?startDate=&endDate=` navigate, directly
  contradicting the guard's own stated purpose → ACCEPTED, fixed.
  Switched to `Number.isFinite()`. Added a dedicated NaN test case.
- [LOW, quality] Combined 3-input malformed-payload test into one
  assertion — a failure wouldn't say which input regressed → ACCEPTED,
  fixed. Split into 4 separate tests (missing monthIndex, missing year,
  non-numeric string, literal NaN).
- [NITPICK, quality] Hand-rolled structural type for chartData instead
  of importing Recharts' own click-event type → REJECTED as a change
  now; deliberate choice keeping the function's contract minimal and
  matching exactly what tests construct, reasonable trade-off.
- [INFO, adversarial] `CashflowMonth` independently duplicated in
  api/dashboard.ts and shared/types/index.ts (pre-existing, predates
  this diff per git log — introduced in 89cdeea) → noted in tech debt,
  not fixed here (adjacent, cross-cutting, same class as the
  already-logged UpcomingAlert duplication).

## Full gate (post-review-fixes): frontend 959/959 tests, lint clean,
tsc --noEmit clean. No backend changes.

## Plan (revised after plan-challenger NEEDS_WORK — 2 must_fix resolved
by taking the simpler alternative, 2 should_fix folded in):
1. Read exact lines to replace. 2. **Extract the click handler into a
named function** `handleCashflowClick(chartData: unknown, navigate)`
(module-scope or component-scope, single call site) instead of an
inline `vi.mock('recharts')` capture — plan-challenger found `AreaChart`
renders TWICE on this page (cashflow at line 263 WITH onClick, Net
Worth Trend at line ~671 WITHOUT), so a naive mock capturing "the"
onClick prop would collide between the two instances since
NET_WORTH_HISTORY renders non-empty by default in the shared MSW
handlers. Extracting to a named function sidesteps this entirely — no
recharts mock needed, no collision possible, exercises the exact same
runtime closure. Inside: read `payload.monthIndex`/`payload.year`
directly (no string parsing), **with a malformed-payload guard**
(`typeof payload?.monthIndex !== 'number' || typeof payload?.year !==
'number'` → return early) per should_fix — recharts types
`activePayload` as `any[]`, so the `as CashflowMonth` cast alone gives
zero runtime protection; without the guard a backend field
rename/deploy-skew would navigate to `?startDate=&endDate=` silently
instead of failing loudly. `start=new Date(year,monthIndex-1,1)`,
`end=new Date(year,monthIndex,0)`. Import `CashflowMonth` inline
(`type` modifier on the existing named import, matching Reminders.tsx's
convention) per should_fix. 3. Correct the CASHFLOW test fixture (was
0-indexed + wrong "Apr '25" format vs real backend's 1-indexed bare
"Apr"). 4. Unit test `handleCashflowClick` directly (no vi.mock, no
full-page mount) — Apr, Jan/FY-rollover, Feb non-leap, Dec year-end,
no-activePayload guard, empty-array guard, AND the new malformed-payload
guard case. 5. Full gate.

## Plan-Challenger: verdict NEEDS_WORK. All 4 DQ answers (date-math
correctness, monthIndex 1-indexing, fixture correction, no-premature-
helper) verified correct by independent trace. 2 must_fix resolved
above by switching to the extract-and-unit-test approach instead of
the originally-planned vi.mock('recharts') — the mock design had a
real, demonstrated flaw (2 AreaChart instances on one page, capture
collision) that the simpler alternative avoids entirely rather than
patches around. 2 should_fix folded in (malformed-payload guard +
test case; import style consistency).

Task Classification: risk_level LOW (single file, currently 100%-broken
non-load-bearing handler — fix can only improve things), task_type
bugfix.

## Design Questions:
DQ1: What exactly is fragile, and is there a better data source already
available?
Evidence: Dashboard.tsx:267-280's onClick handler re-parses the CHART'S
DISPLAY LABEL string (`chartData.activePayload[0].payload.month`, e.g.
"Apr") via `.split(' ')`, a hardcoded English month-abbreviation array,
and `2000 + parseInt(yr,10)` (a Y2.1k-style 2-digit-year hack) — instead
of using `monthIndex`/`year`, which are ALREADY structured numeric
fields on the SAME payload object (CashflowMonth interface,
api/dashboard.ts:17-24), computed authoritatively by the backend
(dashboardService.ts:128-141, SQL EXTRACT(MONTH...)/EXTRACT(YEAR...)).

DQ2: Is the existing click handler's own code internally consistent
with the real data shape?
Evidence: NO — CONFIRMED BROKEN, not just fragile. The click handler's
own comment claims the label format is `"Apr '24"` (with a year
suffix), but the backend only ever returns `month: 'Apr'` (bare month
abbreviation, no year, dashboardService.ts:134). Traced the full data
path: Dashboard.tsx:57-60's `useQuery` has no `select`/transform,
`cashflow` flows raw from `fetchCashflow()` straight into
`<AreaChart data={cashflow}>` (line 264) — nothing ever adds a year
suffix. So in production, `monthLabel.split(' ')` on `"Apr"` produces
`['Apr']`, `yr` is `undefined`, and `yr.replace("'", '')` throws
`TypeError: Cannot read properties of undefined`. Clicking the
cash-flow chart today throws an uncaught exception and never
navigates — this is a real, currently-shipping crash bug, not a
hypothetical fragility concern. (React event-handler exceptions are
NOT caught by the app's ErrorBoundary — that only catches render-phase
errors — so this fails silently to the user, console-only.)

DQ3: Is there existing test coverage for this click behavior?
Evidence: NONE — grepped Dashboard.test.tsx, the CASHFLOW fixture is
only ever used to render the chart, never to simulate a click. The
fixture ITSELF has the wrong shape relative to production (uses
`monthIndex: 3` 0-indexed JS-Date-style + `month: "Apr '25"` with a year
suffix; the real backend uses `monthIndex: 4` 1-indexed SQL-EXTRACT-style
+ `month: 'Apr'` no suffix) — so even a naively-written test against the
existing fixture would validate the WRONG mental model.

## Verification Questions:
VQ1: Does the fix use monthIndex/year directly, with zero string
re-parsing of the display label?
VQ2: Is monthIndex correctly treated as 1-indexed (SQL EXTRACT
convention) when constructing a JS Date (which is 0-indexed)?
VQ3: Does a real test exercise the click handler end-to-end (simulate a
chart click, assert the resulting navigate() URL), using a fixture that
matches the REAL backend shape, not the currently-wrong test fixture?
VQ4: Is the currently-wrong CASHFLOW test fixture corrected as part of
this fix (it affects every other test that renders the chart too)?

## Series plan (9 /task runs total, user-approved order) — 6 of 9 done:
1. [DONE] Bug fixes: UTC snapshot key + netWorthChangePct approximation
2. [DONE] Spend-by-category breakdown widget
3. [DONE] Tax-deduction snapshot (80C/80D) widget
4. [DONE] Investment/loan summary tile
5. [DONE] Alerts "view all" link (new Reminders page)
6. [DONE] Quick-add shortcuts (Add Expense / Add Income on Dashboard)
7. [IN PROGRESS] Fragile cash-flow month-click date parsing
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
