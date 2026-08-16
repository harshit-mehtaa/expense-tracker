/**
 * Unit tests for refundReporting.ts
 *
 * Refunds are stored as INCOME transactions that point back at the original
 * expense via refundForTransactionId. Reporting must therefore subtract them
 * from the expense side rather than counting them as income — and it must
 * attribute the subtraction to the ORIGINAL expense's owner and category, not
 * to whoever recorded the refund.
 *
 * Uses default import `prisma` in the source — dual-export mock required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/prisma', () => {
  const mock = {
    transaction: {
      aggregate: vi.fn(),
      groupBy: vi.fn(),
      findMany: vi.fn(),
    },
  };
  return { default: mock, prisma: mock };
});

import prisma from '../config/prisma';
import {
  reportingTransactionWhere,
  reportingIncomeWhere,
  reportingExpenseWhere,
  reportingRefundWhere,
  getNetExpenseTotal,
  getNetExpenseByUserCategory,
} from '../utils/refundReporting';

const txMock = (prisma as any).transaction;

const USER_FILTER = { userId: 'u1' };
const DATE_FILTER = { gte: new Date('2024-04-01'), lte: new Date('2025-03-31') };

beforeEach(() => {
  vi.clearAllMocks();
  txMock.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
  txMock.groupBy.mockResolvedValue([]);
  txMock.findMany.mockResolvedValue([]);
});

// ─── where-builders ───────────────────────────────────────────────────────────

describe('reportingTransactionWhere', () => {
  it('always excludes soft-deleted rows, transfer legs, and SIP-generated rows', () => {
    expect(reportingTransactionWhere()).toEqual({
      deletedAt: null,
      transferPairId: null,
      sipId: null,
    });
  });

  it('merges the caller\'s user filter', () => {
    expect(reportingTransactionWhere(USER_FILTER)).toMatchObject({ userId: 'u1', deletedAt: null });
  });

  it('includes the date filter when one is supplied', () => {
    expect(reportingTransactionWhere(USER_FILTER, DATE_FILTER)).toMatchObject({ date: DATE_FILTER });
  });

  it('omits the date key entirely when no date is supplied', () => {
    expect(reportingTransactionWhere(USER_FILTER)).not.toHaveProperty('date');
  });
});

describe('reportingIncomeWhere', () => {
  it('selects INCOME rows that are NOT refunds', () => {
    expect(reportingIncomeWhere(USER_FILTER, DATE_FILTER)).toEqual({
      userId: 'u1',
      deletedAt: null,
      transferPairId: null,
      sipId: null,
      date: DATE_FILTER,
      type: 'INCOME',
      refundForTransactionId: null,
    });
  });

  it('works with no arguments at all', () => {
    expect(reportingIncomeWhere()).toMatchObject({ type: 'INCOME', refundForTransactionId: null });
  });
});

describe('reportingExpenseWhere', () => {
  it('selects EXPENSE rows without any refund constraint', () => {
    const where = reportingExpenseWhere(USER_FILTER, DATE_FILTER);
    expect(where).toMatchObject({ type: 'EXPENSE', userId: 'u1', date: DATE_FILTER });
    expect(where).not.toHaveProperty('refundForTransactionId');
  });
});

describe('reportingRefundWhere', () => {
  it('selects only INCOME rows that DO point at an original transaction', () => {
    expect(reportingRefundWhere(USER_FILTER, DATE_FILTER)).toEqual({
      userId: 'u1',
      deletedAt: null,
      transferPairId: null,
      sipId: null,
      date: DATE_FILTER,
      type: 'INCOME',
      refundForTransactionId: { not: null },
    });
  });

  it('is the exact complement of reportingIncomeWhere on refundForTransactionId', () => {
    expect(reportingIncomeWhere(USER_FILTER).refundForTransactionId).toBeNull();
    expect(reportingRefundWhere(USER_FILTER).refundForTransactionId).toEqual({ not: null });
  });
});

// ─── getNetExpenseTotal ───────────────────────────────────────────────────────

describe('getNetExpenseTotal', () => {
  it('subtracts refunds from expenses', async () => {
    txMock.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 10_000 } }) // expenses
      .mockResolvedValueOnce({ _sum: { amount: 2_500 } }); // refunds
    expect(await getNetExpenseTotal(USER_FILTER, DATE_FILTER)).toBe(7_500);
  });

  it('treats a null expense sum as 0 (no matching rows)', async () => {
    txMock.aggregate
      .mockResolvedValueOnce({ _sum: { amount: null } })
      .mockResolvedValueOnce({ _sum: { amount: 400 } });
    expect(await getNetExpenseTotal(USER_FILTER, DATE_FILTER)).toBe(-400);
  });

  it('treats a null refund sum as 0', async () => {
    txMock.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 900 } })
      .mockResolvedValueOnce({ _sum: { amount: null } });
    expect(await getNetExpenseTotal(USER_FILTER, DATE_FILTER)).toBe(900);
  });

  it('converts Prisma Decimal-like values via Number()', async () => {
    // Prisma returns Decimal objects, not JS numbers — the helper must coerce.
    const decimal = (v: string) => ({ toString: () => v, valueOf: () => Number(v) });
    txMock.aggregate
      .mockResolvedValueOnce({ _sum: { amount: decimal('1250.50') } })
      .mockResolvedValueOnce({ _sum: { amount: decimal('250.25') } });
    expect(await getNetExpenseTotal(USER_FILTER, DATE_FILTER)).toBe(1000.25);
  });

  it('queries expenses and refunds with the matching where-clauses', async () => {
    await getNetExpenseTotal(USER_FILTER, DATE_FILTER);
    expect(txMock.aggregate).toHaveBeenCalledTimes(2);
    expect(txMock.aggregate.mock.calls[0][0].where).toMatchObject({ type: 'EXPENSE' });
    expect(txMock.aggregate.mock.calls[1][0].where).toMatchObject({
      type: 'INCOME',
      refundForTransactionId: { not: null },
    });
  });

  it('can go negative when refunds exceed expenses in the period', async () => {
    txMock.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 100 } })
      .mockResolvedValueOnce({ _sum: { amount: 750 } });
    expect(await getNetExpenseTotal(USER_FILTER, DATE_FILTER)).toBe(-650);
  });
});

// ─── getNetExpenseByUserCategory ──────────────────────────────────────────────

describe('getNetExpenseByUserCategory', () => {
  it('returns an empty map when there are no expenses and no refunds', async () => {
    const totals = await getNetExpenseByUserCategory(USER_FILTER, DATE_FILTER);
    expect(totals.size).toBe(0);
  });

  it('keys expense totals by `userId:categoryId`', async () => {
    txMock.groupBy.mockResolvedValue([
      { userId: 'u1', categoryId: 'c1', _sum: { amount: 5_000 } },
      { userId: 'u2', categoryId: 'c2', _sum: { amount: 3_000 } },
    ]);
    const totals = await getNetExpenseByUserCategory(USER_FILTER, DATE_FILTER);
    expect(totals.get('u1:c1')).toBe(5_000);
    expect(totals.get('u2:c2')).toBe(3_000);
  });

  it('uses an empty string for a null expense categoryId', async () => {
    txMock.groupBy.mockResolvedValue([{ userId: 'u1', categoryId: null, _sum: { amount: 700 } }]);
    const totals = await getNetExpenseByUserCategory(USER_FILTER, DATE_FILTER);
    expect(totals.get('u1:')).toBe(700);
  });

  it('treats a null expense sum as 0', async () => {
    txMock.groupBy.mockResolvedValue([{ userId: 'u1', categoryId: 'c1', _sum: { amount: null } }]);
    const totals = await getNetExpenseByUserCategory(USER_FILTER, DATE_FILTER);
    expect(totals.get('u1:c1')).toBe(0);
  });

  it('subtracts a refund from the ORIGINAL expense\'s user and category, not the refund row\'s own', async () => {
    txMock.groupBy.mockResolvedValue([{ userId: 'u1', categoryId: 'c1', _sum: { amount: 5_000 } }]);
    txMock.findMany.mockResolvedValue([
      // Recorded against u2, but refunds u1's c1 expense — must debit u1:c1.
      { amount: 1_200, userId: 'u2', refundFor: { userId: 'u1', categoryId: 'c1' } },
    ]);
    const totals = await getNetExpenseByUserCategory(USER_FILTER, DATE_FILTER);
    expect(totals.get('u1:c1')).toBe(3_800);
    expect(totals.has('u2:c1')).toBe(false);
  });

  it('falls back to the refund row\'s own userId when refundFor is null (orphaned refund)', async () => {
    txMock.findMany.mockResolvedValue([{ amount: 300, userId: 'u9', refundFor: null }]);
    const totals = await getNetExpenseByUserCategory(USER_FILTER, DATE_FILTER);
    expect(totals.get('u9:')).toBe(-300);
  });

  it('falls back to an empty category key when the original expense had no category', async () => {
    txMock.findMany.mockResolvedValue([
      { amount: 150, userId: 'u1', refundFor: { userId: 'u1', categoryId: null } },
    ]);
    const totals = await getNetExpenseByUserCategory(USER_FILTER, DATE_FILTER);
    expect(totals.get('u1:')).toBe(-150);
  });

  it('creates a negative entry when a refund has no matching expense in the period', async () => {
    txMock.groupBy.mockResolvedValue([]);
    txMock.findMany.mockResolvedValue([
      { amount: 900, userId: 'u1', refundFor: { userId: 'u1', categoryId: 'c1' } },
    ]);
    const totals = await getNetExpenseByUserCategory(USER_FILTER, DATE_FILTER);
    expect(totals.get('u1:c1')).toBe(-900);
  });

  it('accumulates multiple refunds against the same key', async () => {
    txMock.groupBy.mockResolvedValue([{ userId: 'u1', categoryId: 'c1', _sum: { amount: 10_000 } }]);
    txMock.findMany.mockResolvedValue([
      { amount: 1_000, userId: 'u1', refundFor: { userId: 'u1', categoryId: 'c1' } },
      { amount: 2_500, userId: 'u1', refundFor: { userId: 'u1', categoryId: 'c1' } },
    ]);
    const totals = await getNetExpenseByUserCategory(USER_FILTER, DATE_FILTER);
    expect(totals.get('u1:c1')).toBe(6_500);
  });

  it('converts Prisma Decimal-like refund amounts via Number()', async () => {
    txMock.groupBy.mockResolvedValue([{ userId: 'u1', categoryId: 'c1', _sum: { amount: 1_000 } }]);
    txMock.findMany.mockResolvedValue([
      { amount: { valueOf: () => 249.75 }, userId: 'u1', refundFor: { userId: 'u1', categoryId: 'c1' } },
    ]);
    const totals = await getNetExpenseByUserCategory(USER_FILTER, DATE_FILTER);
    expect(totals.get('u1:c1')).toBe(750.25);
  });

  it('applies a categoryId filter to both the expense and the refund query', async () => {
    await getNetExpenseByUserCategory(USER_FILTER, DATE_FILTER, ['c1', 'c2']);
    expect(txMock.groupBy.mock.calls[0][0].where).toMatchObject({ categoryId: { in: ['c1', 'c2'] } });
    expect(txMock.findMany.mock.calls[0][0].where).toMatchObject({
      refundFor: { is: { categoryId: { in: ['c1', 'c2'] } } },
    });
  });

  it('applies no category filter when categoryIds is undefined', async () => {
    await getNetExpenseByUserCategory(USER_FILTER, DATE_FILTER);
    expect(txMock.groupBy.mock.calls[0][0].where).not.toHaveProperty('categoryId');
    expect(txMock.findMany.mock.calls[0][0].where).not.toHaveProperty('refundFor');
  });

  it('applies no category filter when categoryIds is an empty array', async () => {
    await getNetExpenseByUserCategory(USER_FILTER, DATE_FILTER, []);
    expect(txMock.groupBy.mock.calls[0][0].where).not.toHaveProperty('categoryId');
    expect(txMock.findMany.mock.calls[0][0].where).not.toHaveProperty('refundFor');
  });

  it('groups expenses by userId and categoryId', async () => {
    await getNetExpenseByUserCategory(USER_FILTER, DATE_FILTER);
    expect(txMock.groupBy.mock.calls[0][0].by).toEqual(['userId', 'categoryId']);
  });
});
