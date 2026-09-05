# Task Progress

## Status: analyze

## Task: [8/9 of a Dashboard improvement series] Add per-member drill-in
on the Dashboard's family spending breakdown widget (ADMIN-only stacked
BarChart, currently no click interaction).

## Steps Completed: analyze, plan, approve, implement

## Implementation Summary: Added `handleFamilyMemberClick(memberId,
navigate)` in Dashboard.tsx (named+exported, mirrors Task 7's pattern
but simpler — no Recharts payload parsing needed since member.id is
already unambiguous per-Bar), wired onClick on each `<Bar>` in the
family spending chart, `cursor="pointer"`. Added genuinely new
URL-param infrastructure to Reports.tsx (had zero useSearchParams usage
before this task): new useAuth()+useSearchParams imports, an
auth-gated one-shot mount effect that reads `tab`/`targetUserId`, sets
the active tab unconditionally (UI state, not sensitive) and the scoped
member only when isAdmin (the actual security boundary), then strips
both params. Verified 3 independent security gates hold: Dashboard
widget is ADMIN-only, the new effect only scopes data when isAdmin, and
the backend's resolveTargetUserId ignores targetUserId for non-admins
regardless of URL content.

5 new tests: 2 unit tests on handleFamilyMemberClick (correct URL per
member, no cross-member bleed) + 3 Reports.tsx integration tests (ADMIN
lands on Spending Analysis scoped to the clicked member; MEMBER visiting
the same link also lands on the Spending tab but targetUserId is never
sent — own data only; the member selector reflects the scoped value).

## Steps Completed: analyze, plan, approve, implement, review

## Review: quality verdict PASS, adversarial verdict BRUISED (no
critical/high — 3 independent security layers verified to hold even
under an explicit race-condition trace; real Medium findings on
scope/consistency, not exploitable data leaks).

## Co-Founder Filter:
- [MED, adversarial] This task's deep link is the FIRST way to set
  viewUserId to an arbitrary id not sourced from the active-members
  dropdown — the dropdown itself is an implicit whitelist (only lists
  active members), but a bookmarked/shared URL with a stale or
  deactivated member's id would bypass that, since
  resolveTargetUserId only checks deletedAt, not isActive → ACCEPTED,
  fixed. Reports.tsx's effect now validates targetUserId against its
  own loaded `members` list (same list the dropdown offers) before
  calling setViewUserId, waiting on isMembersLoading the same way it
  waits on user. This also resolves the adjacent "stale link 404s
  silently" finding as a side effect — an unrecognized id is never
  sent to the backend at all via this path.
- [LOW-MED, adversarial] `'spending'` tab-id string literal duplicated
  4x untyped (TabId union, tabs array, URL construction in Dashboard.tsx,
  searchParams comparison) — a rename would silently break the deep
  link with no compile error → ACCEPTED, fixed. Extracted
  `SPENDING_TAB_ID` from Reports.tsx, imported into Dashboard.tsx (no
  lazy-loading in this app — every page already shares one bundle, so
  no bundle-split downside to the cross-page import).
- [Test gap, adversarial] No regression test that a MEMBER never sees
  the Family Spending widget at all (the pre-existing render gate this
  task's new click surface lives behind) → ACCEPTED, fixed.
- [MED, adversarial] `resolveTargetUserId`'s deletedAt-only check
  (ignores isActive) is a broader, PRE-EXISTING backend gap affecting
  every caller of that function, not just this new deep link →
  ACCEPTED_DEFERRED. My frontend validation closes it for this specific
  entry point; the backend-wide gap needs its own audit (does the
  existing dropdown-driven flow have any race where a member is
  deactivated between page load and click? needs investigation, out of
  proportion for this task). Logged as tech debt.
- [MED, adversarial] `spendingByCat` query has no isError handling,
  unlike P&L/Trial Balance queries in the same file → ACCEPTED_DEFERRED
  as a general pre-existing gap (my validation fix already prevents
  THIS task's new entry point from ever triggering it). Logged as tech
  debt for the general case.
- [Design note, adversarial] Whole-query-string strip vs Transactions.tsx's
  selective-preserve pattern → REJECTED as a change now. Reviewer's own
  analysis: harmless today, Reports.tsx has no other query-param
  consumer to preserve. Matches original DQ2 reasoning.
- [Test-quality note, adversarial] MEMBER-case test proves the network-
  level consequence (no targetUserId sent) but not the effect's
  internal isAdmin check directly → REJECTED as a gap. Reviewer's own
  conclusion: this is genuine defense-in-depth: testing observable
  behavior (what request went out) is the correct boundary, not
  internal implementation state that isn't idiomatically observable
  anyway (the selector never renders for a MEMBER).
- [LOW, quality] `memberId` interpolated into the URL with no
  encodeURIComponent — safe today (always a CUID) but the type
  signature doesn't encode that guarantee → ACCEPTED, fixed.

## Full gate (post-review-fixes): frontend 967/967 tests, lint clean
(including react-hooks/exhaustive-deps on the new effect), tsc --noEmit
clean. No backend changes — Reports.tsx's existing spending-by-category
fetch already accepts/forwards targetUserId.

## Question Resolution (fresh reads at REVIEW time):
| # | Question | Result |
|---|---|---|
| VQ1 | Clicks exactly that member's Spending Analysis | PASS — per-Bar closure, no cross-member bleed, now also validated server-side-equivalent (against loaded members) |
| VQ2 | Lands on 'spending' tab specifically | PASS — for both ADMIN and MEMBER (tab-switch is UI state, not gated) |
| VQ3 | Handler named/exported/directly-testable | PASS — both reviewers independently confirmed |
| VQ4 | Non-admin/unresolved-session has no path to trigger | PASS — 3 independent layers verified, adversarial reviewer explicitly traced and ruled out the race-condition scenario |

## Plan (revised after plan-challenger NEEDS_WORK — 1 must_fix resolved,
2 should_fix folded in): 1. Add `handleFamilyMemberClick(memberId,
navigate)` in Dashboard.tsx (named+exported, mirrors Task 7's pattern
but simpler — per-Bar onClick means memberId is unambiguous from
closure, no Recharts payload parsing needed), navigate to
`/reports?tab=spending&targetUserId=${memberId}`, wire onClick on each
`<Bar>`, `cursor="pointer"`. 2. Unit-test it directly. 3. Add
auth-gated one-shot mount effect in Reports.tsx (genuinely NEW infra —
confirmed zero useSearchParams usage there today, 705-line file read in
full): new useAuth()+useSearchParams imports, `if (!user) return` guard
— **plan-challenger traced this is MORE load-bearing than originally
stated**: renderPage mounts with a real AuthProvider and no
ProtectedRoute, so user really is null on first pass in tests; since
the strip logic isn't isAdmin-gated, acting before user resolves would
silently drop targetUserId before isAdmin ever becomes true. Comment
must state this causal chain explicitly, not just "mirrors a documented
bug." **Must_fix resolution**: `setActiveTab('spending')` is NOT
isAdmin-gated — tab selection is UI navigation state, not sensitive
data; the actual security boundary is `targetUserId`, which IS strictly
isAdmin-gated before calling setViewUserId. A MEMBER visiting the deep
link lands on the Spending tab showing THEIR OWN data (targetUserId
silently ignored), not blocked from it — simpler than inventing a
tab-access restriction with no real security rationale. Strip both
params after regardless of role. 4. Deep-link integration tests: ADMIN
lands on spending tab with correct targetUserId sent to backend; MEMBER
visiting the SAME url also lands on spending tab but targetUserId is
never sent/applied (their own data only). 5. Full gate (test + tsc +
lint — lint matters here since react-hooks/rules-of-hooks already
caught a real bug in this codebase once).

## Plan-Challenger: verdict NEEDS_WORK. All 4 DQ answers confirmed
correct — plan-challenger's own trace went deeper than the original
plan on WHY the `if (!user) return` guard is load-bearing (real
AuthProvider + no ProtectedRoute in tests + ungated strip logic = real
silent-drop risk, not just precautionary mirroring). 1 must_fix resolved
above (Step 3/Step 4 contradiction on MEMBER tab-switch behavior). 2
should_fix folded in (explicit causal-chain comment on the guard;
comment cross-referencing the isActive/deletedAt filter-consistency
assumption between getFamilyOverview and resolveTargetUserId).

Task Classification: risk_level MEDIUM (Reports.tsx gets new URL-param
infra in a shared multi-tab/multi-query page), task_type feature.

## User decision (AskUserQuestion): clicking a member's bar navigates to
Reports > Spending Analysis tab, pre-scoped to that member — the most
literal "drill into their spending breakdown" match, since that tab
already shows exactly this. Requires adding URL-param handling to
Reports.tsx (currently has none — confirmed via direct read).

## Design Questions:
DQ1: What exactly needs to change in Dashboard.tsx?
Evidence: Dashboard.tsx:708-727's family chart renders one
`<Bar key={member.id} dataKey={member.id} .../>` per member inside a
`.map()` closure — member.id/name already in scope, no payload parsing
needed (per-Bar onClick is confirmed supported by Recharts 2.15.4's
type defs, distinct from the chart-level onClick used by Task 7's
cashflow handler). This is actually SIMPLER than Task 7's pattern, not
hackier.

DQ2: What exactly needs to change in Reports.tsx?
Evidence: `activeTab` is local `useState<TabId>('pl')` (defaults to
Profit & Loss, NOT URL-driven). `viewUserId` comes from
`useMemberSelector()` (also local state, no URL seeding). Confirmed via
direct read: Reports.tsx has ZERO `useSearchParams` usage today — this
is genuinely new infrastructure, not a mirror of an existing pattern
(unlike Transactions.tsx's `?startDate=&endDate=` which Task 7 could
reuse as-is).

DQ3: Is this an ADMIN-only interaction end to end?
Evidence: the family widget itself is already gated
`user?.role === 'ADMIN' && familyOverview.members.length > 1`.
Reports.tsx's member-selector `<select>` (line ~192) is also
admin-gated. The destination URL param must be interpreted the same
way every prior task's targetUserId handling has been — ignored
server-side for non-admins regardless of what's in the URL.

## Verification Questions:
VQ1: Does clicking a specific member's bar segment navigate to exactly
that member's Spending Analysis (not the wrong member, not
family-wide)?
VQ2: Does Reports.tsx land on the 'spending' tab specifically (not the
default 'pl' tab) when arriving via this deep link?
VQ3: Is the per-Bar click handler a named, exported, directly-testable
function (matching Task 7's established pattern — Recharts renders 0x0
under jsdom, real coordinate clicks can't be simulated)?
VQ4: Does a non-admin (or an admin whose session hasn't resolved yet)
have no path to trigger this, matching the family widget's existing
gating?

## Series plan (9 /task runs total, user-approved order) — 7 of 9 done:
1. [DONE] Bug fixes: UTC snapshot key + netWorthChangePct approximation
2. [DONE] Spend-by-category breakdown widget
3. [DONE] Tax-deduction snapshot (80C/80D) widget
4. [DONE] Investment/loan summary tile
5. [DONE] Alerts "view all" link (new Reminders page)
6. [DONE] Quick-add shortcuts (Add Expense / Add Income on Dashboard)
7. [DONE] Fragile cash-flow month-click date parsing (was a live crash)
8. [IN PROGRESS] Per-member drill-in on family spending breakdown
9. Dashboard.test.tsx coverage check + gap-fill

## Tech debt inventory (see git log for full task-by-task detail):
- Primary transaction CRUD mutations (edit/delete/import/bulk/recurring-
  apply) still don't invalidate dashboard/profit-and-loss/report-
  spending/accounts — only the create path (Task 6) and 4 secondary
  modals do. `lib/queryInvalidation.ts` is the natural home for a
  shared helper covering all ~7 sites.
- `CashflowMonth`/`UpcomingAlert` types independently duplicated
  (api/dashboard.ts + shared/types/index.ts) rather than imported from
  the shared module — pre-existing drift risk, needs unification.
- `useAccounts`/`useCategories` independently duplicated 5-way (same
  query key, separate definitions — a queryFn drift would silently
  corrupt shared cache).
- `computeTotalLiabilities` has an undocumented endDate filter that
  silently excludes loans past their scheduled end date.
- `selectedMemberName` derivation duplicated in Dashboard.tsx and
  Transactions.tsx — candidate to return from useMemberSelector.
- `PageHeader` component has zero production usages; Dashboard's Task 6
  header is its 9th hand-rolled duplicate.
- ADMIN sees no Dashboard quick-add buttons by default (family-wide
  view) but Transactions.tsx's own Add flow auto-selects the admin as
  target instead — open product question.
- No modal in the app has role="dialog"/focus-trap/Escape-to-close (12
  modals checked) — systemic a11y gap. Progress bars also lack ARIA.
- `viewUserId` is local useState, not shared context/URL state.
- BUDGET_ALERT rows display the budget LIMIT as "amount due".
- 80C/80D bar-color threshold duplicated 4x.
- taxApi/insuranceApi/investmentsApi/loansApi mostly return `Promise<any>`.
- Backend branch-coverage gate at 99.9% (loanService.ts:457,
  subscriptionService.ts:402-403).
- `''`-coerces-to-0 Zod bug class unfixed in RealEstate.tsx, Accounts.tsx,
  TaxCentre.tsx (12 fields).
- Dashboard's `netWorth` always today's live figure regardless of
  `selectedFY`. UTC-vs-IST bug class also in useRecurringAutoGenerate.ts:12.

## Known Flakes: none currently tracked.
