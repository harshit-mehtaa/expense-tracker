# Task Progress

## Status: analyze

## Task: [1/9 of a Dashboard improvement series] Fix two related bugs in Dashboard's
net-worth calculation: (1) the monthly net-worth snapshot key is built via
`new Date().toISOString().slice(0,7)` — UTC — while the app runs IST, silently
skipping the new month's snapshot between 00:00-05:29 IST on the 1st; (2)
`netWorthChangePct` in dashboardService.ts is approximated from last-FY
income/expense delta even though real netWorthHistory snapshots already exist and
are fetched by this same Dashboard page — should use the real year-ago snapshot.

## Series plan (9 /task runs total, user-approved order):
1. [THIS TASK] Bug fixes: UTC snapshot key + netWorthChangePct approximation
2. Spend-by-category breakdown widget
3. Tax-deduction snapshot (80C/80D) widget
4. Investment/loan summary tile
5. Alerts "view all" link
6. Quick-add shortcuts (add transaction / record income)
7. Fragile cash-flow month-click date parsing
8. Per-member drill-in on family spending breakdown
9. Dashboard.test.tsx coverage check + gap-fill

## Steps Completed: analyze, plan, approve, implement

## Baseline Failures: none — backend 2342/2342, frontend 886/886, all passing.

## Implementation Summary:
All 10 plan steps done (7b inserted per plan-challenger should_fix). New
getISTMonthKey() helper (frontend/src/lib/financialYear.ts) reused for both sides
of Dashboard.tsx's snapshot-exists comparison. dashboardService.ts's
getDashboardSummary now anchors "vs last FY" on a real netWorthSnapshot strictly
before FY start (lt, not lte — the must_fix boundary fix), falling back to
undefined (not a fabricated number) when no anchor exists, anchor netWorth is
null, anchor netWorth is 0, or the view is family-wide ADMIN. Dead
prevIncome/prevExpense/previousFY/previousRange approximation code removed.
Types widened (frontend/src/api/dashboard.ts, shared/types/index.ts).

18 new tests: 6 table-driven getISTMonthKey unit tests (mid-month, month-start
crossover, month-start past-crossover, month-end, Dec/Jan boundary, real
snapshot-shaped instant), 3 Dashboard.tsx tests (fixed the pre-existing buggy
fixture + added positive-fire case + fires-only-once-across-invalidate-cycle),
1 Dashboard.tsx undefined-comparison rendering test, 9 backend
dashboardService.unit.test.ts anchor-snapshot tests (MEMBER, ADMIN+targetUserId,
boundary-exact exclusion, orderBy desc, no-anchor, zero-anchor, null-anchor,
family-wide skip, Decimal-string coercion) — plus fixed 1 pre-existing test that
assumed the now-removed prev-period aggregate calls.

Live Docker validation (5 checks against a dedicated throwaway test user, zero
mutation of real user data): boundary-exact snapshot correctly excluded,
real prior-FY snapshot correctly used with hand-verified computed value,
brand-new user has no comparison, family-wide ADMIN has no comparison, dead code
confirmed absent from source. All passed, no leftover rows.

Full suite: backend 2351/2351 tests, dashboardService.ts 100%
stmts/branch/func/line, only the same pre-existing unrelated coverage gap
(loanService.ts/subscriptionService.ts) remains. Frontend 895/895 tests, lint
clean, tsc --noEmit clean both sides.

## Steps Completed: analyze, plan, approve, implement, review

## Review: quality FAIL (strong tier, diff >100 lines) — 1 High. Adversarial
BRUISED — 1 medium broken-assumption, 1 medium blast-radius (different file, out
of scope), several low. Co-Founder Filter:

ACCEPTED (fixed):
1. [HIGH, quality] Negative anchor net worth inverted the trend sign: dividing
   by the SIGNED anchor meant an improvement from a negative baseline (e.g. debt
   shrinking) computed as a negative percentage — red "down" arrow for good
   news. Independently re-verified the math. Fixed: divide by `Math.abs(anchor)`
   instead. Added a dedicated test + live Docker check (negative anchor, real
   improvement correctly reads positive).
2. [MEDIUM, adversarial — broken assumption] The anchor query was unbounded
   ("any snapshot before FY start"), so a user with a multi-month/multi-year gap
   in history would get a stale anchor mislabeled "vs last FY" — a NEW way to be
   confidently wrong, worse than the approximation it replaced in that specific
   sense. Fixed: bounded the anchor to `[previousFY.start, currentFY.start)` —
   if no snapshot exists within the immediately-preceding FY specifically,
   returns undefined instead of reaching further back. Re-introduced
   `previousRange`/`getPreviousFY` (deliberately, for this new purpose — not
   the old approximation) — updated the must_fix #1 test's expected query shape
   and added a 2-FY-old-snapshot-excluded test, backend + live Docker.
3. [LOW, quality] "Fires only once across invalidate cycle" test's final gate
   only waited on the loading spinner clearing, not the actual GET refetch it
   claimed to test — a false-pass risk if the refetch timing ever changed.
   Fixed: now waits on GET call count directly.
4. [LOW×2, quality + adversarial DRY] `istOffset`/offset-shift logic duplicated
   between getFYFromDate and getISTMonthKey. Fixed: hoisted `IST_OFFSET_MS` +
   shared `toISTYearMonth()` helper, both functions now derive from it.

ACCEPTED_DEFERRED (valid, logged as tech debt, not fixed now):
5. [MEDIUM, quality — scope] `netWorth` itself (not just the change%) is always
   TODAY's live figure regardless of `selectedFY` — viewing a historical FY
   still shows current net worth compared against that FY's own anchor. This is
   a PRE-EXISTING characteristic of the whole `getDashboardSummary` function
   (not introduced by this fix) and a materially larger redesign (would need
   the whole Dashboard's "current" cards to become FY-scoped, not just this one
   field) — deferred as out of this bugfix's scope.
6. [MEDIUM, adversarial — blast radius] The exact same UTC-vs-IST key-comparison
   bug class (a UTC-sliced "today"/"this period" key compared against a stored
   value) exists unfixed in `frontend/src/hooks/useRecurringAutoGenerate.ts:12`
   (localStorage-based once-a-day gate). Different file/feature, wrapped in a
   `.catch()`, self-corrects the next day — deferred to its own task rather than
   scope-creeping this Dashboard fix.

REJECTED (would make things worse, or already handled):
7. [LOW, quality] Reviewer suggested `getISTMonthKey` throw on an invalid Date.
   Rejected: the current silent "NaN-NaN never matches, one harmless extra
   idempotent POST" degradation is safer than introducing a new uncaught-throw
   crash surface in a mount effect for a scenario the API contract already
   guarantees can't happen (a valid ISO snapshotDate).
8. [LOW, quality] Dashboard.tsx's mount effect has no StrictMode double-invoke
   guard (unlike AuthContext's ref-latch precedent) — reviewer's own verdict was
   "no action required" (harmless, idempotent upsert); no action taken.

## Final verification after fixes: backend 2353/2353 tests (2351 + 2 new: sign-
inversion + 2-FY-gap exclusion), dashboardService.ts 100% coverage, tsc --noEmit
clean. Frontend 895/895 tests, lint clean, tsc --noEmit clean. Live Docker
validation re-run with both fixes: 7/7 checks passed (added negative-anchor and
multi-year-gap-exclusion checks against the real backend).

## Design Questions:
DQ1: What exactly causes the "skipped snapshot" bug, traced precisely?
Evidence: Dashboard.tsx:73 `currentMonthKey = new Date().toISOString().slice(0,7)`;
Dashboard.tsx:74-76 compares against `s.snapshotDate.slice(0,7)` per history entry.
Backend's `getMonthStart()` (backend/src/utils/financialYear.ts:143-145) computes
`dayjs().tz('Asia/Kolkata').startOf('month').toDate()` — correctly IST. A Date
representing "Apr 1 00:00 IST" serializes via `.toISOString()` to
"...-03-31T18:30:00.000Z" (IST is UTC+5:30, so IST midnight-of-1st = 6:30pm UTC the
PREVIOUS day) — so EVERY stored snapshotDate, read via `.slice(0,7)`, shows the
calendar month BEFORE the IST month it represents. `currentMonthKey` ("now") shows
the correct month for most of the day but also lags by one IST month during
00:00-05:29 IST on the 1st (UTC still in the previous month). Net effect: the two
sides of the comparison are keyed inconsistently relative to true IST months —
this is broader than the single documented midnight window; needs a precise,
table-driven trace across representative timestamps by the architect (do not trust
this manual derivation blindly — recompute independently before planning the fix).

DQ2: Is there an established IST-aware date-key pattern already in this codebase to
reuse rather than reinvent?
Evidence: frontend/src/lib/financialYear.ts:6-17 `getFYFromDate` uses "shift by IST
offset (5.5h), then read UTC getters" (`new Date(date.getTime() + istOffset)`,
`.getUTCMonth()`, `.getUTCFullYear()`) — correct regardless of browser-local
timezone. This is the app's own established pattern for extracting IST calendar
components from a UTC timestamp on the frontend (contrast with
dateFormat.ts:117-121 `toDateInputValue`, which uses LOCAL getters and assumes the
browser's tz IS IST — a different, narrower assumption). Should extend this
pattern for a "YYYY-MM in IST" helper.

DQ3: What's the correct comparison anchor for "vs last FY" using real
netWorthHistory snapshots, and what's the fallback when the needed snapshot
doesn't exist (new user, short history, or family-wide ADMIN view)?
Evidence: dashboardService.ts:1094-1113 `getNetWorthHistory(userId)` returns up to
24 months of snapshots ordered ascending, user-scoped ONLY (no family-wide
variant). `getFYRange(currentFY).start` = Apr 1 00:00 IST of the current FY's
start year — the natural "start of this FY" anchor, closely matching "vs last FY"
intent. `getDashboardSummary`'s `effectiveUserId` (dashboardService.ts:31) is
`undefined` for family-wide ADMIN view — snapshots can't apply there since none
exist per-family. StatCard already supports an undefined `change` gracefully
(Dashboard.tsx:499-501: `{subtitle && change === undefined && (...)}` renders a
plain subtitle with no % when `change` is undefined) — so returning
`netWorthChangePct: undefined` for "no real data available" is a supported,
already-tested UI path, not new work.
[DECISION NEEDED AT APPROVE]: when no anchor snapshot exists, fall back to the
existing approximation, or return undefined and let the UI show no comparison?
Recommend: undefined (honest > approximated) for the per-user case when history is
short; keep the existing approximation ONLY for family-wide view (no snapshot
concept exists there at all).

DQ4: Does `getDashboardSummary` need a new query, and what's the exact blast
radius of changing `netWorthChangePct`'s type?
Evidence: `getDashboardSummary` (dashboardService.ts:14-64) does not currently
query snapshots. Grepped repo-wide: `netWorthChangePct` has exactly ONE frontend
consumer (Dashboard.tsx:136, the Net Worth StatCard's `change` prop) and is typed
`number` (not `number | undefined`) in frontend/src/api/dashboard.ts:7 — must
become optional if DQ3's undefined-fallback is adopted. No other file references
`netWorthChangePct`/`prevNetWorth` outside dashboardService.ts, api/dashboard.ts,
Dashboard.tsx, and their respective test files.

## Verification Questions:
VQ1: Does the fixed snapshot-key comparison correctly identify "has a snapshot for
the current IST month" across ALL times of day/month — not just the previously-
documented midnight window? (Table-driven: mid-month, month-start at several
times, month-end at several times, Dec/Jan year boundary.)
VQ2: Does the fix trigger `triggerSnapshot()` exactly when needed (missing month)
and NOT redundantly once a valid snapshot already exists for the month?
VQ3: Does `netWorthChangePct` use the real snapshot for a per-user view when
available, fall back correctly per the APPROVE decision when not, and is this
covered by backend unit tests AND a frontend rendering test for the
no-comparison-available case?
VQ4: Is the ONE frontend consumer (Dashboard.tsx:136) and its type
(api/dashboard.ts:7) updated consistently with whatever DQ3 decides?
VQ5: Does live Docker validation prove real IST day-of-month/day-of-year behavior,
not just mocked/unit-level date arithmetic?

## Design Question Answers (architect, independently re-derived, not trusted from
my own manual analysis):
DQ1: Bug is BROADER than documented — wrong almost the entire month, only
accidentally correct in the ~5.5h post-midnight window. `currentMonthKey` is wrong
only 00:00-05:29 IST on the 1st. But `s.snapshotDate.slice(0,7)` is wrong ALWAYS
(every stored snapshot's UTC-sliced key is structurally one month behind its true
IST month) — confirmed against backend's own financialYear.test.ts:47-52 assertion
("June 1 00:00 IST = May 31 18:30:00.000Z"). Net effect: for ~29.8 of each ~30-day
month, hasCurrentMonthSnapshot reads FALSE even when a valid snapshot exists →
triggerSnapshot() fires redundantly on nearly every dashboard load. The fix must
apply IST-aware keying to BOTH sides of the comparison, not just "now".
DQ2: Reuse frontend/src/lib/financialYear.ts's getFYFromDate offset-shift pattern
(add 5.5h, read UTC getters) — NOT dateFormat.ts's toDateInputValue (local
getters, assumes browser tz IS IST — wrong assumption for a self-hosted app).
DQ3: Anchor = closest snapshot at/before start of CURRENT FY (matches the "vs last
FY" label and the page's FY-scoped design, not a naive "365 days ago"). Fallback
to `undefined` (not a fabricated approximation) when no anchor exists — StatCard
already renders this gracefully (Dashboard.tsx:499-501, existing code, zero new
UI work). Family-wide ADMIN view: skip the lookup entirely (no per-family
snapshot concept exists), also undefined.
DQ4: One new query, one new field type widening. Only ONE live frontend consumer
(Dashboard.tsx:136), already effectively optional via `summary?.` — zero-risk
type change. shared/types/index.ts's DashboardSummary is dead/unused (confirmed
by grep) but worth updating for documentation honesty.

## Plan:
1. [LOW] Add `getISTMonthKey(date: Date): string` to frontend/src/lib/financialYear.ts
   — same offset-shift technique as getFYFromDate, parameterized on `date` (no
   implicit `new Date()`, so tests need no fake timers).
2. [MED] Fix Dashboard.tsx:73-76's snapshot-exists check: apply getISTMonthKey to
   BOTH `currentMonthKey` and each `s.snapshotDate`.
3. [LOW] Update/extend Dashboard.test.tsx's existing snapshot test (currently uses
   the SAME buggy UTC-slice methodology at line 167 — must be fixed too) + add
   table-driven cases: mid-month, month-start at 00:05/08:00 IST, month-end 23:55
   IST, Dec31→Jan1 boundary.
4. [MED] **REVISED after plan-challenger must_fix #1 and #2.** Add real-snapshot
   anchor query to getDashboardSummary (dashboardService.ts):
   `prisma.netWorthSnapshot.findFirst({where:{userId: effectiveUserId,
   snapshotDate:{lt: currentRange.start}}, orderBy: {snapshotDate:'desc'}})` —
   **`lt`, not `lte`**: `getFYRange(currentFY).start` and `getMonthStart()`
   produce the IDENTICAL instant during the FY's first month (April), so `lte`
   would let that month's own just-created snapshot satisfy "at or before FY
   start" — comparing the current FY against itself instead of against the
   previous FY, specifically during April every year. `lt` correctly excludes it,
   falling through to the last real snapshot before this FY began. Skipped
   (Promise.resolve(null)) when effectiveUserId undefined. Replace the
   approximation; netWorthChangePct/netWorthChange become undefined when no
   anchor, anchor netWorth is null, or anchor netWorth is 0. **Also remove the
   now-dead `prevIncome`/`prevExpense`/`previousFY`/`previousRange` variables and
   their two `Promise.all` queries** (dashboardService.ts:25,28,34-39) — these
   only fed the approximation being replaced; leaving them in would run two
   pointless DB aggregates on every dashboard load.
5. [LOW] Widen types: frontend/src/api/dashboard.ts (netWorthChangePct/
   netWorthChange → `number | undefined`) + shared/types/index.ts (same, dead
   type but fixed for honesty).
6. [LOW] Backend unit tests: anchor found (MEMBER + ADMIN/targetUserId), no
   anchor, family-wide ADMIN (query skipped entirely), anchor netWorth=0, anchor
   netWorth=null, **anchor snapshot dated EXACTLY at currentRange.start is
   excluded** (the must_fix #1 boundary case — asserts `lt` semantics, not
   `lte`). Add `netWorthSnapshot.findFirst: vi.fn()` to the mock factory
   (default `.mockResolvedValue(null)`, matching the file's existing
   default-per-mock convention). Update/remove the old test asserting the
   6-call aggregate sequence (current+previous period) since previous-period
   queries are now gone.
7. [LOW] Frontend test: netWorthChangePct=undefined renders StatCard without a
   trend arrow (existing fallback path, first end-to-end test of it).
8. [MED] Live Docker validation: seed a real NetWorthSnapshot row, verify the new
   findFirst query + real Prisma Decimal/Date serialization produces the exact
   shape getISTMonthKey expects, hand-verify netWorthChangePct's computed value.
   **Also seed a snapshot dated EXACTLY at getFYRange(currentFY).start and
   confirm it is correctly excluded (lt, not lte) from the anchor result** — the
   one scenario the must_fix review specifically flagged as needing real-DB
   proof, not just a mocked unit test. Confirm via code read that
   previousFY/previousRange/prevIncome/prevExpense no longer appear anywhere in
   getDashboardSummary.
7b. [LOW] **New per should_fix #1**: add a test asserting `triggerSnapshot`'s
   mutation fires exactly ONCE across the invalidate→refetch cycle (not just the
   static "already has a snapshot" case) — this bug's headline symptom was
   redundant writes, so the dynamic sequence deserves its own regression test.
9. [LOW] Full gate run both sides (lint, tsc --noEmit, test:coverage @100% backend,
   frontend test suite).

## Verification Question Mapping
| # | Question | Step(s) |
|---|---|---|
| VQ1 | Key comparison correct across all times/boundaries | 3 |
| VQ2 | triggerSnapshot fires exactly when needed, not redundantly | 2, 3 |
| VQ3 | Real snapshot used, correct fallback, backend+frontend tests | 4, 6, 7 |
| VQ4 | The one consumer + its type updated consistently | 5, 7 |
| VQ5 | Live Docker validates real IST/serialization behavior | 8 |

## Decisions for User (surfaced at APPROVE):
- Anchor choice: closest snapshot STRICTLY BEFORE start of current FY
  (recommended, matches "vs last FY" label + FY-scoped page design) vs. naive
  "365 days ago".
- **Family-wide ADMIN view will visibly change**: the absolute Net Worth number
  stays (computed family-wide as today), but the trend arrow/percentage
  disappears entirely (today it shows an approximated, arguably misleading %;
  after the fix it shows nothing, since no per-family snapshot concept exists).
  Recommended as the honest option, but this is a visible UI change for anyone
  using the "All Family" view, not just an internal computation swap — flagging
  explicitly per plan-challenger should_fix #2.
- Zero-anchor behavior change: previously `prevNetWorth===0` returned 0% (falsely
  implying "no change"); fix returns undefined instead (mathematically honest,
  matches the "no data" case) — this is a small behavior change beyond the
  literal ask, flagged for explicit sign-off.

## Task Classification: risk_level MEDIUM, task_type bugfix.

## Plan-Challenger: verdict NEEDS_WORK on first pass. All 4 design questions
independently confirmed correct (including DQ1's non-obvious "structurally always
wrong, not just a narrow window" timezone claim). 2 must_fix (anchor query's `lte`
would self-match the FY's own first-month snapshot, turning "vs last FY" into a
same-FY comparison every April; dead approximation code left in place) and 3
should_fix findings — resolved by switching to `lt` for the anchor boundary,
removing the now-dead prevIncome/prevExpense/previousFY/previousRange code, adding
a boundary-exact test case, adding a triggerSnapshot-fires-once regression test,
extending the Docker validation to cover the boundary case, and surfacing the
family-wide ADMIN UI change explicitly for APPROVE sign-off. Not re-challenged —
fixes are direct implementations of the reviewer's own concrete suggestions.

## Tech debt noted (not yet actioned):
- `VEHICLE_ONLY_FIELDS` (assetService.ts) and the Zod field list (routes/assets.ts) are
  two hand-maintained lists that must stay in sync — extract a shared constant if they
  ever drift or grow past ~8 fields.
- `investmentService.ts`'s nested Asset-create bypasses `clearVehicleOnlyFields` (safe
  today — hardcodes assetType=PROPERTY, but a future change there wouldn't get the same
  guard for free).
- Backend global branch-coverage gate sits at 99.9%, not 100%, due to pre-existing gaps
  in `loanService.ts:457` and `subscriptionService.ts:402-403` (`?? fallback` branches
  with no test for the null path). Confirmed via `git stash` (twice now, across two
  tasks) to predate this session's work. Needs a dedicated fix task.
- Frontend `npm run typecheck:tests` has pre-existing errors in `apiNormalizers.test.ts`
  (4 fixtures missing `userId`, stale since `userId` was added to `InsurancePolicy`/
  `Loan`) and `dateFormat.test.ts` (`VitestUtils` type mismatch). Also pre-existing,
  also needs a dedicated fix task.
- `Insurance.tsx`'s `startEdit` still blanket-iterates `Object.entries(policy)` into
  `setValue` for every remaining computed field (`isPaid`, `lastPaid*`, `userName`),
  relying on Zod's silent key-stripping as an implicit safety net rather than an
  explicit exclusion list. `assets` was explicitly excluded in a prior task's review;
  the older fields were flagged as the same pattern but left alone (pre-existing,
  harmless, out of scope).
- Same `''`-coerces-to-0-before-`.optional()` Zod bug class as the fixed premiumDueDate
  bug still exists, unfixed, in `RealEstate.tsx:48` (`rentalIncomeMonthly` — the
  harmful variant: silently writes 0 over the real value, not just blocks submission),
  `Accounts.tsx:124` (`interestRate`), and `TaxCentre.tsx` (12 fields). Different pages,
  out of scope for the task that found this pattern — needs a dedicated cleanup task.
- `selectedVehicleIds` (Insurance.tsx) seeds once from `editing.assets` (the insurance
  query's snapshot) rather than reconciling against the fresher `['assets', X]` query
  once it resolves. A vehicle linked/unlinked from another tab or after the cache goes
  stale could show the wrong checkbox state until the next natural refetch. Self-heals
  within one session; a full fix needs a reconciling effect, deferred as
  disproportionate to a rare edge case.
- `isSaving` (Insurance.tsx) duplicates react-hook-form's own `formState.isSubmitting`,
  which already tracks an async onValid callback correctly. Valid simplification,
  deferred to avoid further churn on an already-large diff.
- Candidate bug-pattern for `.claude/memory/bug-patterns.md` (not yet added — needs a
  3rd occurrence per the self-improvement threshold): "long-running multi-await form
  submissions need a staleness guard (disabled Cancel, or a session token) before their
  success tail mutates shared modal state." Second occurrence caught in this session
  (Insurance.tsx's Cancel-during-submit race); watch for a third before proposing via
  `/update-system`.

## Known Flakes: none currently tracked.
