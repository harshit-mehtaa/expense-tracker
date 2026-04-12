/**
 * Tests for transactionService.
 *
 * Covers: filter/WHERE construction, buildImportHash (pure), getTransactionById,
 * createTransaction (INCOME/EXPENSE + TRANSFER double-entry), updateTransaction
 * (balance recalc, loan recalc, TRANSFER rejection), softDeleteTransaction (paired
 * cascade), bulkImportTransactions, getAllTransactionsForExport, buildCsv.
 *
 * transactionService uses default import prisma.
 * $transaction passthrough: fn receives same mock object as ptx/tx.
 * bulkImportTransactions uses DIRECT prisma calls (not $transaction).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/prisma', () => {
  const prisma = {
    transaction: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
    },
    bankAccount: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    loan: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    bankStatementImport: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return { default: prisma, prisma };
});

import prisma from '../config/prisma';
import {
  buildImportHash,
  getTransactions,
  getTransactionById,
  createTransaction,
  updateTransaction,
  softDeleteTransaction,
  bulkImportTransactions,
  getAllTransactionsForExport,
  buildCsv,
} from '../services/transactionService';

const txMock = (prisma as any).transaction;
const acctMock = (prisma as any).bankAccount;
const loanMock = (prisma as any).loan;
const importMock = (prisma as any).bankStatementImport;

const MOCK_TX = {
  id: 'tx-1',
  userId: 'u1',
  type: 'EXPENSE',
  amount: 1000,
  description: 'Test expense',
  date: new Date('2025-01-15'),
  bankAccountId: 'acct-1',
  loanId: null,
  transferPairId: null,
  deletedAt: null,
  tags: [] as string[],
  paymentMode: 'UPI',
  categoryId: null,
};

const MOCK_ACCOUNT = { id: 'acct-1', userId: 'u1', currentBalance: 50000 };

beforeEach(() => {
  vi.clearAllMocks();
  txMock.count.mockResolvedValue(0);
  txMock.findMany.mockResolvedValue([]);
  txMock.findUnique.mockResolvedValue(MOCK_TX);
  txMock.findFirst.mockResolvedValue(null);
  txMock.create.mockResolvedValue(MOCK_TX);
  txMock.createMany.mockResolvedValue({ count: 1 });
  txMock.update.mockResolvedValue({ ...MOCK_TX, deletedAt: new Date() });
  acctMock.findFirst.mockResolvedValue(MOCK_ACCOUNT);
  acctMock.update.mockResolvedValue(MOCK_ACCOUNT);
  loanMock.findFirst.mockResolvedValue(null);
  loanMock.update.mockResolvedValue({});
  importMock.create.mockResolvedValue({});
  (prisma as any).$transaction.mockImplementation(async (fn: any) => fn(prisma));
});

// ─── Helper: capture WHERE from getTransactions ────────────────────────────────

async function getWhere(
  requesterId: string,
  role: string,
  filters: Parameters<typeof getTransactions>[2],
) {
  await getTransactions(requesterId, role, filters);
  const call = txMock.findMany.mock.calls[0]?.[0];
  return call?.where ?? {};
}

// ─────────────────────────────────────────────────────────────────────────────
// Role-based user scoping
// ─────────────────────────────────────────────────────────────────────────────

describe('getTransactions — role scoping', () => {
  it('MEMBER: always scopes to requesterId regardless of filters.userId', async () => {
    const where = await getWhere('user-1', 'MEMBER', { userId: 'other-user' });
    expect(where.userId).toBe('user-1');
  });

  it('ADMIN with filters.userId: scopes to that specific user', async () => {
    const where = await getWhere('admin-1', 'ADMIN', { userId: 'user-2' });
    expect(where.userId).toBe('user-2');
  });

  it('ADMIN without filters.userId: no userId constraint (family-wide)', async () => {
    const where = await getWhere('admin-1', 'ADMIN', {});
    expect(where.userId).toBeUndefined();
  });

  it('always adds deletedAt: null to where clause', async () => {
    const where = await getWhere('user-1', 'MEMBER', {});
    expect(where.deletedAt).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Multi-value type filter
// ─────────────────────────────────────────────────────────────────────────────

describe('getTransactions — type filter', () => {
  it('uses { in: [...] } when types array has multiple values', async () => {
    const where = await getWhere('user-1', 'MEMBER', { types: ['INCOME', 'EXPENSE'] });
    expect(where.type).toEqual({ in: ['INCOME', 'EXPENSE'] });
  });

  it('uses { in: [...] } even for a single-element types array', async () => {
    const where = await getWhere('user-1', 'MEMBER', { types: ['INCOME'] });
    expect(where.type).toEqual({ in: ['INCOME'] });
  });

  it('uses scalar string when only filters.type (singular) is provided', async () => {
    const where = await getWhere('user-1', 'MEMBER', { type: 'EXPENSE' });
    expect(where.type).toBe('EXPENSE');
  });

  it('types array takes precedence over singular type', async () => {
    const where = await getWhere('user-1', 'MEMBER', { types: ['INCOME'], type: 'EXPENSE' });
    expect(where.type).toEqual({ in: ['INCOME'] });
  });

  it('sets no type filter when neither types nor type is provided', async () => {
    const where = await getWhere('user-1', 'MEMBER', {});
    expect(where.type).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Multi-value category filter
// ─────────────────────────────────────────────────────────────────────────────

describe('getTransactions — categoryId filter', () => {
  it('uses { in: [...] } for categoryIds array', async () => {
    const where = await getWhere('user-1', 'MEMBER', { categoryIds: ['cat-1', 'cat-2'] });
    expect(where.categoryId).toEqual({ in: ['cat-1', 'cat-2'] });
  });

  it('uses scalar string for singular categoryId', async () => {
    const where = await getWhere('user-1', 'MEMBER', { categoryId: 'cat-1' });
    expect(where.categoryId).toBe('cat-1');
  });

  it('categoryIds array takes precedence over singular categoryId', async () => {
    const where = await getWhere('user-1', 'MEMBER', { categoryIds: ['cat-1'], categoryId: 'cat-2' });
    expect(where.categoryId).toEqual({ in: ['cat-1'] });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Multi-value paymentMode filter
// ─────────────────────────────────────────────────────────────────────────────

describe('getTransactions — paymentMode filter', () => {
  it('uses { in: [...] } for paymentModes array', async () => {
    const where = await getWhere('user-1', 'MEMBER', { paymentModes: ['UPI', 'CASH'] });
    expect(where.paymentMode).toEqual({ in: ['UPI', 'CASH'] });
  });

  it('uses scalar string for singular paymentMode', async () => {
    const where = await getWhere('user-1', 'MEMBER', { paymentMode: 'UPI' });
    expect(where.paymentMode).toBe('UPI');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// bankAccountId filter
// ─────────────────────────────────────────────────────────────────────────────

describe('getTransactions — bankAccountId filter', () => {
  it('passes bankAccountId directly when provided', async () => {
    const where = await getWhere('user-1', 'MEMBER', { bankAccountId: 'acct-123' });
    expect(where.bankAccountId).toBe('acct-123');
  });

  it('does not set bankAccountId when not provided', async () => {
    const where = await getWhere('user-1', 'MEMBER', {});
    expect(where.bankAccountId).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Date / FY filter
// ─────────────────────────────────────────────────────────────────────────────

describe('getTransactions — date filter', () => {
  it('FY filter sets date range (Apr 1 – Mar 31 in UTC+5:30)', async () => {
    const where = await getWhere('user-1', 'MEMBER', { fy: '2025-26' });
    expect(where.date).toEqual({
      gte: new Date('2025-03-31T18:30:00.000Z'),
      lte: new Date('2026-03-31T18:29:59.999Z'),
    });
  });

  it('FY filter takes precedence over startDate/endDate when both provided', async () => {
    const where = await getWhere('user-1', 'MEMBER', {
      fy: '2025-26',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
    });
    expect((where.date as any).gte).toEqual(new Date('2025-03-31T18:30:00.000Z'));
    expect((where.date as any).lte).toEqual(new Date('2026-03-31T18:29:59.999Z'));
  });

  it('uses explicit startDate and endDate when no fy', async () => {
    const where = await getWhere('user-1', 'MEMBER', {
      startDate: '2025-01-01',
      endDate: '2025-06-30',
    });
    expect((where.date as any).gte).toEqual(new Date('2025-01-01'));
    expect((where.date as any).lte).toEqual(new Date('2025-06-30'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Amount range filter
// ─────────────────────────────────────────────────────────────────────────────

describe('getTransactions — amount filter', () => {
  it('applies minAmount and maxAmount as Prisma gte/lte', async () => {
    const where = await getWhere('user-1', 'MEMBER', { minAmount: 1000, maxAmount: 50000 });
    expect(where.amount).toEqual({ gte: 1000, lte: 50000 });
  });

  it('applies only minAmount when maxAmount is absent', async () => {
    const where = await getWhere('user-1', 'MEMBER', { minAmount: 5000 });
    expect((where.amount as any).gte).toBe(5000);
    expect((where.amount as any).lte).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Search filter
// ─────────────────────────────────────────────────────────────────────────────

describe('getTransactions — search filter', () => {
  it('applies case-insensitive contains on description', async () => {
    const where = await getWhere('user-1', 'MEMBER', { search: 'coffee' });
    expect(where.description).toEqual({ contains: 'coffee', mode: 'insensitive' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildImportHash
// ─────────────────────────────────────────────────────────────────────────────

describe('buildImportHash', () => {
  const DATE = '2025-04-01';
  const AMOUNT = 1500.00;
  const DESC = 'Salary';
  const ACCOUNT_ID = 'acct-abc123';

  it('is deterministic — same inputs produce same hash', () => {
    const h1 = buildImportHash(DATE, AMOUNT, DESC, ACCOUNT_ID);
    const h2 = buildImportHash(DATE, AMOUNT, DESC, ACCOUNT_ID);
    expect(h1).toBe(h2);
  });

  it('produces a 64-character hex string (SHA-256)', () => {
    const hash = buildImportHash(DATE, AMOUNT, DESC, ACCOUNT_ID);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('normalizes description case — "Coffee" and "coffee" produce same hash', () => {
    const h1 = buildImportHash(DATE, AMOUNT, 'Coffee', ACCOUNT_ID);
    const h2 = buildImportHash(DATE, AMOUNT, 'COFFEE', ACCOUNT_ID);
    expect(h1).toBe(h2);
  });

  it('normalizes description whitespace — leading/trailing spaces ignored', () => {
    const h1 = buildImportHash(DATE, AMOUNT, '  Salary  ', ACCOUNT_ID);
    const h2 = buildImportHash(DATE, AMOUNT, 'Salary', ACCOUNT_ID);
    expect(h1).toBe(h2);
  });

  it('treats positive and negative amounts as equal (Math.abs)', () => {
    const h1 = buildImportHash(DATE, -1500, DESC, ACCOUNT_ID);
    const h2 = buildImportHash(DATE, 1500, DESC, ACCOUNT_ID);
    expect(h1).toBe(h2);
  });

  it('produces different hashes for different dates', () => {
    const h1 = buildImportHash('2025-04-01', AMOUNT, DESC, ACCOUNT_ID);
    const h2 = buildImportHash('2025-04-02', AMOUNT, DESC, ACCOUNT_ID);
    expect(h1).not.toBe(h2);
  });

  it('produces different hashes for different accounts', () => {
    const h1 = buildImportHash(DATE, AMOUNT, DESC, 'account-A');
    const h2 = buildImportHash(DATE, AMOUNT, DESC, 'account-B');
    expect(h1).not.toBe(h2);
  });

  it('produces different hashes for different amounts', () => {
    const h1 = buildImportHash(DATE, 1000, DESC, ACCOUNT_ID);
    const h2 = buildImportHash(DATE, 2000, DESC, ACCOUNT_ID);
    expect(h1).not.toBe(h2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getTransactionById
// ─────────────────────────────────────────────────────────────────────────────

describe('getTransactionById', () => {
  it('returns transaction when found and requester owns it', async () => {
    const result = await getTransactionById('tx-1', 'u1', 'MEMBER');
    expect(result).toBe(MOCK_TX);
  });

  it('throws NotFound when transaction does not exist', async () => {
    txMock.findUnique.mockResolvedValue(null);
    await expect(getTransactionById('tx-x', 'u1', 'MEMBER')).rejects.toThrow(/not found/i);
  });

  it('throws NotFound when transaction has deletedAt set (soft-deleted)', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, deletedAt: new Date() });
    await expect(getTransactionById('tx-1', 'u1', 'MEMBER')).rejects.toThrow(/not found/i);
  });

  it('throws Forbidden when MEMBER requests another user\'s transaction', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, userId: 'u2' });
    await expect(getTransactionById('tx-1', 'u1', 'MEMBER')).rejects.toThrow(/forbidden|access denied/i);
  });

  it('ADMIN can access any user\'s transaction', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, userId: 'u2' });
    const result = await getTransactionById('tx-1', 'admin-1', 'ADMIN');
    expect(result).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createTransaction — INCOME / EXPENSE
// ─────────────────────────────────────────────────────────────────────────────

describe('createTransaction — INCOME/EXPENSE', () => {
  const BASE_DATA = {
    amount: 5000,
    type: 'EXPENSE',
    description: 'Groceries',
    date: '2025-04-01',
    bankAccountId: 'acct-1',
  };

  it('throws NotFound when source bank account does not belong to user', async () => {
    acctMock.findFirst.mockResolvedValue(null);
    await expect(createTransaction('u1', BASE_DATA)).rejects.toThrow(/not found/i);
  });

  it('creates transaction and updates account balance for EXPENSE', async () => {
    await createTransaction('u1', BASE_DATA);
    expect(txMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'EXPENSE', amount: 5000, userId: 'u1' }),
      }),
    );
    expect(acctMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ currentBalance: { increment: -5000 } }),
      }),
    );
  });

  it('creates transaction and increments account balance for INCOME', async () => {
    await createTransaction('u1', { ...BASE_DATA, type: 'INCOME' });
    expect(acctMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ currentBalance: { increment: 5000 } }),
      }),
    );
  });

  it('throws NotFound when loanId references unknown loan', async () => {
    loanMock.findFirst.mockResolvedValue(null);
    await expect(
      createTransaction('u1', { ...BASE_DATA, loanId: 'loan-99' }),
    ).rejects.toThrow(/not found/i);
  });

  it('throws BadRequest when payment exceeds outstanding loan balance', async () => {
    loanMock.findFirst.mockResolvedValue({ id: 'loan-1', outstandingBalance: 3000, userId: 'u1' });
    await expect(
      createTransaction('u1', { ...BASE_DATA, amount: 5000, loanId: 'loan-1' }),
    ).rejects.toThrow(/exceeds/i);
  });

  it('decrements loan outstanding balance on linked EXPENSE', async () => {
    loanMock.findFirst.mockResolvedValue({ id: 'loan-1', outstandingBalance: 10000, userId: 'u1' });
    await createTransaction('u1', { ...BASE_DATA, amount: 2000, loanId: 'loan-1' });
    expect(loanMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ outstandingBalance: { decrement: 2000 } }),
      }),
    );
  });

  it('does NOT link loan for INCOME type (loanId only valid for EXPENSE)', async () => {
    loanMock.findFirst.mockResolvedValue({ id: 'loan-1', outstandingBalance: 10000, userId: 'u1' });
    await createTransaction('u1', { ...BASE_DATA, type: 'INCOME', loanId: 'loan-1' });
    // loanMock.findFirst not called for INCOME
    expect(loanMock.findFirst).not.toHaveBeenCalled();
    expect(loanMock.update).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createTransaction — TRANSFER (double-entry)
// ─────────────────────────────────────────────────────────────────────────────

describe('createTransaction — TRANSFER', () => {
  const TRANSFER_DATA = {
    amount: 10000,
    type: 'TRANSFER',
    description: 'Between accounts',
    date: '2025-04-01',
    bankAccountId: 'acct-src',
    transferToAccountId: 'acct-dest',
  };

  it('throws BadRequest when transferToAccountId is missing', async () => {
    // Construct without transferToAccountId key (not via spread+undefined override which is brittle)
    const { transferToAccountId: _omit, ...dataWithoutDest } = TRANSFER_DATA;
    await expect(
      createTransaction('u1', dataWithoutDest as any),
    ).rejects.toThrow(/transferToAccountId.*required/i);
  });

  it('throws NotFound when destination account not found', async () => {
    // source account found, dest account not found
    acctMock.findFirst
      .mockResolvedValueOnce({ id: 'acct-src', userId: 'u1' })
      .mockResolvedValueOnce(null);
    await expect(createTransaction('u1', TRANSFER_DATA)).rejects.toThrow(/not found/i);
  });

  it('creates debit and credit legs with shared transferPairId', async () => {
    acctMock.findFirst
      .mockResolvedValueOnce({ id: 'acct-src', userId: 'u1' })
      .mockResolvedValueOnce({ id: 'acct-dest', userId: 'u1' });
    txMock.create.mockResolvedValue({ ...MOCK_TX, type: 'EXPENSE', transferPairId: 'pair-abc' });

    await createTransaction('u1', TRANSFER_DATA);

    // Two transaction.create calls: debit (EXPENSE) + credit (INCOME)
    expect(txMock.create).toHaveBeenCalledTimes(2);
    const [debitCall, creditCall] = txMock.create.mock.calls;
    expect(debitCall[0].data.type).toBe('EXPENSE');
    expect(creditCall[0].data.type).toBe('INCOME');
    // Both share same transferPairId
    expect(debitCall[0].data.transferPairId).toBe(creditCall[0].data.transferPairId);
  });

  it('decrements source and increments destination balances', async () => {
    acctMock.findFirst
      .mockResolvedValueOnce({ id: 'acct-src', userId: 'u1' })
      .mockResolvedValueOnce({ id: 'acct-dest', userId: 'u1' });
    txMock.create.mockResolvedValue({ ...MOCK_TX, type: 'EXPENSE' });

    await createTransaction('u1', TRANSFER_DATA);

    const updateCalls = acctMock.update.mock.calls;
    const srcUpdate = updateCalls.find((c: any) => c[0].where?.id === 'acct-src');
    const destUpdate = updateCalls.find((c: any) => c[0].where?.id === 'acct-dest');
    expect(srcUpdate[0].data.currentBalance).toEqual({ decrement: 10000 });
    expect(destUpdate[0].data.currentBalance).toEqual({ increment: 10000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateTransaction
// ─────────────────────────────────────────────────────────────────────────────

describe('updateTransaction', () => {
  it('throws NotFound when transaction does not exist', async () => {
    txMock.findUnique.mockResolvedValue(null);
    await expect(updateTransaction('tx-x', 'u1', 'MEMBER', {})).rejects.toThrow(/not found/i);
  });

  it('throws NotFound when transaction is soft-deleted', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, deletedAt: new Date() });
    await expect(updateTransaction('tx-1', 'u1', 'MEMBER', {})).rejects.toThrow(/not found/i);
  });

  it('throws BadRequest for TRANSFER type transactions', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, type: 'TRANSFER' });
    await expect(updateTransaction('tx-1', 'u1', 'MEMBER', {})).rejects.toThrow(/cannot be edited/i);
  });

  it('throws Forbidden when MEMBER tries to edit another user\'s transaction', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, userId: 'u2' });
    await expect(updateTransaction('tx-1', 'u1', 'MEMBER', {})).rejects.toThrow(/forbidden|access denied/i);
  });

  it('recalculates account balance when amount changes', async () => {
    // original: EXPENSE 1000 on acct-1 → oldDelta = -1000
    // update to amount 1500 → newDelta = -1500, netChange = -1500 - (-1000) = -500
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, type: 'EXPENSE', amount: 1000, bankAccountId: 'acct-1' });
    txMock.update.mockResolvedValue({ ...MOCK_TX, amount: 1500 });

    await updateTransaction('tx-1', 'u1', 'MEMBER', { amount: 1500 });

    expect(acctMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'acct-1' },
        data: { currentBalance: { increment: -500 } },
      }),
    );
  });

  it('recalculates account balance when type changes (EXPENSE → INCOME)', async () => {
    // original: EXPENSE 1000 → oldDelta = -1000
    // new type INCOME 1000 → newDelta = +1000, netChange = +2000
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, type: 'EXPENSE', amount: 1000, bankAccountId: 'acct-1' });
    txMock.update.mockResolvedValue({ ...MOCK_TX, type: 'INCOME' });

    await updateTransaction('tx-1', 'u1', 'MEMBER', { type: 'INCOME' });

    expect(acctMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { currentBalance: { increment: 2000 } },
      }),
    );
  });

  it('does NOT update account balance when neither amount nor type changed', async () => {
    txMock.update.mockResolvedValue({ ...MOCK_TX, description: 'Updated desc' });
    await updateTransaction('tx-1', 'u1', 'MEMBER', { description: 'Updated desc' });
    expect(acctMock.update).not.toHaveBeenCalled();
  });

  it('updates loan outstanding balance when loan-linked EXPENSE amount changes', async () => {
    // original: EXPENSE 1000 on loanId 'loan-1' → oldLoanDecrement=1000
    // new amount: 700 → newLoanDecrement=700, loanNetChange = 1000-700 = +300 (restore 300 to loan)
    txMock.findUnique.mockResolvedValue({
      ...MOCK_TX,
      type: 'EXPENSE',
      amount: 1000,
      bankAccountId: null,
      loanId: 'loan-1',
    });
    txMock.update.mockResolvedValue({ ...MOCK_TX, amount: 700 });

    await updateTransaction('tx-1', 'u1', 'MEMBER', { amount: 700 });

    expect(loanMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'loan-1' },
        data: { outstandingBalance: { increment: 300 } },
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// softDeleteTransaction
// ─────────────────────────────────────────────────────────────────────────────

describe('softDeleteTransaction', () => {
  it('throws NotFound when transaction does not exist', async () => {
    txMock.findUnique.mockResolvedValue(null);
    await expect(softDeleteTransaction('tx-x', 'u1', 'MEMBER')).rejects.toThrow(/not found/i);
  });

  it('throws Forbidden when MEMBER tries to delete another user\'s transaction', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, userId: 'u2' });
    await expect(softDeleteTransaction('tx-1', 'u1', 'MEMBER')).rejects.toThrow(/forbidden|access denied/i);
  });

  it('sets deletedAt and reverses account balance for EXPENSE', async () => {
    // original EXPENSE 1000 → reversal = +1000
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, type: 'EXPENSE', amount: 1000, bankAccountId: 'acct-1' });

    await softDeleteTransaction('tx-1', 'u1', 'MEMBER');

    expect(txMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
    );
    expect(acctMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'acct-1' },
        data: { currentBalance: { increment: 1000 } }, // reversal of -1000 EXPENSE
      }),
    );
  });

  it('reverses INCOME as negative on soft-delete', async () => {
    // original INCOME 500 → reversal = -500
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, type: 'INCOME', amount: 500, bankAccountId: 'acct-1' });

    await softDeleteTransaction('tx-1', 'u1', 'MEMBER');

    expect(acctMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { currentBalance: { increment: -500 } },
      }),
    );
  });

  it('cascades soft-delete to paired TRANSFER leg', async () => {
    const pairedTx = {
      ...MOCK_TX,
      id: 'tx-2',
      type: 'INCOME',
      amount: 10000,
      bankAccountId: 'acct-dest',
      transferPairId: 'pair-1',
      deletedAt: null,
    };
    txMock.findUnique.mockResolvedValue({
      ...MOCK_TX,
      id: 'tx-1',
      type: 'EXPENSE',
      amount: 10000,
      bankAccountId: 'acct-src',
      transferPairId: 'pair-1',
    });
    txMock.findFirst.mockResolvedValue(pairedTx);
    txMock.update.mockResolvedValue({ ...MOCK_TX, deletedAt: new Date() });

    await softDeleteTransaction('tx-1', 'u1', 'MEMBER');

    // Should have called update twice: once for original, once for paired leg
    expect(txMock.update).toHaveBeenCalledTimes(2);
    // Should have updated both account balances
    expect(acctMock.update).toHaveBeenCalledTimes(2);
  });

  it('skips balance reversal when transaction has no bankAccountId', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, bankAccountId: null });
    await softDeleteTransaction('tx-1', 'u1', 'MEMBER');
    expect(acctMock.update).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// bulkImportTransactions
// ─────────────────────────────────────────────────────────────────────────────

describe('bulkImportTransactions', () => {
  const ROWS = [
    { date: '2025-04-01', amount: 1000, type: 'EXPENSE' as const, description: 'A' },
    { date: '2025-04-02', amount: 2000, type: 'INCOME' as const, description: 'B' },
  ];

  it('calls createMany with dedup and creates import record', async () => {
    txMock.createMany.mockResolvedValue({ count: 2 });

    const result = await bulkImportTransactions('u1', 'acct-1', ROWS, 'HDFC', 'stmt.csv');

    expect(txMock.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
    expect(importMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u1',
          bankName: 'HDFC',
          filename: 'stmt.csv',
          rowCount: 2,
          importedCount: 2,
        }),
      }),
    );
    expect(result.importedCount).toBe(2);
    expect(result.duplicatesSkipped).toBe(0);
  });

  it('counts duplicates correctly when createMany skips some rows', async () => {
    txMock.createMany.mockResolvedValue({ count: 1 }); // 1 of 2 inserted, 1 was duplicate

    const result = await bulkImportTransactions('u1', 'acct-1', ROWS, 'SBI', 'bank.csv');

    expect(result.importedCount).toBe(1);
    expect(result.duplicatesSkipped).toBe(1);
    expect(result.errorsCount).toBe(0);
  });

  it('does NOT use $transaction (direct prisma calls)', async () => {
    txMock.createMany.mockResolvedValue({ count: 1 });
    await bulkImportTransactions('u1', 'acct-1', ROWS, 'ICICI', 'x.csv');
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getAllTransactionsForExport
// ─────────────────────────────────────────────────────────────────────────────

describe('getAllTransactionsForExport', () => {
  it('MEMBER: scoped to requesterId', async () => {
    await getAllTransactionsForExport('u1', 'MEMBER', {});
    const call = txMock.findMany.mock.calls[0][0];
    expect(call.where.userId).toBe('u1');
  });

  it('ADMIN: no userId constraint (family-wide)', async () => {
    await getAllTransactionsForExport('admin-1', 'ADMIN', {});
    const call = txMock.findMany.mock.calls[0][0];
    expect(call.where.userId).toBeUndefined();
  });

  it('applies fy date range filter', async () => {
    await getAllTransactionsForExport('u1', 'MEMBER', { fy: '2025-26' });
    const call = txMock.findMany.mock.calls[0][0];
    expect(call.where.date).toBeDefined();
    expect(call.where.date.gte).toBeInstanceOf(Date);
  });

  it('applies categoryIds filter', async () => {
    await getAllTransactionsForExport('u1', 'MEMBER', { categoryIds: ['cat-1', 'cat-2'] });
    const call = txMock.findMany.mock.calls[0][0];
    expect(call.where.categoryId).toEqual({ in: ['cat-1', 'cat-2'] });
  });

  it('applies types filter', async () => {
    await getAllTransactionsForExport('u1', 'MEMBER', { types: ['INCOME', 'EXPENSE'] });
    const call = txMock.findMany.mock.calls[0][0];
    expect(call.where.type).toEqual({ in: ['INCOME', 'EXPENSE'] });
  });

  it('applies singular type filter (not array form)', async () => {
    await getAllTransactionsForExport('u1', 'MEMBER', { type: 'INCOME' });
    const call = txMock.findMany.mock.calls[0][0];
    expect(call.where.type).toBe('INCOME');
  });

  it('applies paymentModes array filter', async () => {
    await getAllTransactionsForExport('u1', 'MEMBER', { paymentModes: ['CASH', 'UPI'] });
    const call = txMock.findMany.mock.calls[0][0];
    expect(call.where.paymentMode).toEqual({ in: ['CASH', 'UPI'] });
  });

  it('applies singular paymentMode filter (not array form)', async () => {
    await getAllTransactionsForExport('u1', 'MEMBER', { paymentMode: 'UPI' });
    const call = txMock.findMany.mock.calls[0][0];
    expect(call.where.paymentMode).toBe('UPI');
  });

  it('applies startDate filter as date range lower bound', async () => {
    await getAllTransactionsForExport('u1', 'MEMBER', { startDate: '2025-04-01' });
    const call = txMock.findMany.mock.calls[0][0];
    expect(call.where.date).toBeDefined();
    expect(call.where.date.gte).toEqual(new Date('2025-04-01'));
  });

  it('applies endDate filter as date range upper bound', async () => {
    await getAllTransactionsForExport('u1', 'MEMBER', { endDate: '2025-06-30' });
    const call = txMock.findMany.mock.calls[0][0];
    expect(call.where.date).toBeDefined();
    expect(call.where.date.lte).toEqual(new Date('2025-06-30'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildCsv
// ─────────────────────────────────────────────────────────────────────────────

describe('buildCsv', () => {
  const makeRow = (overrides: Partial<Record<string, any>> = {}) => ({
    date: new Date('2025-04-01'),
    description: 'Test transaction',
    type: 'EXPENSE',
    amount: 1500,
    category: { name: 'Food' },
    bankAccount: { bankName: 'HDFC', accountNumberLast4: '1234' },
    paymentMode: 'UPI',
    tags: [] as string[],
    ...overrides,
  });

  it('produces CSV with correct header row', () => {
    const csv = buildCsv([makeRow()]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Date,Description,Type,Amount,Category,Account,PaymentMode,Tags');
  });

  it('uses CRLF line endings', () => {
    const csv = buildCsv([makeRow(), makeRow()]);
    expect(csv).toContain('\r\n');
  });

  it('formats date as YYYY-MM-DD', () => {
    const csv = buildCsv([makeRow()]);
    const lines = csv.split('\r\n');
    expect(lines[1]).toContain('2025-04-01');
  });

  it('escapes double-quotes in description', () => {
    const csv = buildCsv([makeRow({ description: 'It\'s a "test"' })]);
    expect(csv).toContain('"It\'s a ""test"""');
  });

  it('formats amount with 2 decimal places', () => {
    const csv = buildCsv([makeRow({ amount: 1500 })]);
    expect(csv).toContain('1500.00');
  });

  it('handles null category gracefully', () => {
    const csv = buildCsv([makeRow({ category: null })]);
    expect(csv).toBeDefined();
    expect(csv).not.toContain('undefined');
  });

  it('handles null bankAccount gracefully', () => {
    const csv = buildCsv([makeRow({ bankAccount: null })]);
    expect(csv).toBeDefined();
    expect(csv).not.toContain('undefined');
  });

  it('joins multiple tags with semicolons', () => {
    const csv = buildCsv([makeRow({ tags: ['food', 'lunch', 'work'] })]);
    expect(csv).toContain('food;lunch;work');
  });

  it('returns only header for empty rows array', () => {
    const csv = buildCsv([]);
    expect(csv).toBe('Date,Description,Type,Amount,Category,Account,PaymentMode,Tags');
  });
});
