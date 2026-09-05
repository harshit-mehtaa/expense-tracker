# Task Progress

## Status: analyze

## Task: [6/9 of a Dashboard improvement series] Add quick-add shortcuts
to the Dashboard (add transaction / record income). Note: Header.tsx
already has a global "Add Transaction" button on every page — researcher
dispatched to find the actual gap before assuming scope.

## Steps Completed: analyze, plan, approve, implement

## Implementation Summary: Extracted AddTransactionModal (170+ lines,
was private to Transactions.tsx) + its 3 supporting query hooks +
txSchema/TxForm into new shared files: components/transactions/
AddTransactionModal.tsx, hooks/useTransactionFormOptions.ts (also
extracted invalidateFinancialReports into lib/queryInvalidation.ts).
Added defaultType?: 'EXPENSE'|'INCOME' prop. Fixed a real, previously-
logged tech debt item at the single relocated mutation source: it now
also invalidates ['dashboard'] and calls invalidateFinancialReports —
both Transactions.tsx's existing flow AND Dashboard's new buttons get
this fix since there's only one code path now. Wired 2 new Dashboard
buttons ("Add Expense"/"Add Income") into the page header, HIDDEN (not
disabled) when an ADMIN is viewing "All Family" — matches the
established convention used by all 8 other resource pages with a
create action (plan-challenger caught and corrected an invented
disabled+tooltip design in PLAN). Fixed 2 stale line-number comments in
Transactions.test.tsx left behind by the extraction.

9 new tests: AddTransactionModal.test.tsx (5 — defaultType EXPENSE vs
INCOME, category re-filtering on type switch, invalidation set includes
dashboard/profit-and-loss/report-spending, targetUserId only sent when
provided) + Dashboard.test.tsx (3 — buttons hidden when family-wide,
shown for MEMBER, shown+opens pre-set-to-Income modal for ADMIN with a
member selected).

## Steps Completed: analyze, plan, approve, implement, review

## Review: quality verdict PASS_WITH_NOTES, adversarial verdict BRUISED
(1 HIGH must_fix — empirically verified, the exact minimal quick-add
path this feature exists for was rejected 422 by the backend).

## Co-Founder Filter:
- [HIGH, adversarial] Minimal quick-add (description + amount only)
  submitted `categoryId/bankAccountId/paymentMode/transferToAccountId`
  as `''` — backend Zod schema types these `.cuid()/.enum().optional()`,
  which accepts `undefined` but rejects `''` → 422 on the feature's own
  primary use case. Empirically verified against the real backend
  schema. EditTransactionModal already handles this correctly
  (`|| undefined`); the extraction missed it → ACCEPTED, fixed. Added
  the same normalization to all 4 fields, plus a regression test
  asserting the actual POST body on a minimal-form submission.
- [MED, adversarial] `['accounts']` not invalidated despite a
  transaction with a bankAccountId moving that account's balance
  server-side (ConvertToTransferModal already does this) → ACCEPTED,
  fixed.
- [MED, adversarial] Shared `queryInvalidation.ts` docstring claimed
  "every mutation" gets this invalidation — false, 6 sibling mutations
  in Transactions.tsx/RecurringRules.tsx still don't → ACCEPTED,
  softened to state the real (partial) coverage explicitly rather than
  an absolute claim the next reader would wrongly trust. Full fix
  (unifying all 7 sites into one helper) logged as tech debt, not done
  here — cross-cutting beyond this task's scope.
- [MED, adversarial] `quickAddType` orphaned state — reachable via Tab
  (no focus trap on the modal): switching to "All Family" while typing
  unmounts the modal but leaves `quickAddType` set, so picking a new
  member instantly reopens a blank modal the user never clicked for.
  Separately, switching members while the modal STAYS mounted (still
  member-scoped) leaves stale form state (react-hook-form only reads
  defaultValues at init) → ACCEPTED, fixed both: clear quickAddType in
  the member-select onChange, and added a `key` prop so the modal
  remounts on type/target change instead of reusing stale state.
- [MED, quality] Dashboard test proved the modal opens with the right
  type but never proved `targetUserId` reaches the actual POST — a
  regression could misattribute an admin's quick-add to their own
  account instead of the selected member's → ACCEPTED, fixed. Added a
  full submit-and-assert-request-param test.
- [MED, quality] Comment overstated invalidation fix as closing the gap
  "for every caller" when it's create-only → ACCEPTED, fixed wording.
- [LOW, adversarial] Dashboard's "Add Income" test couldn't distinguish
  correct wiring from a hardcoded/swapped-button bug (no mirror test for
  "Add Expense") → ACCEPTED, added the mirror test.
- [LOW, adversarial] Invalidation test only checked `queryKey[0]`, not
  full key equality → ACCEPTED, tightened to `toHaveBeenCalledWith`.
- [LOW, quality] `useLoans` not actually used in Transactions.tsx
  post-extraction (only the modal needs it) → verified accurate, no
  action needed, extraction location is still correct (shared file, one
  consumer today, correctly positioned for future reuse).
- [LOW, quality] `selectedMemberName` duplicated a 2nd time (Dashboard +
  Transactions.tsx) → ACCEPTED_DEFERRED. Real fix is returning it from
  useMemberSelector (touches every page using that hook) — bigger than
  this task, logged as tech debt.
- [LOW, quality] PageHeader component has zero production usages, this
  task's new header markup is its 9th hand-rolled duplicate →
  ACCEPTED_DEFERRED, logged as tech debt (adopt-or-delete decision for
  a future cleanup task).
- [LOW/PRODUCT, adversarial] ADMIN sees no quick-add buttons by default
  (family-wide view) — matches the established hide-on-family-wide
  convention (verified across 8 pages) but conflicts with
  Transactions.tsx's own Add flow, which auto-selects the admin as
  target instead of hiding. Genuine product tension between two real
  precedents → NOT changed (would reverse the plan-challenger's own
  must_fix correction from PLAN without new evidence tipping the
  balance) — logged as an explicit product question for a future
  decision, not silently resolved either way.
- [INFO, adversarial] 5 tracked session-log jsonl deletions in the
  working tree, unrelated to this task → confirmed NOT staged (verified
  via explicit `git add` of only intended files, same practice as every
  prior task this series).

## Full gate (post-review-fixes): frontend 948/948 tests, lint clean,
tsc --noEmit clean. Zero backend changes (confirmed via git status) —
POST /transactions already supports type:INCOME, no endpoint work
needed.

## Plan (10 steps, awaiting plan-challenger verdict):
DQ1 resolution: two Dashboard buttons "Add Expense"/"Add Income", both
opening the same modal with a new `defaultType` prop — closes both the
"Dashboard has zero create affordance" gap and the "income requires an
extra manual step, zero visual signal" gap. DQ2: extract
AddTransactionModal (Transactions.tsx:2104-2281) + its 3 supporting
query hooks + txSchema into new shared files, NOT duplicated (hooks are
also used by EditModal/ImportModal still in Transactions.tsx, so must
move somewhere both import from, not just delete). DQ3: Header's button
stays unchanged (Dashboard buttons earn their existence independently).
DQ4: the extracted mutation currently invalidates only
transactions/loans/budgets — NOT dashboard/report-spending/profit-and-
loss (matches an already-logged tech debt item). Since this task
extracts the mutation into ONE shared location anyway, the fix lands
once and both Transactions.tsx's existing flow and Dashboard's new
buttons get it for free.

1. Extract useCategories/useAccounts/useLoans → hooks/
useTransactionFormOptions.ts. 2. Extract invalidateFinancialReports →
lib/queryInvalidation.ts. 3. Extract AddTransactionModal →
components/transactions/AddTransactionModal.tsx (new dir), add
defaultType prop, fix invalidation gap (add dashboard +
report-spending/profit-and-loss). 4. **Revised per must_fix**: Wire
Dashboard.tsx: 2 buttons, HIDDEN (not disabled+tooltip) when
`isViewingFamilyWide` — matches the established, repo-wide convention
used by all 8 other resource pages with a create action (Accounts,
Budgets, Gold, Investments, Assets, Insurance, Loans, RealEstate all use
`{!isViewingFamilyWide && <Button>}`); no extra defensive user-resolution
gating needed beyond this, since ProtectedRoute already guarantees `user`
is resolved before Dashboard mounts. Guard budgetActuals ?? [].
5. Fix stale line-number comments in Transactions.test.tsx. 6. New
AddTransactionModal.test.tsx (REQUIRED case: Transactions.tsx's own
existing invocation, no defaultType, also fires the new dashboard/
report-spending invalidations — proves the "one path, fixed once"
claim, not just inferred) + Dashboard button tests (rendered when
member-scoped, hidden when family-wide). 7. lint + tsc + full suite.

## Plan-Challenger: verdict NEEDS_WORK. All 4 DQ answers confirmed
correct (extraction mechanics, hook dependencies, invalidation-gap
diagnosis all verified against fresh reads). 1 must_fix resolved above
(disabled+tooltip design was unsupported by its own citation and
contradicted the established hide-button convention used by 8 other
pages — switched to hide, matching precedent exactly). 2 should_fix
resolved (promoted the "Transactions.tsx's own invocation also gets the
fix" test from optional to required; clarified no extra auth-race
defensive gating needed since ProtectedRoute already closes that race
for Dashboard's button-based design, unlike Transactions.tsx's one-shot
mount effect). 1 nice_to_fix noted (new directory
components/transactions/ needs creating).

Task Classification: risk_level MEDIUM, task_type feature.

## Design Questions:
DQ1: What quick-add capability already exists, and what's actually
missing?
Evidence: Header.tsx:79-82 already has a global "Add Transaction" button
(every page, including Dashboard) → /transactions?add=1 →
AddTransactionModal, but ALWAYS defaults `type: 'EXPENSE'`
(Transactions.tsx:2125), no query-param support for a default type.
Income vs expense is not a distinct flow anywhere — same schema, same
modal, same endpoint, just a `<select>` toggle (Transactions.tsx:
2211-2215). Recording income requires an extra manual type-switch and
isn't visually signaled by the button's label/icon at all. Dashboard.tsx
itself has ZERO create affordance (grepped the full file — only a
read/filter drill-down exists, not a create action). This is the first
task in the 9-task series to add a create/mutate affordance, not a
read-only display widget.

DQ2: Is `AddTransactionModal` reusable, or private to Transactions.tsx?
Evidence: Defined at Transactions.tsx:2104, NOT exported — private to
that file. Duplicating its 170+ lines into Dashboard.tsx would create
two copies of the same form that could drift (the exact
duplicate-instead-of-extract mistake this session already corrected
once, in Task 2's chartUtils.tsx extraction).

## Verification Questions:
VQ1: Does the fix genuinely close the income asymmetry gap (not just
duplicate the existing Expense-only Header button)?
VQ2: Is the shared modal actually extracted/reused (no duplicate copy)?
VQ3: Same role/targetUserId scoping and cache-invalidation pattern as
the existing AddTransactionModal (must invalidate the same query keys
on success, matching Transactions.tsx's own mutation)?
VQ4: Does the Dashboard-native shortcut avoid being pure redundant UI
next to the already-global Header button — i.e. does it add real,
distinct value?

## Series plan (9 /task runs total, user-approved order) — 5 of 9 done:
1. [DONE] Bug fixes: UTC snapshot key + netWorthChangePct approximation
2. [DONE] Spend-by-category breakdown widget
3. [DONE] Tax-deduction snapshot (80C/80D) widget
4. [DONE] Investment/loan summary tile
5. [DONE] Alerts "view all" link (new Reminders page)
6. [IN PROGRESS] Quick-add shortcuts (add transaction / record income)
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
  context/URL state — an ADMIN scoped to one member sees a wider "All
  Family" view after Dashboard→Reminders navigation, no visual cue.
- BUDGET_ALERT rows display the budget LIMIT as "amount due" (not money
  owed) — pre-existing backend data-shape inconsistency in alert model.
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
