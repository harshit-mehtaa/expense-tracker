import { prisma } from '../config/prisma';
import type { Prisma, CapitalGainAssetType } from '@prisma/client';
import { getFYRange } from '../utils/financialYear';

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function listCapitalGains(userId: string, fy: string) {
  return prisma.capitalGainEntry.findMany({
    where: { userId, fyYear: fy, deletedAt: null },
    orderBy: { saleDate: 'desc' },
  });
}

export async function getCapitalGain(userId: string, id: string) {
  return prisma.capitalGainEntry.findFirst({
    where: { id, userId, deletedAt: null },
  });
}

export async function createCapitalGain(
  userId: string,
  data: Omit<Prisma.CapitalGainEntryUncheckedCreateInput, 'userId'>,
) {
  return prisma.capitalGainEntry.create({ data: { ...data, userId } });
}

export async function updateCapitalGain(
  userId: string,
  id: string,
  data: Partial<Prisma.CapitalGainEntryUncheckedUpdateInput>,
) {
  const result = await prisma.capitalGainEntry.updateMany({
    where: { id, userId, deletedAt: null },
    data,
  });
  if (result.count === 0) return null;
  return prisma.capitalGainEntry.findUnique({ where: { id } });
}

export async function deleteCapitalGain(userId: string, id: string) {
  const result = await prisma.capitalGainEntry.updateMany({
    where: { id, userId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return result.count > 0 ? { deleted: true } : null;
}

// ─── Computation ──────────────────────────────────────────────────────────────

export interface CapitalGainSummary {
  stcg: {
    equity15Pct: number;   // Listed equity + equity MF held < 12m → 15%
    other: number;         // All other STCG (incl. foreign equity < 24m) → slab rate
    total: number;
  };
  ltcg: {
    equity10Pct: number;   // 112A-eligible (listed equity/equity MF) LTCG after ₹1L exemption → 10%
    withIndexation: number; // Property/Gold/Bonds ≥ 24/36m → 20% with indexation
    debtMFSlab: number;    // DEBT_MF post-Apr 2023 purchase → slab rate
    foreign20Pct: number;  // Foreign equity ≥ 24m → 20% without indexation (no 112A benefit)
    total: number;
  };
  totalTaxableGain: number;
  entries: Array<{
    id: string;
    assetName: string;
    assetType: CapitalGainAssetType;
    holdingDays: number;
    isLongTerm: boolean;
    gain: number;
    taxRate: string;
    taxBucket: string;
  }>;
}

// Long-term thresholds (days)
const LONG_TERM_DAYS: Record<CapitalGainAssetType, number> = {
  EQUITY_LISTED: 365,        // 12 months
  EQUITY_MUTUAL_FUND: 365,   // 12 months
  DEBT_MUTUAL_FUND: 1095,    // 36 months (for pre-Apr 2023 purchases using old rules)
  PROPERTY: 730,             // 24 months
  BONDS: 1095,               // 36 months
  GOLD: 1095,                // 36 months
  FOREIGN_EQUITY: 730,       // 24 months (applies to RSU/ESOP sales and direct foreign stocks)
  OTHER: 1095,               // default 36 months
};

export async function calcCapitalGainsSummary(userId: string, fy: string): Promise<CapitalGainSummary> {
  const { start, end } = getFYRange(fy);
  const entries = await prisma.capitalGainEntry.findMany({
    where: {
      userId,
      fyYear: fy,
      deletedAt: null,
      saleDate: { gte: start, lt: end },
    },
    orderBy: { saleDate: 'asc' },
  });

  let stcgEquity15 = 0;
  let stcgOther = 0;
  let ltcg112ARaw = 0;    // sum of 112A-eligible LTCG before exemption
  let ltcgIndexation = 0;
  let ltcgDebtMFSlab = 0;
  let ltcgForeign20 = 0;  // foreign equity LTCG ≥ 24m → 20% without indexation

  const details: CapitalGainSummary['entries'] = [];

  for (const e of entries) {
    const purchase = Number(e.purchasePrice);
    const sale = Number(e.salePrice);
    const gain = sale - purchase;
    const holdingDays = Math.floor(
      (e.saleDate.getTime() - e.purchaseDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    const ltThreshold = LONG_TERM_DAYS[e.assetType];
    const isLongTerm = holdingDays >= ltThreshold;

    let taxRate: string;
    let taxBucket: string;

    if (!isLongTerm) {
      // STCG
      if (e.assetType === 'EQUITY_LISTED' || e.assetType === 'EQUITY_MUTUAL_FUND') {
        stcgEquity15 += gain;
        taxRate = '15%';
        taxBucket = 'STCG_EQUITY_15';
      } else if (e.assetType === 'DEBT_MUTUAL_FUND' && !e.isPreApril2023Purchase) {
        // Post-Apr 2023 DEBT_MF: always slab rate regardless of holding period
        ltcgDebtMFSlab += gain;
        taxRate = 'Slab rate';
        taxBucket = 'DEBT_MF_SLAB';
      } else {
        // Includes FOREIGN_EQUITY held < 24m → slab rate
        stcgOther += gain;
        taxRate = 'Slab rate';
        taxBucket = 'STCG_OTHER_SLAB';
      }
    } else {
      // LTCG
      if (e.assetType === 'DEBT_MUTUAL_FUND' && !e.isPreApril2023Purchase) {
        // Post-Apr 2023 DEBT_MF: always slab rate
        ltcgDebtMFSlab += gain;
        taxRate = 'Slab rate';
        taxBucket = 'DEBT_MF_SLAB';
      } else if (e.assetType === 'FOREIGN_EQUITY') {
        // Foreign equity ≥ 24m → 20% without indexation (no 112A benefit)
        ltcgForeign20 += gain;
        taxRate = '20% (foreign equity, no indexation)';
        taxBucket = 'LTCG_FOREIGN_20';
      } else if (e.isSection112AEligible) {
        ltcg112ARaw += gain;
        taxRate = '10% (Sec 112A, ₹1L exempt)';
        taxBucket = 'LTCG_112A';
      } else {
        // Property, Gold, Bonds, pre-Apr-2023 DEBT_MF → 20% with indexation
        const cost = e.indexedCost !== null ? Number(e.indexedCost) : purchase;
        ltcgIndexation += sale - cost;
        taxRate = '20% with indexation';
        taxBucket = 'LTCG_INDEXATION';
      }
    }

    details.push({
      id: e.id,
      assetName: e.assetName,
      assetType: e.assetType,
      holdingDays,
      isLongTerm,
      gain,
      taxRate,
      taxBucket,
    });
  }

  // Apply ₹1L aggregate exemption to all 112A-eligible LTCG
  const ltcgEquity10 = Math.max(ltcg112ARaw - 100000, 0);

  const stcgTotal = stcgEquity15 + stcgOther;
  const ltcgTotal = ltcgEquity10 + ltcgIndexation + ltcgDebtMFSlab + ltcgForeign20;

  return {
    stcg: {
      equity15Pct: stcgEquity15,
      other: stcgOther,
      total: stcgTotal,
    },
    ltcg: {
      equity10Pct: ltcgEquity10,
      withIndexation: ltcgIndexation,
      debtMFSlab: ltcgDebtMFSlab,
      foreign20Pct: ltcgForeign20,
      total: ltcgTotal,
    },
    totalTaxableGain: stcgTotal + ltcgTotal,
    entries: details,
  };
}
