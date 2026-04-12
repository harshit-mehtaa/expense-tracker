/**
 * Unit tests for capitalGainsService.ts.
 *
 * Key test focus:
 * - CRUD: listCapitalGains, getCapitalGain, createCapitalGain,
 *   updateCapitalGain (count>0 → updated, count=0 → null),
 *   deleteCapitalGain (count>0 → {deleted:true}, count=0 → null)
 * - calcCapitalGainsSummary: all 9 tax classification branches:
 *     STCG_EQUITY_15, STCG_OTHER_SLAB, DEBT_MF_SLAB (post-Apr-2023),
 *     LTCG_112A (with ₹1L exemption), LTCG_INDEXATION (null vs real indexedCost),
 *     LTCG_FOREIGN_20, and 112A gain under ₹1L threshold
 *
 * NOTE: Post-Apr-2023 DEBT_MF goes to ltcg.debtMFSlab regardless of holding period.
 * capitalGainsService uses named import { prisma }.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/prisma', () => {
  const mockPrisma = {
    capitalGainEntry: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  return { default: mockPrisma, prisma: mockPrisma };
});

import { prisma } from '../config/prisma';
import {
  listCapitalGains,
  getCapitalGain,
  createCapitalGain,
  updateCapitalGain,
  deleteCapitalGain,
  calcCapitalGainsSummary,
} from '../services/capitalGainsService';

const cgMock = (prisma as any).capitalGainEntry;

const MOCK_ENTRY = {
  id: 'cg-1',
  userId: 'u1',
  fyYear: '2025-26',
  assetName: 'Test Asset',
  assetType: 'EQUITY_LISTED',
  purchaseDate: new Date('2024-12-01'),
  saleDate: new Date('2025-06-01'),
  purchasePrice: 100000,
  salePrice: 120000,
  indexedCost: null,
  isSection112AEligible: false,
  isPreApril2023Purchase: false,
  deletedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  cgMock.findMany.mockResolvedValue([]);
  cgMock.findFirst.mockResolvedValue(MOCK_ENTRY);
  cgMock.findUnique.mockResolvedValue(MOCK_ENTRY);
  cgMock.create.mockResolvedValue(MOCK_ENTRY);
  cgMock.updateMany.mockResolvedValue({ count: 1 });
});

// ─────────────────────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────────────────────

describe('listCapitalGains', () => {
  it('queries by userId and fyYear with deletedAt filter', async () => {
    cgMock.findMany.mockResolvedValue([MOCK_ENTRY]);
    const result = await listCapitalGains('u1', '2025-26');
    expect(cgMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'u1', fyYear: '2025-26', deletedAt: null }),
      }),
    );
    expect(result).toHaveLength(1);
  });
});

describe('getCapitalGain', () => {
  it('returns entry when found', async () => {
    const result = await getCapitalGain('u1', 'cg-1');
    expect(result).toBe(MOCK_ENTRY);
  });

  it('returns null when not found', async () => {
    cgMock.findFirst.mockResolvedValue(null);
    const result = await getCapitalGain('u1', 'cg-x');
    expect(result).toBeNull();
  });
});

describe('createCapitalGain', () => {
  it('creates entry with userId merged', async () => {
    const data = { fyYear: '2025-26', assetName: 'HDFC Bank', assetType: 'EQUITY_LISTED' };
    await createCapitalGain('u1', data as any);
    expect(cgMock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'u1', assetName: 'HDFC Bank' }),
    });
  });
});

describe('updateCapitalGain', () => {
  it('returns updated entry when found (count > 0)', async () => {
    const updated = { ...MOCK_ENTRY, salePrice: 150000 };
    cgMock.findUnique.mockResolvedValue(updated);

    const result = await updateCapitalGain('u1', 'cg-1', { salePrice: 150000 });

    expect(cgMock.updateMany).toHaveBeenCalledWith({
      where: { id: 'cg-1', userId: 'u1', deletedAt: null },
      data: { salePrice: 150000 },
    });
    expect(result).toBe(updated);
  });

  it('returns null when entry not found (count = 0)', async () => {
    cgMock.updateMany.mockResolvedValue({ count: 0 });
    const result = await updateCapitalGain('u1', 'cg-x', { salePrice: 150000 });
    expect(result).toBeNull();
    expect(cgMock.findUnique).not.toHaveBeenCalled();
  });
});

describe('deleteCapitalGain', () => {
  it('returns { deleted: true } when entry found (count > 0)', async () => {
    const result = await deleteCapitalGain('u1', 'cg-1');
    expect(result).toEqual({ deleted: true });
  });

  it('returns null when entry not found (count = 0)', async () => {
    cgMock.updateMany.mockResolvedValue({ count: 0 });
    const result = await deleteCapitalGain('u1', 'cg-x');
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calcCapitalGainsSummary — tax classification branches
// ─────────────────────────────────────────────────────────────────────────────

// Helper: builds a capital gain entry with sensible defaults, purchase+sale dates
// chosen to produce the given holdingDays
function makeEntry(overrides: Partial<typeof MOCK_ENTRY> & { holdingDays?: number } = {}) {
  const holdingDays = overrides.holdingDays ?? 182;
  delete (overrides as any).holdingDays;
  const saleDate = new Date('2025-09-01'); // in FY 2025-26
  const purchaseDate = new Date(saleDate.getTime() - holdingDays * 24 * 60 * 60 * 1000);
  return {
    ...MOCK_ENTRY,
    purchaseDate,
    saleDate,
    purchasePrice: 100000,
    salePrice: 120000, // default gain = 20000
    ...overrides,
  };
}

describe('calcCapitalGainsSummary', () => {
  it('EQUITY_LISTED held < 365d → stcg.equity15Pct (STCG_EQUITY_15)', async () => {
    cgMock.findMany.mockResolvedValue([
      makeEntry({ assetType: 'EQUITY_LISTED', holdingDays: 182 }),
    ]);
    const result = await calcCapitalGainsSummary('u1', '2025-26');
    expect(result.stcg.equity15Pct).toBe(20000);
    expect(result.stcg.other).toBe(0);
    expect(result.entries[0].taxBucket).toBe('STCG_EQUITY_15');
  });

  it('EQUITY_MUTUAL_FUND held < 365d → stcg.equity15Pct (STCG_EQUITY_15)', async () => {
    cgMock.findMany.mockResolvedValue([
      makeEntry({ assetType: 'EQUITY_MUTUAL_FUND', holdingDays: 200 }),
    ]);
    const result = await calcCapitalGainsSummary('u1', '2025-26');
    expect(result.stcg.equity15Pct).toBe(20000);
    expect(result.entries[0].taxBucket).toBe('STCG_EQUITY_15');
  });

  it('FOREIGN_EQUITY held < 730d → stcg.other (STCG_OTHER_SLAB)', async () => {
    cgMock.findMany.mockResolvedValue([
      makeEntry({ assetType: 'FOREIGN_EQUITY', holdingDays: 500 }),
    ]);
    const result = await calcCapitalGainsSummary('u1', '2025-26');
    expect(result.stcg.other).toBe(20000);
    expect(result.entries[0].taxBucket).toBe('STCG_OTHER_SLAB');
  });

  it('DEBT_MF, isPreApril2023Purchase=false → ltcg.debtMFSlab regardless of holding (DEBT_MF_SLAB)', async () => {
    // Even with short holding, post-Apr-2023 DEBT_MF goes to ltcg.debtMFSlab
    cgMock.findMany.mockResolvedValue([
      makeEntry({ assetType: 'DEBT_MUTUAL_FUND', isPreApril2023Purchase: false, holdingDays: 100 }),
    ]);
    const result = await calcCapitalGainsSummary('u1', '2025-26');
    expect(result.ltcg.debtMFSlab).toBe(20000);
    expect(result.stcg.other).toBe(0);
    expect(result.entries[0].taxBucket).toBe('DEBT_MF_SLAB');
  });

  it('EQUITY_LISTED held ≥ 365d + isSection112AEligible → ltcg.equity10Pct after ₹1L exemption', async () => {
    // gain=150000, 112A-eligible → ltcg112ARaw=150000, equity10Pct = max(150000-100000, 0) = 50000
    cgMock.findMany.mockResolvedValue([
      makeEntry({
        assetType: 'EQUITY_LISTED',
        holdingDays: 500,
        isSection112AEligible: true,
        purchasePrice: 100000,
        salePrice: 250000, // gain = 150000
      }),
    ]);
    const result = await calcCapitalGainsSummary('u1', '2025-26');
    expect(result.ltcg.equity10Pct).toBe(50000); // 150000 - 100000 exemption
    expect(result.entries[0].taxBucket).toBe('LTCG_112A');
  });

  it('112A gain ≤ ₹1L exemption → ltcg.equity10Pct = 0 (exemption absorbs gain)', async () => {
    // gain=80000 < 100000 threshold → equity10Pct = max(80000-100000, 0) = 0
    cgMock.findMany.mockResolvedValue([
      makeEntry({
        assetType: 'EQUITY_LISTED',
        holdingDays: 500,
        isSection112AEligible: true,
        purchasePrice: 100000,
        salePrice: 180000, // gain = 80000
      }),
    ]);
    const result = await calcCapitalGainsSummary('u1', '2025-26');
    expect(result.ltcg.equity10Pct).toBe(0);
  });

  it('PROPERTY held ≥ 730d → ltcg.withIndexation using actual indexedCost', async () => {
    // gain before indexation = 500000, but indexedCost = 250000 → indexed gain = 500000-250000 = 250000
    cgMock.findMany.mockResolvedValue([
      makeEntry({
        assetType: 'PROPERTY',
        holdingDays: 800,
        purchasePrice: 200000,
        salePrice: 700000,
        indexedCost: 250000,
      }),
    ]);
    const result = await calcCapitalGainsSummary('u1', '2025-26');
    // ltcgIndexation = salePrice - indexedCost = 700000 - 250000 = 450000
    expect(result.ltcg.withIndexation).toBe(450000);
    expect(result.entries[0].taxBucket).toBe('LTCG_INDEXATION');
  });

  it('PROPERTY with null indexedCost → falls back to purchasePrice for indexed gain', async () => {
    // indexedCost = null → cost = purchasePrice = 200000, gain = 700000-200000 = 500000
    cgMock.findMany.mockResolvedValue([
      makeEntry({
        assetType: 'PROPERTY',
        holdingDays: 800,
        purchasePrice: 200000,
        salePrice: 700000,
        indexedCost: null,
      }),
    ]);
    const result = await calcCapitalGainsSummary('u1', '2025-26');
    expect(result.ltcg.withIndexation).toBe(500000);
  });

  it('FOREIGN_EQUITY held ≥ 730d → ltcg.foreign20Pct (LTCG_FOREIGN_20)', async () => {
    cgMock.findMany.mockResolvedValue([
      makeEntry({ assetType: 'FOREIGN_EQUITY', holdingDays: 800 }),
    ]);
    const result = await calcCapitalGainsSummary('u1', '2025-26');
    expect(result.ltcg.foreign20Pct).toBe(20000);
    expect(result.entries[0].taxBucket).toBe('LTCG_FOREIGN_20');
  });

  it('DEBT_MF, isPreApril2023Purchase=true, held ≥ 1095d → ltcg.withIndexation (LTCG_INDEXATION)', async () => {
    cgMock.findMany.mockResolvedValue([
      makeEntry({
        assetType: 'DEBT_MUTUAL_FUND',
        isPreApril2023Purchase: true,
        holdingDays: 1200, // ≥ 1095d → LTCG
        purchasePrice: 100000,
        salePrice: 140000,
        indexedCost: null,
      }),
    ]);
    const result = await calcCapitalGainsSummary('u1', '2025-26');
    expect(result.ltcg.withIndexation).toBe(40000);
    expect(result.entries[0].taxBucket).toBe('LTCG_INDEXATION');
  });

  it('returns zero totals when no entries', async () => {
    const result = await calcCapitalGainsSummary('u1', '2025-26');
    expect(result.totalTaxableGain).toBe(0);
    expect(result.stcg.total).toBe(0);
    expect(result.ltcg.total).toBe(0);
  });

  it('mixes multiple entries and sums buckets correctly', async () => {
    cgMock.findMany.mockResolvedValue([
      makeEntry({ assetType: 'EQUITY_LISTED', holdingDays: 100, salePrice: 120000 }), // STCG_EQUITY_15: 20000
      makeEntry({ assetType: 'FOREIGN_EQUITY', holdingDays: 300, salePrice: 130000 }), // STCG_OTHER: 30000
    ]);
    const result = await calcCapitalGainsSummary('u1', '2025-26');
    expect(result.stcg.equity15Pct).toBe(20000);
    expect(result.stcg.other).toBe(30000);
    expect(result.stcg.total).toBe(50000);
    expect(result.totalTaxableGain).toBe(50000);
  });
});
