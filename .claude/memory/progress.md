# Task Progress

## Status: analyze

## Task: [5/9 of a Dashboard improvement series] Add a "View all" link to
the Dashboard's "Upcoming This Month" alerts card (currently truncates to
5 with no way to see the rest).

## Steps Completed: analyze, plan, approve, implement

## Implementation Summary: New `/reminders` route + `Reminders.tsx` page
(reuses `fetchUpcomingAlerts`/query key `['dashboard','alerts', viewUserId]`
byte-identical to Dashboard's alerts card — zero backend changes). Flat
list, sorted exactly as the backend returns it, each row links via an
exhaustive `Record<UpcomingAlert['type'], string>` (9 types → 6 domain
pages — a future 10th type fails tsc instead of silently 404ing). Added
Sidebar nav entry (Bell icon, after Dashboard) so it's not an orphan
route. Added "View all" link to Dashboard's alerts card (Budget Health's
exact idiom). Also wired a "View all" footer link into Header.tsx's
notification-bell dropdown — a pre-existing 3rd consumer of the same
alert data (own query key, no viewUserId, deliberately global/context-
independent — scoping NOT changed) that had no links at all; caught by
the plan-challenger, resolved as a small consistency addition once a
canonical destination existed.

19 new tests: Reminders.test.tsx (17 — loading/loaded transition, all 9
alert types render not just 5, each type's link destination via
it.each, due-today/tomorrow phrasing, no-amount row safety, empty state,
explicit fetch-error message (not silent fallback to empty), admin
member-switch refetch, MEMBER sees no selector) + Header.test.tsx (2 —
View-all link href, present in both populated and empty states).

## Steps Completed: analyze, plan, approve, implement, review

## Review: quality verdict PASS_WITH_NOTES, adversarial verdict BRUISED
(1 High that both reviewers converged on independently — the "compile-
time exhaustive" claim on ALERT_TYPE_ROUTE was false; a future 10th
alert type would compile cleanly and silently self-link with zero
test/type/console signal).

## Co-Founder Filter:
- [HIGH, adversarial] `ALERT_TYPE_ROUTE` lookup was unguarded at runtime
  — `getUpcomingAlerts` has no backend return-type annotation, and the
  frontend's `UpcomingAlert` type is a hand-maintained, already-drifted
  duplicate of an orphaned shared/types/index.ts copy (zero importers).
  A type mismatch compiles cleanly and passes `undefined` to `Link`'s
  `to`, which React Router silently treats as "stay on this page" — no
  crash, no console error → ACCEPTED, fixed. Guarded the lookup at
  runtime: unmapped types render a plain non-clickable row instead of a
  misleading link. Rewrote the comment to state the real (weaker)
  guarantee instead of a false stronger one.
- [MED, quality] Order-assertion test only checked row COUNT (9), not
  actual order — a client-side `.sort()` regression would pass
  unchanged; the comment also incorrectly claimed the fixture was in
  daysUntilDue order (it wasn't — 60 before 20) → ACCEPTED, fixed.
  Rewrote to assert exact rendered title order against the fixture.
- [MED, quality] No test actually pinned the shared query-key prefix
  (`['dashboard','alerts',...]`) — a typo'd key would pass all 17
  original tests while silently defeating cache sharing → ACCEPTED,
  fixed. Added a `queryClient.getQueryData(['dashboard','alerts',
  undefined])` assertion.
- [MED, quality] Dashboard's own new "View all" link had no test (Header's
  got 2) → ACCEPTED, fixed. Added to Dashboard.test.tsx.
- [LOW, both reviewers] `{alert.amount && <INRDisplay/>}` renders a bare
  "0" text node when amount===0 (React renders falsy-but-defined
  numbers) — Header.tsx already got this right (`!= null`) →
  ACCEPTED, fixed in both Reminders.tsx AND the pre-existing identical
  bug in Dashboard.tsx (adjacent, one-line, same bug class already being
  touched).
- [LOW, adversarial] `it.each` per-type-link test was a hand-maintained
  parallel copy of `ALERT_TYPE_ROUTE`, could silently under-cover a
  future type → ACCEPTED, fixed. Exported `ALERT_TYPE_ROUTE`, drove
  `it.each` from `Object.entries()`, added a fixture-completeness
  assertion (Set equality between fixture types and map keys).
- [MED, adversarial] `viewUserId` scope resets to "All Family" when an
  ADMIN navigates Dashboard→Reminders (useMemberSelector is local
  `useState`, not shared context) — an admin scoped to one member sees a
  WIDER list after clicking "View all", without it being obvious the
  scope changed → ACCEPTED_DEFERRED. Reviewer's own verdict listed this
  as deferrable; fixing it would mean lifting viewUserId into shared
  state or a URL param, out of proportion for this task. Logged as tech
  debt.
- [LOW, adversarial] BUDGET_ALERT rows display the budget LIMIT as the
  "amount due" (not money owed) and always sort to the top
  (daysUntilDue:0), while `utilized` is fetched and discarded →
  ACCEPTED_DEFERRED. Pre-existing backend data-shape inconsistency
  (alert.amount means different things per type), not introduced by
  this diff — same display Dashboard's card has used for years, just
  now also visible on a page with more rows. Logged as tech debt.
- [MED, adversarial] `shared/types/index.ts`'s `UpcomingAlert` is
  orphaned (zero importers) and already drifted from the frontend's own
  copy → ACCEPTED_DEFERRED. Proper fix is unifying through shared/types
  and annotating the backend's return type — cross-cutting, touches
  backend code, belongs in a dedicated task, not this one. Logged.
- [LOW, adversarial] Member-selector block is now a 14th+ duplicate
  across the codebase → ACCEPTED_DEFERRED, matches an already-logged
  tech debt category (component extraction candidate).
- [NITPICK, quality] Unrelated session-log jsonl deletions in the working
  tree → REJECTED, false positive. Hook-driven housekeeping (7-day
  retention), never staged by this or any prior task in this series —
  confirmed via explicit `git add` of only the intended files each time.

## Full gate (post-review-fixes): frontend 936/936 tests, lint clean,
tsc --noEmit clean. Manual dev-server click-through (plan step 10) not
possible in this environment — no browser/screenshot tooling, same
limitation noted in Task 2.

## Question Resolution (fresh reads at REVIEW time):
| # | Question | Result |
|---|---|---|
| VQ1 | Reminders shares cache with Dashboard's alerts query | PASS — now test-pinned, not just claimed |
| VQ2 | Every alert type maps to a correct, working link | PASS — now runtime-guarded + self-maintaining test coverage |
| VQ3 | Same role/targetUserId scoping as every other page | PASS — both reviewers independently traced server-side authorization, no MEMBER leak path |
| VQ4 | Dashboard's card gets the "View all" link matching the other cards' idiom | PASS — now tested |
| VQ5 | Handles zero-alerts case gracefully on the new page | PASS |

## User decision (AskUserQuestion): build a new dedicated Reminders page
(not an in-place expand) — matches the other 4 cards' navigate-away
pattern and the literal task ask.

## Design Question Answers (condensed — full evidence in architect's
output, superseded once plan-challenger resolves):
DQ1: `getUpcomingAlerts` has no server limit — reuse as-is, zero backend
work, cache-shared with Dashboard via identical query key.
DQ2: Add a Sidebar nav entry — every other substantive page has one; an
orphan route would be the app's first.
DQ3: 9 alert types → 6 destination LIST pages (no per-entity deep-linking
exists anywhere in the app) — EMI→/loans, SIP/FD/RD→/investments,
INSURANCE_PREMIUM→/insurance, SUBSCRIPTION_*→/subscriptions,
ADVANCE_TAX→/tax, BUDGET_ALERT→/budgets. Built as an exhaustive
`Record<UpcomingAlert['type'], string>`.
DQ4: useMemberSelector(), same as every full page.
DQ5: Flat, sorted by daysUntilDue exactly as backend returns — avoids a
5th duplicated per-type styling lookup (tech debt already flags a 4x
duplication of this exact pattern for tax bar-colors).

## Plan (revised after plan-challenger NEEDS_WORK — 2 should_fix resolved,
1 new step added):
1. Route `/reminders` in App.tsx. 2. Sidebar nav entry (Bell icon, after
Dashboard). 3. Build Reminders.tsx (useMemberSelector header, byte-
identical useQuery, flat alert list, "Due in the next 30 days" subtitle
— NOT FY-scoped, per-row Link via ALERT_TYPE_ROUTE, empty/loading/error
states matching an existing page's established inline-error copy
convention, verified during implementation not assumed). 4. Add "View
all" link to Dashboard's alerts card (copy Budget Health's exact idiom).
**4b. NEW**: Add a "View all →" footer link to Header.tsx's notification
dropdown (lines 84-129), pointing to /reminders — plan-challenger found
this pre-existing 3rd alerts consumer (own query key `['dashboard',
'alerts']`, no viewUserId — intentionally global/context-independent,
NOT changing its scoping) has no link anywhere; now that a canonical
destination exists, wiring it in is a small, directly-related addition,
not scope creep. 5. Repo-wide grep for /reminders collisions.
6. Reminders.test.tsx. 7. Check App.test.tsx shellHandlers (likely no-op,
same endpoint reused). 8. tsc + lint. 9. Full suite. 10. Manual
dev-server click-through (string route literals aren't statically
checked against App.tsx's route table).

## Plan-Challenger: verdict NEEDS_WORK. All 5 DQ answers confirmed except
DQ1's "cache-shared with Dashboard" framing, which missed a 3rd consumer
(Header.tsx's notification bell, different query key, no links) — resolved
via new Step 4b above. 2nd should_fix: VQ1's test coverage claim overstated
(renderPage.tsx creates a fresh QueryClient per test, so cache-sharing is
verified by query-key LITERAL match via code read, not by any automated
test) — noted explicitly, no code change needed, just accurate framing.
2 nice_to_fix noted (error-copy convention to verify at implementation;
"View all" showing even for 1-2 alerts is fine, matches Budget Health's
own unconditional precedent).

Task Classification: risk_level MEDIUM (new page+route+nav, but fully
additive, no backend/schema changes), task_type feature.

## Series plan (9 /task runs total, user-approved order) — 4 of 9 done:
1. [DONE] Bug fixes: UTC snapshot key + netWorthChangePct approximation
2. [DONE] Spend-by-category breakdown widget
3. [DONE] Tax-deduction snapshot (80C/80D) widget
4. [DONE] Investment/loan summary tile
5. [IN PROGRESS] Alerts "view all" link
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
