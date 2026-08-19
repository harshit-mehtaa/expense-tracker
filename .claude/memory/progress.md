# Task Progress

## Status: review

## Task: Show which vehicle asset(s) a policy is linked to on the Insurance page —
reverse direction of the existing Assets-page "linked to policy X" display. Revised
after plan-challenger found: this creates a new read dependency (Insurance page now
renders Asset data) with no matching cache invalidation on the write side.

## Steps Completed: analyze, plan, approve, implement, review

## Risk: LOW. task_type: feature.

## Plan:
1. [LOW] `insuranceService.ts`: add to the shared `policyPaymentInclude` (covers all 3
   `getInsurancePolicies` branches in one edit): `assets: {select: {id, name,
   registrationNumber, soldAt}, orderBy: [{name: 'asc'}, {id: 'asc'}]}`. No
   `assetType: 'VEHICLE'` filter needed — `clearVehicleOnlyFields` already guarantees a
   non-VEHICLE asset can never hold this FK. Secondary `id` sort makes ordering fully
   deterministic when two vehicles share a name. `value`/`salePrice` (the only two
   Decimal fields on Asset) deliberately excluded — would force nested normalization
   for zero display benefit.
2. [LOW] `insuranceService.test.ts`: extend the 3 branch include assertions (existing
   `objectContaining` calls, won't break); add ONE assertion pinning the exact nested
   select shape with `toEqual` (not `objectContaining`) so a future dev can't silently
   add a sensitive field (sumAssured-style leak) to this select without a test failing —
   mirrors the "deliberately minimal" precedent already enforced on the Asset side
   (assetService.ts's own insurancePolicy select). New test for multi-asset + sold
   passthrough via withPaymentStatus.
3. [LOW] `frontend/api/insurance.ts`: new `PolicyAssetRef {id: string; name: string;
   registrationNumber?: string | null; soldAt?: string | null}` (explicit `| null`,
   matching how Prisma actually returns these, not just `?:string`). Add optional
   `assets?: PolicyAssetRef[]` to `InsurancePolicy` (optional because create/update/
   premium-calendar responses don't include it). No `normalizePolicy` change.
4. [LOW] `Insurance.tsx`: add `Car` icon import. Render `{policy.assets &&
   policy.assets.length > 0 && (...)}` after the existing agentContact line, matching
   its per-field conditional convention. Each linked vehicle shows name + optional
   (registrationNumber), and for a sold vehicle, the SAME "Sold {date}" slate badge
   convention already used on the Assets page (Assets.tsx's sold badge) — not novel
   "(sold)" text + line-through styling, which has zero precedent in this codebase.
5. [MED] **New step, closes the plan-challenger's must-fix**: add `['insurance']`
   cache invalidation to both write paths that can change what this new display shows:
   - `Assets.tsx`'s `invalidate()` (used by create/update/delete/sell) — add
     `qc.invalidateQueries({queryKey: ['insurance']})`, comment mirroring the existing
     reverse-direction precedent in Insurance.tsx ("A create/update/delete here can
     each change what a linked vehicle shows...").
   - `Loans.tsx`'s inline asset creator's `onSuccess` — same addition.
   Without this, linking a vehicle to a policy on the Assets page wouldn't show on the
   Insurance page for up to 5 minutes (staleTime), on the single most likely workflow
   for this feature.
6. [LOW] `Insurance.test.tsx`: cases for 0/1/2+ linked vehicles, one sold (renders the
   slate "Sold {date}" badge, not hidden), field absent entirely (existing fixture
   already has no `assets` key, so this is exercised by every existing test once the
   guard lands). Plus a new test on the Assets.tsx/Loans.tsx side asserting the mutation
   invalidates `['insurance']` too.
7. [LOW] Live Docker validation, trimmed to what unit tests can't prove: create a
   policy + 2 linked vehicles (sell one) + a second policy with no assets, call
   `getInsurancePolicies` for all 3 role branches against the real Postgres, assert the
   nested `orderBy` produces the expected deterministic order and `soldAt` round-trips
   correctly. (The include-shape-per-branch claim is already unit-tested in step 2;
   this step exists specifically for the one thing a mock can't prove — real nested
   Prisma ordering.)
8. [LOW] Full test + typecheck + lint + 100% backend coverage gate check both sides.

## Verification Question Mapping
| # | Question | Step(s) |
|---|---|---|
| VQ1 | Renders correctly across all 3 `getInsurancePolicies` branches | 1, 2, 7 |
| VQ2 | Frontend handles 0/1/2+ linked vehicles | 4, 6 |
| VQ3 | Sold linked asset distinguished, not hidden | 1, 4, 6 |
| VQ4 | No data leak beyond the policy's own owner | Argued from invariant (verified: no
  `Asset.userId` write path exists outside createAsset) + step 2's exact-select-shape
  pin, which is the part actually owned by this task (field scope, not ownership) |
| VQ5 (new) | Insurance page doesn't show stale "Covers:" after an Assets-page mutation | 5, 6 |

## Decisions for User (surfaced at APPROVE):
- Sold vehicle display: use the EXISTING slate "Sold {date}" badge convention (matches
  the Assets page exactly) rather than inventing new "(sold)" + line-through styling
  that has no precedent in this codebase. Recommended, not asking separately — this is
  a straightforward consistency call, not a product trade-off.

## Baseline Failures: none — backend 2339/2339, frontend 863/863, all passing.

## Implementation Summary:
All 8 plan steps done. Backend: policyPaymentInclude.assets added (insuranceService.ts),
exact-select-shape + multi-asset/sold tests added (35 tests, was 33). Frontend:
PolicyAssetRef + InsurancePolicy.assets? (api/insurance.ts), Covers: render with Car
icon + existing slate Sold-badge convention (Insurance.tsx), ['insurance'] invalidation
added to Assets.tsx's invalidate() and Loans.tsx's inline creator onSuccess (closes
plan-challenger must-fix), 6 new frontend tests across Assets/Insurance/Loans.
Live Docker validation (3 role branches, 3 linked vehicles incl. 1 sold, deterministic
name+id ordering, soldAt round-trip) — all passed, no leftover rows.

Full suite: backend 2341/2341 tests, insuranceService.ts 100% stmts/branch/func/line.
Frontend 869/869 tests, lint clean.

## Pre-existing, out-of-scope issues found during verification (NOT caused by this task
— confirmed via git stash against unmodified main 7077b61):
- Backend global branch coverage gate fails at 99.9% (not 100%) due to
  loanService.ts:457 and subscriptionService.ts:402-403 (`?? fallback` branches with no
  test for the null path). Neither file was touched by this task.
- frontend `npm run typecheck:tests` has pre-existing errors: apiNormalizers.test.ts
  missing `userId` on 4 InsurancePolicy/Loan fixtures (stale since Task B added
  `userId` to the type), and dateFormat.test.ts has a `VitestUtils` type mismatch.
Escalating to user rather than fixing — out of this task's scope, not introduced here.

## Review: quality PASS, compliance COMPLIANT, adversarial RESILIENT. No critical/high/
medium findings. 3 low findings fixed: (1) Insurance.tsx comma-render now binds
`const assets = policy.assets` instead of a `policy.assets!` non-null assertion inside
the map closure; (2) added an explicit comma-separator assertion to the "shows multiple
linked vehicles" test; (3) `startEdit` now excludes `assets` before its blanket
Object.entries→setValue loop (was silently riding along into the PUT body, harmlessly
stripped by Zod, but fragile). 2 findings rejected: per-mutation invalidation spy tests
for update/delete/sell (redundant — `invalidate()` has no branches, one spy test on
create already proves the mechanism, matches existing RealEstate/Gold test convention);
unbounded growth of sold-vehicle entries on a policy's Covers list (explicitly
intentional per the approved plan's VQ3 decision, already tested).
