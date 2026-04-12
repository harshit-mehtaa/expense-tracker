/**
 * Unit tests for foreignAssetService.ts
 *
 * Covers: CRUD (listForeignAssets, getForeignAsset, createForeignAsset,
 * updateForeignAsset, deleteForeignAsset) and getForeignAssetSummary
 * grouping by category.
 *
 * Uses named import { prisma } — dual-export mock required.
 * NOTE: updateForeignAsset re-fetches via findFirst (not findUnique).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/prisma', () => {
  const mock = {
    foreignAssetDisclosure: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  return { default: mock, prisma: mock };
});

import { prisma } from '../config/prisma';
import {
  listForeignAssets,
  getForeignAsset,
  createForeignAsset,
  updateForeignAsset,
  deleteForeignAsset,
  getForeignAssetSummary,
} from '../services/foreignAssetService';

const faMock = (prisma as any).foreignAssetDisclosure;

const MOCK_ASSET = {
  id: 'fa-1',
  userId: 'u1',
  fyYear: '2025-26',
  category: 'BANK_ACCOUNT',
  assetName: 'Chase Savings',
  country: 'USA',
  closingValueINR: 500000,
  incomeAccruedINR: 12000,
  deletedAt: null,
  createdAt: new Date('2025-04-01'),
};

beforeEach(() => {
  vi.clearAllMocks();
  faMock.findMany.mockResolvedValue([MOCK_ASSET]);
  faMock.findFirst.mockResolvedValue(MOCK_ASSET);
  faMock.create.mockResolvedValue(MOCK_ASSET);
  faMock.updateMany.mockResolvedValue({ count: 1 });
});

// ─── CRUD ─────────────────────────────────────────────────────────────────────

describe('listForeignAssets', () => {
  it('queries by userId, fyYear, and deletedAt: null, ordered by createdAt desc', async () => {
    const result = await listForeignAssets('u1', '2025-26');
    expect(faMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1', fyYear: '2025-26', deletedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(result).toHaveLength(1);
  });
});

describe('getForeignAsset', () => {
  it('returns asset when found', async () => {
    const result = await getForeignAsset('u1', 'fa-1');
    expect(faMock.findFirst).toHaveBeenCalledWith({
      where: { id: 'fa-1', userId: 'u1', deletedAt: null },
    });
    expect(result).toBeDefined();
  });

  it('returns null when not found', async () => {
    faMock.findFirst.mockResolvedValue(null);
    const result = await getForeignAsset('u1', 'fa-x');
    expect(result).toBeNull();
  });
});

describe('createForeignAsset', () => {
  it('merges userId into data and calls create', async () => {
    const data = { fyYear: '2025-26', category: 'EQUITY', assetName: 'NVIDIA', country: 'USA', closingValueINR: 200000, incomeAccruedINR: 0 };
    await createForeignAsset('u1', data as any);
    expect(faMock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'u1', assetName: 'NVIDIA' }),
    });
  });
});

describe('updateForeignAsset', () => {
  it('happy path: updateMany count=1 → re-fetches via findFirst and returns updated record', async () => {
    const updated = { ...MOCK_ASSET, closingValueINR: 600000 };
    faMock.findFirst.mockResolvedValue(updated); // re-fetch after updateMany returns this
    const result = await updateForeignAsset('u1', 'fa-1', { closingValueINR: 600000 });
    expect(faMock.updateMany).toHaveBeenCalledWith({
      where: { id: 'fa-1', userId: 'u1', deletedAt: null },
      data: { closingValueINR: 600000 },
    });
    expect(faMock.findFirst).toHaveBeenCalledWith({
      where: { id: 'fa-1', userId: 'u1', deletedAt: null },
    });
    expect(result).toEqual(updated);
  });

  it('not-found path: updateMany count=0 → returns null', async () => {
    faMock.updateMany.mockResolvedValue({ count: 0 });
    const result = await updateForeignAsset('u1', 'fa-x', { closingValueINR: 600000 });
    expect(result).toBeNull();
  });
});

describe('deleteForeignAsset', () => {
  it('soft-deletes → returns { deleted: true }', async () => {
    const result = await deleteForeignAsset('u1', 'fa-1');
    expect(faMock.updateMany).toHaveBeenCalledWith({
      where: { id: 'fa-1', userId: 'u1', deletedAt: null },
      data: expect.objectContaining({ deletedAt: expect.any(Date) }),
    });
    expect(result).toEqual({ deleted: true });
  });

  it('not-found path: count=0 → returns null', async () => {
    faMock.updateMany.mockResolvedValue({ count: 0 });
    const result = await deleteForeignAsset('u1', 'fa-x');
    expect(result).toBeNull();
  });
});

// ─── getForeignAssetSummary ───────────────────────────────────────────────────

describe('getForeignAssetSummary', () => {
  it('returns zeros for empty asset list', async () => {
    faMock.findMany.mockResolvedValue([]);
    const r = await getForeignAssetSummary('u1', '2025-26');
    expect(r.count).toBe(0);
    expect(r.totalClosingValueINR).toBe(0);
    expect(r.totalIncomeAccruedINR).toBe(0);
    expect(r.byCategory).toEqual({});
  });

  it('single asset: count=1, totals correct, byCategory has one key', async () => {
    faMock.findMany.mockResolvedValue([MOCK_ASSET]);
    const r = await getForeignAssetSummary('u1', '2025-26');
    expect(r.count).toBe(1);
    expect(r.totalClosingValueINR).toBe(500000);
    expect(r.totalIncomeAccruedINR).toBe(12000);
    expect(r.byCategory['BANK_ACCOUNT']).toEqual({ count: 1, closingValueINR: 500000 });
  });

  it('two assets same category: byCategory count=2, closingValueINR summed', async () => {
    const asset2 = { ...MOCK_ASSET, id: 'fa-2', closingValueINR: 300000, incomeAccruedINR: 5000 };
    faMock.findMany.mockResolvedValue([MOCK_ASSET, asset2]);
    const r = await getForeignAssetSummary('u1', '2025-26');
    expect(r.count).toBe(2);
    expect(r.totalClosingValueINR).toBe(800000);
    expect(r.byCategory['BANK_ACCOUNT'].count).toBe(2);
    expect(r.byCategory['BANK_ACCOUNT'].closingValueINR).toBe(800000);
  });

  it('two assets different categories: two separate byCategory keys', async () => {
    const asset2 = { ...MOCK_ASSET, id: 'fa-2', category: 'EQUITY', closingValueINR: 200000, incomeAccruedINR: 0 };
    faMock.findMany.mockResolvedValue([MOCK_ASSET, asset2]);
    const r = await getForeignAssetSummary('u1', '2025-26');
    expect(Object.keys(r.byCategory)).toHaveLength(2);
    expect(r.byCategory['BANK_ACCOUNT'].count).toBe(1);
    expect(r.byCategory['EQUITY'].count).toBe(1);
  });
});
