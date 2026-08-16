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
    bankAccount: {
      update: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
    subscription: {
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
  generateDueRecurringTransactionsForAllUsers,
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
    // System time MUST be at/after nextRunDate or the catch-up `while` loop never
    // runs and this test passes vacuously without ever reaching the race guard.
    vi.setSystemTime(new Date('2024-03-01T12:00:00Z'));
    ruleMock.findMany.mockResolvedValue([MOCK_RULE]);
    ruleMock.updateMany.mockResolvedValue({ count: 0 }); // another request already advanced
    const result = await generateDueRecurringTransactions('u1');
    expect(result).toEqual({ generated: 0 });
    expect(ruleMock.updateMany).toHaveBeenCalledTimes(1); // guard was actually exercised
    expect(txMock.create).not.toHaveBeenCalled();
  });

  it('INCOME template credits the linked account (positive balance delta)', async () => {
    vi.setSystemTime(new Date('2024-03-01T12:00:00Z'));
    const incomeRule = {
      ...MOCK_RULE,
      templateTransaction: { ...MOCK_RULE.templateTransaction, type: 'INCOME', amount: 5000 },
    };
    ruleMock.findMany.mockResolvedValue([incomeRule]);
    ruleMock.updateMany.mockResolvedValue({ count: 1 });
    txMock.create.mockResolvedValue({});
    (prisma as any).bankAccount.update.mockResolvedValue({});

    await generateDueRecurringTransactions('u1');
    expect((prisma as any).bankAccount.update).toHaveBeenCalledWith({
      where: { id: 'acct-1' },
      data: { currentBalance: { increment: 5000 } },
    });
  });

  it('EXPENSE template debits the linked account (negative balance delta)', async () => {
    vi.setSystemTime(new Date('2024-03-01T12:00:00Z'));
    ruleMock.findMany.mockResolvedValue([MOCK_RULE]); // type: 'EXPENSE'
    ruleMock.updateMany.mockResolvedValue({ count: 1 });
    txMock.create.mockResolvedValue({});
    (prisma as any).bankAccount.update.mockResolvedValue({});

    await generateDueRecurringTransactions('u1');
    expect((prisma as any).bankAccount.update).toHaveBeenCalledWith({
      where: { id: 'acct-1' },
      data: { currentBalance: { increment: -5000 } },
    });
  });

  it('happy path: updateMany returns count=1 → creates transaction, returns generated: 1', async () => {
    vi.setSystemTime(new Date('2024-03-01T12:00:00Z'));
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
    vi.setSystemTime(new Date('2024-03-01T12:00:00Z'));
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
    vi.setSystemTime(new Date('2024-03-01T12:00:00Z'));
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
    vi.setSystemTime(new Date('2024-03-15T12:00:00Z'));
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
    vi.setSystemTime(new Date('2024-03-01T12:00:00Z'));
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
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
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
    vi.setSystemTime(new Date('2024-03-01T12:00:00Z'));
    ruleMock.findMany.mockResolvedValue([{ ...MOCK_RULE, frequency: 'YEARLY', nextRunDate: base }]);
    ruleMock.updateMany.mockResolvedValue({ count: 1 });
    txMock.create.mockResolvedValue({});

    await generateDueRecurringTransactions('u1');
    const updateCall = ruleMock.updateMany.mock.calls[0][0];
    const advanced: Date = updateCall.data.nextRunDate;
    expect(dayjs(advanced).format('YYYY-MM-DD')).toBe('2025-03-01');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateDueRecurringTransactionsForAllUsers
//
// Cron entry point — invoked from src/index.ts, not from any route. Fans out
// over every active, non-deleted user and sums their per-user generation counts.
// ─────────────────────────────────────────────────────────────────────────────

describe('generateDueRecurringTransactionsForAllUsers', () => {
  const userMock = () => (prisma as any).user;

  it('queries only active, non-soft-deleted users and selects just the id', async () => {
    userMock().findMany.mockResolvedValue([]);
    await generateDueRecurringTransactionsForAllUsers();
    expect(userMock().findMany).toHaveBeenCalledWith({
      where: { isActive: true, deletedAt: null },
      select: { id: true },
    });
  });

  it('returns zeros when there are no active users', async () => {
    userMock().findMany.mockResolvedValue([]);
    const result = await generateDueRecurringTransactionsForAllUsers();
    expect(result).toEqual({ generated: 0, usersProcessed: 0 });
    expect(ruleMock.findMany).not.toHaveBeenCalled();
  });

  it('counts users processed even when none of them have due rules', async () => {
    userMock().findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
    ruleMock.findMany.mockResolvedValue([]);
    const result = await generateDueRecurringTransactionsForAllUsers();
    expect(result).toEqual({ generated: 0, usersProcessed: 2 });
    expect(ruleMock.findMany).toHaveBeenCalledTimes(2);
  });

  it('scopes the due-rule lookup to each user in turn', async () => {
    userMock().findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
    ruleMock.findMany.mockResolvedValue([]);
    await generateDueRecurringTransactionsForAllUsers();
    expect(ruleMock.findMany.mock.calls[0][0].where.userId).toBe('u1');
    expect(ruleMock.findMany.mock.calls[1][0].where.userId).toBe('u2');
  });

  it('sums generated counts across users', async () => {
    vi.setSystemTime(new Date('2024-03-01T12:00:00Z'));
    userMock().findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
    // u1 has one due rule, u2 has none
    ruleMock.findMany
      .mockResolvedValueOnce([MOCK_RULE])
      .mockResolvedValueOnce([]);
    ruleMock.updateMany.mockResolvedValue({ count: 1 });
    txMock.create.mockResolvedValue({});
    (prisma as any).bankAccount.update.mockResolvedValue({});

    const result = await generateDueRecurringTransactionsForAllUsers();
    expect(result).toEqual({ generated: 1, usersProcessed: 2 });
  });
});


// ─── Subscription-owned rules ────────────────────────────────────────────────

/**
 * A subscription is billed at the price in effect on each DUE DATE. Reading one fixed
 * amount meant a price rise recorded today would retroactively reprice every backfilled
 * month, so a container that had been down across a rise would post a ledger of charges
 * that never happened.
 */
describe('generation for a subscription-owned rule', () => {
  const SUBSCRIPTION_RULE = {
    ...MOCK_RULE,
    id: 'rule-sub',
    subscriptionId: 'sub-1',
    nextRunDate: new Date('2024-01-01'),
    templateTransaction: { ...MOCK_RULE.templateTransaction, amount: 649, description: 'Netflix' },
    subscription: {
      id: 'sub-1',
      status: 'ACTIVE',
      prices: [
        { amount: 499, effectiveFrom: new Date('2023-01-01') },
        { amount: 649, effectiveFrom: new Date('2024-03-01') },
      ],
    },
  };

  beforeEach(() => {
    ruleMock.updateMany.mockResolvedValue({ count: 1 });
    txMock.create.mockResolvedValue({ id: 'gen-1' });
    (prisma as any).bankAccount.update.mockResolvedValue({});
    (prisma as any).subscription.update.mockResolvedValue({});
  });

  it('bills each backfilled month at the price in effect THEN, not today', async () => {
    // Catching up Jan..May 2024 across a 1 Mar rise from 499 to 649.
    ruleMock.findMany.mockResolvedValue([SUBSCRIPTION_RULE]);

    await generateDueRecurringTransactions('u1');

    const amounts = txMock.create.mock.calls.map((c: any) => Number(c[0].data.amount));
    // Jan, Feb at 499; Mar onward at 649. The old code produced 649 for all of them.
    expect(amounts.slice(0, 2)).toEqual([499, 499]);
    expect(amounts[2]).toBe(649);
    expect(new Set(amounts)).toEqual(new Set([499, 649]));
  });

  it('attributes every generated charge to its subscription', async () => {
    ruleMock.findMany.mockResolvedValue([SUBSCRIPTION_RULE]);

    await generateDueRecurringTransactions('u1');

    for (const call of txMock.create.mock.calls) {
      expect(call[0].data.subscriptionId).toBe('sub-1');
    }
  });

  it('adjusts the account balance by the resolved price, not the template amount', async () => {
    ruleMock.findMany.mockResolvedValue([SUBSCRIPTION_RULE]);

    await generateDueRecurringTransactions('u1');

    const firstDelta = (prisma as any).bankAccount.update.mock.calls[0][0].data.currentBalance.increment;
    // EXPENSE at the Jan price of 499 -> -499, not -649.
    expect(firstDelta).toBe(-499);
  });

  it('does not bill a cancelled subscription even if its rule reaches the generator', async () => {
    // Pre-mortem #3 named exactly this failure: a cancelled subscription that keeps
    // billing. cancelSubscription sets isActive:false, and there are TWO independent
    // barriers — the due-rule query, and the atomic updateMany guard inside the
    // transaction. This forces the rule past the first barrier to prove the second one
    // is real, which a test that only checks the query filter would not.
    ruleMock.findMany.mockResolvedValue([{ ...SUBSCRIPTION_RULE, isActive: false }]);
    ruleMock.updateMany.mockResolvedValue({ count: 0 }); // guard rejects an inactive rule

    const result = await generateDueRecurringTransactions('u1');

    expect(result.generated).toBe(0);
    expect(txMock.create).not.toHaveBeenCalled();
    // The guard pins isActive, so a deactivated rule can never win the race.
    expect(ruleMock.updateMany.mock.calls[0][0].where.isActive).toBe(true);
  });

  it('stops rather than inventing an amount when no price covers the date', async () => {
    // Bad data: the rule is due before any recorded price exists.
    ruleMock.findMany.mockResolvedValue([{
      ...SUBSCRIPTION_RULE,
      nextRunDate: new Date('2022-01-01'),
      subscription: {
        ...SUBSCRIPTION_RULE.subscription,
        prices: [{ amount: 499, effectiveFrom: new Date('2023-01-01') }],
      },
    }]);

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await generateDueRecurringTransactions('u1');

    expect(result.generated).toBe(0);
    expect(txMock.create).not.toHaveBeenCalled();
    // Silence here is the real danger: a subscription that stops billing looks exactly
    // like one that is not due, so the stop has to be announced.
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('no price covering its due date'),
      expect.objectContaining({ subscriptionId: 'sub-1' }),
    );
    errorSpy.mockRestore();
  });

  it('converts a trial to ACTIVE on the first real charge', async () => {
    ruleMock.findMany.mockResolvedValue([{
      ...SUBSCRIPTION_RULE,
      nextRunDate: new Date('2024-03-01'),
      subscription: { ...SUBSCRIPTION_RULE.subscription, status: 'TRIALING' },
    }]);

    await generateDueRecurringTransactions('u1');

    expect((prisma as any).subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sub-1' }, data: { status: 'ACTIVE' } }),
    );
  });

  it('leaves a plain recurring rule on its template amount', async () => {
    // The regression guard for every non-subscription rule in the system.
    ruleMock.findMany.mockResolvedValue([{ ...MOCK_RULE, subscriptionId: null, subscription: null }]);

    await generateDueRecurringTransactions('u1');

    const amounts = txMock.create.mock.calls.map((c: any) => Number(c[0].data.amount));
    expect(new Set(amounts)).toEqual(new Set([5000]));
    expect(txMock.create.mock.calls[0][0].data.subscriptionId).toBeNull();
  });
});

/**
 * The rule a subscription owns must only change through subscriptionService. Editing it
 * directly would move money without touching the price history, so the recorded price
 * and the amount actually charged would silently diverge.
 */
describe('subscription-owned rules are not directly editable', () => {
  it('refuses to update a rule owned by a subscription', async () => {
    ruleMock.findFirst.mockResolvedValue({ ...MOCK_RULE, subscriptionId: 'sub-1' });

    await expect(updateRecurringRule('rule-1', 'u1', { isActive: false }))
      .rejects.toThrow(/belongs to a subscription/i);

    expect(ruleMock.update).not.toHaveBeenCalled();
  });

  it('refuses to delete a rule owned by a subscription', async () => {
    ruleMock.findFirst.mockResolvedValue({ ...MOCK_RULE, subscriptionId: 'sub-1' });

    await expect(deleteRecurringRule('rule-1', 'u1'))
      .rejects.toThrow(/belongs to a subscription/i);

    expect(ruleMock.delete).not.toHaveBeenCalled();
  });

  it('still allows editing an ordinary rule', async () => {
    ruleMock.findFirst.mockResolvedValue({ ...MOCK_RULE, subscriptionId: null });
    ruleMock.update.mockResolvedValue(MOCK_RULE);

    await updateRecurringRule('rule-1', 'u1', { isActive: false });

    expect(ruleMock.update).toHaveBeenCalled();
  });
});
