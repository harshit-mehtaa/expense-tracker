import { prisma } from '../config/prisma';
import type { Prisma } from '@prisma/client';

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function listForeignAssets(userId: string, fy: string) {
  return prisma.foreignAssetDisclosure.findMany({
    where: { userId, fyYear: fy, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getForeignAsset(userId: string, id: string) {
  return prisma.foreignAssetDisclosure.findFirst({
    where: { id, userId, deletedAt: null },
  });
}

export async function createForeignAsset(
  userId: string,
  data: Omit<Prisma.ForeignAssetDisclosureUncheckedCreateInput, 'userId'>,
) {
  return prisma.foreignAssetDisclosure.create({ data: { ...data, userId } });
}

export async function updateForeignAsset(
  userId: string,
  id: string,
  data: Partial<Prisma.ForeignAssetDisclosureUncheckedUpdateInput>,
) {
  const result = await prisma.foreignAssetDisclosure.updateMany({
    where: { id, userId, deletedAt: null },
    data,
  });
  if (result.count === 0) return null;
  return prisma.foreignAssetDisclosure.findFirst({ where: { id, userId, deletedAt: null } });
}

export async function deleteForeignAsset(userId: string, id: string) {
  const result = await prisma.foreignAssetDisclosure.updateMany({
    where: { id, userId, deletedAt: null },
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
