# Task Progress

## Status: implement (validated live, entering review)

## Task: Auto-link RealEstate to a collateral Asset (no manual duplicate-entry step), plus
add purchaseDate + vehicle subtype to the generic Asset model. Revised after
plan-challenger found: missing delete-path handling, unnecessary $transaction, TOCTOU
guard.

## Steps Completed: analyze, plan, approve, implement, review

## Risk: HIGH (migration alters an existing FK's delete behavior on production data +
new deletion-blocking semantics). task_type: feature.

## Plan:
1. [MED] Migration: `VehicleType` enum (TWO_WHEELER/FOUR_WHEELER/OTHER),
   `Asset.purchaseDate DateTime?`, `Asset.vehicleType VehicleType?`; backfill un-linked
   RealEstate rows into Asset reusing the exact `ast_`+md5(id) scheme + `ON CONFLICT
   ("realEstateId") DO NOTHING` from migration 20260816120000; ALTER
   `Asset_realEstateId_fkey` from `ON DELETE SET NULL` to `ON DELETE CASCADE` (matches
   the existing `RealEstateOwner` precedent), update schema.prisma's `Asset.realEstate`
   relation to `onDelete: Cascade`.
2. [MED] `createRealEstate` (investmentService.ts): nested write, NOT `$transaction`
   (Prisma already atomically supports `asset: { create: {...} } }` alongside the
   existing `owners: { create: [...] }` nested write in the same call). Populates
   assetType=PROPERTY, name=propertyName, value=currentValue, purchaseDate=purchaseDate.
   No P2002 handling needed — realEstateId is always a fresh cuid.
3. [LOW] `assetService.createAsset`: wrap `prisma.asset.create` in try/catch, translate
   P2002 → `AppError.conflict` (matches `categoryRuleService.ts:46-68`'s established
   pattern) instead of a racy pre-check. Covers both realEstateId and goldHoldingId.
4. [MED] `deleteRealEstate` (investmentService.ts): fetch the linked asset, if it secures
   an active loan (`findActiveLoanSecuring`) throw `AppError.conflict` (same message shape
   as `recordRealEstateSale`'s guard) — closes the pre-existing gap noted earlier this
   session where property deletion had no loan-collateral guard. Otherwise delete the
   RealEstate row; the Asset cascade-deletes via the FK from step 1. No orphaned Asset is
   left to silently inflate net worth.
5. [LOW] Loans.tsx: remove the PROPERTY branch of "Already tracked as a property?"
   (sub-select + `linkableProperties` query + the now-dead `newAssetLinkId &&
   assetType === 'PROPERTY'` payload fragment). GOLD's identical, still-correct flow is
   untouched.
6. [LOW] RealEstate.tsx: invalidate `['assets']` on the create-property mutation's
   onSuccess so Loans.tsx's picker reflects the new property immediately.
7. [MED] Backend Zod (`routes/assets.ts`): add optional `purchaseDate`, `vehicleType` to
   `assetSchema` (+ `.partial()` for PUT); `superRefine` requiring `vehicleType` when
   `assetType === 'VEHICLE'` (matches `loans.ts`'s existing assetId-requirement pattern).
   `purchaseDate` stays optional for every type (often approximate/unknown, unlike a
   type pick from a small enum).
8. [LOW] Frontend `Asset` type + Assets.tsx: add both fields to the type, the create/edit
   form (date input all types, vehicleType select gated on VEHICLE, required client-side
   to match the backend), AND the read-only card body (so the fields are visible, not
   write-only — Assets.tsx already shows soldAt/notes/loans as badges/text there).
9. [LOW] Loans.tsx inline asset creator: same two fields in `newAsset` state + conditional
   UI + mutation payload, mirroring Assets.tsx.
10. [MED] Tests: investmentService.unit.test.ts (createRealEstate nested-asset-write
    assertion, deleteRealEstate active-loan-guard + cascade test — no $transaction mock
    needed), assetService P2002-catch test, Loans.test.tsx (delete the now-impossible
    "sends realEstateId" test, add PROPERTY-hides/GOLD-keeps picker test, VEHICLE field
    round-trip), Assets.test.tsx (purchaseDate/vehicleType create+edit+card-display,
    required-vehicleType validation), RealEstate.test.tsx (assets invalidation, delete
    blocked-by-active-loan test).
11. [LOW] Live Docker validation (ZZ_LIVE_ prefixed, try/finally, zero-leftover check):
    create property -> exactly one linked Asset with copied purchaseDate/value -> confirm
    excluded from otherAssets net-worth bucket -> appears in Loans picker with no extra
    step -> attempt delete while securing an active loan (expect 409) -> close loan ->
    delete again (expect cascade removes both rows, zero orphan) -> VEHICLE
    purchaseDate/vehicleType round-trip create+update.

## Pre-Mortem (HIGH risk, orchestrator-authored — plan changed after challenge, bumping
risk beyond the architect's original MEDIUM classification):
1. The CASCADE migration is clean in dev/CI but production has a RealEstate row whose
   linked Asset still secures a loan that predates closedAt tracking and was never
   properly closed — deletion now 409s where it silently succeeded before, confusing a
   user with no clear self-service path to resolve the stale loan.
2. A future GoldHolding auto-link (same pattern, different model) gets built without the
   equivalent delete-cascade fix, reintroducing the identical orphaned-Asset net-worth
   inflation bug for gold — because this fix wasn't captured as a documented pattern.
3. The nested `asset: { create: {...} } }` write hits a Decimal-coercion edge case Prisma
   mocks don't catch at the unit-test level (mocked tests don't validate real Postgres
   type coercion) — only surfaces via live traffic.
Mitigation: step 11's live-Docker validation directly exercises the delete-guard and
cascade path (covers #1's mechanism, not the specific stale-loan-data scenario — flagged
as accepted residual risk, not blocking); #2 is logged to progress.md's tech-debt list
after commit; #3 is why step 11 validates via a real Postgres round-trip, not just mocks.

## Decisions for User (surfaced at APPROVE):
- Sync is create-time only: renaming a property or changing its value later does NOT
  propagate to its linked Asset's name/value (net worth is unaffected either way — it
  reads RealEstate directly, not the Asset copy). Accepted.
- Property deletion now blocks (409) if the property secures an active loan — closes a
  pre-existing gap (this guard never existed before). Confirmed as intended.
- vehicleType becomes required specifically when creating/editing a VEHICLE asset (not
  for PROPERTY/GOLD/OTHER). purchaseDate stays optional for all types. Confirmed.

## Baseline Failures: none — backend 2298/2298, frontend 851/851, all passing.

## Validation Results: Live Docker check passed all 6 assertions (auto-link on create,
no net-worth double-count, appears in collateral picker with no extra step, delete
blocked while ANY loan open-or-closed references the asset, cascade-deletes cleanly once
the loan itself is deleted, VEHICLE purchaseDate/vehicleType round-trip). Zero leftover
ZZ_LIVE_ rows after cleanup. Bug caught and fixed during this step: deleteRealEstate's
first version only checked OPEN loans (findActiveLoanSecuring) but Loan.assetId is ON
DELETE RESTRICT regardless of closedAt — a closed loan still blocks deletion via a raw
P2003 unless the check covers ANY loan. Fixed to match assetService.deleteAsset's
existing "any loan, closed or not" pattern.

## REVIEW round 1 — Quality reviewer FAIL, fixes applied:
- CRITICAL (confirmed live): purchaseDate/vehicleType empty strings from a cleared HTML
  input broke every asset edit + any create without a picked date — vehicleType '' hit a
  raw Zod enum-mismatch 422, purchaseDate '' (or even a valid "YYYY-MM-DD", since Prisma
  needs full ISO-8601) hit an unhandled PrismaClientValidationError -> 500. Fixed with
  optionalDate/optionalVehicleType transforms in routes/assets.ts (same pattern as
  routes/loans.ts's existing optionalDate). Re-verified via a real HTTP-boundary
  supertest run (not just service calls) — 5/5 checks pass, zero leftover rows.
- HIGH: updateAsset had no P2002->conflict translation (createAsset did) — added, shared
  via translateLinkConflict().
- HIGH: Loans.tsx inline PROPERTY creation had no guard against duplicating an
  already-auto-linked property — added an inline hint pointing at the existing picker.
- MEDIUM x4: recordRealEstateSale now mirrors soldAt/salePrice onto the linked Asset
  (so a sold property stops looking like available loan collateral); misplaced JSDoc
  reordered; deleteRealEstate's 409 message reworded to name a real remedy; stale
  vehicleType nulled on a type change away from VEHICLE.
- LOW x2: deleteAsset's stale "ON DELETE SET NULL" comment fixed (actually RESTRICT);
  weak test assertion (checked "bought" text, not the actual date) strengthened.

## REVIEW round 2 — adversarial reviewer findings, applied:
- Fixed: recordGoldHoldingSale now mirrors soldAt/salePrice onto its linked asset too
  (RealEstate got this in round 1, Gold was missed — inconsistency within the same diff).
- Fixed: schema.prisma + frontend api/assets.ts comments on Asset.soldAt were stale
  (said "never duplicated here" — no longer true since the sale-mirroring fix); rewritten.
- Fixed: migration backfill now copies soldAt/salePrice too, so an already-sold property
  backfilled fresh doesn't get an asset that looks available as collateral. Verified zero
  currently-sold RealEstate rows exist, so no retroactive data fix was needed; confirmed
  `prisma migrate status`/`deploy` stay clean after editing the (locally-applied,
  unshared) migration file.
- Fixed: RealEstate.tsx AND Gold.tsx's sell mutations now invalidate ['assets'] too,
  since selling mutates the linked asset row now.
- Fixed (self-caught during this round): my own round-1 fix to Assets.tsx's submit
  handler introduced a regression — stripping purchaseDate to `undefined` when empty
  meant a user could no longer CLEAR a purchase date on edit. Reverted to a plain submit;
  the backend's optionalDate transform already handles '' -> null correctly, so frontend
  stripping was both unnecessary and, as written, actively wrong. New test added
  ("clearing the purchase date on edit actually clears it").
- Fixed: vehicleType normalization was incomplete — only nulled on an explicit type
  CHANGE with a truthy old value; a create with `{assetType:'OTHER', vehicleType:'X'}`
  or an update leaving assetType untouched while the OLD value was already null both
  slipped through. Replaced with unconditional normalizeVehicleType(), applied in both
  createAsset and updateAsset.
- Fixed: added an assertion that the Loans.tsx PROPERTY duplicate-warning hint text
  actually renders (existing test only checked the picker was gone, hint could've been
  silently deleted and the suite stayed green).
- Fixed: deleteAsset's 409 message reworded for consistency with deleteRealEstate's
  (both now name the same real remedy instead of "unlink", which isn't always possible).
- Declined (reasoned, not a regression from this task): a co-owner can CASCADE-delete
  another owner's Asset via deleteRealEstate, since Asset is single-owner-scoped by
  design (assetService's own long-standing comment) while RealEstate write access is
  already shared across co-owners — consistent with existing co-ownership authority, not
  a new privilege this task introduces. Logged as tech debt below, not fixed.
- Declined (pre-existing, out of scope): Assets.tsx's purchaseDate display uses the
  shared `toDateInputValue` util (local Date getters), which is a codebase-wide,
  pre-existing utility used the same way elsewhere in the same file (e.g. sell-date
  default) — not something this task introduced. Negligible practical impact for an
  India-first app (positive UTC offset never shifts the displayed day backward).

Final state: backend 2317/2317, frontend 860/860, both 100% coverage on every file this
task touched, tsc clean both sides, eslint clean. Live-reverified twice more after these
fixes (vehicleType normalization + real create->sell->read round trip for the asset
mirror), zero leftover rows both times.

## Tech debt noted (carried forward + new):
- Asset.value/RealEstate.currentValue can drift. Category delete needs 2 round trips.
- Transaction.isRecurring written, never read. NetWorthSnapshot.creditCards NULL pre-08-17.
- Loan prepayment: 2 bounded non-atomicity/race windows; no edit/delete for a logged
  prepayment (would need a new hard delete).
- Subscription startDate edit: same bounded race class as loan prepayment.
- Loan closedAt: scoped to the prepayment path only — manual balance edits and ordinary
  EMI-linked payments do not set it.
- Asset sales: CapitalGainEntry (tax) remains fully disconnected from a real sale.
  Investment sales share the same underlying gap but were scoped out.
- RealEstate/vehicle autolink (this task): Asset is single-owner-scoped while
  RealEstate/Loan support co-ownership — a co-owner can already fully edit/delete a
  shared RealEstate row, and that delete now cascades to an Asset scoped to a different
  owner. Not a new bypass (RealEstate delete was already unguarded before this task), but
  the ownership-model mismatch is now more visible. Needs a real design decision, not a
  one-line fix.
- Vehicle auto-detection from insurance policies was explicitly declined (sumAssured
  isn't the same as market value; no make/model/registration on a policy to seed from) —
  a "nudge" pattern was proposed as the alternative but not built; revisit only if
  requested again.

## Known Flakes (pre-existing)
- `dashboard.routes.test.ts > returns empty array when no alerts` (backend) — order-dependent
- `Dashboard.test.tsx` (frontend) — `findBy` timeouts under parallel load; passes on re-run
