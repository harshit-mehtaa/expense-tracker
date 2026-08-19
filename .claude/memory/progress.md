# Task Progress

## Status: idle

## Last completed: Show which vehicle asset(s) a policy is linked to on the Insurance
page (reverse direction of the Assets page's existing "linked to policy X" display).
Committed as feat 0da55f7.

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
  with no test for the null path). Confirmed via `git stash` to predate this session's
  work — not introduced by any task here. Needs a dedicated fix task.
- Frontend `npm run typecheck:tests` has pre-existing errors in `apiNormalizers.test.ts`
  (4 fixtures missing `userId`, stale since `userId` was added to `InsurancePolicy`/
  `Loan`) and `dateFormat.test.ts` (`VitestUtils` type mismatch). Also pre-existing,
  also needs a dedicated fix task.
- `Insurance.tsx`'s `startEdit` still blanket-iterates `Object.entries(policy)` into
  `setValue` for every remaining computed field (`isPaid`, `lastPaid*`, `userName`),
  relying on Zod's silent key-stripping as an implicit safety net rather than an
  explicit exclusion list. `assets` was explicitly excluded during this task's review;
  the older fields were flagged as the same pattern but left alone (pre-existing,
  harmless, out of scope).

## Known Flakes: none currently tracked.
