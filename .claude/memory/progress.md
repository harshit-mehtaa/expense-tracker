# Task Progress

## Status: analyze

## Task: Add a vehicle picker to the Insurance page's add/edit form for VEHICLE-type
policies — pick existing vehicle asset(s) to link (or none), mirroring the Assets
page's existing insurance picker but writing from the other direction. Currently the
only way to link a vehicle to its policy is from the Assets page, requiring the
vehicle to already exist as an asset first; this closes that gap.

## Steps Completed: analyze, plan, approve, implement

## Implementation Summary:
All 9 plan steps done (Step 10 dropped per plan-challenger, folded into Step 8).
Insurance.tsx: candidate-vehicle query (assetOwnerId scoping), checkbox-list picker
gated on policyType==='VEHICLE' with "currently linked to X" hint, onSubmit rewritten
as a single try/catch/finally async orchestration (Promise.allSettled for both unlink
and link phases, branch-scoped hard-gate only when leaving VEHICLE, single
invalidation/form-close at the very end). Added id/htmlFor to 6 form fields
(policyType, policyNumber, policyName, sumAssured, premiumAmount, startDate) needed
for reliable test targeting — this form had no accessible-label wiring before.

Two real pre-existing bugs found and fixed while implementing/testing (both
previously unreachable — no prior test ever fully submitted this form):
1. `premiumDueDate: z.coerce.number().int().min(1).max(31).optional()` coerced an
   empty string to 0 BEFORE `.optional()` could skip it, so leaving this genuinely-
   optional field blank silently failed validation with NO visible error message —
   blocked every Add/Update Policy submission that didn't fill it in. Fixed with a
   `z.preprocess('' | null -> undefined)` wrapper.
2. (Test-fixture-only, not a code bug) the pre-existing `POLICY` test fixture used a
   stale field name `insurer` instead of `providerName` — never caught before because
   no prior test fully submitted an edit form using it.

14 new tests added (13 vehicle-picker + 1 covers/comma-render already existed from
prior task's review fixes). Full suite: frontend 882/882 tests (869 baseline + 13
new), lint clean, tsc --noEmit clean (backend untouched — this is a frontend-only
task per DQ6, confirmed no backend files changed).

## Steps Completed: analyze, plan, approve, implement, review

## Review: quality PASS_WITH_NOTES (strong tier, diff >100 lines), adversarial
BRUISED (2 high-severity findings). Both reviewers independently found the
premiumDueDate clear-value bug — high-confidence, fixed. Co-Founder Filter:

ACCEPTED (fixed):
1. [HIGH, both reviewers] premiumDueDate silently lost an explicit clear — the
   frontend preprocess mapped '' to `undefined`, which JSON.stringify drops, so a
   `.partial()` PUT read the key as "not sent" and left the stale value in the DB
   with no error. Fixed end-to-end: frontend now preprocesses '' to explicit `null`;
   backend's `premiumDueDate` schema (routes/insurance.ts) now accepts `.nullable()`.
   Added a backend route test + a frontend test + live Docker validation (create
   with premiumDueDate=15, explicit-null clear, omitted-key no-op preservation,
   out-of-range still 422 — all passed against the real running backend).
2. [HIGH, adversarial] Cancel-during-submit race: Cancel had no `disabled={isSaving}`
   guard, so canceling mid-submission then opening a NEW form let the stale
   submission's end-of-flow (setShowForm(false) etc.) later close/reset that new,
   unrelated session. Fixed by disabling Cancel while isSaving — the modal backdrop
   already blocks all other UI, so this fully closes the race (no other way to open
   a second session while one is in flight).
3. [MED, quality] Cache invalidation was inconsistent on partial-failure paths (a
   failed policy mutation after successful unlinks invalidated nothing). Fixed by
   moving invalidateInsurance() into `finally`, unconditional.
4. [LOW, quality] Sold vehicles weren't excluded from new candidates (inconsistent
   with Loans.tsx's own asset picker). Fixed — hidden from new selection, but an
   already-linked sold vehicle stays visible/unlinkable.
5. [LOW, quality] Test flake risk: an ordering assertion didn't wait for both
   concurrent link PUTs first. Fixed.
6. [MED, quality] Missing tests for the two behaviors this diff actually moved:
   modal closes after success, modal stays open + error toast + submit re-enabled
   after the policy mutation itself fails. Added both.

ACCEPTED_DEFERRED (valid, logged as tech debt, not fixed now):
7. [MED, quality] Dual source of truth for link state: `selectedVehicleIds` seeds
   from `editing.assets` (the insurance query's snapshot) while the "currently
   linked to X" hint reads the fresher assets query. A vehicle linked from another
   tab/session could show as unchecked-but-actually-linked until the cache
   naturally refreshes. Self-heals within one SPA session (React Query
   invalidation already covers the common path); a full fix needs a reconciling
   effect once the assets query resolves — deferred as disproportionate to a rare
   edge case.
8. [LOW, quality] Same `''`-coerces-to-0-before-.optional() pattern exists,
   unfixed, in RealEstate.tsx:48, Accounts.tsx:124, TaxCentre.tsx (12 fields) —
   different files, out of this task's scope, flagged for a dedicated cleanup task.
9. [LOW, quality] `isSaving` duplicates RHF's `formState.isSubmitting`, which
   already tracks an async onValid callback. Valid simplification, deferred to
   avoid further churn on an already-substantial diff.
10. [LOW, quality] Toast messages show only a failure count, not the underlying
    error reason, for partial unlink/link failures. Minor UX polish, deferred.
11. [LOW, quality] The bare `catch {}` is correct today (only mutateAsync can throw)
    but fragile if a future edit adds another awaited call inside the try. Already
    has an explanatory comment; deferred.

REJECTED (false positive or already mitigated):
12. [LOW, adversarial] Rapid double-click on submit — already covered by the
    existing `disabled={isSaving}` on the submit button, consistent with every
    other mutation-button pattern in this codebase (none have a dedicated
    double-click test).
13. [LOW-MED, adversarial] Toggling a checkbox mid-submit has no visible effect —
    moot once Cancel is disabled during isSaving; the user can't lose or corrupt
    anything, only defer their new selection to the next submit attempt.
14. Nitpicks (no `role="group"` on the checkbox list, O(n²) includes() in map,
    expect() inside MSW resolvers relying on failOnConsoleError) — all match
    existing codebase convention or are irrelevant at real scale; no action.

## Question Resolution
| # | Question | Status | Evidence |
|---|---|---|---|
| DQ1-DQ7 | (see Design Question Answers above) | RESOLVED | Independently re-verified by both the architect and both reviewers against fresh code reads; DQ6 (no backend changes) was later revised — see below |
| DQ6 (revised) | No backend changes needed | PARTIALLY REVISED | True for the vehicle-picker feature itself; the premiumDueDate fix required one small, well-precedented backend schema change (routes/insurance.ts), discovered during implementation/review, not part of the original feature scope |
| VQ1 | Uses existing validated PUT, no new backend path (vehicle linking) | RESOLVED | Confirmed by both reviewers reading assetService.ts fresh |
| VQ2 | Edit pre-selects, create starts empty | RESOLVED | Insurance.test.tsx: 2 tests |
| VQ3 | Unlink before policy PUT when leaving VEHICLE | RESOLVED | Insurance.test.tsx: ordering test + both reviewers traced the code |
| VQ4 | Owner-scoped picker, no sensitive fields | RESOLVED | Insurance.test.tsx: admin-scoping test; both reviewers confirmed no cross-member leak is structurally possible |
| VQ5 | Partial-failure surfaces clearly | RESOLVED | 3 tests (leaving-VEHICLE abort, staying-VEHICLE warn-and-continue, partial link failure) |
| VQ6 | Cache invalidation fires correctly | RESOLVED (fixed during review — was previously incomplete on failure paths) | Moved to `finally`, unconditional |
| VQ7 | Reassigning an already-linked vehicle is surfaced | RESOLVED | Insurance.test.tsx: hint test |
| EQ1 (review-phase) | premiumDueDate explicit-clear semantics | RESOLVED (was BROKEN, fixed) | Backend route test + frontend test + live Docker validation |
| EQ2 (review-phase) | Cancel-during-submit race | RESOLVED (was BROKEN, fixed) | `disabled={isSaving}` on Cancel; traced by adversarial reviewer, fix verified by re-running the full test suite |

## Final verification after fixes: frontend 886/886 tests (882 + 4 new: modal-closes,
modal-stays-open-on-failure, sold-vehicle-filter, premiumDueDate-explicit-null), lint
clean, tsc --noEmit clean. Backend 2342/2342 tests (2341 + 1 new route test),
insurance.ts and routes/insurance.ts both 100% coverage, tsc --noEmit clean. Same
pre-existing, unrelated coverage gap in loanService.ts/subscriptionService.ts
(confirmed unchanged, not introduced by this task). Live Docker validation of the
premiumDueDate fix passed all 4 checks against the real backend.

## Design Questions:
DQ1: What backend write path sets Asset.insurancePolicyId, and does it already
validate ownership + policy type with no new backend code needed?
Evidence: assetService.ts:81-90 `assertInsurancePolicyOwned` (called from
updateAsset:167-169 only when nextAssetType==='VEHICLE' and 'insurancePolicyId' in
data) checks `policy.userId === asset.userId` AND `policy.policyType === 'VEHICLE'`
(404/400). routes/assets.ts:90 `insurancePolicyId: optionalLinkId` ('' -> null)
already accepts this field on PUT /api/assets/:id. No backend changes are required —
the frontend can call the EXISTING `assetsApi.update(vehicleId, {insurancePolicyId})`
per vehicle, exactly as Assets.tsx already does from the Asset side.

DQ2: With no bulk-link endpoint, how should a multi-vehicle selection persist — N
client-side PUTs, or a new backend endpoint?
Evidence: no "reconcile a set of children" endpoint exists anywhere (grepped
routes/); Loans.tsx's `owners` array is a field INSIDE one PUT /api/loans/:id body
(ownerShares.ts reconciles server-side) — a different shape (loan owns the array;
here Asset owns the scalar FK). Given realistic N (a handful of vehicles per policy),
N parallel client-side `assetsApi.update()` calls mirrors Loans.tsx's inline-creator
precedent (plain mutations, no saga/rollback) and avoids duplicating
assertInsurancePolicyOwned's validation server-side for no behavioral gain.

DQ3: What submit ORDER avoids the existing 409 guard when a user deselects vehicles
AND changes policyType away from VEHICLE in the same edit?
Evidence: insuranceService.ts:107-117 `updateInsurancePolicy`'s guard reads
`policy.assets.length` from a FRESH DB query at request time (not from the request
body) and 409s if `nextPolicyType !== 'VEHICLE' && policy.assets.length > 0`. If
vehicle unlinks happen AFTER the policy PUT, the guard still sees the OLD linked
count and blocks a coherent user action. Unlinks for a policyType-away-from-VEHICLE
edit must happen BEFORE the policy PUT; reconciliation for a policy STAYING VEHICLE
can safely happen after (order doesn't matter there).

DQ4: What UI widget fits the multi-select, given no direct precedent in this
codebase?
Evidence: every `type="checkbox"` in `pages/` (Transactions, Loans, ScheduleCG/HP,
Accounts, Investments) is a single standalone boolean toggle, not a repeated list.
Loans.tsx's `owners` `useFieldArray` is the closest "select multiple" pattern but
each row carries its OWN sub-fields (userId + sharePercent) — heavier machinery than
needed for a pure set-membership toggle. A checkbox-per-candidate-vehicle list reuses
the existing checkbox styling convention directly.

DQ5: How should the candidate-vehicle list be scoped/fetched to avoid the two
established bug classes from the prior two tasks (cross-user leak; shared-cache-key
poisoning)?
Evidence: Assets.tsx:75-93 already solved the mirror-image problem: `policyOwnerId =
editingAsset?.userId ?? viewUserId ?? user?.id`, server-side-scoped fetch, VEHICLE-
filtered AFTER the query (not inside queryFn), `enabled: showForm &&
watchedAssetType === 'VEHICLE'`. The reverse should mirror exactly: `vehicleOwnerId =
editing?.userId ?? viewUserId ?? user?.id`, `assetsApi.getAll(vehicleOwnerId)` (note:
positional string arg, NOT an options object — different signature from
insuranceApi.getAll — api/assets.ts:94), filter `assetType === 'VEHICLE'` after the
query, cache key `['assets', vehicleOwnerId]` (SAME key Assets.tsx's own list uses,
safe to share since both fetch the identical unfiltered payload).

DQ6: Does this task need any backend changes at all?
Evidence: given DQ1 (existing endpoint already validates) and DQ3 (ordering handles
the only real conflict client-side), the answer is no — this is a frontend-only task.

DQ7: Should a vehicle already linked to a DIFFERENT VEHICLE policy be selectable, and
if so how is that surfaced?
Evidence: `Asset.insurancePolicyId` is a single scalar FK (not many-to-many, per
Task B's schema) — selecting an already-linked-elsewhere vehicle and saving will
silently reassign it via the same PUT. The picker should show which policy (if any)
a candidate is currently linked to, so a re-assignment is visible, not silent.

## Verification Questions:
VQ1: Does linking/unlinking call the existing, already-validated PUT /api/assets/:id
per vehicle, with no new/duplicated backend validation path?
VQ2: Does editing a VEHICLE policy pre-select its currently-linked vehicles (from
`policy.assets`), and does creating a new VEHICLE policy start with none selected?
VQ3: Does switching a policy's type AWAY from VEHICLE while vehicles are selected
unlink them BEFORE the policy PUT (not after), avoiding the 409 guard?
VQ4: Is the picker correctly owner-scoped (ADMIN family-wide edit of another
member's policy shows THAT member's vehicles) and does it exclude
financially-sensitive asset fields it doesn't need?
VQ5: Does a failure partway through a multi-vehicle reconciliation surface a clear
error rather than silently leaving a partial state?
VQ6: Do ['assets']/['insurance'] cache invalidations correctly fire from these new
mutations too, matching the established invalidation-symmetry rule?
VQ7: Does re-selecting a vehicle already linked to a different policy correctly
reassign it, and is that surfaced to the user rather than silent?

## Design Question Answers (architect, verified independently against fresh reads):
DQ1: PUT /api/assets/:id -> assetService.updateAsset already validates ownership +
policy type for insurancePolicyId (assertInsurancePolicyOwned, assetService.ts:81-90,
called at :167-169). No new backend code needed.
DQ2: N sequential (not parallel) client-side `assetsApi.update()` PUTs — no bulk
endpoint exists, sequential chosen so a failure is attributable to a specific vehicle.
DQ3: Unlink deselected vehicles FIRST (awaited), then the policy PUT, then link newly-
selected vehicles — because insuranceService.ts's 409 guard reads policy.assets fresh
from the DB, blind to client intent, so unlinking after the policy PUT would still see
stale linked-asset count and false-409 a coherent user action.
DQ4: Checkbox list (local `selectedVehicleIds: string[]` state, NOT an RHF field) —
matches existing labelled-checkbox idiom (80C/80D/isForParents), no native
`<select multiple>` precedent anywhere in the codebase.
DQ5: `assetOwnerId = editing?.userId ?? viewUserId ?? user?.id`, query key
`['assets', assetOwnerId]`, filter `assetType === 'VEHICLE'` AFTER the query, never
inside queryFn. **Correction per plan-challenger**: this key does NOT literally share
a cache entry with Assets.tsx's own list query (`['assets', viewUserId]` — no
`editing?.userId` fallback there, since Assets.tsx never edits a different owner's
item within one session the way this cross-page picker does). It's a separate,
correctly-scoped entry that happens to return an identical payload for the common
case and is correctly swept by `invalidateQueries({queryKey:['assets']})`'s prefix
match — duplicated, not shared, but harmless. The owner-scoping logic itself (verified
against createMutation's own `viewUserId ? {targetUserId} : undefined` semantics) is
necessary, not optional: family-wide create defaults to self, not "all family."
DQ6: No backend changes required — frontend-only task.
DQ7: Yes selectable (insurancePolicyId has no @unique constraint) — show a "currently
linked to X" inline hint so reassignment is visible, not silent.

## Plan:
1. [LOW] Add scoped candidate-vehicle query: `useAuth` import, `assetOwnerId =
   editing?.userId ?? viewUserId ?? user?.id`, `useQuery({queryKey:['assets',
   assetOwnerId], queryFn: () => assetsApi.getAll(assetOwnerId), enabled: showForm &&
   watchedPolicyType==='VEHICLE'})`, derive `candidateVehicles` filtered to VEHICLE
   type AFTER the query.
2. [LOW] Add `watchedPolicyType = watch('policyType')` and local
   `selectedVehicleIds: string[]` state (not an RHF field).
3. [LOW] Seed/reset `selectedVehicleIds`: `startEdit` seeds from
   `policy.assets?.map(a=>a.id) ?? []`; Add-Policy click and Cancel both reset to `[]`.
4. [MED] Render the checkbox-list picker gated on `watchedPolicyType==='VEHICLE'`:
   labelled checkbox per candidate vehicle, registrationNumber inline, "currently
   linked to {v.insurancePolicy.providerName} · {v.insurancePolicy.policyName}" hint
   (not the bare id, per plan-challenger nice_to_fix) when `v.insurancePolicyId &&
   v.insurancePolicyId !== editing?.id`, `isAssetsError` fallback text, empty-state
   hint when zero candidates.
5. [MED] **REVISED after plan-challenger.** Rewrite `onSubmit` as a single try/catch/
   finally async orchestration (moving `invalidateInsurance()`/`setShowForm(false)`/
   `setEditing(null)`/`reset()` OUT of createMutation's/updateMutation's `onSuccess`
   and into onSubmit's own end-of-flow, since nothing else calls these mutations):
   - Snapshot `originalVehicleIds = editing?.assets?.map(a=>a.id) ?? []` fresh at the
     top (guarantees CREATE can never produce a toUnlink entry); `targetVehicleIds =
     data.policyType==='VEHICLE' ? selectedVehicleIds : []`; diff toUnlink/toLink.
   - Phase 1 (unlink): `Promise.allSettled` over all toUnlink PUTs
     (`insurancePolicyId: ''`) — always attempts every one, never early-aborts.
     Hard-gate the policy mutation on all-succeeded ONLY when `data.policyType !==
     'VEHICLE'` (the only branch where insuranceService's 409 guard can fire) — toast
     naming the failure count and `return` without calling the policy mutation. When
     staying VEHICLE, unlink failures are toasted but do NOT block the policy save
     (ordering doesn't matter there — the guard can't trigger).
   - Phase 2: `await` `updateMutation.mutateAsync(...)` or
     `createMutation.mutateAsync(...)` to get the saved policy id.
   - Phase 3 (link): `Promise.allSettled` over all toLink PUTs
     (`insurancePolicyId: savedPolicy.id`); toast a partial-failure count if any
     rejected.
   - On success of all phases: single `invalidateInsurance()` call, close the form,
     reset RHF state and `selectedVehicleIds`.
   - Whole body wrapped in try/catch (mutateAsync rejects even with onError defined at
     the useMutation level — RHF's handleSubmit does not catch a rejected onValid
     callback) — catch toasts a generic failure message; `finally` clears `isSaving`.
   This resolves both must_fix findings (partial-unlink visibility via allSettled +
   explicit toast; unhandled-rejection risk via the wrapping try/catch) and 3 of 5
   should_fix findings (Promise.allSettled adopted, matching Transactions.tsx's
   existing bulk-mutation convention; originalVehicleIds guaranteed fresh; unlink
   failures no longer block unrelated edits when staying VEHICLE). Side effect: the
   modal now stays open/disabled for the FULL reconciliation, not just the policy PUT,
   so `isSaving` (step 6) is now meaningful, and there's only one invalidation instead
   of two (no more UI flash between phases).
6. [LOW] Add local `isSaving` state gating the Submit button, set at the top of
   `onSubmit`'s try, cleared in `finally` — now meaningful since the modal stays open
   through the full reconciliation (see Step 5's revision).
7. [LOW] Add `onError` toast to `createMutation` (currently has none, unlike
   `updateMutation`) — belt-and-suspenders alongside onSubmit's own try/catch.
8. [MED] Extend `Insurance.test.tsx` per the Cases Matrix below — the async
   orchestration has no existing test shape to copy; must assert PUT *order* (unlink
   phase resolves before the policy PUT fires; policy PUT resolves before the link
   phase fires) and per-vehicle request bodies, not just final state. Folds in the
   dropped Step 10's intent as an MSW-based assertion instead of a Docker check (see
   below).
9. [LOW] `npm run lint`, `npx tsc --noEmit`, full frontend test suite (incl.
   `Assets.test.tsx`, which shares the touched cache keys).

**Step 10 DROPPED per plan-challenger should_fix**: the proposed Docker check (two
rapid sequential PUTs on the same row) doesn't exercise anything this design actually
does — a vehicle is never in both toUnlink and toLink within one submit, so no asset
row is ever PUT twice in the same flow. Its intent (proving request ORDER, not just
final state) is better served by Step 8's MSW-based assertions, which can actually
inspect request order/bodies directly.

## Verification Question Mapping
| # | Question | Step(s) |
|---|---|---|
| VQ1 | Uses existing validated PUT, no new backend path | 5, 8 |
| VQ2 | Edit pre-selects, create starts empty | 3 |
| VQ3 | Unlink before policy PUT when leaving VEHICLE (hard gate only in that branch) | 5 |
| VQ4 | Owner-scoped picker, no sensitive fields | 1, 4 |
| VQ5 | Partial-failure surfaces clearly (per-vehicle, via allSettled), no silent partial state | 5, 6, 7 |
| VQ6 | Cache invalidation fires from new mutations (once, at end of orchestration) | 5 |
| VQ7 | Reassigning an already-linked vehicle is surfaced | 4 |

## Cases Matrix (abbreviated — full detail in architect's original output):
Happy: create+2 vehicles selected; edit+add one; edit+deselect one (stay VEHICLE);
open edit pre-checks existing links.
Sad: policyType VEHICLE->HEALTH with links still selected (must unlink first, no 409);
unlink PUT fails mid-loop (abort, toast, no policy write); link PUT fails for 1 of 2
after policy saved (toast partial-failure count); candidate fetch fails (fallback text).
Edge: zero candidate vehicles (empty-state hint); vehicle already linked elsewhere
(hint shown, reassign still works); ADMIN editing a specific member from family-wide
view (scoped via editing.userId, not viewUserId); toggle policyType back and forth
before submit (selection persists, only submit-time target forced empty); create then
immediately switch away from VEHICLE before selecting anything (zero asset PUTs).
**New per plan-challenger**: staying-VEHICLE edit where an unlink PUT fails — policy
PUT still proceeds (ordering doesn't matter in this branch), failure is toasted but
doesn't block the unrelated field edits; unlink loop with 2+ entries where the FIRST
succeeds and the SECOND fails — assert both were attempted (Promise.allSettled, not
early-abort) and the toast/assertions reflect exactly which one(s) failed.

## Decisions for User (surfaced at APPROVE):
- Sequential (not parallel) PUTs for multi-vehicle reconciliation — marginally slower
  for 3+ vehicles at once, imperceptible at this app's scale, chosen so a partial
  failure is attributable to a specific vehicle. Recommended as-is.
- Checkbox list will NOT show "Sold" status inline (architect flagged as optional
  polish, not required for correctness — backend doesn't block linking a sold
  vehicle). Recommended to skip for this task; can add later if wanted.

## Task Classification: risk_level MEDIUM, task_type feature.

## Plan-Challenger: verdict NEEDS_WORK on first pass. 6/7 design questions confirmed
correct; DQ5's cache-key "sharing" claim was factually imprecise (corrected above,
behavior was already right). 2 must_fix (partial-unlink-state invisibility;
unhandled-promise-rejection risk) and 5 should_fix findings, all concentrated in
Step 5 — resolved by rewriting Step 5 to use Promise.allSettled for both unlink/link
phases (always attempts every item, never early-aborts), a branch-scoped hard-gate
(only blocks the policy PUT when actually leaving VEHICLE, where the 409 guard can
fire), a single try/catch/finally wrapping the whole orchestration, and moving
form-closing side effects out of the mutations' onSuccess into onSubmit's own
end-of-flow. Step 10 (Docker check) dropped as testing nothing this design does;
folded into Step 8's MSW-based order assertions instead. Not re-challenged after
revision — the fixes are mechanical implementations of the reviewer's own concrete
suggestions, not new design decisions.

## Strategic Concerns (from architect):
- A dedicated backend bulk-link endpoint would be premature at this app's scale (a
  family's handful of vehicles) — frontend-only sequential-PUT reconciliation is the
  right call today; revisit only if this grows to needing atomic all-or-nothing linking.
- `onSubmit` is becoming an orchestration layer that doesn't fully fit React Query's
  single-mutation model — flagged as the 2nd/3rd such case in this codebase's history;
  if a 4th multi-step-reconciliation feature appears, consider extracting a shared
  `reconcileLinks(current[], target[], link, unlink)` helper rather than copy-pasting
  a third time. Not building it now for a single caller.

## Baseline Failures: none — frontend 869/869 passing. Task is frontend-only (DQ6), no
backend baseline run needed.

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
