# Task Progress

## Status: idle

## Last completed: Link vehicles to their insurance policy from the Insurance page
(checkbox picker on the VEHICLE-policy form, reconciled via the existing
PUT /api/assets/:id). Also fixed a real bug where premiumDueDate could never be
cleared once set. Committed as feat 92a3f24.

## QUEUED NEXT: none.

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
