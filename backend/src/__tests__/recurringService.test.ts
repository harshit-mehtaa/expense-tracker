/**
 * Unit tests for recurringService.ts.
 *
 * Key test focus: generateDueRecurringTransactions race-condition guard
 * (updateMany with nextRunDate pin prevents duplicate generation on concurrent calls)
 * and advanceDate frequency arithmetic (tested indirectly via updateMany args).
 *
 * createRecurringRule and deleteRecurringRule use $transaction — mocked via passthrough.
 * generateDueRecurringTransactions does NOT use $transaction — uses direct prisma calls.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import dayjs from 'dayjs';

// recurringService uses default import of prisma
vi.mock('../config/prisma', () => {
  const mockPrisma = {
    recurringRule: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    transaction: {
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return { default: mockPrisma, prisma: mockPrisma };
});

import prisma from '../config/prisma';
import {
  createRecurringRule,
  listRecurringRules,
  updateRecurringRule,
  deleteRecurringRule,
  generateDueRecurringTransactions,
} from '../services/recurringService';

const ruleMock = (prisma as any).recurringRule;
const txMock = (prisma as any).transaction;

// Pin system time for deterministic date assertions
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2024-01-01'));
});

afterAll(() => {
  vi.useRealTimers();
});

// $transaction passthrough: inner fn receives the same prisma mock as `tx`
beforeEach(() => {
  vi.clearAllMocks();
  (prisma as any).$transaction.mockImplementation(async (fn: any) => fn(prisma));
});

const MOCK_RULE = {
  id: 'rule-1',
  userId: 'u1',
  frequency: 'MONTHLY' as const,
  nextRunDate: new Date('2024-03-01'),
  isActive: true,
  templateTransactionId: 'tmpl-1',
  templateTransaction: {
    id: 'tmpl-1',
    userId: 'u1',
    amount: 5000,
    type: 'EXPENSE',
    description: 'Rent',
    bankAccountId: 'acct-1',
    categoryId: 'cat-1',
    paymentMode: 'BANK_TRANSFER',
    date: new Date('2024-03-01'),
    tags: [],
    gstAmount: null,
    deletedAt: null,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// listRecurringRules
// ─────────────────────────────────────────────────────────────────────────────

describe('listRecurringRules', () => {
  it('queries by userId with include and orderBy nextRunDate', async () => {
    ruleMock.findMany.mockResolvedValue([MOCK_RULE]);
    const result = await listRecurringRules('u1');
    expect(ruleMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1' },
        orderBy: { nextRunDate: 'asc' },
      }),
    );
    expect(result).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createRecurringRule
// ─────────────────────────────────────────────────────────────────────────────

describe('createRecurringRule', () => {
  it('creates template transaction and rule inside $transaction', async () => {
    const template = { id: 'tmpl-new', userId: 'u1' };
    const rule = { id: 'rule-new', userId: 'u1', templateTransactionId: 'tmpl-new' };
    txMock.create.mockResolvedValue(template);
    ruleMock.create.mockResolvedValue(rule);

    const result = await createRecurringRule('u1', {
      amount: 5000,
      type: 'EXPENSE',
      description: 'Rent',
      frequency: 'MONTHLY',
      nextRunDate: '2024-04-01',
    });

    expect((prisma as any).$transaction).toHaveBeenCalled();
    expect(txMock.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'u1', amount: 5000, isRecurring: true }),
    }));
    expect(ruleMock.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'u1', frequency: 'MONTHLY' }),
    }));
    expect(result).toBe(rule);
  });

  it('defaults nextRunDate to today when not provided', async () => {
    txMock.create.mockResolvedValue({ id: 'tmpl-new', userId: 'u1' });
    ruleMock.create.mockResolvedValue({ id: 'rule-new' });

    await createRecurringRule('u1', {
      amount: 1000,
      type: 'EXPENSE',
      description: 'Sub',
      frequency: 'MONTHLY',
    });

    // System time is pinned to 2024-01-01 via beforeAll → exact match
    const createCall = txMock.create.mock.calls[0][0];
    expect(createCall.data.date).toEqual(new Date('2024-01-01'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateRecurringRule
// ─────────────────────────────────────────────────────────────────────────────

describe('updateRecurringRule', () => {
  it('throws NotFound when rule does not exist', async () => {
    ruleMock.findFirst.mockResolvedValue(null);
    await expect(updateRecurringRule('rule-x', 'u1', { isActive: false })).rejects.toThrow(/not found/i);
  });

  it('updates only provided fields', async () => {
    ruleMock.findFirst.mockResolvedValue(MOCK_RULE);
    ruleMock.update.mockResolvedValue({ ...MOCK_RULE, isActive: false });

    await updateRecurringRule('rule-1', 'u1', { isActive: false });
    expect(ruleMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rule-1' },
        data: { isActive: false },
      }),
    );
  });

  it('converts nextRunDate string to Date', async () => {
    ruleMock.findFirst.mockResolvedValue(MOCK_RULE);
    ruleMock.update.mockResolvedValue(MOCK_RULE);

    await updateRecurringRule('rule-1', 'u1', { nextRunDate: '2024-05-01' });
    const updateCall = ruleMock.update.mock.calls[0][0];
    expect(updateCall.data.nextRunDate).toBeInstanceOf(Date);
  });

  it('includes frequency in update data when explicitly provided (covers frequency !== undefined branch)', async () => {
    ruleMock.findFirst.mockResolvedValue(MOCK_RULE);
    ruleMock.update.mockResolvedValue(MOCK_RULE);

    await updateRecurringRule('rule-1', 'u1', { frequency: 'WEEKLY' });
    const updateCall = ruleMock.update.mock.calls[0][0];
    expect(updateCall.data.frequency).toBe('WEEKLY');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteRecurringRule
// ─────────────────────────────────────────────────────────────────────────────

describe('deleteRecurringRule', () => {
  it('throws NotFound when rule does not exist', async () => {
    ruleMock.findFirst.mockResolvedValue(null);
    await expect(deleteRecurringRule('rule-x', 'u1')).rejects.toThrow(/not found/i);
  });

  it('deletes rule then soft-deletes template inside $transaction', async () => {
    ruleMock.findFirst.mockResolvedValue(MOCK_RULE);
    ruleMock.delete.mockResolvedValue(MOCK_RULE);
    txMock.update.mockResolvedValue({});

    await deleteRecurringRule('rule-1', 'u1');

    expect((prisma as any).$transaction).toHaveBeenCalled();
    // Rule deleted first (FK constraint: rule references template)
    expect(ruleMock.delete).toHaveBeenCalledWith({ where: { id: 'rule-1' } });
    // Template soft-deleted after
    expect(txMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tmpl-1' },
        data: expect.objectContaining({ isRecurring: false }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateDueRecurringTransactions
// ─────────────────────────────────────────────────────────────────────────────

describe('generateDueRecurringTransactions', () => {
  it('returns generated: 0 when no due rules exist', async () => {
    ruleMock.findMany.mockResolvedValue([]);
    const result = await generateDueRecurringTransactions('u1');
    expect(result).toEqual({ generated: 0 });
    expect(txMock.create).not.toHaveBeenCalled();
  });

  it('skips rule whose template has deletedAt set', async () => {
    const deletedTemplate = { ...MOCK_RULE.templateTransaction, deletedAt: new Date() };
    ruleMock.findMany.mockResolvedValue([{ ...MOCK_RULE, templateTransaction: deletedTemplate }]);
    const result = await generateDueRecurringTransactions('u1');
    expect(result).toEqual({ generated: 0 });
    expect(ruleMock.updateMany).not.toHaveBeenCalled();
  });

  it('race guard: skips when updateMany returns count=0 (another request ran first)', async () => {
    ruleMock.findMany.mockResolvedValue([MOCK_RULE]);
    ruleMock.updateMany.mockResolvedValue({ count: 0 }); // another request already advanced
    const result = await generateDueRecurringTransactions('u1');
    expect(result).toEqual({ generated: 0 });
    expect(txMock.create).not.toHaveBeenCalled();
  });

  it('happy path: updateMany returns count=1 → creates transaction, returns generated: 1', async () => {
    ruleMock.findMany.mockResolvedValue([MOCK_RULE]);
    ruleMock.updateMany.mockResolvedValue({ count: 1 });
    txMock.create.mockResolvedValue({});

    const result = await generateDueRecurringTransactions('u1');
    expect(result).toEqual({ generated: 1 });
    expect(txMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u1',
          amount: 5000,
          type: 'EXPENSE',
          isRecurring: false, // generated copy is NOT a template
        }),
      }),
    );
  });

  it('processes multiple due rules independently', async () => {
    const rule2 = { ...MOCK_RULE, id: 'rule-2' };
    ruleMock.findMany.mockResolvedValue([MOCK_RULE, rule2]);
    ruleMock.updateMany.mockResolvedValue({ count: 1 });
    txMock.create.mockResolvedValue({});

    const result = await generateDueRecurringTransactions('u1');
    expect(result).toEqual({ generated: 2 });
    expect(ruleMock.updateMany).toHaveBeenCalledTimes(2);
    expect(txMock.create).toHaveBeenCalledTimes(2);
  });

  // ─── advanceDate frequency tests (tested indirectly via updateMany nextRunDate arg) ───

  it('MONTHLY: advances nextRunDate by 1 month', async () => {
    const base = new Date('2024-03-01');
    ruleMock.findMany.mockResolvedValue([{ ...MOCK_RULE, frequency: 'MONTHLY', nextRunDate: base }]);
    ruleMock.updateMany.mockResolvedValue({ count: 1 });
    txMock.create.mockResolvedValue({});

    await generateDueRecurringTransactions('u1');
    const updateCall = ruleMock.updateMany.mock.calls[0][0];
    const advanced: Date = updateCall.data.nextRunDate;
    expect(dayjs(advanced).format('YYYY-MM-DD')).toBe('2024-04-01');
  });

  it('DAILY: advances nextRunDate by 1 day', async () => {
    const base = new Date('2024-03-15');
    ruleMock.findMany.mockResolvedValue([{ ...MOCK_RULE, frequency: 'DAILY', nextRunDate: base }]);
    ruleMock.updateMany.mockResolvedValue({ count: 1 });
    txMock.create.mockResolvedValue({});

    await generateDueRecurringTransactions('u1');
    const updateCall = ruleMock.updateMany.mock.calls[0][0];
    const advanced: Date = updateCall.data.nextRunDate;
    expect(dayjs(advanced).format('YYYY-MM-DD')).toBe('2024-03-16');
  });

  it('WEEKLY: advances nextRunDate by 7 days', async () => {
    const base = new Date('2024-03-01');
    ruleMock.findMany.mockResolvedValue([{ ...MOCK_RULE, frequency: 'WEEKLY', nextRunDate: base }]);
    ruleMock.updateMany.mockResolvedValue({ count: 1 });
    txMock.create.mockResolvedValue({});

    await generateDueRecurringTransactions('u1');
    const updateCall = ruleMock.updateMany.mock.calls[0][0];
    const advanced: Date = updateCall.data.nextRunDate;
    expect(dayjs(advanced).format('YYYY-MM-DD')).toBe('2024-03-08');
  });

  it('QUARTERLY: advances nextRunDate by 3 months', async () => {
    const base = new Date('2024-01-01');
    ruleMock.findMany.mockResolvedValue([{ ...MOCK_RULE, frequency: 'QUARTERLY', nextRunDate: base }]);
    ruleMock.updateMany.mockResolvedValue({ count: 1 });
    txMock.create.mockResolvedValue({});

    await generateDueRecurringTransactions('u1');
    const updateCall = ruleMock.updateMany.mock.calls[0][0];
    const advanced: Date = updateCall.data.nextRunDate;
    expect(dayjs(advanced).format('YYYY-MM-DD')).toBe('2024-04-01');
  });

  it('YEARLY: advances nextRunDate by 1 year', async () => {
    const base = new Date('2024-03-01');
    ruleMock.findMany.mockResolvedValue([{ ...MOCK_RULE, frequency: 'YEARLY', nextRunDate: base }]);
    ruleMock.updateMany.mockResolvedValue({ count: 1 });
    txMock.create.mockResolvedValue({});

    await generateDueRecurringTransactions('u1');
    const updateCall = ruleMock.updateMany.mock.calls[0][0];
    const advanced: Date = updateCall.data.nextRunDate;
    expect(dayjs(advanced).format('YYYY-MM-DD')).toBe('2025-03-01');
  });
});
