/**
 * Unit tests for otherIncomeService.ts
 *
 * Covers: CRUD (listOtherIncome, getOtherIncome, createOtherIncome,
 * updateOtherIncome, deleteOtherIncome) and calcOtherIncomeSummary
 * with all sourceTypes, 80TTA deduction, and OLD vs NEW regime.
 *
 * Uses named import { prisma } — dual-export mock required.
 * NOTE: updateOtherIncome re-fetches via findUnique (not findFirst).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/prisma', () => {
  const mock = {
    otherSourceIncome: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  return { default: mock, prisma: mock };
});

import { prisma } from '../config/prisma';
import {
  listOtherIncome,
  getOtherIncome,
  createOtherIncome,
  updateOtherIncome,
  deleteOtherIncome,
  calcOtherIncomeSummary,
} from '../services/otherIncomeService';

const oimMock = (prisma as any).otherSourceIncome;

const MOCK_ENTRY = {
  id: 'oi-1',
  userId: 'u1',
  fyYear: '2025-26',
  sourceType: 'FD_INTEREST',
  amount: 5000,
  tdsDeducted: 500,
  description: 'SBI FD interest',
  deletedAt: null,
  createdAt: new Date('2025-04-01'),
};

beforeEach(() => {
  vi.clearAllMocks();
  oimMock.findMany.mockResolvedValue([MOCK_ENTRY]);
  oimMock.findFirst.mockResolvedValue(MOCK_ENTRY);
  oimMock.findUnique.mockResolvedValue(MOCK_ENTRY);
  oimMock.create.mockResolvedValue(MOCK_ENTRY);
  oimMock.updateMany.mockResolvedValue({ count: 1 });
});

// ─── CRUD ─────────────────────────────────────────────────────────────────────

describe('listOtherIncome', () => {
  it('queries by userId, fyYear, and deletedAt: null', async () => {
    const result = await listOtherIncome('u1', '2025-26');
    expect(oimMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', fyYear: '2025-26', deletedAt: null } }),
    );
    expect(result).toHaveLength(1);
  });
});

describe('getOtherIncome', () => {
  it('returns entry when found', async () => {
    const result = await getOtherIncome('u1', 'oi-1');
    expect(oimMock.findFirst).toHaveBeenCalledWith({
      where: { id: 'oi-1', userId: 'u1', deletedAt: null },
    });
    expect(result).toBeDefined();
  });

  it('returns null when not found', async () => {
    oimMock.findFirst.mockResolvedValue(null);
    const result = await getOtherIncome('u1', 'oi-x');
    expect(result).toBeNull();
  });
});

describe('createOtherIncome', () => {
  it('merges userId into data and calls create', async () => {
    const data = { fyYear: '2025-26', sourceType: 'DIVIDEND' as const, amount: 3000 };
    await createOtherIncome('u1', data as any);
    expect(oimMock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'u1', fyYear: '2025-26', amount: 3000 }),
    });
  });
});

describe('updateOtherIncome', () => {
  it('happy path: updateMany count=1 → re-fetches via findUnique and returns record', async () => {
    const updated = { ...MOCK_ENTRY, amount: 6000 };
    oimMock.findUnique.mockResolvedValue(updated);
    const result = await updateOtherIncome('u1', 'oi-1', { amount: 6000 });
    expect(oimMock.updateMany).toHaveBeenCalledWith({
      where: { id: 'oi-1', userId: 'u1', deletedAt: null },
      data: { amount: 6000 },
    });
    expect(oimMock.findUnique).toHaveBeenCalledWith({ where: { id: 'oi-1' } });
    expect(result).toEqual(updated);
  });

  it('not-found path: updateMany count=0 → returns null, findUnique not called', async () => {
    oimMock.updateMany.mockResolvedValue({ count: 0 });
    const result = await updateOtherIncome('u1', 'oi-x', { amount: 6000 });
    expect(result).toBeNull();
    expect(oimMock.findUnique).not.toHaveBeenCalled();
  });
});

describe('deleteOtherIncome', () => {
  it('soft-deletes by setting deletedAt → returns { deleted: true }', async () => {
    const result = await deleteOtherIncome('u1', 'oi-1');
    expect(oimMock.updateMany).toHaveBeenCalledWith({
      where: { id: 'oi-1', userId: 'u1', deletedAt: null },
      data: expect.objectContaining({ deletedAt: expect.any(Date) }),
    });
    expect(result).toEqual({ deleted: true });
  });

  it('not-found path: count=0 → returns null', async () => {
    oimMock.updateMany.mockResolvedValue({ count: 0 });
    const result = await deleteOtherIncome('u1', 'oi-x');
    expect(result).toBeNull();
  });
});

// ─── calcOtherIncomeSummary ────────────────────────────────────────────────────

function makeEntry(sourceType: string, amount: number, tdsDeducted = 0) {
  return { ...MOCK_ENTRY, id: `oi-${Math.random()}`, sourceType, amount, tdsDeducted };
}

describe('calcOtherIncomeSummary', () => {
  it('FD_INTEREST: accumulates in breakdown.fdInterest and totalTdsDeducted', async () => {
    oimMock.findMany.mockResolvedValue([makeEntry('FD_INTEREST', 10000, 1000)]);
    const r = await calcOtherIncomeSummary('u1', '2025-26');
    expect(r.breakdown.fdInterest).toBe(10000);
    expect(r.totalTdsDeducted).toBe(1000);
    expect(r.foreignDividend).toBe(0);
  });

  it('RD_INTEREST: accumulates in breakdown.rdInterest', async () => {
    oimMock.findMany.mockResolvedValue([makeEntry('RD_INTEREST', 4000, 400)]);
    const r = await calcOtherIncomeSummary('u1', '2025-26');
    expect(r.breakdown.rdInterest).toBe(4000);
    expect(r.totalTdsDeducted).toBe(400);
  });

  it('SAVINGS_INTEREST OLD regime: deduction80TTA = Math.min(savings, 10000)', async () => {
    oimMock.findMany.mockResolvedValue([makeEntry('SAVINGS_INTEREST', 8000)]);
    const r = await calcOtherIncomeSummary('u1', '2025-26', 'OLD');
    expect(r.breakdown.savingsInterest).toBe(8000);
    expect(r.deduction80TTA).toBe(8000); // min(8000, 10000)
    expect(r.taxableTotal).toBe(0); // 8000 - 8000
  });

  it('SAVINGS_INTEREST OLD regime: 80TTA capped at ₹10K when interest > 10000', async () => {
    oimMock.findMany.mockResolvedValue([makeEntry('SAVINGS_INTEREST', 15000)]);
    const r = await calcOtherIncomeSummary('u1', '2025-26', 'OLD');
    expect(r.deduction80TTA).toBe(10000);
    expect(r.taxableTotal).toBe(5000); // 15000 - 10000
  });

  it('SAVINGS_INTEREST NEW regime: deduction80TTA = 0', async () => {
    oimMock.findMany.mockResolvedValue([makeEntry('SAVINGS_INTEREST', 12000)]);
    const r = await calcOtherIncomeSummary('u1', '2025-26', 'NEW');
    expect(r.deduction80TTA).toBe(0);
    expect(r.taxableTotal).toBe(12000);
  });

  it('DIVIDEND: accumulates in breakdown.dividend with TDS', async () => {
    oimMock.findMany.mockResolvedValue([makeEntry('DIVIDEND', 20000, 2000)]);
    const r = await calcOtherIncomeSummary('u1', '2025-26');
    expect(r.breakdown.dividend).toBe(20000);
    expect(r.totalTdsDeducted).toBe(2000);
  });

  it('GIFT: accumulates in breakdown.gift', async () => {
    oimMock.findMany.mockResolvedValue([makeEntry('GIFT', 5000, 0)]);
    const r = await calcOtherIncomeSummary('u1', '2025-26');
    expect(r.breakdown.gift).toBe(5000);
  });

  it('FOREIGN_DIVIDEND: tracked in foreignDividend and totalForeignWithholdingTax, NOT in totalTdsDeducted', async () => {
    oimMock.findMany.mockResolvedValue([makeEntry('FOREIGN_DIVIDEND', 30000, 4500)]);
    const r = await calcOtherIncomeSummary('u1', '2025-26');
    expect(r.foreignDividend).toBe(30000);
    expect(r.totalForeignWithholdingTax).toBe(4500);
    expect(r.totalTdsDeducted).toBe(0); // NOT added to domestic TDS
    expect(r.grossTotal).toBe(30000);
  });

  it('OTHER/unknown sourceType: falls into breakdown.other', async () => {
    oimMock.findMany.mockResolvedValue([makeEntry('OTHER', 7000, 0)]);
    const r = await calcOtherIncomeSummary('u1', '2025-26');
    expect(r.breakdown.other).toBe(7000);
  });

  it('empty entries: all zeros', async () => {
    oimMock.findMany.mockResolvedValue([]);
    const r = await calcOtherIncomeSummary('u1', '2025-26');
    expect(r.grossTotal).toBe(0);
    expect(r.taxableTotal).toBe(0);
    expect(r.totalTdsDeducted).toBe(0);
  });

  it('mixed entries: grossTotal = domesticGross + foreignDividend', async () => {
    oimMock.findMany.mockResolvedValue([
      makeEntry('FD_INTEREST', 10000, 1000),
      makeEntry('FOREIGN_DIVIDEND', 5000, 750),
      makeEntry('SAVINGS_INTEREST', 3000, 0),
    ]);
    const r = await calcOtherIncomeSummary('u1', '2025-26', 'OLD');
    // domestic = 10000 + 3000 = 13000, foreign = 5000
    expect(r.grossTotal).toBe(18000);
    expect(r.totalForeignWithholdingTax).toBe(750);
    expect(r.totalTdsDeducted).toBe(1000);
    expect(r.deduction80TTA).toBe(3000); // min(3000, 10000)
  });

  it('defaults to OLD regime when not specified', async () => {
    oimMock.findMany.mockResolvedValue([makeEntry('SAVINGS_INTEREST', 6000)]);
    const r = await calcOtherIncomeSummary('u1', '2025-26'); // no regime param
    expect(r.deduction80TTA).toBe(6000); // OLD regime applied
  });
});
