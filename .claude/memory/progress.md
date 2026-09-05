# Task Progress

## Status: analyze

## Task: [3/9 of a Dashboard improvement series] Add a tax-deduction snapshot
(80C/80D) widget to the Dashboard — usage vs. cap for the current FY.

## Steps Completed: analyze, plan, approve, implement, review

## Review: quality verdict PASS, adversarial verdict BRUISED (no
critical/high — both reviewers independently traced the cache-key sharing
claim, the color-threshold direction, the regime-error-vs-New-Regime-vs-
missing-profile-defaults-to-OLD branch ordering, and backend authorization
for all 3 endpoints against the real source, not the plan's paraphrase).

## Co-Founder Filter:
- [MED, quality] All 3 queries fire ungated/parallel, even for New Regime
  users who discard 2 of 3 → ACCEPTED_DEFERRED. Matches TaxCentre.tsx's own
  identical pattern (no `enabled` gate there either); note for a future
  dashboard-perf pass once all 9 series widgets are in and the full
  waterfall cost is visible.
- [LOW, quality] Progress bars lack ARIA (role="progressbar" etc.) →
  ACCEPTED_DEFERRED. Systemic — Budget Health and Tracker80DTab.tsx's own
  bars have the same gap; not this diff's to fix in isolation.
- [LOW, quality] taxApi.getProfile/insuranceApi.get80D return `any` →
  ACCEPTED_DEFERRED. Pre-existing across both entire API modules.
- [MED, adversarial] No loading skeleton, card renders blank until all 3
  queries settle → CHALLENGED. Verified via fresh grep: only
  summary/cashflow (which gate the page's big chart) show a pulse skeleton
  on this page — Budget Health, Spend by Category, Alerts, Family Overview
  all have NO loading state at all. `return null` while loading is MORE
  consistent with the page's actual dominant convention (5 of 7 cards),
  not a regression against the ONE outlier (Cash Flow) the reviewer cited.
- [MED, adversarial] New-Regime "hide both bars" divergence from
  TaxCentre's 80C tab documented only in ephemeral progress.md → ACCEPTED,
  fixed. Added a durable code comment at the branch itself.
- [LOW, adversarial] `colorFor` threshold expression duplicated a 4th time
  (TaxCentre.tsx, Tracker80DTab.tsx ×3, now Dashboard.tsx) → ACCEPTED_DEFERRED.
  Extraction would require touching 3 unrelated files outside this task's
  scope; noted in tech debt below for a dedicated cleanup task.
- [LOW, adversarial] pct===75 boundary (yellow) untested → ACCEPTED, fixed.
  Added a boundary test.
- [LOW, adversarial] Member-switch test only asserts 1 of 3 queries'
  targetUserId param → REJECTED. Query-key structure mechanically
  guarantees identical behavior for all 3; redundant assertions add no
  coverage value.
- [LOW, adversarial] Session-log jsonl deletions/additions flagged as
  "scope creep" → REJECTED, false positive. Those files are unstaged
  harness housekeeping, never part of this task's actual `git add` (same
  as every prior task in this series — confirmed via `git status`).

## Full gate (post-review-fixes): frontend 910/910 tests, lint clean,
tsc --noEmit clean.

## Question Resolution (fresh reads at REVIEW time):
| # | Question | Result |
|---|---|---|
| VQ1 | Same role/targetUserId scoping as every other card | PASS — traced resolveTargetUserId + both routes independently by both reviewers |
| VQ2 | Avoids implying 80D is FY-scoped | PASS — no selectedFY in query key, caption present |
| VQ3 | Gates/caveats for New Regime users | PASS — 3 distinct, correctly-ordered branches (error/New/normal) |
| VQ4 | Handles zero-usage/no-data gracefully | PASS — tested |
| VQ5 | Colors match TaxCentre's convention | PASS — correct direction, now boundary-tested at 75% |

## Implementation Summary: Added 3 queries to Dashboard.tsx (taxApi.getProfile,
taxApi.get80CTracker, insuranceApi.get80D) with query keys byte-matched to
TaxCentre.tsx/Tracker80DTab.tsx for cache sharing (corrected the architect's
80C key from a made-up `['tax','80c-tracker',...]` to the REAL
`['tax-80c', selectedFY, viewUserId]` used by TaxCentre.tsx:83-86 — caught
during implementation by reading the actual file instead of trusting the
plan). New "Tax Deductions" card between Spend by Category and Net Worth
Trend: gated on all 3 queries settling before rendering body (no flash of
raw numbers); distinct states for profile-fetch-error ("regime unknown",
NOT defaulted to OLD), New Regime (amber notice replacing both bars,
explicitly diverging from TaxCentre's own mixed notice+numbers behavior),
and normal (80C + 80D progress rows, green/yellow/red at 100%/75%,
matching TaxCentre.tsx:565/Tracker80DTab.tsx:72 — opposite color direction
from Budget Health, verified not copy-pasted). 80D row has a "Lifetime
tally, not limited to this FY" caption since the backend has no FY concept
for it at all. Added MSW handlers for the 3 new endpoints to
Dashboard.test.tsx and App.test.tsx's shellHandlers (onUnhandledRequest:
'error' breaks every existing test otherwise) — including the "fires only
once" test's own hand-rolled handler list, which doesn't use
dashboardHandlers(). 7 new tests: both rows render correct amounts/red
color below 75%, green at 100%, MEMBER visibility, New Regime replaces
bars, profile-fetch-error shows the distinct third state, zero-usage
0-width bars, ADMIN member-switch refetch.

Full gate: frontend 909/909 tests (902 baseline + 7 new), lint clean,
tsc --noEmit clean. No backend changes (DQ1 confirmed both endpoints
already exist and are role/FY-scoped as needed).

## Plan (revised after plan-challenger NEEDS_WORK — 2 must_fix resolved):
1. [LOW] Three queries in Dashboard.tsx: `taxApi.getProfile` (key
   `['tax-profile', selectedFY, viewUserId]`, `staleTime: 5*60*1000`,
   capture `isError` too), `taxApi.get80CTracker` (key
   `['tax', '80c-tracker', selectedFY, viewUserId]` — viewUserId always
   included, matching every sibling query), `insuranceApi.get80D` (key
   `['insurance', '80d', viewUserId]`, no selectedFY, `staleTime:
   5*60*1000` — matches Tracker80DTab.tsx's own staleTime so cache is
   actually shared, not just key-compatible).
2. [LOW] Add `IndianRupee` icon import.
3. [MED] Compact widget card between Spend by Category and Net Worth
   Trend, same chrome as Budget Health. Body gated on ALL THREE queries
   settled (not per-row) to avoid a flash of raw numbers before regime is
   known:
   - `profileIsError`: neutral "Unable to determine tax regime" notice,
     hide both bars. NOT defaulted to OLD — must_fix #2 from
     plan-challenger (silently defaulting an errored fetch to OLD would
     show real numbers to a possibly-New-Regime user).
   - `(profile?.regime ?? 'OLD') === 'NEW'`: condensed amber notice
     REPLACING both bars. Explicit, documented divergence from
     TaxCentre.tsx's 80C tab (which shows the notice AND the numbers
     together — plan-challenger must_fix #1: our compact card doesn't have
     room for both, so we hide, unlike TaxCentre; this is a deliberate
     choice, not a misreading of precedent).
   - Else: 80C row (bar green>=100%/yellow>=75%/red else, matches
     TaxCentre.tsx:565) + 80D row (same thresholds against total/50000,
     matches Tracker80DTab.tsx:72) + caption "Lifetime tally, not limited
     to this FY" under 80D. Per-row "Unable to load" text if that
     specific tracker query (not profile) errors.
4. [LOW] 0-width bar guard for zero usage (mirror Task 2's negative-total
   fix). `profile` resolved-but-null (no tax profile set up) defaults to
   OLD; `profile` fetch ERROR does not (step 3).
5. [MED] Add MSW handlers for GET /tax/profile, /tax/80c-tracker,
   /insurance/80d-summary to Dashboard.test.tsx's dashboardHandlers()
   (onUnhandledRequest:'error' breaks every existing test otherwise).
6. [LOW] New tests: both rows render correct values/colors; MEMBER
   visibility; New Regime replaces bars with notice; profile-fetch-error
   shows the distinct "unable to determine regime" state (not OLD
   defaults); zero-usage 0-width bars; ADMIN member-switch refetch.
7. [LOW] tsc --noEmit + lint.
8. [LOW] Dashboard.test.tsx then full frontend suite.

## Plan-Challenger: verdict NEEDS_WORK on first pass. DQ1/DQ4/DQ5 fully
confirmed. 2 must_fix resolved above (New-Regime "hide both bars" behavior
now explicitly justified as a deliberate compact-card divergence from
TaxCentre's own mixed notice+numbers behavior, rather than falsely claimed
as matching precedent; profile-fetch-error now has its own distinct state
instead of silently defaulting to OLD). 3 should_fix resolved: viewUserId
always included in query key (no longer an open question), staleTime
5min added to the two shared-cache queries to match their sibling
components, 80C's LIC-premium leg being undated (pre-existing, inherited
from TaxCentre, not introduced here) noted in tech debt below rather than
changed. 1 nice_to_fix resolved: loading gate now waits on all three
queries, not per-row, to avoid a flash of raw numbers before regime is
known.


## Design Questions:
DQ1: Reuse existing endpoints or build new backend work?
Evidence: `taxApi.get80CTracker(fy, viewUserId)` → `/tax/80c-tracker`
(backend/src/routes/tax.ts:84, taxService.ts:318-350) is FY-scoped,
role-scoped, returns {utilized, remaining, limit, pctUtilized}, already
consumed by TaxCentre.tsx:545-593. `insuranceApi.get80D({targetUserId})` →
`/insurance/80d-summary` (backend/src/routes/insurance.ts:49-53,
insuranceService.ts:133-165) returns {selfFamily, parents, total}, already
consumed by Tracker80DTab.tsx. No combined endpoint exists; recommend reuse
(2 queries), matching Budget Health's precedent of calling a foreign-domain
hook directly from Dashboard.tsx rather than inventing a new endpoint.

DQ2: How to handle 80D's FY-blindness vs 80C's FY-awareness (Dashboard has
a selectedFY selector)?
Evidence: `insuranceService.get80DSummary` takes NO fy param — sums ALL
is80dEligible policies regardless of date. `taxService.get80CTracker` IS
FY-windowed via purchaseDate/startDate. If wired to selectedFY, changing
the Dashboard's FY dropdown would change 80C's number but not 80D's — a
confusing silent asymmetry unless addressed explicitly in the plan.

DQ3: Should the widget respect the user's tax regime (New Regime = 80C/80D
deductions don't apply)?
Evidence: TaxCentre.tsx's 80C tab and Tracker80DTab.tsx both suppress with
an amber "Not applicable in New Regime" banner when
`selectedRegime === 'NEW'` (from `taxApi.getTaxProfile`). Showing raw usage
numbers to a New Regime user without this context is misleading.

DQ4: Widget shape as a compact Dashboard CARD vs. the full-page precedent
(Tracker80DTab.tsx, 189 lines)?
Evidence: Task 2 established cards must be ONE compact block matching
Budget Health's chrome (rounded-xl border bg-card shadow-card p-4,
icon+title+"View all"), not a full-page transplant.

DQ5: Visible to MEMBER, or ADMIN-only?
Evidence: Task 2's precedent — every card except the inherently
cross-member "Family Spending" is MEMBER-visible. 80C/80D is personal, not
cross-member.

## Verification Questions:
VQ1: Same role/targetUserId scoping pattern as every other Dashboard card?
VQ2: Does the widget avoid implying 80D is FY-scoped when it isn't (DQ2)?
VQ3: Does the widget gate/caveat for New Regime users (DQ3)?
VQ4: Handles zero-usage/no-data gracefully?
VQ5: Progress-bar colors/thresholds match TaxCentre's established
green/yellow/red convention, not ad hoc?

## Series plan (9 /task runs total, user-approved order) — 2 of 9 done:
1. [DONE] Bug fixes: UTC snapshot key + netWorthChangePct approximation
2. [DONE] Spend-by-category breakdown widget
3. [IN PROGRESS] Tax-deduction snapshot (80C/80D) widget
4. Investment/loan summary tile
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
