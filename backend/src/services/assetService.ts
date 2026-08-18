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
