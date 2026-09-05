# Task Progress

## Status: analyze

## Task: [9/9 of a Dashboard improvement series] Dashboard.test.tsx coverage check + gap-fill

## Steps Completed: analyze

## Design Questions:
1. Is frontend coverage actually a CI-enforced gate, and does Dashboard.tsx currently
   pass it? Evidence: `frontend/vite.config.ts:52-74` — real per-directory thresholds,
   `**/src/pages/**` is `perFile: true` at 30/30/15/30. Ran `npx vitest run --coverage`
   (full suite, exit 0): Dashboard.tsx = 98.47% stmts / 83.22% branches / 76.92% funcs /
   98.47% lines — already far above threshold. This task is a QUALITY investment, not a
   build-fix. (architecture.md/patterns.md were stale on this point — both claimed a
   "near-zero floor, not meaningful"; corrected during this ANALYZE phase.)
2. What are the ACTUAL uncovered lines/branches/functions, verified from
   `coverage/coverage-final.json` (not guessed)? Full list extracted via a one-off node
   script parsing `.s`/`.b`/`.f` maps for `src/pages/Dashboard.tsx`:
   - Uncovered statement lines: 216, 303-305, 400-403, 446-449, 549-550, 597, 619, 668
   - Uncovered branches (line:condition): 215 (isMembersError), 302 (cashflowLoading),
     400/402 (daysUntilDue ternary chain), 446/448/461×2 (budget pct color thresholds),
     548 (taxWidgetLoading), 564 (`taxProfile?.regime ?? 'OLD'`), 596 (tracker80CError),
     618 (summary80DError), 623 (`combinedLimit > 0 ? ... : 0`), 650 (portfolio/loans
     loading), 667 (loansError), 761 (`budgetActuals ?? []`)
   - Uncovered functions: lines 312/318/706/707/734/745 — ALL Recharts internal
     callbacks (tickFormatter, Tooltip formatter, chart onClick props). Confirmed via
     source read: these are the exact onClick wrappers already covered indirectly by
     `handleCashflowClick`/`handleFamilyMemberClick`'s own direct unit tests (file's own
     top-of-file comment documents why: Recharts renders 0×0 under jsdom, so these
     callbacks are unreachable via a real mount regardless of test count).
3. Which gaps are worth closing vs. structurally untestable/low-value? Classified by
   reading each site against existing sibling-widget test patterns already in the file:
   - REAL, high-value (asymmetric with an already-tested sibling case, or an
     intentionally-documented distinct behavior that's untested):
     a. `loansError` "Unable to load" row (:667-668) — direct mirror of the ALREADY
        tested `portfolioError` case one widget up; only one side of a symmetric pair
        is covered.
     b. `tracker80CError`/`summary80DError` independent fetch failures (:596-597,
        618-619) — only `taxProfileError` is tested, which short-circuits before these
        branches; the two ARE independently reachable (different queries).
     c. `taxProfile?.regime ?? 'OLD'` (:564) — the code's own comment calls this out as
        an intentionally DISTINCT case from the fetch-error state, yet it's untested.
     d. Budget Health color thresholds at >=100%/75-99% (:446-449, 461) — mirrors the
        already-thorough 3-case color-threshold tests done for Tax Deductions; only the
        <75% (green) case exists for Budget Health.
     e. `alert.daysUntilDue === 0`/`=== 1` ("Due today"/"Due tomorrow") (:400-403) —
        only the `else` branch is tested.
     f. `combinedLimit > 0 ? ... : 0` (:623) — mirrors the already-tested
        zero-denominator guard pattern from Spend by Category; untested here.
     g. `isMembersError` true-branch for Dashboard's own member selector (:215-216) —
        reachable, user-visible, no test exists.
   - LOW-value / SKIP (documented, will list explicitly rather than silently drop):
     - Recharts internal callbacks (:312,318,706,707,734,745) — structurally
       unreachable under jsdom; the codebase's established, reviewer-endorsed answer
       (Tasks 7 & 8) is extracting+testing the handler directly, already done.
     - Loading-skeleton branches (:302-305 cashflow, :548-550 tax, :650 portfolio/loans)
       — transient, near-zero regression risk, static markup only.
     - `selectedMemberName` inner fallback (:94, not in the uncovered list above but
       related) and `budgetActuals ?? []`/`viewUserId ?? 'self'` modal defaults (:759,
       761) — defensive/edge; `?? 'self'` gets incidental coverage for free if a MEMBER
       quick-add submission test is added (see Verification Question 2).

## Verification Questions:
1. Do the new tests use the SAME fixture/handler patterns already established in this
   file (dashboardHandlers() override params, `settled()` helper, widget-scoped
   `within()` queries) rather than inventing new patterns? Check during REVIEW by
   diffing new test style against existing tests in the same file.
2. Is there an existing MEMBER-role quick-add SUBMISSION test (not just button-presence)?
   Evidence: grep for `MEMBER_USER` + `Add Transaction` submit flow in
   Dashboard.test.tsx — only ADMIN-with-selected-member submits currently. If added,
   confirm it's additive value (exercises `viewUserId ?? 'self'` in the modal key) and
   not scope creep beyond the 7 items above.
3. After adding tests, does `npx vitest run --coverage` (full suite) still exit 0, and
   does re-parsing coverage-final.json confirm each of the 7 targeted lines/branches
   flipped from uncovered to covered (not just "some new assertions exist")?
4. Does adding these tests avoid breaking the documented handler-ordering / MSW
   first-match convention, and the `key={..-self}` modal-remount pattern from Task 6?

## Baseline: full frontend suite green pre-change (`npx vitest run --coverage` exit 0,
   verified this ANALYZE phase — see full-coverage.log in job tmp dir).

## Steps Completed: analyze, plan, approve

## Plan (revised after plan-challenger — verdict NEEDS_WORK, 1 must_fix accepted, 3 nice_to_fix folded in):
All additive `it()` blocks in `frontend/src/__tests__/pages/Dashboard.test.tsx`'s existing
`describe('Dashboard page — smoke', ...)` block. No production code changes.

1. [LOW] `loansError` "Unable to load" test — mirrors existing portfolioError test (:503-517).
2. [LOW] 4 tax-widget tests: tracker80CError, summary80DError, missing-regime-defaults-to-OLD
   (assert BOTH `tax-widget-regime-unknown` and `tax-widget-new-regime-notice` testids absent,
   real 80C/80D bars render — precision fix from plan-challenger), 80D-zero-denominator.
3. [LOW] 2 Budget Health color-threshold tests (pctUsed:100 red, pctUsed:85 amber) — mirrors
   Tax Deductions' 3-case pattern.
4. [LOW] 2 alert-phrasing tests (daysUntilDue:0 "Due today", :1 "Due tomorrow").
5. [LOW] `isMembersError` test — one-off 500 on `/users/members`, ADMIN user, wait via
   `findByText('55.5%')` NOT `settled()` (the `<select>` never mounts in this branch).
6. [LOW] StatCard down-trend test — netWorthChangePct:-3.5; assert BOTH `.text-red-500` AND
   `.lucide-trending-down` inside the Net Worth card (precision fix — text-red-500 alone is
   ambiguous per plan-challenger).
7. [LOW] 2 savingsScheme color tests (savingsRate:20 amber, savingsRate:5 rose) — scope the
   class assertion to the Savings Rate card container specifically (`.closest('div.rounded-xl')`),
   not a bare document querySelectorAll, since New Regime notice also uses `.bg-amber-50`
   (Dashboard.tsx:573) — precision fix from plan-challenger.
8. [LOW] **MEMBER quick-add submission test (added per plan-challenger's must_fix)** — a
   MEMBER clicks Add Expense/Income, modal opens with correct defaultType, submits; assert
   targetUserId is omitted end-to-end through DASHBOARD'S OWN props/click-handler/remount-key
   wiring (`viewUserId ?? 'self'` at Dashboard.tsx:759, `showAccountOwner={isAdmin}`,
   `fallbackAccountOwnerName`) — NOT just AddTransactionModal.test.tsx:158-182's isolated
   mount, which bypasses all of Dashboard's own wiring and never proves it.
9. [LOW] Run full suite (`npx vitest run --coverage`), re-parse coverage-final.json, confirm
   all targeted lines/branches flipped from uncovered to covered, exit 0, no regressions.
10. [LOW] Document declined items in commit message: Recharts-internal callbacks (unreachable
    under jsdom, established fix already applied Tasks 7-8), loading-skeleton branches
    (transient/static), `??`/`||` defensive fallbacks at :94,192,209,221,430,658,761,765
    (low reachability/value, backend-guaranteed fields).

Task Classification: risk_level=low, task_type=test.
Validation Strategy: full-suite vitest run + coverage-final.json re-parse diff.

## Plan-Challenger Verdict: NEEDS_WORK -> resolved (Must Fix #1 accepted into Step 8 above;
   3 Nice-to-Fix items folded into Steps 2/6/7). Q1's "40 tests" docstring citation flagged
   as a fabricated/unsupported evidence citation by the challenger — harmless (no step
   depended on it), noted for calibration, not actioned.

## Steps Completed: analyze, plan, approve, implement

## Implementation Summary:
14 new `it()` blocks added to `frontend/src/__tests__/pages/Dashboard.test.tsx` (52 -> 66
tests), zero production code changes. Full suite (`npx vitest run --coverage`) exits 0.
Dashboard.tsx coverage: 98.47%/83.22%/76.92%/98.47% -> 99.41%/94.04%/76.92%/99.41%
(stmt/branch/fn/line). Functions unchanged by design (Recharts-internal callbacks
declined). Re-parsed coverage-final.json: all 9 targeted gaps (a-g, h, i) confirmed
flipped from uncovered to covered; zero regressions to the 52 pre-existing tests.

Remaining uncovered lines/branches (confirmed exactly the declined set, nothing missed):
loading-skeleton branches (:302-305 cashflow, :548-550 tax widget, :650 portfolio/loans),
and `??`/`||` defensive fallbacks (:94, 192, 209, 221, 430, 658, 761) plus Recharts-internal
callbacks (:312,318,706,707,734,745 — tickFormatter/Tooltip formatter/chart onClick
wrappers, structurally unreachable under jsdom at 0x0 render size).

## Validation Results: `npx vitest run --coverage` exit 0. Dashboard.test.tsx: 66/66 pass.
Coverage-final.json re-parse: all 9 targeted gap lines/branches confirmed non-zero count.

## Steps Completed: analyze, plan, approve, implement, review

## Review: Tier 2 (quality + adversarial, parallel). Quality verdict: PASS (2 low notes).
Adversarial verdict: BRUISED (2 medium findings, both about test #14's docstring
overclaiming and one redundant-but-not-harmful assertion — no critical/high).

## Co-Founder Filter:
- Test #14 docstring overclaimed showAccountOwner/fallbackAccountOwnerName/remount-key
  proof it didn't actually assert -> ACCEPTED, fixed (docstring corrected, redundancy
  with AddTransactionModal.test.tsx:158-182 now explicitly documented rather than
  denied; real remaining value — MEMBER click-through + defaultType wiring, never
  tested before — kept and accurately described).
- loansError test's "Unable to load" assertion not scoped to the specific row -> ACCEPTED,
  fixed (scoped to the Loan Outstanding row via `.closest('div.flex')`).
- showAccountOwner/fallbackAccountOwnerName genuinely untested anywhere in the repo
  (accountFormat.ts:46's owner-name branch, verified via coverage re-run: 66.66% branch
  coverage) -> ACCEPTED_DEFERRED, logged as new tech debt below (out of scope — lives in
  AddTransactionModal.tsx/accountFormat.ts, not Dashboard.test.tsx).
- Boundary values (pctUsed===75, savingsRate===10) untested -> DECLINED (both reviewers
  called non-blocking; interior values already prove both ternary arms; not the actual
  boundary condition the daysUntilDue chain has).
- Post-fix: full suite re-run, 981/981 pass, exit 0, Dashboard.tsx coverage unchanged
  (99.41/94.04/76.92/99.41).

## New tech debt (from this task's review):
- `frontend/src/lib/accountFormat.ts:46`'s `showOwner ? (userName || fallbackOwnerName) :
  undefined` branch (owner-name-shown case) has zero test coverage anywhere in the repo —
  `showAccountOwner`/`fallbackAccountOwnerName` props on AddTransactionModal are passed
  by Dashboard.tsx and TaxCentre-adjacent callers but never observed with a real owner
  name in any test. Needs an accounts fixture with a distinguishable userName in
  AddTransactionModal.test.tsx to close.
