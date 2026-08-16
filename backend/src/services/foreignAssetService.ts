import { prisma } from '../config/prisma';
import type { Prisma } from '@prisma/client';
import { ownerScopedWhere } from '../utils/resolveTargetUserId';

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function listForeignAssets(userId: string, fy: string) {
  return prisma.foreignAssetDisclosure.findMany({
    where: { userId, fyYear: fy, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

/** Also serves as the audit-snapshot fetch for the tax route's PUT/DELETE handlers. */
export async function getForeignAsset(requesterId: string, id: string, requesterRole = 'MEMBER') {
  return prisma.foreignAssetDisclosure.findFirst({
    where: { ...ownerScopedWhere(id, requesterId, requesterRole), deletedAt: null },
  });
}

export async function createForeignAsset(
  userId: string,
  data: Omit<Prisma.ForeignAssetDisclosureUncheckedCreateInput, 'userId'>,
) {
  return prisma.foreignAssetDisclosure.create({ data: { ...data, userId } });
}

export async function updateForeignAsset(
  requesterId: string,
  id: string,
  data: Partial<Prisma.ForeignAssetDisclosureUncheckedUpdateInput>,
  requesterRole = 'MEMBER',
) {
  const result = await prisma.foreignAssetDisclosure.updateMany({
    where: { ...ownerScopedWhere(id, requesterId, requesterRole), deletedAt: null },
    data,
  });
  if (result.count === 0) return null;
  return prisma.foreignAssetDisclosure.findFirst({ where: { id, deletedAt: null } });
}

export async function deleteForeignAsset(requesterId: string, id: string, requesterRole = 'MEMBER') {
  const result = await prisma.foreignAssetDisclosure.updateMany({
    where: { ...ownerScopedWhere(id, requesterId, requesterRole), deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return result.count > 0 ? { deleted: true } : null;
}

// ─── Summary ──────────────────────────────────────────────────────────────────

export async function getForeignAssetSummary(userId: string, fy: string) {
  const assets = await prisma.foreignAssetDisclosure.findMany({
    where: { userId, fyYear: fy, deletedAt: null },
  });

  const totalClosingValue = assets.reduce((s, a) => s + Number(a.closingValueINR), 0);
  const totalIncomeAccrued = assets.reduce((s, a) => s + Number(a.incomeAccruedINR), 0);

  const byCategory = assets.reduce<Record<string, { count: number; closingValueINR: number }>>(
    (acc, a) => {
      const cat = a.category;
      if (!acc[cat]) acc[cat] = { count: 0, closingValueINR: 0 };
      acc[cat].count++;
      acc[cat].closingValueINR += Number(a.closingValueINR);
      return acc;
    },
    {},
  );

  return {
    count: assets.length,
    totalClosingValueINR: totalClosingValue,
    totalIncomeAccruedINR: totalIncomeAccrued,
    byCategory,
  };
}
