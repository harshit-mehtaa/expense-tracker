# Task Progress

## Status: implement

## Task: Track more VEHICLE asset detail — registration number, make & model, fuel type,
optional link to an existing InsurancePolicy (VEHICLE type). Revised after
plan-challenger found: fuelType's clear-semantics would make it permanently unclearable,
the insurance picker would leak family members' policies in the admin case, and the
ownership guard's spec couldn't produce the two status codes it promised.

## Steps Completed: analyze, plan

## Risk: MEDIUM. task_type: feature.

## Plan:
1. [MED] Schema: `enum FuelType { PETROL DIESEL ELECTRIC HYBRID CNG OTHER }`. Add to
   `Asset`: `registrationNumber String?`, `make String?`, `model String?` (confirmed a
   legal Prisma scalar field name — Prisma reserves model-BLOCK names, not scalar field
   names), `fuelType FuelType?`, `insurancePolicyId String?` (NOT `@unique` — this is a
   reference FK like `Loan.assetId`, not an identity link like `realEstateId`/
   `goldHoldingId`, since InsurancePolicy never participates in net worth so there's no
   double-count invariant to protect), relation `onDelete: SetNull` (matches
   `goldHoldingId`'s precedent — deleting a lapsed policy must never delete the vehicle,
   unlike `realEstateId`'s CASCADE where the Asset IS the property's own wrapper),
   `@@index([insurancePolicyId])`. Back-relation `assets Asset[]` on `InsurancePolicy`.
2. [MED] Migration: `CREATE TYPE FuelType`, 5x `ALTER TABLE "Asset" ADD COLUMN`, FK
   constraint `ON DELETE SET NULL ON UPDATE CASCADE`, index. No backfill (nothing to
   derive these from).
3. [MED] `assetService.ts`:
   - `assertInsurancePolicyOwned(userId, insurancePolicyId)`: ONE query
     `findFirst({where:{id, userId}, select:{id, policyType}})` (ownership only, no
     policyType in the WHERE) → 404 if not found; THEN a separate in-JS check
     `if (policy.policyType !== 'VEHICLE') throw AppError.badRequest(...)` — two
     distinguishable, independently testable branches (a single combined-WHERE query
     can't tell "not yours" from "not a vehicle policy" apart, and the 400 branch would
     be unreachable, failing the 100% coverage gate).
   - Guard is skipped entirely when the FINAL (post-clear) assetType isn't VEHICLE — a
     stale hidden-form `insurancePolicyId` on a switch-away-from-VEHICLE update must be
     silently nulled, not validated (matches the documented stale-hidden-field contract
     `vehicleType` already follows; RHF keeps unmounted-but-registered field values by
     default).
   - Replace `normalizeVehicleType` with list-driven `clearVehicleOnlyFields(assetType)`
     covering all 6 vehicle-only fields (vehicleType + the 5 new ones): `{}` for VEHICLE,
     all-null otherwise.
   - `assetInclude` gets a minimal `insurancePolicy: {select: {id, policyType,
     providerName, policyName, endDate}}` — explicitly excluding sumAssured,
     premiumAmount, premiumFrequency, nomineeName, agentName, agentContact,
     policyNumber, tax-eligibility flags (financially sensitive, belongs to the
     Insurance page).
4. [MED] `routes/assets.ts` Zod:
   - `optionalFuelType`: union of enum/''/null, optional, transform `'' or null -> null`
     (explicit clear), real value passes through, absent key stays absent on `.partial()`
     (verified: `.partial()` short-circuits on a genuinely-missing key before the
     transform runs, so PUT omitting the field never touches it). NOT cloned from
     `optionalVehicleType` (that maps `'' -> undefined`, which — because the key was
     already present pre-transform — zod keeps as `key: undefined` in the output, so
     Prisma reads "no change" and the field can never be cleared once set; harmless for
     `vehicleType`, a live defect for an optional field like `fuelType`).
   - `optionalLinkId` (same `'' -> null`, real value passes through, absent stays
     absent shape): applied to `insurancePolicyId`, AND retrofitted onto the existing
     `realEstateId`/`goldHoldingId` (today plain `z.string().optional()` — confirmed an
     empty string reaches Prisma as a raw P2003 FK violation → unhandled 500, same bug
     class as the one just fixed for purchaseDate/vehicleType, pre-existing, adjacent,
     in a file this task already touches).
   - `registrationNumber`/`make`/`model`: plain `z.string().max().optional()` — no
     custom transform needed, empty strings are already safe for plain strings
     (confirmed by `notes` coexisting with the date/enum transforms).
5. [LOW] Frontend types: `FuelType` union + `FUEL_TYPES` label map in `api/assets.ts`
   (matching `VEHICLE_TYPES`'s established three-copies-per-enum convention), 5 new
   `Asset` fields, `AssetInsuranceRef` type; add the missing `userId: string` to the
   frontend `InsurancePolicy` type in `api/insurance.ts` (backend already sends it).
6. [MED] `Assets.tsx`: form fields for all 4 new inputs inside the existing
   `watchedAssetType === 'VEHICLE'` block (fuelType NOT required — matches Q4's
   no-backfill reasoning). Insurance picker: **server-side scoped**, NOT a family-wide
   fetch filtered client-side — `insuranceApi.getAll(policyOwnerId ? {targetUserId:
   policyOwnerId} : undefined)` keyed `['insurance', policyOwnerId]`, where
   `policyOwnerId = editingAsset?.userId ?? viewUserId ?? user.id` (needs `useAuth()`
   import — `useMemberSelector()` alone doesn't expose the current user), filtered
   client-side only to `policyType === 'VEHICLE'` (ownership is already guaranteed
   server-side, so no client-side owner filter needed). This closes the real admin
   family-wide leak the architect found, without the client-side-filter approach that
   would have introduced a query-cache collision with Insurance.tsx's own
   `['insurance', viewUserId]` key and shipped other members' sumAssured/policyNumber/
   nomineeName into the browser. `openEdit` repopulates all 5 new fields. Read side:
   fuel badge beside the vehicleType badge, `{make} {model}` line, registration number
   line, insurer line (`{providerName} · {policyName}`, + endDate if present).
7. [MED] `Loans.tsx` inline creator: mirror all 4 fields into `newAsset` state (init,
   conditional spread into `createAssetMutation` payload, reset on success — this
   creator uses plain `useState` + conditional spreads, not RHF, so it has no
   stale-hidden-field problem the way Assets.tsx does). Own insurance query mirroring
   the existing `linkableGold` pattern exactly: `enabled: showNewAsset &&
   newAsset.assetType === 'VEHICLE'`, scoped `viewUserId ? {targetUserId: viewUserId} :
   undefined` to match `createAssetMutation`'s own targetUserId.
8. [LOW] Backend tests: `assetService.test.ts` — add `insurancePolicy: {findFirst:
   vi.fn()}` to the shared prisma mock (every test TypeErrors without it once the guard
   is wired in); ownership 404 vs wrong-policyType 400 as two separate cases; all-6
   fields nulled on non-VEHICLE create/update including the stale-hidden-field case (a
   non-VEHICLE update carrying a stale/dangling `insurancePolicyId` → 200, silently
   nulled, no 404); explicit-null unlink; update the pre-existing exact-object assertion
   that will receive 5 extra nulls. `assets.routes.test.ts` — empty-string/enum
   omit-vs-null cases for the Zod layer (route tests mock prisma, so the FK-empty-string
   → P2003 path is only provable live in step 10, not here — noted, not a gap to close
   at this layer).
9. [LOW] Frontend tests + new MSW `/insurance` handler in BOTH `Assets.test.tsx` AND
   `Loans.test.tsx` (existing tests in both files will fail under `onUnhandledRequest:
   'error'` the moment either page's default `assetType==='VEHICLE'` fires the new
   query without a handler) — picker filters to VEHICLE-type only (ownership already
   server-scoped), read-side display, Loans inline-creator payload shape on VEHICLE vs
   OTHER.
10. [LOW] Live Docker validation via `supertest` against the real Express app (not
    direct service calls): empty-string/enum/FK-empty-string cases through the real
    Zod-validated route AND the real DB (closing the gap step 8's mocked route tests
    can't reach); `pg_constraint` introspection confirming `confdeltype = 'n'` (SET
    NULL) on the new FK, followed by an actual policy delete + asset re-read proving
    the link clears without deleting the vehicle; cross-member negative (another user's
    policy id → 404, no policy fields leaked); existing VEHICLE asset with
    `fuelType = NULL` saved unchanged → 200, not 422 (the exact regression Q4 exists to
    prevent). `try/finally`, zero-leftover `ZZ_LIVE_` row count assertion.
11. [LOW] `Insurance.tsx`'s delete-policy mutation currently invalidates only
    `['insurance']` — after this task, a delete can also SET NULL a linked asset's
    `insurancePolicyId`, so the Assets page would keep showing the insurer name until an
    unrelated refetch. Add `qc.invalidateQueries({queryKey: ['assets']})` there too
    (same pattern already used when RealEstate/Gold sales mutate a linked asset).

## Verification Question Mapping
| # | Question | Step(s) |
|---|---|---|
| VQ1 | Both surfaces collect+display all 4 fields | 6, 7, 9 |
| VQ2 | insurancePolicyId ownership validated, no cross-member leak | 3, 6, 8, 10 |
| VQ3 | assetInclude selects only minimal safe policy fields | 3 |
| VQ4 | New Zod fields empty-string-safe (no regression of the just-fixed bug class) | 4, 8, 10 |
| VQ5 | Deleting a linked policy SET NULLs the link, verified against the real FK | 2, 10 |

## Decisions for User (surfaced at APPROVE):
- FuelType values: PETROL/DIESEL/ELECTRIC/HYBRID/CNG/OTHER (6, recommended — OTHER
  absorbs LPG and anything else, matching every sibling enum's shape) vs adding LPG as
  a 7th explicit value (LPG conversions are common enough in India that OTHER might lose
  a signal worth having — cheap now, a two-migration dance later since Postgres can't
  ADD VALUE and use it in the same transaction).
- Declined (from plan-challenger's "should fix" list, not re-litigating): sharing a
  single field-list constant between routes/assets.ts's Zod schema and assetService.ts's
  clearVehicleOnlyFields — the codebase already has this exact duplication for the
  single existing vehicleType-required rule (assertVehicleTypeRequired is exported but
  unused by the route, which re-implements the check itself), so extending the existing
  duplication to 6 fields matches established practice rather than introducing new
  cross-layer coupling for a list unlikely to change often. Will add a code comment
  cross-referencing both lists so they visibly need to move together.

## Baseline Failures: none — backend 2317/2317, frontend 860/860, all passing.

## REVIEW — Tier 2 (quality strong + adversarial balanced, parallel):
Quality: FAIL -> fixes applied. Adversarial: DESTROYED -> fixes applied. Both re-verified
live. Real bugs caught and fixed:
- CRITICAL: Loans.tsx's insurance query filtered to VEHICLE type INSIDE queryFn under
  the same cache key ['insurance', viewUserId] Insurance.tsx uses for the full list —
  would have shown only vehicle policies (wrong premium totals) on the Insurance page
  for up to 5 min after opening the Loans inline creator. Fixed: filter moved to a
  derived value after the query (Assets.tsx already did this correctly — only Loans.tsx
  had the bug).
- HIGH: insurancePolicyId picker in Assets.tsx was an uncontrolled <select> fed by an
  async query — editing an already-linked vehicle could paint "Not linked" even though
  the link was intact (options arrive after RHF's reset already ran). Fixed: made
  controlled via watch/setValue. Verified the regression test genuinely catches it
  (reverted the fix, confirmed the test fails; restored, confirmed it passes).
- HIGH/MEDIUM: the "linked policy must be VEHICLE type" invariant was enforced only at
  link time — updateInsurancePolicy let a linked policy's type change to HEALTH etc.
  with no guard, silently breaking the invariant. Fixed: mirrors deleteAsset's loan-guard
  shape (409 if type changes away from VEHICLE while assets still link to it).
- MEDIUM: Insurance.tsx's updateMutation didn't invalidate ['assets'] (only delete did) —
  editing a linked policy's name/provider left the Assets page showing stale text.
  Consolidated into invalidateInsurance().
- MEDIUM (P1 sentinel integrity): registrationNumber/make/model stored '' when cleared
  on a VEHICLE but NULL when cleared server-side by a type switch — two representations
  of "not set" in the same columns. Fixed with a shared optionalText transform ('' ->
  null, trims).
- LOW: added isError-driven visible degraded states to both insurance pickers (was:
  silent empty picker on fetch failure); added `?? user?.id` fallback to Loans.tsx's
  insurance query to match Assets.tsx's defense against an ADMIN family-wide unscoped
  fetch (currently unreachable via UI, but shouldn't depend on that).
Declined (reasoned): frontend InsurancePolicy.userId type field is unused today but
accurately types real API response data, not fabricated — kept. The nested Asset-create
in investmentService.ts (prior task) bypasses clearVehicleOnlyFields, but is safe today
(hardcodes assetType=PROPERTY, sets no vehicle fields) — pre-existing structural note,
not this task's to fix.
Final: backend 2339/2339, frontend 863/863, both 100% coverage on every touched file,
tsc/eslint clean both sides. Live-reverified twice more (optionalText trim/null
behavior + the policyType-change guard), zero leftover rows both times.

## Tech debt noted (new):
- VEHICLE_ONLY_FIELDS (assetService.ts) and the Zod field list (routes/assets.ts) are
  two hand-maintained lists that must stay in sync — currently fine at 6 fields
  (verified in sync by two independent reviewers), but extract a shared constant the
  first time they drift, or once a 7th/8th vehicle-only field is added.
- The Asset model now carries 10+ optional columns, most meaningful for only one
  assetType. Columns (not a JSON blob) remain correct — a JSON metadata field would
  lose the FuelType enum's DB-level domain and, critically, insurancePolicyId's real FK
  with ON DELETE SET NULL. If a 5th type-specific field group appears, consider a 1:1
  satellite table (e.g. VehicleDetail) instead of a 6th/7th nullable column.
- investmentService.ts's nested Asset-create (from the real-estate autolink task) writes
  directly via Prisma, bypassing assetService's clearVehicleOnlyFields — safe today
  (hardcodes assetType=PROPERTY), but the 6-field vehicle-only invariant now lives in
  only one of two Asset-creating code paths.
