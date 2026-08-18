# Task Progress

## Status: implement
## Task: How do we track sale of assets (real estate, vehicle, etc.)?
## Started: 2026-08-18
## Baseline Failures: 0 (backend 2272/2272, frontend 834/834)
## Validation Results: Live-verified against running stack across all three asset types —
vehicle (generic Asset), gold, and real estate. Confirmed: net worth moves correctly on
both create and sell, purchase history fully preserved on every sale, loan-collateral
guard blocks a mortgaged property and correctly unblocks once the loan is closed
(reused Loan.closedAt from the prior session task). Cleaned up, zero leftover rows.
Backend 2298/2298 (26 new), frontend 850/850 (16 new), both tsc clean, lint clean.
## Steps Completed: analyze, plan, approve, implement

## Design Questions

**DQ1. How is "an asset was sold" represented today, across every asset-holding model?**
Nowhere. `Asset`, `RealEstate`, `GoldHolding`, `Investment` all have zero sale-related
fields (no `soldAt`, `salePrice`, `isActive`) — confirmed by re-reading all four models
in full. The only mechanism that exists is `delete{Asset,RealEstate,GoldHolding,
Investment}` (`assetService.ts:85`, `investmentService.ts:765,573,257`) — every one a
raw `prisma.X.delete()`. Deleting IS today's only way to remove a "sold" item from net
worth, and it destroys the entire record — purchase price, purchase date, location,
everything — with nothing left to say a sale ever happened, for how much, or when.
`vision.md`'s "8 existing hard deletes (don't add more)" almost certainly includes these.

**DQ2. Is there even a UI path to "sell" something today?**
Inconsistent, and for the thing the user asked about first, it's WORSE than delete —
it's nothing. `RealEstate.tsx` has NO delete action wired up anywhere in the frontend
(the backend route `DELETE /investments/real-estate/:id` exists and works, but nothing
calls it) — there is currently no way through the UI to remove a property record at all,
sold or otherwise. `Gold.tsx` DOES wire up `investmentsApi.deleteGold` — a gold holding
can be destructively deleted today. Generic `Asset` (what a VEHICLE or any unsecured
"OTHER" item is) has no dedicated management page anywhere — `grep -rln "assetsApi"
src/pages` returns only `Loans.tsx`, where it's created solely as loan collateral. An
unsecured vehicle you just want to track — no loan against it — cannot currently be
created through the UI at all.

**DQ3. Does a generic `Asset` even carry enough data to represent a sale (a gain/loss)?**
No, and this is a real, separate gap. `Asset` has `value` only — no `purchaseDate`, no
`purchasePrice`. A depreciating vehicle's "value" is presumably user-updated over time
(no update-value flow exists either, unlike `GoldHolding.currentPricePerGram`, which the
model comment says is "User-updated in Settings"). Recording a vehicle's sale can
therefore only ever mean "sold on X for Y" — never a computed gain/loss — unless
`Asset` first gains a cost-basis field, which is its own, separate schema question.

**DQ4. Does the app already have a concept that's basically "an asset was sold," just
disconnected?**
Yes — `CapitalGainEntry` (schema.prisma), created via `capitalGainsService.ts` for tax
reporting. Its `assetType` enum (`CapitalGainAssetType`) already includes `PROPERTY` and
`GOLD`. But `assetName` is free text, not a foreign key — there is no `realEstateId` or
`goldHoldingId` on this table, only `investmentId` (optional). So a property sale
recorded for tax purposes today is entirely disconnected from the `RealEstate` row that
tracked that same property's value in net worth for years; nothing links them, and
nothing tells the `RealEstate` row it should stop counting. Two completely separate,
uncoordinated actions are required to record one real event.

**DQ5. What happens today if a property secures an ACTIVE loan and gets deleted?**
A real, currently-exploitable data-loss bug, found while tracing this: `Asset.
realEstateId` is `ON DELETE SET NULL` (`migration 20260816120000`), while `Loan.assetId`
is `ON DELETE RESTRICT` with an application-level guard in `deleteAsset`
(`assetService.ts:93-97`, blocks deletion if `asset.loans.length > 0`). But
`deleteRealEstate` (`investmentService.ts:765`) has NO equivalent check — deleting a
RealEstate row that a secured home loan's Asset points to is NOT blocked; the Asset
survives (SET NULL silently detaches it), the loan keeps referencing that now-bare Asset
shell, and the property's entire purchase history, location and detail are destroyed
with zero warning. Directly relevant here: a non-destructive "mark as sold" flow that
checks for an active linked loan is the right fix for both problems at once.

**DQ6. What SHOULD selling a mortgaged property do to the loan?**
Should at minimum warn, likely block outright until the loan is closed — proceeds from
selling a house are how a mortgage typically gets paid off, but the ORDER matters
(closing the loan, e.g. via `recordLoanPrepayment` from this session's earlier work,
should happen with real money BEFORE or exactly alongside the sale being recorded, not
be silently ignored). `RealEstate.loanId` links to the exact loan; `Loan.closedAt`
(added this session, `3837329`) is now directly queryable to check whether that loan is
still open — reusing that field rather than re-deriving the same fact a second way.

## Verification Questions

**VQ1.** Is a sold RealEstate/GoldHolding row excluded from `fetchAssetBreakdown`
(`dashboardService.ts`) going forward — every one of `investment`, `goldHolding`,
`asset`, `realestate` in that function is fetched with NO status filter today?
**VQ2.** Does the sale record preserve the asset's full history (purchase price, date,
location) rather than the delete-and-lose-everything status quo?
**VQ3.** Is a sale blocked (or at minimum clearly warned) when the property secures a
loan that is not yet `closedAt`-closed?
**VQ4.** Is the sold state visible in the UI, not just a queryable column nobody reads —
the same defect class already found and fixed for `LoanPrepayment` and `Loan.closedAt`
earlier this session?
**VQ5.** Does the fix for RealEstate (which has NO delete UI today) not accidentally
also change GoldHolding's EXISTING destructive delete button without an explicit
decision to do so?
**VQ6.** Is a co-owner's write access to record a sale scoped the same way
`userRealEstateWriteWhere` already scopes every other RealEstate mutation?

## QUEUED NEXT (unrelated)
1. Credit card statement import [BLOCKED — needs a sample file].
2. Native date pickers in Firefox/Safari — only if those browsers matter.

## Tech debt noted
- Loan prepayment/subscription-startDate: bounded races, documented in prior commits.
- Loan closedAt (3837329): prepayment-path only, by design.
- DQ5 above (RealEstate delete not FK-guarded against an active secured loan) is a real
  bug independent of this task's scope decision — flag to user regardless of what ships.

## Known Flakes (pre-existing)
- `dashboard.routes.test.ts > returns empty array when no alerts` (backend) — order-dependent
- `Dashboard.test.tsx` (frontend) — `findBy` timeouts under parallel load; passes on re-run
