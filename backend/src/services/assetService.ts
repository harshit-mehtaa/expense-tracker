import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { ownerScopedWhere } from '../utils/resolveTargetUserId';

/**
 * Assets are what secured loans are held against — a property, a vehicle, gold.
 *
 * Single-owner, so this uses the shared `ownerScopedWhere` rather than a bespoke
 * predicate. Loans need their own because they are co-ownable; assets are not, and
 * reaching for a loan-shaped predicate here would imply a sharing model that does not
 * exist.
 */

const assetInclude = {
  realEstate: { select: { id: true, propertyName: true, currentValue: true } },
  goldHolding: { select: { id: true, description: true, quantityGrams: true } },
  loans: { select: { id: true, lenderName: true, loanType: true, outstandingBalance: true } },
} as const;

export async function listAssets(userId?: string) {
  return prisma.asset.findMany({
    where: userId ? { userId } : {},
    include: assetInclude,
    orderBy: { createdAt: 'desc' },
  });
}

export async function getAsset(requesterId: string, id: string, requesterRole = 'MEMBER') {
  return prisma.asset.findFirst({
    where: ownerScopedWhere(id, requesterId, requesterRole),
    include: assetInclude,
  });
}

/**
 * A linked property must belong to the asset's owner. `assetInclude` returns the
 * property's name and current value, so an unvalidated id would leak another member's
 * property details back through the asset.
 */
async function assertRealEstateOwned(userId: string, realEstateId: string | null | undefined) {
  if (!realEstateId) return;
  const property = await prisma.realEstate.findFirst({
    where: { id: realEstateId, userId }, select: { id: true },
  });
  if (!property) throw AppError.notFound('Property');
}

/**
 * Same rule for the gold link: `assetInclude` returns the holding, so an unvalidated id
 * would leak another member's gold through the asset.
 */
async function assertGoldHoldingOwned(userId: string, goldHoldingId: string | null | undefined) {
  if (!goldHoldingId) return;
  const holding = await prisma.goldHolding.findFirst({
    where: { id: goldHoldingId, userId }, select: { id: true },
  });
  if (!holding) throw AppError.notFound('Gold holding');
}

/** Mirrors loanService's assertAssetRequired — same "cheap-to-require enum pick, checked
 *  against the merged state on update" shape. */
export function assertVehicleTypeRequired(assetType: string, vehicleType: string | null | undefined) {
  if (assetType === 'VEHICLE' && !vehicleType) {
    throw AppError.badRequest('A vehicle asset must have a vehicle type');
  }
}

/**
 * A realEstateId/goldHoldingId conflict (the property/holding already has a linked
 * asset — createRealEstate auto-creates one for every property now) is caught here
 * rather than pre-checked: a pre-check-then-insert has a TOCTOU race under concurrent
 * requests that would still let a raw P2002 through. Matches categoryRuleService's
 * existing try/catch-on-P2002 pattern. Shared by createAsset and updateAsset — a PUT
 * accepts the same two link fields and writes through the same unique indexes, so it
 * carries an identical conflict risk now that every property auto-links on creation.
 */
function translateLinkConflict(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw AppError.conflict('This property or gold holding is already linked to another asset.');
  }
  throw err;
}

/**
 * A non-VEHICLE asset must never carry a vehicleType — enforced unconditionally, not
 * just when a type CHANGES away from VEHICLE, since a client could send
 * `{assetType: 'OTHER', vehicleType: 'FOUR_WHEELER'}` on create, or send vehicleType on
 * an update alongside an unrelated field while a hidden form input still holds a stale
 * value (react-hook-form keeps unmounted-but-registered fields by default).
 */
function normalizeVehicleType(assetType: string, vehicleType: string | null | undefined) {
  return assetType === 'VEHICLE' ? vehicleType : null;
}

export async function createAsset(userId: string, data: Omit<Prisma.AssetCreateInput, 'user'>) {
  const assetType = (data as any).assetType as string;
  assertVehicleTypeRequired(assetType, (data as any).vehicleType);
  await assertRealEstateOwned(userId, (data as any).realEstateId);
  await assertGoldHoldingOwned(userId, (data as any).goldHoldingId);
  try {
    return await prisma.asset.create({
      data: {
        ...data,
        userId,
        vehicleType: normalizeVehicleType(assetType, (data as any).vehicleType),
      } as Prisma.AssetUncheckedCreateInput,
      include: assetInclude,
    });
  } catch (err) {
    return translateLinkConflict(err);
  }
}

export async function updateAsset(
  requesterId: string,
  id: string,
  data: Prisma.AssetUpdateInput,
  requesterRole = 'MEMBER',
) {
  const asset = await prisma.asset.findFirst({
    where: ownerScopedWhere(id, requesterId, requesterRole),
  });
  if (!asset) throw AppError.notFound('Asset');
  // Validate against the MERGED state: a partial update changing only vehicleType (or
  // only assetType) must still be checked against whichever field the request didn't
  // touch — same reasoning as loanService.updateLoan's nextAssetId merge.
  const nextAssetType = ('assetType' in data ? (data as any).assetType : asset.assetType) as string;
  const nextVehicleType = 'vehicleType' in data ? (data as any).vehicleType : asset.vehicleType;
  assertVehicleTypeRequired(nextAssetType, nextVehicleType as string | null | undefined);
  if ('realEstateId' in data) await assertRealEstateOwned(asset.userId, (data as any).realEstateId);
  if ('goldHoldingId' in data) await assertGoldHoldingOwned(asset.userId, (data as any).goldHoldingId);
  const writeData = {
    ...data,
    vehicleType: normalizeVehicleType(nextAssetType, nextVehicleType as string | null | undefined),
  } as Prisma.AssetUpdateInput;
  try {
    return await prisma.asset.update({ where: { id }, data: writeData, include: assetInclude });
  } catch (err) {
    return translateLinkConflict(err);
  }
}

/**
 * The open loan (if any) securing the asset with this id, or null. "Open" specifically —
 * a CLOSED loan that once used this as collateral is not a reason to block a sale; you
 * can sell a house once the mortgage against it is paid off. Shared by every sale path
 * (this file's own recordAssetSale, and investmentService's RealEstate/GoldHolding sale
 * functions, which resolve their own linked asset's id first).
 */
export async function findActiveLoanSecuring(assetId: string) {
  return prisma.loan.findFirst({
    where: { assetId, closedAt: null },
    select: { id: true, lenderName: true },
  });
}

async function assertNotSecuringActiveLoan(assetId: string) {
  const openLoan = await findActiveLoanSecuring(assetId);
  if (openLoan) {
    throw AppError.conflict(
      `This still secures an active loan (${openLoan.lenderName}). Close or pay off the loan before recording a sale.`,
    );
  }
}

export interface RecordSaleInput {
  salePrice: number;
  date: string;
}

/**
 * For an UNLINKED asset only (no realEstateId/goldHoldingId) — a linked one's sale is
 * recorded on the RealEstate/GoldHolding row it represents (investmentService.ts), so
 * this refuses rather than creating a second place that could claim the same sale.
 */
export async function recordAssetSale(
  requesterId: string,
  id: string,
  input: RecordSaleInput,
  requesterRole = 'MEMBER',
) {
  const asset = await prisma.asset.findFirst({ where: ownerScopedWhere(id, requesterId, requesterRole) });
  if (!asset) throw AppError.notFound('Asset');
  if (asset.realEstateId || asset.goldHoldingId) {
    throw AppError.badRequest(
      'This asset represents a property or gold holding — record the sale there instead.',
    );
  }
  await assertNotSecuringActiveLoan(id);

  return prisma.asset.update({
    where: { id },
    data: { soldAt: new Date(input.date), salePrice: input.salePrice },
    include: assetInclude,
  });
}

export async function deleteAsset(requesterId: string, id: string, requesterRole = 'MEMBER') {
  const asset = await prisma.asset.findFirst({
    where: ownerScopedWhere(id, requesterId, requesterRole),
    include: { loans: { select: { id: true } } },
  });
  if (!asset) throw AppError.notFound('Asset');

  // A secured loan must always name its collateral, so deleting an asset out from under
  // one would leave that loan violating the rule it was created against. Loan.assetId is
  // ON DELETE RESTRICT, so an unguarded delete would fail with a raw FK violation instead
  // of this clean 409 — same shape as deleteRealEstate's guard, which mirrors this check.
  if (asset.loans.length > 0) {
    throw AppError.conflict(
      `This asset secures ${asset.loans.length} loan(s). Delete those loans first, or record a sale instead.`,
    );
  }

  return prisma.asset.delete({ where: { id } });
}

/** Snapshot fetch for the audit trail — not an authorization check. */
export async function getAssetForAudit(requesterId: string, id: string, requesterRole = 'MEMBER') {
  return prisma.asset.findFirst({ where: ownerScopedWhere(id, requesterId, requesterRole) });
}
