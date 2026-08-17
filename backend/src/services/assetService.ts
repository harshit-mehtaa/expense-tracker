import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { ownerScopedWhere } from '../utils/resolveTargetUserId';
import type { Prisma } from '@prisma/client';

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

export async function createAsset(userId: string, data: Omit<Prisma.AssetCreateInput, 'user'>) {
  await assertRealEstateOwned(userId, (data as any).realEstateId);
  await assertGoldHoldingOwned(userId, (data as any).goldHoldingId);
  return prisma.asset.create({
    data: { ...data, userId } as Prisma.AssetUncheckedCreateInput,
    include: assetInclude,
  });
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
  if ('realEstateId' in data) await assertRealEstateOwned(asset.userId, (data as any).realEstateId);
  if ('goldHoldingId' in data) await assertGoldHoldingOwned(asset.userId, (data as any).goldHoldingId);
  return prisma.asset.update({ where: { id }, data, include: assetInclude });
}

export async function deleteAsset(requesterId: string, id: string, requesterRole = 'MEMBER') {
  const asset = await prisma.asset.findFirst({
    where: ownerScopedWhere(id, requesterId, requesterRole),
    include: { loans: { select: { id: true } } },
  });
  if (!asset) throw AppError.notFound('Asset');

  // A secured loan must always name its collateral, so deleting an asset out from under
  // one would leave that loan violating the rule it was created against. The FK is
  // ON DELETE SET NULL, which would silently produce exactly that state.
  if (asset.loans.length > 0) {
    throw AppError.conflict(
      `This asset secures ${asset.loans.length} loan(s). Unlink or delete them first.`,
    );
  }

  return prisma.asset.delete({ where: { id } });
}

/** Snapshot fetch for the audit trail — not an authorization check. */
export async function getAssetForAudit(requesterId: string, id: string, requesterRole = 'MEMBER') {
  return prisma.asset.findFirst({ where: ownerScopedWhere(id, requesterId, requesterRole) });
}
