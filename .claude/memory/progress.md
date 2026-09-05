# Task Progress

## Status: idle

## Last completed: [1/9 of a Dashboard improvement series] Fixed Dashboard's
net-worth trend calculation — IST-aware snapshot-key comparison (was broken for
most of each month, not just near midnight) and a real-snapshot-anchored "vs last
FY" percentage (was an income/expense approximation). Review caught and fixed two
real bugs along the way: negative-anchor sign inversion, and an unbounded anchor
lookup that could mislabel a stale/multi-year-old snapshot as "last FY". Committed
as fix 14a8ae5.

## Series plan (9 /task runs total, user-approved order) — 1 of 9 done:
1. [DONE] Bug fixes: UTC snapshot key + netWorthChangePct approximation
2. [QUEUED NEXT] Spend-by-category breakdown widget
3. Tax-deduction snapshot (80C/80D) widget
4. Investment/loan summary tile
5. Alerts "view all" link
6. Quick-add shortcuts (add transaction / record income)
7. Fragile cash-flow month-click date parsing
8. Per-member drill-in on family spending breakdown
9. Dashboard.test.tsx coverage check + gap-fill

## Tech debt noted (not yet actioned):
- `VEHICLE_ONLY_FIELDS` (assetService.ts) and the Zod field list (routes/assets.ts) are
  two hand-maintained lists that must stay in sync — extract a shared constant if they
  ever drift or grow past ~8 fields.
- `investmentService.ts`'s nested Asset-create bypasses `clearVehicleOnlyFields` (safe
  today — hardcodes assetType=PROPERTY, but a future change there wouldn't get the same
  guard for free).
- Backend global branch-coverage gate sits at 99.9%, not 100%, due to pre-existing gaps
  in `loanService.ts:457` and `subscriptionService.ts:402-403` (`?? fallback` branches
  with no test for the null path). Confirmed via `git stash` (three times now, across
  three tasks) to predate this session's work. Needs a dedicated fix task.
- Frontend `npm run typecheck:tests` has pre-existing errors in `apiNormalizers.test.ts`
  (4 fixtures missing `userId`, stale since `userId` was added to `InsurancePolicy`/
  `Loan`) and `dateFormat.test.ts` (`VitestUtils` type mismatch). Also pre-existing,
  also needs a dedicated fix task.
- `Insurance.tsx`'s `startEdit` still blanket-iterates `Object.entries(policy)` into
  `setValue` for every remaining computed field (`isPaid`, `lastPaid*`, `userName`),
  relying on Zod's silent key-stripping. Pre-existing, harmless, out of scope.
- Same `''`-coerces-to-0-before-`.optional()` Zod bug class as the fixed premiumDueDate
  bug still exists, unfixed, in `RealEstate.tsx:48` (`rentalIncomeMonthly`), `Accounts.tsx:124`
  (`interestRate`), and `TaxCentre.tsx` (12 fields). Different pages, needs a dedicated
  cleanup task.
- `selectedVehicleIds` (Insurance.tsx) seeds once from `editing.assets` rather than
  reconciling against the fresher `['assets', X]` query once it resolves. Self-heals
  within one session; deferred as disproportionate to a rare edge case.
- `isSaving` (Insurance.tsx) duplicates react-hook-form's own `formState.isSubmitting`.
  Valid simplification, deferred to avoid further churn.
- Candidate bug-pattern (2nd occurrence, watch for a 3rd before proposing via
  `/update-system`): "long-running multi-await form submissions need a staleness guard
  before their success tail mutates shared modal state" (Insurance.tsx's Cancel-during-
  submit race, fixed in that task).
- Dashboard's `netWorth` field (not just the change%) is always TODAY's live figure
  regardless of `selectedFY` — viewing a historical FY still shows current net worth.
  Pre-existing, larger than this task's scope (would need the whole Dashboard to become
  FY-scoped, not just the net-worth trend). Noted during Task 1's review.
- The same UTC-vs-IST key-comparison bug class fixed in Task 1 (Dashboard.tsx's
  snapshot-exists check) also exists, unfixed, in
  `frontend/src/hooks/useRecurringAutoGenerate.ts:12` (a localStorage-based once-a-day
  gate, `new Date().toISOString().slice(0,10)`). Self-corrects the next day, wrapped in
  a `.catch()` — low impact, but the same class of bug. Candidate for its own task.

## Known Flakes: none currently tracked.
