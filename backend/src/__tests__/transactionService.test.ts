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
    insurancePolicy: {
      findFirst: vi.fn(),
    },
    // softDeleteTransaction refuses to delete a recurring rule's template.
    recurringRule: {
      findFirst: vi.fn(),
    },
    subscription: {
      findFirst: vi.fn(),
    },
    sIP: {
      findFirst: vi.fn(),
    },
    sIPTransaction: {
      create: vi.fn(),
      delete: vi.fn(),
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
  getTransferCounterpartCandidates,
  createTransaction,
  convertTransactionToTransfer,
  convertTransactionToSIP,
  updateTransactionSIPLink,
  removeTransactionSIPLink,
  updateTransactionInsurancePolicyLink,
  removeTransactionInsurancePolicyLink,
  updateTransactionRefundLink,
  removeTransactionRefundLink,
  updateTransaction,
  softDeleteTransaction,
  bulkImportTransactions,
  getAllTransactionsForExport,
  buildCsv,
} from '../services/transactionService';

const txMock = (prisma as any).transaction;
const acctMock = (prisma as any).bankAccount;
const loanMock = (prisma as any).loan;
const policyMock = (prisma as any).insurancePolicy;
const sipMock = (prisma as any).sIP;
const sipTxMock = (prisma as any).sIPTransaction;
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
  insurancePolicyId: null,
  refundForTransactionId: null,
  transferPairId: null,
  deletedAt: null,
  tags: [] as string[],
  paymentMode: 'UPI',
  categoryId: null,
};

const MOCK_ACCOUNT = { id: 'acct-1', userId: 'u1', currentBalance: 50000 };
const MOCK_SIP = { id: 'sip-1', userId: 'u1', investmentId: 'inv-1', bankAccountId: null };
const MOCK_POLICY = { id: 'pol-1', userId: 'u1', policyName: 'Health Plan' };

beforeEach(() => {
  vi.clearAllMocks();
  txMock.count.mockResolvedValue(0);
  txMock.findMany.mockResolvedValue([]);
  txMock.findUnique.mockResolvedValue(MOCK_TX);
  txMock.findFirst.mockResolvedValue(null);
  // Default: the transaction is NOT a recurring template. Tests that exercise the guard
  // override this.
  (prisma as any).recurringRule.findFirst.mockResolvedValue(null);
  txMock.create.mockResolvedValue(MOCK_TX);
  txMock.createMany.mockResolvedValue({ count: 1 });
  txMock.update.mockResolvedValue({ ...MOCK_TX, deletedAt: new Date() });
  acctMock.findFirst.mockResolvedValue(MOCK_ACCOUNT);
  acctMock.update.mockResolvedValue(MOCK_ACCOUNT);
  loanMock.findFirst.mockResolvedValue(null);
  loanMock.update.mockResolvedValue({});
  policyMock.findFirst.mockResolvedValue(MOCK_POLICY);
  sipMock.findFirst.mockResolvedValue(MOCK_SIP);
  sipTxMock.create.mockResolvedValue({ id: 'sip-tx-1', investmentId: 'inv-1' });
  sipTxMock.delete.mockResolvedValue({ id: 'sip-tx-1' });
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

  it('explicit startDate/endDate narrow the FY date range when both are provided', async () => {
    const where = await getWhere('user-1', 'MEMBER', {
      fy: '2025-26',
      startDate: '2025-05-01',
      endDate: '2025-05-31',
    });
    expect((where.date as any).gte).toEqual(new Date('2025-04-30T18:30:00.000Z'));
    expect((where.date as any).lte).toEqual(new Date('2025-05-31T18:29:59.999Z'));
  });

  it('uses explicit startDate and endDate when no fy', async () => {
    const where = await getWhere('user-1', 'MEMBER', {
      startDate: '2025-01-01',
      endDate: '2025-06-30',
    });
    expect((where.date as any).gte).toEqual(new Date('2024-12-31T18:30:00.000Z'));
    expect((where.date as any).lte).toEqual(new Date('2025-06-30T18:29:59.999Z'));
  });

  it('keeps the FY lower bound when startDate falls before the FY start', async () => {
    // The bounds intersect (never widen): FY 2025-26 starts 2025-04-01 IST, so a
    // startDate of 2025-01-01 must NOT pull `gte` back outside the financial year.
    const where = await getWhere('user-1', 'MEMBER', { fy: '2025-26', startDate: '2025-01-01' });
    expect((where.date as any).gte).toEqual(new Date('2025-03-31T18:30:00.000Z'));
  });

  it('keeps the FY upper bound when endDate falls after the FY end', async () => {
    // Mirror of the above for the upper bound: an endDate past 2026-03-31 IST must
    // NOT push `lte` beyond the financial year.
    const where = await getWhere('user-1', 'MEMBER', { fy: '2025-26', endDate: '2026-12-31' });
    expect((where.date as any).lte).toEqual(new Date('2026-03-31T18:29:59.999Z'));
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
  it('applies case-insensitive contains on description and remark', async () => {
    const where = await getWhere('user-1', 'MEMBER', { search: 'coffee' });
    expect(where.OR).toEqual([
      { description: { contains: 'coffee', mode: 'insensitive' } },
      { remark: { contains: 'coffee', mode: 'insensitive' } },
    ]);
  });
});

describe('getTransactions — transfer metadata', () => {
  it('marks transfer pairs as credit-card bill payments when the incoming leg is a credit-card account', async () => {
    txMock.count.mockResolvedValue(1);
    txMock.findMany
      .mockResolvedValueOnce([{
        ...MOCK_TX,
        id: 'tx-bank-leg',
        type: 'EXPENSE',
        transferPairId: 'pair-cc',
        bankAccount: { bankName: 'HDFC Bank', accountNumberLast4: '1111', accountType: 'SAVINGS' },
      }])
      .mockResolvedValueOnce([
        {
          id: 'tx-bank-leg',
          type: 'EXPENSE',
          transferPairId: 'pair-cc',
          bankAccount: { bankName: 'HDFC Bank', accountNumberLast4: '1111', accountType: 'SAVINGS' },
        },
        {
          id: 'tx-card-leg',
          type: 'INCOME',
          transferPairId: 'pair-cc',
          bankAccount: { bankName: 'ICICI Bank', accountNumberLast4: '1234', accountType: 'CREDIT_CARD' },
        },
      ]);

    const result = await getTransactions('u1', 'MEMBER', {});

    expect(txMock.findMany.mock.calls[1][0]).toMatchObject({
      where: { transferPairId: { in: ['pair-cc'] }, deletedAt: null },
    });
    expect(result.items[0]).toMatchObject({
      isCreditCardBillPayment: true,
      creditCardAccount: { bankName: 'ICICI Bank', accountNumberLast4: '1234', accountType: 'CREDIT_CARD' },
      transferCounterpartyAccount: { bankName: 'ICICI Bank', accountNumberLast4: '1234', accountType: 'CREDIT_CARD' },
    });
  });

  it('short-circuits without a second query when no item is part of a transfer pair', async () => {
    txMock.count.mockResolvedValue(1);
    txMock.findMany.mockResolvedValueOnce([{ ...MOCK_TX, id: 'tx-plain', transferPairId: null }]);

    const result = await getTransactions('u1', 'MEMBER', {});

    // Only the page query ran — the transfer-legs lookup is skipped entirely.
    expect(txMock.findMany).toHaveBeenCalledTimes(1);
    expect(result.items[0]).toMatchObject({
      id: 'tx-plain',
      isCreditCardBillPayment: false,
      creditCardAccount: null,
      transferCounterpartyAccount: null,
    });
  });

  it('defaults to null metadata for unpaired items, orphaned pair ids, and legs with no pair id', async () => {
    txMock.count.mockResolvedValue(2);
    txMock.findMany
      .mockResolvedValueOnce([
        { ...MOCK_TX, id: 'tx-orphan', transferPairId: 'pair-missing' },
        { ...MOCK_TX, id: 'tx-unpaired', transferPairId: null },
      ])
      // The legs query returns a row whose transferPairId is null, so it is skipped
      // when building the pair map — leaving 'pair-missing' with no entry at all.
      .mockResolvedValueOnce([{ id: 'leg-no-pair', type: 'EXPENSE', transferPairId: null, bankAccount: null }]);

    const result = await getTransactions('u1', 'MEMBER', {});

    expect(result.items[0]).toMatchObject({
      id: 'tx-orphan',
      isCreditCardBillPayment: false,
      creditCardAccount: null,
      transferCounterpartyAccount: null,
    });
    expect(result.items[1]).toMatchObject({
      id: 'tx-unpaired',
      isCreditCardBillPayment: false,
      creditCardAccount: null,
      transferCounterpartyAccount: null,
    });
  });

  it('reports a transfer counterparty without flagging it as a credit-card bill payment', async () => {
    txMock.count.mockResolvedValue(1);
    txMock.findMany
      .mockResolvedValueOnce([{ ...MOCK_TX, id: 'tx-a', type: 'EXPENSE', transferPairId: 'pair-b2b' }])
      .mockResolvedValueOnce([
        { id: 'tx-a', type: 'EXPENSE', transferPairId: 'pair-b2b', bankAccount: { bankName: 'HDFC Bank', accountNumberLast4: '1111', accountType: 'SAVINGS' } },
        // Incoming leg is a SAVINGS account, not CREDIT_CARD → not a bill payment.
        { id: 'tx-b', type: 'INCOME', transferPairId: 'pair-b2b', bankAccount: { bankName: 'SBI', accountNumberLast4: '2222', accountType: 'SAVINGS' } },
      ]);

    const result = await getTransactions('u1', 'MEMBER', {});

    expect(result.items[0]).toMatchObject({
      isCreditCardBillPayment: false,
      creditCardAccount: null,
      transferCounterpartyAccount: { bankName: 'SBI', accountNumberLast4: '2222', accountType: 'SAVINGS' },
    });
  });

  it('falls back to a null counterparty when the paired leg has no bank account', async () => {
    txMock.count.mockResolvedValue(1);
    txMock.findMany
      .mockResolvedValueOnce([{ ...MOCK_TX, id: 'tx-a', type: 'EXPENSE', transferPairId: 'pair-null-acct' }])
      .mockResolvedValueOnce([
        { id: 'tx-a', type: 'EXPENSE', transferPairId: 'pair-null-acct', bankAccount: null },
        { id: 'tx-b', type: 'INCOME', transferPairId: 'pair-null-acct', bankAccount: null },
      ]);

    const result = await getTransactions('u1', 'MEMBER', {});

    expect(result.items[0]).toMatchObject({
      isCreditCardBillPayment: false,
      creditCardAccount: null,
      transferCounterpartyAccount: null,
    });
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
// getTransferCounterpartCandidates
// ─────────────────────────────────────────────────────────────────────────────

describe('getTransferCounterpartCandidates', () => {
  const CANDIDATE_SOURCE = {
    ...MOCK_TX,
    id: 'tx-debit',
    userId: 'u1',
    type: 'EXPENSE',
    amount: 350000,
    date: new Date('2026-04-15'),
    bankAccountId: 'acct-src',
    transferPairId: null,
  };

  it('queries for the opposite leg on the counterparty account, excluding already-linked rows', async () => {
    txMock.findUnique.mockResolvedValue(CANDIDATE_SOURCE);
    acctMock.findFirst.mockResolvedValue({ id: 'acct-dest', userId: 'u1' });
    txMock.findMany.mockResolvedValue([{ id: 'tx-credit-1' }]);

    const result = await getTransferCounterpartCandidates('tx-debit', 'u1', 'MEMBER', 'acct-dest');

    expect(acctMock.findFirst).toHaveBeenCalledWith({ where: { id: 'acct-dest', userId: 'u1' } });
    expect(txMock.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { not: 'tx-debit' },
        userId: 'u1',
        deletedAt: null,
        transferPairId: null,
        bankAccountId: 'acct-dest',
        type: 'INCOME', // opposite of the EXPENSE source
        amount: 350000,
        date: new Date('2026-04-15'),
        sipId: null,
        sipTransactionId: null,
        insurancePolicyId: null,
        refundForTransactionId: null,
        loanId: null,
      }),
      orderBy: { createdAt: 'asc' },
    }));
    expect(result).toEqual([{ id: 'tx-credit-1' }]);
  });

  it('looks for an EXPENSE counterpart when the source transaction is INCOME', async () => {
    txMock.findUnique.mockResolvedValue({ ...CANDIDATE_SOURCE, type: 'INCOME', bankAccountId: 'acct-card' });
    acctMock.findFirst.mockResolvedValue({ id: 'acct-bank', userId: 'u1' });

    await getTransferCounterpartCandidates('tx-debit', 'u1', 'MEMBER', 'acct-bank');

    expect(txMock.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ type: 'EXPENSE', bankAccountId: 'acct-bank' }),
    }));
  });

  it('rejects an unknown transaction', async () => {
    txMock.findUnique.mockResolvedValue(null);
    await expect(getTransferCounterpartCandidates('tx-x', 'u1', 'MEMBER', 'acct-dest'))
      .rejects.toThrow(/Transaction not found/i);
  });

  it('rejects a soft-deleted transaction', async () => {
    txMock.findUnique.mockResolvedValue({ ...CANDIDATE_SOURCE, deletedAt: new Date() });
    await expect(getTransferCounterpartCandidates('tx-debit', 'u1', 'MEMBER', 'acct-dest'))
      .rejects.toThrow(/Transaction not found/i);
  });

  it("forbids a MEMBER from reading another member's transaction", async () => {
    txMock.findUnique.mockResolvedValue({ ...CANDIDATE_SOURCE, userId: 'other-user' });
    await expect(getTransferCounterpartCandidates('tx-debit', 'u1', 'MEMBER', 'acct-dest'))
      .rejects.toThrow(/Forbidden/i);
  });

  it("allows an ADMIN to read another member's transaction", async () => {
    txMock.findUnique.mockResolvedValue({ ...CANDIDATE_SOURCE, userId: 'other-user' });
    acctMock.findFirst.mockResolvedValue({ id: 'acct-dest', userId: 'other-user' });

    await getTransferCounterpartCandidates('tx-debit', 'admin-1', 'ADMIN', 'acct-dest');

    // Candidates are scoped to the transaction OWNER, not the requesting admin.
    expect(txMock.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'other-user' }),
    }));
  });

  it('rejects a transaction that is already part of a transfer pair', async () => {
    txMock.findUnique.mockResolvedValue({ ...CANDIDATE_SOURCE, transferPairId: 'pair-1' });
    await expect(getTransferCounterpartCandidates('tx-debit', 'u1', 'MEMBER', 'acct-dest'))
      .rejects.toThrow(/already marked as a transfer/i);
  });

  it('rejects a transaction that is neither INCOME nor EXPENSE', async () => {
    txMock.findUnique.mockResolvedValue({ ...CANDIDATE_SOURCE, type: 'TRANSFER' });
    await expect(getTransferCounterpartCandidates('tx-debit', 'u1', 'MEMBER', 'acct-dest'))
      .rejects.toThrow(/Only income or expense/i);
  });

  it('rejects a transaction with no bank account', async () => {
    txMock.findUnique.mockResolvedValue({ ...CANDIDATE_SOURCE, bankAccountId: null });
    await expect(getTransferCounterpartCandidates('tx-debit', 'u1', 'MEMBER', 'acct-dest'))
      .rejects.toThrow(/Bank account is required/i);
  });

  it('rejects a counterparty account identical to the source account', async () => {
    txMock.findUnique.mockResolvedValue(CANDIDATE_SOURCE);
    await expect(getTransferCounterpartCandidates('tx-debit', 'u1', 'MEMBER', 'acct-src'))
      .rejects.toThrow(/must be different/i);
  });

  it('rejects a counterparty account that does not belong to the transaction owner', async () => {
    txMock.findUnique.mockResolvedValue(CANDIDATE_SOURCE);
    acctMock.findFirst.mockResolvedValue(null);
    await expect(getTransferCounterpartCandidates('tx-debit', 'u1', 'MEMBER', 'acct-dest'))
      .rejects.toThrow(/Counterparty bank account not found/i);
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

  it('links an expense transaction to an insurance policy', async () => {
    await createTransaction('u1', { ...BASE_DATA, insurancePolicyId: 'pol-1' });
    expect(policyMock.findFirst).toHaveBeenCalledWith({ where: { id: 'pol-1', userId: 'u1' } });
    expect(txMock.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ insurancePolicyId: 'pol-1' }),
    }));
  });

  it('throws NotFound when insurancePolicyId references an unknown policy', async () => {
    policyMock.findFirst.mockResolvedValue(null);
    await expect(
      createTransaction('u1', { ...BASE_DATA, insurancePolicyId: 'pol-x' }),
    ).rejects.toThrow(/not found/i);
  });

  it('rejects linking both loan and insurance policy on one transaction', async () => {
    loanMock.findFirst.mockResolvedValue({ id: 'loan-1', outstandingBalance: 10000, userId: 'u1' });
    await expect(
      createTransaction('u1', { ...BASE_DATA, loanId: 'loan-1', insurancePolicyId: 'pol-1' }),
    ).rejects.toThrow(/either a loan or an insurance policy/i);
  });

  it('links an INCOME transaction to the expense it refunds', async () => {
    txMock.findFirst.mockResolvedValue({ id: 'expense-1', transferPairId: null });

    await createTransaction('u1', { ...BASE_DATA, type: 'INCOME', refundForTransactionId: 'expense-1' });

    expect(txMock.findFirst).toHaveBeenCalledWith({
      where: { id: 'expense-1', userId: 'u1', deletedAt: null, type: 'EXPENSE' },
      select: { id: true, transferPairId: true },
    });
    expect(txMock.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ refundForTransactionId: 'expense-1' }),
    }));
  });

  it('rejects a refund link on a non-INCOME transaction', async () => {
    await expect(
      createTransaction('u1', { ...BASE_DATA, type: 'EXPENSE', refundForTransactionId: 'expense-1' }),
    ).rejects.toThrow(/Only incoming transactions can be linked as refunds/i);
    expect(txMock.create).not.toHaveBeenCalled();
  });

  it('throws NotFound when the refunded expense does not exist', async () => {
    txMock.findFirst.mockResolvedValue(null);
    await expect(
      createTransaction('u1', { ...BASE_DATA, type: 'INCOME', refundForTransactionId: 'expense-x' }),
    ).rejects.toThrow(/Original expense transaction not found/i);
  });

  it('rejects refunding a transfer leg', async () => {
    txMock.findFirst.mockResolvedValue({ id: 'expense-1', transferPairId: 'pair-1' });
    await expect(
      createTransaction('u1', { ...BASE_DATA, type: 'INCOME', refundForTransactionId: 'expense-1' }),
    ).rejects.toThrow(/Transfer transactions cannot be refunded/i);
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
// convertTransactionToTransfer
// ─────────────────────────────────────────────────────────────────────────────

describe('convertTransactionToTransfer', () => {
  it('links existing expense to a destination transfer leg without adjusting destination balance by default', async () => {
    txMock.findUnique.mockResolvedValue({
      ...MOCK_TX,
      id: 'tx-import',
      userId: 'u1',
      type: 'EXPENSE',
      amount: 350000,
      bankAccountId: 'acct-src',
      transferPairId: null,
      balanceImpactApplied: true,
    });
    acctMock.findFirst.mockResolvedValue({ id: 'acct-dest', userId: 'u1' });
    txMock.update.mockResolvedValue({ ...MOCK_TX, id: 'tx-import', transferPairId: 'pair-1' });

    await convertTransactionToTransfer('tx-import', 'u1', 'MEMBER', {
      transferToAccountId: 'acct-dest',
      adjustDestinationBalance: false,
    });

    expect(txMock.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tx-import' },
      data: expect.objectContaining({ transferPairId: expect.any(String), categoryId: null, loanId: null }),
    }));
    expect(txMock.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        bankAccountId: 'acct-dest',
        type: 'INCOME',
        amount: 350000,
        balanceImpactApplied: false,
      }),
    }));
    expect(acctMock.update).not.toHaveBeenCalled();
  });

  it('uses an existing matching destination credit instead of creating a duplicate transfer leg', async () => {
    txMock.findUnique.mockResolvedValue({
      ...MOCK_TX,
      id: 'tx-debit',
      userId: 'u1',
      type: 'EXPENSE',
      amount: 350000,
      date: new Date('2026-04-15'),
      bankAccountId: 'acct-src',
      transferPairId: null,
      balanceImpactApplied: true,
    });
    acctMock.findFirst.mockResolvedValue({ id: 'acct-dest', userId: 'u1' });
    txMock.findMany.mockResolvedValueOnce([{ id: 'tx-existing-credit', balanceImpactApplied: true }]);
    txMock.update.mockResolvedValue({ ...MOCK_TX, id: 'tx-debit', transferPairId: 'pair-1' });

    await convertTransactionToTransfer('tx-debit', 'u1', 'MEMBER', {
      transferToAccountId: 'acct-dest',
      adjustDestinationBalance: false,
    });

    expect(txMock.create).not.toHaveBeenCalled();
    expect(txMock.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tx-existing-credit' },
      data: expect.objectContaining({
        transferPairId: expect.any(String),
        categoryId: null,
        loanId: null,
        insurancePolicyId: null,
        refundForTransactionId: null,
      }),
    }));
  });

  it('requires explicit counterpart selection when multiple destination credits match', async () => {
    txMock.findUnique.mockResolvedValue({
      ...MOCK_TX,
      id: 'tx-debit',
      userId: 'u1',
      type: 'EXPENSE',
      amount: 350000,
      date: new Date('2026-04-15'),
      bankAccountId: 'acct-src',
      transferPairId: null,
      balanceImpactApplied: true,
    });
    acctMock.findFirst.mockResolvedValue({ id: 'acct-dest', userId: 'u1' });
    txMock.findMany.mockResolvedValueOnce([
      { id: 'tx-credit-1', balanceImpactApplied: true },
      { id: 'tx-credit-2', balanceImpactApplied: true },
    ]);

    await expect(convertTransactionToTransfer('tx-debit', 'u1', 'MEMBER', {
      transferToAccountId: 'acct-dest',
      adjustDestinationBalance: false,
    })).rejects.toThrow(/Multiple matching counterparty/i);

    expect(txMock.create).not.toHaveBeenCalled();
  });

  it('links the selected counterpart when multiple destination credits match', async () => {
    txMock.findUnique.mockResolvedValue({
      ...MOCK_TX,
      id: 'tx-debit',
      userId: 'u1',
      type: 'EXPENSE',
      amount: 350000,
      date: new Date('2026-04-15'),
      bankAccountId: 'acct-src',
      transferPairId: null,
      balanceImpactApplied: true,
    });
    acctMock.findFirst.mockResolvedValue({ id: 'acct-dest', userId: 'u1' });
    txMock.findMany.mockResolvedValueOnce([
      { id: 'tx-credit-1', balanceImpactApplied: true },
      { id: 'tx-credit-2', balanceImpactApplied: true },
    ]);

    await convertTransactionToTransfer('tx-debit', 'u1', 'MEMBER', {
      transferToAccountId: 'acct-dest',
      counterpartTransactionId: 'tx-credit-2',
      adjustDestinationBalance: false,
    });

    expect(txMock.create).not.toHaveBeenCalled();
    expect(txMock.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tx-credit-2' },
      data: expect.objectContaining({ transferPairId: expect.any(String) }),
    }));
  });

  it('increments destination balance when requested', async () => {
    txMock.findUnique.mockResolvedValue({
      ...MOCK_TX,
      type: 'EXPENSE',
      amount: 5000,
      bankAccountId: 'acct-src',
      transferPairId: null,
    });
    acctMock.findFirst.mockResolvedValue({ id: 'acct-dest', userId: 'u1' });

    await convertTransactionToTransfer('tx-1', 'u1', 'MEMBER', {
      transferToAccountId: 'acct-dest',
      adjustDestinationBalance: true,
    });

    expect(acctMock.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'acct-dest' },
      data: { currentBalance: { increment: 5000 } },
    }));
  });

  it('links existing credit-card payment income to a generated source transfer leg', async () => {
    txMock.findUnique.mockResolvedValue({
      ...MOCK_TX,
      id: 'tx-card-payment',
      userId: 'u1',
      type: 'INCOME',
      amount: 12000,
      bankAccountId: 'acct-card',
      transferPairId: null,
      refundForTransactionId: null,
      balanceImpactApplied: true,
    });
    acctMock.findFirst.mockResolvedValue({ id: 'acct-bank', userId: 'u1' });
    txMock.update.mockResolvedValue({ ...MOCK_TX, id: 'tx-card-payment', type: 'INCOME', transferPairId: 'pair-1' });

    await convertTransactionToTransfer('tx-card-payment', 'u1', 'MEMBER', {
      transferFromAccountId: 'acct-bank',
      adjustSourceBalance: false,
    });

    expect(txMock.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tx-card-payment' },
      data: expect.objectContaining({ transferPairId: expect.any(String), categoryId: null }),
    }));
    expect(txMock.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        bankAccountId: 'acct-bank',
        type: 'EXPENSE',
        amount: 12000,
        balanceImpactApplied: false,
      }),
    }));
    expect(acctMock.update).not.toHaveBeenCalled();
  });

  it('decrements source balance for incoming payment conversion when requested', async () => {
    txMock.findUnique.mockResolvedValue({
      ...MOCK_TX,
      type: 'INCOME',
      amount: 7500,
      bankAccountId: 'acct-card',
      transferPairId: null,
      refundForTransactionId: null,
    });
    acctMock.findFirst.mockResolvedValue({ id: 'acct-bank', userId: 'u1' });

    await convertTransactionToTransfer('tx-1', 'u1', 'MEMBER', {
      transferFromAccountId: 'acct-bank',
      adjustSourceBalance: true,
    });

    expect(acctMock.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'acct-bank' },
      data: { currentBalance: { decrement: 7500 } },
    }));
  });

  it('rejects same source and destination account', async () => {
    txMock.findUnique.mockResolvedValue({
      ...MOCK_TX,
      type: 'EXPENSE',
      bankAccountId: 'acct-src',
      transferPairId: null,
    });

    await expect(convertTransactionToTransfer('tx-1', 'u1', 'MEMBER', {
      transferToAccountId: 'acct-src',
      adjustDestinationBalance: false,
    })).rejects.toThrow(/different from source/i);
  });

  it('rejects already transfer-paired transactions', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, transferPairId: 'pair-1' });
    await expect(convertTransactionToTransfer('tx-1', 'u1', 'MEMBER', {
      transferToAccountId: 'acct-dest',
      adjustDestinationBalance: false,
    })).rejects.toThrow(/already.*transfer/i);
  });

  // ── Eligibility guards ──────────────────────────────────────────────────────

  const TO_DEST = { transferToAccountId: 'acct-dest', adjustDestinationBalance: false };

  it('rejects an unknown transaction', async () => {
    txMock.findUnique.mockResolvedValue(null);
    await expect(convertTransactionToTransfer('tx-x', 'u1', 'MEMBER', TO_DEST))
      .rejects.toThrow(/Transaction not found/i);
  });

  it('rejects a soft-deleted transaction', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, deletedAt: new Date() });
    await expect(convertTransactionToTransfer('tx-1', 'u1', 'MEMBER', TO_DEST))
      .rejects.toThrow(/Transaction not found/i);
  });

  it("forbids a MEMBER from converting another member's transaction", async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, userId: 'other-user' });
    await expect(convertTransactionToTransfer('tx-1', 'u1', 'MEMBER', TO_DEST))
      .rejects.toThrow(/Forbidden/i);
  });

  it("allows an ADMIN to convert another member's transaction", async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, userId: 'other-user', type: 'EXPENSE', bankAccountId: 'acct-src', transferPairId: null });
    acctMock.findFirst.mockResolvedValue({ id: 'acct-dest', userId: 'other-user' });

    await convertTransactionToTransfer('tx-1', 'admin-1', 'ADMIN', TO_DEST);

    // The generated counter-leg belongs to the transaction OWNER, not the admin.
    expect(txMock.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'other-user' }),
    }));
  });

  it('rejects SIP-linked transactions', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, sipId: 'sip-1' });
    await expect(convertTransactionToTransfer('tx-1', 'u1', 'MEMBER', TO_DEST))
      .rejects.toThrow(/SIP transactions cannot be converted/i);
  });

  it('rejects policy-linked transactions', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, insurancePolicyId: 'pol-1' });
    await expect(convertTransactionToTransfer('tx-1', 'u1', 'MEMBER', TO_DEST))
      .rejects.toThrow(/Policy-linked transactions cannot be converted/i);
  });

  it('rejects refund transactions', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, refundForTransactionId: 'expense-1' });
    await expect(convertTransactionToTransfer('tx-1', 'u1', 'MEMBER', TO_DEST))
      .rejects.toThrow(/Refund transactions cannot be converted/i);
  });

  it('rejects a transaction that is neither INCOME nor EXPENSE', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, type: 'TRANSFER' });
    await expect(convertTransactionToTransfer('tx-1', 'u1', 'MEMBER', TO_DEST))
      .rejects.toThrow(/Only income or expense/i);
  });

  it('rejects a transaction that has refunds attached to it', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, type: 'EXPENSE', transferPairId: null });
    txMock.count.mockResolvedValue(1);
    await expect(convertTransactionToTransfer('tx-1', 'u1', 'MEMBER', TO_DEST))
      .rejects.toThrow(/Transactions with refunds cannot be converted/i);
  });

  it('rejects an explicit counterpart id that is not among the valid matches', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, type: 'EXPENSE', bankAccountId: 'acct-src', transferPairId: null });
    acctMock.findFirst.mockResolvedValue({ id: 'acct-dest', userId: 'u1' });
    txMock.findMany.mockResolvedValueOnce([{ id: 'tx-credit-1', balanceImpactApplied: true }]);

    await expect(convertTransactionToTransfer('tx-1', 'u1', 'MEMBER', {
      ...TO_DEST,
      counterpartTransactionId: 'tx-not-a-match',
    })).rejects.toThrow(/not a valid match/i);
  });

  // ── EXPENSE → destination-leg branch ────────────────────────────────────────

  it('requires a destination account for an EXPENSE conversion', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, type: 'EXPENSE', transferPairId: null });
    await expect(convertTransactionToTransfer('tx-1', 'u1', 'MEMBER', { adjustDestinationBalance: false }))
      .rejects.toThrow(/Destination account is required/i);
  });

  it('requires the source transaction to have a bank account', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, type: 'EXPENSE', bankAccountId: null, transferPairId: null });
    await expect(convertTransactionToTransfer('tx-1', 'u1', 'MEMBER', TO_DEST))
      .rejects.toThrow(/Source bank account is required/i);
  });

  it('rejects a destination account that does not belong to the owner', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, type: 'EXPENSE', bankAccountId: 'acct-src', transferPairId: null });
    acctMock.findFirst.mockResolvedValue(null);
    await expect(convertTransactionToTransfer('tx-1', 'u1', 'MEMBER', TO_DEST))
      .rejects.toThrow(/Destination bank account not found/i);
  });

  it('defaults the generated destination leg to no balance impact when the flag is omitted', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, type: 'EXPENSE', amount: 900, bankAccountId: 'acct-src', transferPairId: null });
    acctMock.findFirst.mockResolvedValue({ id: 'acct-dest', userId: 'u1' });

    await convertTransactionToTransfer('tx-1', 'u1', 'MEMBER', { transferToAccountId: 'acct-dest' });

    expect(txMock.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ balanceImpactApplied: false }),
    }));
    expect(acctMock.update).not.toHaveBeenCalled();
  });

  it('marks an existing destination leg as balance-applied and credits the account when requested', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, type: 'EXPENSE', amount: 4200, bankAccountId: 'acct-src', transferPairId: null });
    acctMock.findFirst.mockResolvedValue({ id: 'acct-dest', userId: 'u1' });
    txMock.findMany.mockResolvedValueOnce([{ id: 'tx-existing-credit', balanceImpactApplied: false }]);

    await convertTransactionToTransfer('tx-1', 'u1', 'MEMBER', {
      transferToAccountId: 'acct-dest',
      adjustDestinationBalance: true,
    });

    expect(txMock.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tx-existing-credit' },
      data: expect.objectContaining({ balanceImpactApplied: true }),
    }));
    expect(acctMock.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'acct-dest' },
      data: { currentBalance: { increment: 4200 } },
    }));
  });

  it('does not double-credit a destination leg whose balance impact was already applied', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, type: 'EXPENSE', amount: 4200, bankAccountId: 'acct-src', transferPairId: null });
    acctMock.findFirst.mockResolvedValue({ id: 'acct-dest', userId: 'u1' });
    txMock.findMany.mockResolvedValueOnce([{ id: 'tx-existing-credit', balanceImpactApplied: true }]);

    await convertTransactionToTransfer('tx-1', 'u1', 'MEMBER', {
      transferToAccountId: 'acct-dest',
      adjustDestinationBalance: true,
    });

    expect(acctMock.update).not.toHaveBeenCalled();
  });

  // ── INCOME → source-leg branch ──────────────────────────────────────────────

  it('requires a source account for an INCOME conversion', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, type: 'INCOME', transferPairId: null });
    await expect(convertTransactionToTransfer('tx-1', 'u1', 'MEMBER', { adjustSourceBalance: false }))
      .rejects.toThrow(/Source account is required/i);
  });

  it('requires the incoming transaction to have a bank account', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, type: 'INCOME', bankAccountId: null, transferPairId: null });
    await expect(convertTransactionToTransfer('tx-1', 'u1', 'MEMBER', { transferFromAccountId: 'acct-bank' }))
      .rejects.toThrow(/Destination bank account is required/i);
  });

  it('rejects a source account identical to the destination account', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, type: 'INCOME', bankAccountId: 'acct-card', transferPairId: null });
    await expect(convertTransactionToTransfer('tx-1', 'u1', 'MEMBER', { transferFromAccountId: 'acct-card' }))
      .rejects.toThrow(/Source account must be different/i);
  });

  it('rejects a source account that does not belong to the owner', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, type: 'INCOME', bankAccountId: 'acct-card', transferPairId: null });
    acctMock.findFirst.mockResolvedValue(null);
    await expect(convertTransactionToTransfer('tx-1', 'u1', 'MEMBER', { transferFromAccountId: 'acct-bank' }))
      .rejects.toThrow(/Source bank account not found/i);
  });

  it('defaults the generated source leg to no balance impact when the flag is omitted', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, type: 'INCOME', amount: 800, bankAccountId: 'acct-card', transferPairId: null });
    acctMock.findFirst.mockResolvedValue({ id: 'acct-bank', userId: 'u1' });

    await convertTransactionToTransfer('tx-1', 'u1', 'MEMBER', { transferFromAccountId: 'acct-bank' });

    expect(txMock.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'EXPENSE', balanceImpactApplied: false }),
    }));
    expect(acctMock.update).not.toHaveBeenCalled();
  });

  it('links an existing source leg, marks it balance-applied, and debits the account when requested', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, type: 'INCOME', amount: 6100, bankAccountId: 'acct-card', transferPairId: null });
    acctMock.findFirst.mockResolvedValue({ id: 'acct-bank', userId: 'u1' });
    txMock.findMany.mockResolvedValueOnce([{ id: 'tx-existing-debit', balanceImpactApplied: false }]);

    await convertTransactionToTransfer('tx-1', 'u1', 'MEMBER', {
      transferFromAccountId: 'acct-bank',
      adjustSourceBalance: true,
    });

    expect(txMock.create).not.toHaveBeenCalled();
    expect(txMock.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tx-existing-debit' },
      data: expect.objectContaining({ balanceImpactApplied: true, refundForTransactionId: null }),
    }));
    expect(acctMock.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'acct-bank' },
      data: { currentBalance: { decrement: 6100 } },
    }));
  });

  it('does not double-debit a source leg whose balance impact was already applied', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, type: 'INCOME', amount: 6100, bankAccountId: 'acct-card', transferPairId: null });
    acctMock.findFirst.mockResolvedValue({ id: 'acct-bank', userId: 'u1' });
    txMock.findMany.mockResolvedValueOnce([{ id: 'tx-existing-debit', balanceImpactApplied: true }]);

    await convertTransactionToTransfer('tx-1', 'u1', 'MEMBER', {
      transferFromAccountId: 'acct-bank',
      adjustSourceBalance: true,
    });

    expect(acctMock.update).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// convertTransactionToSIP
// ─────────────────────────────────────────────────────────────────────────────

describe('convertTransactionToSIP', () => {
  it('marks an outgoing transaction as SIP without creating a unit transaction when units/nav are omitted', async () => {
    txMock.findUnique.mockResolvedValue({
      ...MOCK_TX,
      id: 'tx-sip',
      userId: 'u1',
      type: 'EXPENSE',
      bankAccountId: 'acct-1',
      transferPairId: null,
      sipId: null,
      sipTransactionId: null,
    });
    sipMock.findFirst.mockResolvedValue({ ...MOCK_SIP, bankAccountId: 'acct-1' });
    txMock.update.mockResolvedValue({ ...MOCK_TX, id: 'tx-sip', sipId: 'sip-1' });

    await convertTransactionToSIP('tx-sip', 'u1', 'MEMBER', { sipId: 'sip-1' });

    expect(sipTxMock.create).not.toHaveBeenCalled();
    expect(txMock.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tx-sip' },
      data: expect.objectContaining({
        sipId: 'sip-1',
        sipTransactionId: null,
        categoryId: null,
        loanId: null,
      }),
    }));
    expect(acctMock.update).not.toHaveBeenCalled();
  });

  it('creates and links a SIP transaction when units and nav are provided', async () => {
    txMock.findUnique.mockResolvedValue({
      ...MOCK_TX,
      id: 'tx-sip',
      type: 'EXPENSE',
      amount: 1000,
      bankAccountId: 'acct-1',
      sipId: null,
      sipTransactionId: null,
    });
    sipMock.findFirst.mockResolvedValue({ ...MOCK_SIP, investmentId: 'inv-1', bankAccountId: null });
    sipTxMock.create.mockResolvedValue({ id: 'sip-tx-1' });

    await convertTransactionToSIP('tx-sip', 'u1', 'MEMBER', { sipId: 'sip-1', units: 12.3456, nav: 81 });

    expect(sipTxMock.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        investmentId: 'inv-1',
        units: 12.3456,
        nav: 81,
        amount: 1000,
        type: 'BUY',
      }),
    }));
    expect(txMock.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sipId: 'sip-1', sipTransactionId: 'sip-tx-1' }),
    }));
  });

  it('rejects already transfer-paired transactions', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, transferPairId: 'pair-1', sipId: null, sipTransactionId: null });
    await expect(convertTransactionToSIP('tx-1', 'u1', 'MEMBER', { sipId: 'sip-1' })).rejects.toThrow(/transfer/i);
  });

  it('rejects already SIP-linked transactions', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, transferPairId: null, sipId: 'sip-1', sipTransactionId: null });
    await expect(convertTransactionToSIP('tx-1', 'u1', 'MEMBER', { sipId: 'sip-2' })).rejects.toThrow(/already.*SIP/i);
  });

  it('rejects non-expense transactions', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, type: 'INCOME', transferPairId: null, sipId: null, sipTransactionId: null });
    await expect(convertTransactionToSIP('tx-1', 'u1', 'MEMBER', { sipId: 'sip-1' })).rejects.toThrow(/outgoing expense/i);
  });

  it('rejects SIPs linked to a different bank account', async () => {
    txMock.findUnique.mockResolvedValue({
      ...MOCK_TX,
      type: 'EXPENSE',
      bankAccountId: 'acct-src',
      transferPairId: null,
      sipId: null,
      sipTransactionId: null,
    });
    sipMock.findFirst.mockResolvedValue({ ...MOCK_SIP, bankAccountId: 'acct-other' });

    await expect(convertTransactionToSIP('tx-1', 'u1', 'MEMBER', { sipId: 'sip-1' })).rejects.toThrow(/different bank account/i);
  });

  const ELIGIBLE_EXPENSE = { ...MOCK_TX, type: 'EXPENSE', transferPairId: null, sipId: null, sipTransactionId: null };

  it('rejects an unknown transaction', async () => {
    txMock.findUnique.mockResolvedValue(null);
    await expect(convertTransactionToSIP('tx-x', 'u1', 'MEMBER', { sipId: 'sip-1' }))
      .rejects.toThrow(/Transaction not found/i);
  });

  it('rejects a soft-deleted transaction', async () => {
    txMock.findUnique.mockResolvedValue({ ...ELIGIBLE_EXPENSE, deletedAt: new Date() });
    await expect(convertTransactionToSIP('tx-1', 'u1', 'MEMBER', { sipId: 'sip-1' }))
      .rejects.toThrow(/Transaction not found/i);
  });

  it("forbids a MEMBER from marking another member's transaction as SIP", async () => {
    txMock.findUnique.mockResolvedValue({ ...ELIGIBLE_EXPENSE, userId: 'other-user' });
    await expect(convertTransactionToSIP('tx-1', 'u1', 'MEMBER', { sipId: 'sip-1' }))
      .rejects.toThrow(/Forbidden/i);
  });

  it("allows an ADMIN to mark another member's transaction as SIP", async () => {
    txMock.findUnique.mockResolvedValue({ ...ELIGIBLE_EXPENSE, userId: 'other-user' });
    sipMock.findFirst.mockResolvedValue({ ...MOCK_SIP, userId: 'other-user' });

    await convertTransactionToSIP('tx-1', 'admin-1', 'ADMIN', { sipId: 'sip-1' });

    // The SIP is looked up against the transaction OWNER, not the admin.
    expect(sipMock.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'sip-1', userId: 'other-user' },
    }));
  });

  it('rejects policy-linked transactions', async () => {
    txMock.findUnique.mockResolvedValue({ ...ELIGIBLE_EXPENSE, insurancePolicyId: 'pol-1' });
    await expect(convertTransactionToSIP('tx-1', 'u1', 'MEMBER', { sipId: 'sip-1' }))
      .rejects.toThrow(/Policy-linked transactions cannot be marked as SIP/i);
  });

  it('rejects refund transactions', async () => {
    txMock.findUnique.mockResolvedValue({ ...ELIGIBLE_EXPENSE, refundForTransactionId: 'expense-1' });
    await expect(convertTransactionToSIP('tx-1', 'u1', 'MEMBER', { sipId: 'sip-1' }))
      .rejects.toThrow(/Refund transactions cannot be marked as SIP/i);
  });

  it('rejects a transaction that has refunds attached to it', async () => {
    txMock.findUnique.mockResolvedValue(ELIGIBLE_EXPENSE);
    txMock.count.mockResolvedValue(1);
    await expect(convertTransactionToSIP('tx-1', 'u1', 'MEMBER', { sipId: 'sip-1' }))
      .rejects.toThrow(/Transactions with refunds cannot be marked as SIP/i);
  });

  it('rejects an unknown SIP', async () => {
    txMock.findUnique.mockResolvedValue(ELIGIBLE_EXPENSE);
    sipMock.findFirst.mockResolvedValue(null);
    await expect(convertTransactionToSIP('tx-1', 'u1', 'MEMBER', { sipId: 'sip-x' }))
      .rejects.toThrow(/SIP not found/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// update/remove SIP link
// ─────────────────────────────────────────────────────────────────────────────

describe('updateTransactionSIPLink', () => {
  it('changes SIP link and replaces the generated SIP transaction', async () => {
    txMock.findUnique.mockResolvedValue({
      ...MOCK_TX,
      id: 'tx-sip',
      type: 'EXPENSE',
      amount: 1000,
      bankAccountId: 'acct-1',
      transferPairId: null,
      sipId: 'sip-old',
      sipTransactionId: 'sip-tx-old',
    });
    sipMock.findFirst.mockResolvedValue({ ...MOCK_SIP, id: 'sip-new', investmentId: 'inv-new', bankAccountId: null });
    sipTxMock.create.mockResolvedValue({ id: 'sip-tx-new' });

    await updateTransactionSIPLink('tx-sip', 'u1', 'MEMBER', { sipId: 'sip-new', units: 10, nav: 100 });

    expect(sipTxMock.delete).toHaveBeenCalledWith({ where: { id: 'sip-tx-old' } });
    expect(sipTxMock.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ investmentId: 'inv-new', units: 10, nav: 100, amount: 1000 }),
    }));
    expect(txMock.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tx-sip' },
      data: expect.objectContaining({ sipId: 'sip-new', sipTransactionId: 'sip-tx-new' }),
    }));
  });

  it('changes SIP link and removes the generated SIP transaction when units/nav are omitted', async () => {
    txMock.findUnique.mockResolvedValue({
      ...MOCK_TX,
      type: 'EXPENSE',
      transferPairId: null,
      sipId: 'sip-old',
      sipTransactionId: 'sip-tx-old',
    });
    sipMock.findFirst.mockResolvedValue({ ...MOCK_SIP, id: 'sip-new', investmentId: 'inv-new' });

    await updateTransactionSIPLink('tx-1', 'u1', 'MEMBER', { sipId: 'sip-new' });

    expect(sipTxMock.delete).toHaveBeenCalledWith({ where: { id: 'sip-tx-old' } });
    expect(sipTxMock.create).not.toHaveBeenCalled();
    expect(txMock.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sipId: 'sip-new', sipTransactionId: null }),
    }));
  });

  it('repairs a link when the transaction only has sipTransactionId', async () => {
    txMock.findUnique.mockResolvedValue({
      ...MOCK_TX,
      type: 'EXPENSE',
      transferPairId: null,
      sipId: null,
      sipTransactionId: 'sip-tx-old',
    });
    sipMock.findFirst.mockResolvedValue({ ...MOCK_SIP, id: 'sip-new', investmentId: 'inv-new' });

    await updateTransactionSIPLink('tx-1', 'u1', 'MEMBER', { sipId: 'sip-new' });

    expect(sipTxMock.delete).toHaveBeenCalledWith({ where: { id: 'sip-tx-old' } });
    expect(txMock.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sipId: 'sip-new', sipTransactionId: null }),
    }));
  });

  it('rejects transactions that are not marked as SIP', async () => {
    txMock.findUnique.mockResolvedValue({
      ...MOCK_TX,
      transferPairId: null,
      sipId: null,
      sipTransactionId: null,
    });

    await expect(updateTransactionSIPLink('tx-1', 'u1', 'MEMBER', { sipId: 'sip-1' })).rejects.toThrow(/not marked as SIP/i);
  });

  const SIP_LINKED = { ...MOCK_TX, type: 'EXPENSE', transferPairId: null, sipId: 'sip-old', sipTransactionId: null };

  it('rejects an unknown transaction', async () => {
    txMock.findUnique.mockResolvedValue(null);
    await expect(updateTransactionSIPLink('tx-x', 'u1', 'MEMBER', { sipId: 'sip-1' }))
      .rejects.toThrow(/Transaction not found/i);
  });

  it('rejects a soft-deleted transaction', async () => {
    txMock.findUnique.mockResolvedValue({ ...SIP_LINKED, deletedAt: new Date() });
    await expect(updateTransactionSIPLink('tx-1', 'u1', 'MEMBER', { sipId: 'sip-1' }))
      .rejects.toThrow(/Transaction not found/i);
  });

  it("forbids a MEMBER from relinking another member's transaction", async () => {
    txMock.findUnique.mockResolvedValue({ ...SIP_LINKED, userId: 'other-user' });
    await expect(updateTransactionSIPLink('tx-1', 'u1', 'MEMBER', { sipId: 'sip-1' }))
      .rejects.toThrow(/Forbidden/i);
  });

  it("allows an ADMIN to relink another member's transaction", async () => {
    txMock.findUnique.mockResolvedValue({ ...SIP_LINKED, userId: 'other-user' });
    sipMock.findFirst.mockResolvedValue({ ...MOCK_SIP, userId: 'other-user' });

    await updateTransactionSIPLink('tx-1', 'admin-1', 'ADMIN', { sipId: 'sip-1' });

    expect(sipMock.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'sip-1', userId: 'other-user' },
    }));
  });

  it('rejects transfer transactions', async () => {
    txMock.findUnique.mockResolvedValue({ ...SIP_LINKED, transferPairId: 'pair-1' });
    await expect(updateTransactionSIPLink('tx-1', 'u1', 'MEMBER', { sipId: 'sip-1' }))
      .rejects.toThrow(/Transfer transactions cannot be linked to SIP/i);
  });

  it('rejects refund transactions', async () => {
    txMock.findUnique.mockResolvedValue({ ...SIP_LINKED, refundForTransactionId: 'expense-1' });
    await expect(updateTransactionSIPLink('tx-1', 'u1', 'MEMBER', { sipId: 'sip-1' }))
      .rejects.toThrow(/Refund transactions cannot be linked to SIP/i);
  });

  it('rejects non-expense transactions', async () => {
    txMock.findUnique.mockResolvedValue({ ...SIP_LINKED, type: 'INCOME' });
    await expect(updateTransactionSIPLink('tx-1', 'u1', 'MEMBER', { sipId: 'sip-1' }))
      .rejects.toThrow(/outgoing expense/i);
  });

  it('rejects an unknown SIP', async () => {
    txMock.findUnique.mockResolvedValue(SIP_LINKED);
    sipMock.findFirst.mockResolvedValue(null);
    await expect(updateTransactionSIPLink('tx-1', 'u1', 'MEMBER', { sipId: 'sip-x' }))
      .rejects.toThrow(/SIP not found/i);
  });

  it('rejects a SIP bound to a different bank account', async () => {
    txMock.findUnique.mockResolvedValue({ ...SIP_LINKED, bankAccountId: 'acct-1' });
    sipMock.findFirst.mockResolvedValue({ ...MOCK_SIP, bankAccountId: 'acct-other' });
    await expect(updateTransactionSIPLink('tx-1', 'u1', 'MEMBER', { sipId: 'sip-1' }))
      .rejects.toThrow(/different bank account/i);
  });
});

describe('removeTransactionSIPLink', () => {
  it('removes SIP link and deletes generated SIP transaction', async () => {
    txMock.findUnique.mockResolvedValue({
      ...MOCK_TX,
      sipId: 'sip-1',
      sipTransactionId: 'sip-tx-1',
    });

    await removeTransactionSIPLink('tx-1', 'u1', 'MEMBER');

    expect(sipTxMock.delete).toHaveBeenCalledWith({ where: { id: 'sip-tx-1' } });
    expect(txMock.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tx-1' },
      data: expect.objectContaining({ sipId: null, sipTransactionId: null }),
    }));
  });

  it('rejects transactions without a SIP link', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, sipId: null, sipTransactionId: null });
    await expect(removeTransactionSIPLink('tx-1', 'u1', 'MEMBER')).rejects.toThrow(/not marked as SIP/i);
  });

  it('rejects an unknown transaction', async () => {
    txMock.findUnique.mockResolvedValue(null);
    await expect(removeTransactionSIPLink('tx-x', 'u1', 'MEMBER')).rejects.toThrow(/Transaction not found/i);
  });

  it('rejects a soft-deleted transaction', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, sipId: 'sip-1', deletedAt: new Date() });
    await expect(removeTransactionSIPLink('tx-1', 'u1', 'MEMBER')).rejects.toThrow(/Transaction not found/i);
  });

  it("forbids a MEMBER from unlinking another member's transaction", async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, userId: 'other-user', sipId: 'sip-1' });
    await expect(removeTransactionSIPLink('tx-1', 'u1', 'MEMBER')).rejects.toThrow(/Forbidden/i);
  });

  it("allows an ADMIN to unlink another member's transaction", async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, id: 'tx-1', userId: 'other-user', sipId: 'sip-1', sipTransactionId: null });

    await removeTransactionSIPLink('tx-1', 'admin-1', 'ADMIN');

    expect(txMock.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tx-1' },
      data: expect.objectContaining({ sipId: null, sipTransactionId: null }),
    }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// update/remove insurance policy link
// ─────────────────────────────────────────────────────────────────────────────

describe('updateTransactionInsurancePolicyLink', () => {
  it('links an outgoing transaction to an insurance policy and clears loan link', async () => {
    txMock.findUnique.mockResolvedValue({
      ...MOCK_TX,
      type: 'EXPENSE',
      transferPairId: null,
      sipId: null,
      sipTransactionId: null,
      loanId: 'loan-1',
    });
    policyMock.findFirst.mockResolvedValue({ id: 'pol-1' });

    await updateTransactionInsurancePolicyLink('tx-1', 'u1', 'MEMBER', { insurancePolicyId: 'pol-1' });

    expect(policyMock.findFirst).toHaveBeenCalledWith({
      where: { id: 'pol-1', userId: 'u1' },
      select: { id: true },
    });
    expect(txMock.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tx-1' },
      data: expect.objectContaining({ insurancePolicyId: 'pol-1', loanId: null }),
    }));
  });

  it('rejects SIP-linked transactions', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, sipId: 'sip-1', sipTransactionId: null });
    await expect(
      updateTransactionInsurancePolicyLink('tx-1', 'u1', 'MEMBER', { insurancePolicyId: 'pol-1' }),
    ).rejects.toThrow(/SIP transactions/i);
  });

  it('rejects non-expense transactions', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, type: 'INCOME' });
    await expect(
      updateTransactionInsurancePolicyLink('tx-1', 'u1', 'MEMBER', { insurancePolicyId: 'pol-1' }),
    ).rejects.toThrow(/outgoing expense/i);
  });

  const POLICY_ELIGIBLE = { ...MOCK_TX, type: 'EXPENSE', transferPairId: null, sipId: null, sipTransactionId: null };

  it('rejects an unknown transaction', async () => {
    txMock.findUnique.mockResolvedValue(null);
    await expect(updateTransactionInsurancePolicyLink('tx-x', 'u1', 'MEMBER', { insurancePolicyId: 'pol-1' }))
      .rejects.toThrow(/Transaction not found/i);
  });

  it('rejects a soft-deleted transaction', async () => {
    txMock.findUnique.mockResolvedValue({ ...POLICY_ELIGIBLE, deletedAt: new Date() });
    await expect(updateTransactionInsurancePolicyLink('tx-1', 'u1', 'MEMBER', { insurancePolicyId: 'pol-1' }))
      .rejects.toThrow(/Transaction not found/i);
  });

  it("forbids a MEMBER from linking another member's transaction", async () => {
    txMock.findUnique.mockResolvedValue({ ...POLICY_ELIGIBLE, userId: 'other-user' });
    await expect(updateTransactionInsurancePolicyLink('tx-1', 'u1', 'MEMBER', { insurancePolicyId: 'pol-1' }))
      .rejects.toThrow(/Forbidden/i);
  });

  it("allows an ADMIN to link another member's transaction", async () => {
    txMock.findUnique.mockResolvedValue({ ...POLICY_ELIGIBLE, userId: 'other-user' });
    policyMock.findFirst.mockResolvedValue({ id: 'pol-1' });

    await updateTransactionInsurancePolicyLink('tx-1', 'admin-1', 'ADMIN', { insurancePolicyId: 'pol-1' });

    // The policy is looked up against the transaction OWNER, not the admin.
    expect(policyMock.findFirst).toHaveBeenCalledWith({
      where: { id: 'pol-1', userId: 'other-user' },
      select: { id: true },
    });
  });

  it('rejects transfer transactions', async () => {
    txMock.findUnique.mockResolvedValue({ ...POLICY_ELIGIBLE, transferPairId: 'pair-1' });
    await expect(updateTransactionInsurancePolicyLink('tx-1', 'u1', 'MEMBER', { insurancePolicyId: 'pol-1' }))
      .rejects.toThrow(/Transfer transactions cannot be linked to an insurance policy/i);
  });

  it('rejects refund transactions', async () => {
    txMock.findUnique.mockResolvedValue({ ...POLICY_ELIGIBLE, refundForTransactionId: 'expense-1' });
    await expect(updateTransactionInsurancePolicyLink('tx-1', 'u1', 'MEMBER', { insurancePolicyId: 'pol-1' }))
      .rejects.toThrow(/Refund transactions cannot be linked to an insurance policy/i);
  });

  it('rejects a transaction that has refunds attached to it', async () => {
    txMock.findUnique.mockResolvedValue(POLICY_ELIGIBLE);
    txMock.count.mockResolvedValue(1);
    await expect(updateTransactionInsurancePolicyLink('tx-1', 'u1', 'MEMBER', { insurancePolicyId: 'pol-1' }))
      .rejects.toThrow(/Transactions with refunds cannot be linked to an insurance policy/i);
  });

  it('rejects an unknown policy', async () => {
    txMock.findUnique.mockResolvedValue(POLICY_ELIGIBLE);
    policyMock.findFirst.mockResolvedValue(null);
    await expect(updateTransactionInsurancePolicyLink('tx-1', 'u1', 'MEMBER', { insurancePolicyId: 'pol-x' }))
      .rejects.toThrow(/Insurance policy not found/i);
  });
});

describe('removeTransactionInsurancePolicyLink', () => {
  it('removes policy link', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, insurancePolicyId: 'pol-1' });

    await removeTransactionInsurancePolicyLink('tx-1', 'u1', 'MEMBER');

    expect(txMock.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tx-1' },
      data: expect.objectContaining({ insurancePolicyId: null }),
    }));
  });

  it('rejects transactions without a policy link', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, insurancePolicyId: null });
    await expect(removeTransactionInsurancePolicyLink('tx-1', 'u1', 'MEMBER')).rejects.toThrow(/not linked/i);
  });

  it('rejects an unknown transaction', async () => {
    txMock.findUnique.mockResolvedValue(null);
    await expect(removeTransactionInsurancePolicyLink('tx-x', 'u1', 'MEMBER')).rejects.toThrow(/Transaction not found/i);
  });

  it('rejects a soft-deleted transaction', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, insurancePolicyId: 'pol-1', deletedAt: new Date() });
    await expect(removeTransactionInsurancePolicyLink('tx-1', 'u1', 'MEMBER')).rejects.toThrow(/Transaction not found/i);
  });

  it("forbids a MEMBER from unlinking another member's transaction", async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, userId: 'other-user', insurancePolicyId: 'pol-1' });
    await expect(removeTransactionInsurancePolicyLink('tx-1', 'u1', 'MEMBER')).rejects.toThrow(/Forbidden/i);
  });

  it("allows an ADMIN to unlink another member's transaction", async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, id: 'tx-1', userId: 'other-user', insurancePolicyId: 'pol-1' });

    await removeTransactionInsurancePolicyLink('tx-1', 'admin-1', 'ADMIN');

    expect(txMock.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tx-1' },
      data: expect.objectContaining({ insurancePolicyId: null }),
    }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// update/remove refund link
// ─────────────────────────────────────────────────────────────────────────────

describe('updateTransactionRefundLink', () => {
  it('links an incoming transaction to the original expense', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, id: 'refund-1', type: 'INCOME', transferPairId: null });
    txMock.findFirst.mockResolvedValue({ id: 'expense-1', transferPairId: null });

    await updateTransactionRefundLink('refund-1', 'u1', 'MEMBER', { refundForTransactionId: 'expense-1' });

    expect(txMock.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'expense-1', userId: 'u1', deletedAt: null, type: 'EXPENSE' }),
      select: { id: true, transferPairId: true },
    }));
    expect(txMock.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'refund-1' },
      data: expect.objectContaining({ refundForTransactionId: 'expense-1' }),
    }));
  });

  it('rejects non-income transactions', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, type: 'EXPENSE' });
    await expect(
      updateTransactionRefundLink('tx-1', 'u1', 'MEMBER', { refundForTransactionId: 'expense-1' }),
    ).rejects.toThrow(/incoming transactions/i);
  });

  it('rejects unknown original expense', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, type: 'INCOME' });
    txMock.findFirst.mockResolvedValue(null);
    await expect(
      updateTransactionRefundLink('tx-1', 'u1', 'MEMBER', { refundForTransactionId: 'expense-x' }),
    ).rejects.toThrow(/original expense/i);
  });

  const REFUND_ELIGIBLE = {
    ...MOCK_TX, id: 'refund-1', type: 'INCOME', transferPairId: null,
    sipId: null, sipTransactionId: null, insurancePolicyId: null,
  };

  it('rejects an unknown transaction', async () => {
    txMock.findUnique.mockResolvedValue(null);
    await expect(updateTransactionRefundLink('tx-x', 'u1', 'MEMBER', { refundForTransactionId: 'expense-1' }))
      .rejects.toThrow(/Transaction not found/i);
  });

  it('rejects a soft-deleted transaction', async () => {
    txMock.findUnique.mockResolvedValue({ ...REFUND_ELIGIBLE, deletedAt: new Date() });
    await expect(updateTransactionRefundLink('refund-1', 'u1', 'MEMBER', { refundForTransactionId: 'expense-1' }))
      .rejects.toThrow(/Transaction not found/i);
  });

  it("forbids a MEMBER from linking another member's transaction", async () => {
    txMock.findUnique.mockResolvedValue({ ...REFUND_ELIGIBLE, userId: 'other-user' });
    await expect(updateTransactionRefundLink('refund-1', 'u1', 'MEMBER', { refundForTransactionId: 'expense-1' }))
      .rejects.toThrow(/Forbidden/i);
  });

  it("allows an ADMIN to link another member's transaction", async () => {
    txMock.findUnique.mockResolvedValue({ ...REFUND_ELIGIBLE, userId: 'other-user' });
    txMock.findFirst.mockResolvedValue({ id: 'expense-1', transferPairId: null });

    await updateTransactionRefundLink('refund-1', 'admin-1', 'ADMIN', { refundForTransactionId: 'expense-1' });

    // The refunded expense is looked up against the transaction OWNER, not the admin.
    expect(txMock.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'other-user' }),
    }));
  });

  it('rejects transfer transactions', async () => {
    txMock.findUnique.mockResolvedValue({ ...REFUND_ELIGIBLE, transferPairId: 'pair-1' });
    await expect(updateTransactionRefundLink('refund-1', 'u1', 'MEMBER', { refundForTransactionId: 'expense-1' }))
      .rejects.toThrow(/Transfer transactions cannot be linked as refunds/i);
  });

  it('rejects SIP transactions', async () => {
    txMock.findUnique.mockResolvedValue({ ...REFUND_ELIGIBLE, sipId: 'sip-1' });
    await expect(updateTransactionRefundLink('refund-1', 'u1', 'MEMBER', { refundForTransactionId: 'expense-1' }))
      .rejects.toThrow(/SIP transactions cannot be linked as refunds/i);
  });

  it('rejects policy-linked transactions', async () => {
    txMock.findUnique.mockResolvedValue({ ...REFUND_ELIGIBLE, insurancePolicyId: 'pol-1' });
    await expect(updateTransactionRefundLink('refund-1', 'u1', 'MEMBER', { refundForTransactionId: 'expense-1' }))
      .rejects.toThrow(/Policy-linked transactions cannot be linked as refunds/i);
  });

  it('rejects a transaction refunding itself', async () => {
    txMock.findUnique.mockResolvedValue(REFUND_ELIGIBLE);
    await expect(updateTransactionRefundLink('refund-1', 'u1', 'MEMBER', { refundForTransactionId: 'refund-1' }))
      .rejects.toThrow(/cannot refund itself/i);
  });

  it('rejects refunding a transfer leg', async () => {
    txMock.findUnique.mockResolvedValue(REFUND_ELIGIBLE);
    txMock.findFirst.mockResolvedValue({ id: 'expense-1', transferPairId: 'pair-1' });
    await expect(updateTransactionRefundLink('refund-1', 'u1', 'MEMBER', { refundForTransactionId: 'expense-1' }))
      .rejects.toThrow(/Transfer transactions cannot be refunded/i);
  });
});

describe('removeTransactionRefundLink', () => {
  it('removes refund link', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, id: 'refund-1', type: 'INCOME', refundForTransactionId: 'expense-1' });

    await removeTransactionRefundLink('refund-1', 'u1', 'MEMBER');

    expect(txMock.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'refund-1' },
      data: expect.objectContaining({ refundForTransactionId: null }),
    }));
  });

  it('rejects transactions without a refund link', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, type: 'INCOME', refundForTransactionId: null });
    await expect(removeTransactionRefundLink('tx-1', 'u1', 'MEMBER')).rejects.toThrow(/not linked as a refund/i);
  });

  it('rejects an unknown transaction', async () => {
    txMock.findUnique.mockResolvedValue(null);
    await expect(removeTransactionRefundLink('tx-x', 'u1', 'MEMBER')).rejects.toThrow(/Transaction not found/i);
  });

  it('rejects a soft-deleted transaction', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, refundForTransactionId: 'expense-1', deletedAt: new Date() });
    await expect(removeTransactionRefundLink('tx-1', 'u1', 'MEMBER')).rejects.toThrow(/Transaction not found/i);
  });

  it("forbids a MEMBER from unlinking another member's transaction", async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, userId: 'other-user', refundForTransactionId: 'expense-1' });
    await expect(removeTransactionRefundLink('tx-1', 'u1', 'MEMBER')).rejects.toThrow(/Forbidden/i);
  });

  it("allows an ADMIN to unlink another member's transaction", async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, id: 'tx-1', userId: 'other-user', refundForTransactionId: 'expense-1' });

    await removeTransactionRefundLink('tx-1', 'admin-1', 'ADMIN');

    expect(txMock.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tx-1' },
      data: expect.objectContaining({ refundForTransactionId: null }),
    }));
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

  it('rejects a type change on a transaction that has active refunds', async () => {
    // Changing EXPENSE → INCOME would orphan the refund rows pointing at it.
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, type: 'EXPENSE' });
    txMock.count.mockResolvedValue(2);

    await expect(updateTransaction('tx-1', 'u1', 'MEMBER', { type: 'INCOME' }))
      .rejects.toThrow(/Transactions with refunds cannot change type/i);

    expect(txMock.count).toHaveBeenCalledWith({
      where: { refundForTransactionId: 'tx-1', deletedAt: null },
    });
    expect(acctMock.update).not.toHaveBeenCalled();
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

  it('updates date field when date is provided (line 300 truthy branch)', async () => {
    txMock.update.mockResolvedValue({ ...MOCK_TX, date: new Date('2025-05-01') });
    await updateTransaction('tx-1', 'u1', 'MEMBER', { date: '2025-05-01' });
    expect(txMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ date: new Date('2025-05-01') }),
      }),
    );
  });

  it('uses original.amount when data.amount is undefined in loan recalculation (line 329 ?? branch)', async () => {
    // type changes EXPENSE→INCOME on a loan-linked tx, amount is NOT provided
    // newAmount = data.amount ?? Number(original.amount) → uses original.amount
    txMock.findUnique.mockResolvedValue({
      ...MOCK_TX,
      type: 'EXPENSE',
      amount: 1000,
      bankAccountId: null,
      loanId: 'loan-1',
    });
    txMock.update.mockResolvedValue({ ...MOCK_TX, type: 'INCOME' });

    await updateTransaction('tx-1', 'u1', 'MEMBER', { type: 'INCOME' });

    // wasLoanExpense=true, isLoanExpense=false → oldLoanDecrement=1000, newLoanDecrement=0
    // loanNetChange = 1000 - 0 = 1000 (restore full amount)
    expect(loanMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'loan-1' },
        data: { outstandingBalance: { increment: 1000 } },
      }),
    );
  });

  it('INCOME→EXPENSE type change on loan-linked tx (line 335: !wasLoanExpense → 0)', async () => {
    // original is INCOME (wasLoanExpense=false), new type is EXPENSE (isLoanExpense=true)
    // oldLoanDecrement = wasLoanExpense ? amount : 0 → 0 (line 335 ': 0' branch)
    // newLoanDecrement = isLoanExpense ? 800 : 0 → 800
    // loanNetChange = 0 - 800 = -800 (loan outstanding increases)
    txMock.findUnique.mockResolvedValue({
      ...MOCK_TX,
      type: 'INCOME',
      amount: 500,
      bankAccountId: null,
      loanId: 'loan-1',
    });
    txMock.update.mockResolvedValue({ ...MOCK_TX, type: 'EXPENSE', amount: 800 });

    await updateTransaction('tx-1', 'u1', 'MEMBER', { type: 'EXPENSE', amount: 800 });

    expect(loanMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'loan-1' },
        data: { outstandingBalance: { increment: -800 } },
      }),
    );
  });

  it('INCOME→INCOME loan-linked tx — skips loan update (line 333: false branch)', async () => {
    // wasLoanExpense=false, isLoanExpense=false → condition false → loanMock.update NOT called
    txMock.findUnique.mockResolvedValue({
      ...MOCK_TX,
      type: 'INCOME',
      amount: 500,
      bankAccountId: null,
      loanId: 'loan-1',
    });
    txMock.update.mockResolvedValue({ ...MOCK_TX, type: 'INCOME', amount: 600 });

    await updateTransaction('tx-1', 'u1', 'MEMBER', { amount: 600 });

    expect(loanMock.update).not.toHaveBeenCalled();
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

  it('refuses to delete an expense that still has refunds linked to it', async () => {
    txMock.findUnique.mockResolvedValue({ ...MOCK_TX, type: 'EXPENSE' });
    txMock.count.mockResolvedValue(1);

    await expect(softDeleteTransaction('tx-1', 'u1', 'MEMBER'))
      .rejects.toThrow(/Remove refund links before deleting the original expense/i);

    expect(txMock.count).toHaveBeenCalledWith({
      where: { refundForTransactionId: 'tx-1', deletedAt: null },
    });
    // Nothing is mutated — neither the soft-delete nor the balance reversal.
    expect(txMock.update).not.toHaveBeenCalled();
    expect(acctMock.update).not.toHaveBeenCalled();
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

  it('does not reverse account balance when balance impact was not applied', async () => {
    txMock.findUnique.mockResolvedValue({
      ...MOCK_TX,
      type: 'INCOME',
      amount: 5000,
      bankAccountId: 'acct-dest',
      balanceImpactApplied: false,
    });

    await softDeleteTransaction('tx-1', 'u1', 'MEMBER');

    expect(txMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
    );
    expect(acctMock.update).not.toHaveBeenCalled();
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

  it('deletes the generated SIP transaction when a SIP-linked bank transaction is deleted', async () => {
    txMock.findUnique.mockResolvedValue({
      ...MOCK_TX,
      sipId: 'sip-1',
      sipTransactionId: 'sip-tx-1',
      bankAccountId: null,
    });

    await softDeleteTransaction('tx-1', 'u1', 'MEMBER');

    expect(sipTxMock.delete).toHaveBeenCalledWith({ where: { id: 'sip-tx-1' } });
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

  it('applies singular categoryId filter (else-if branch, lines 481-482)', async () => {
    await getAllTransactionsForExport('u1', 'MEMBER', { categoryId: 'cat-1' });
    const call = txMock.findMany.mock.calls[0][0];
    expect(call.where.categoryId).toBe('cat-1');
  });

  it('applies bankAccountId filter (line 477)', async () => {
    await getAllTransactionsForExport('u1', 'MEMBER', { bankAccountId: 'acct-99' });
    const call = txMock.findMany.mock.calls[0][0];
    expect(call.where.bankAccountId).toBe('acct-99');
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
    expect(call.where.date.gte).toEqual(new Date('2025-03-31T18:30:00.000Z'));
  });

  it('applies endDate filter as date range upper bound', async () => {
    await getAllTransactionsForExport('u1', 'MEMBER', { endDate: '2025-06-30' });
    const call = txMock.findMany.mock.calls[0][0];
    expect(call.where.date).toBeDefined();
    expect(call.where.date.lte).toEqual(new Date('2025-06-30T18:29:59.999Z'));
  });

  it('applies startDate/endDate as a narrower range when fy is also provided', async () => {
    await getAllTransactionsForExport('u1', 'MEMBER', {
      fy: '2025-26',
      startDate: '2025-07-01',
      endDate: '2025-07-31',
    });
    const call = txMock.findMany.mock.calls[0][0];
    expect(call.where.date.gte).toEqual(new Date('2025-06-30T18:30:00.000Z'));
    expect(call.where.date.lte).toEqual(new Date('2025-07-31T18:29:59.999Z'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildCsv
// ─────────────────────────────────────────────────────────────────────────────

describe('buildCsv', () => {
  const makeRow = (overrides: Partial<Record<string, any>> = {}) => ({
    date: new Date('2025-04-01'),
    description: 'Test transaction',
    remark: 'Bank remark',
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
    expect(lines[0]).toBe('Date,Description,Remark,Type,Amount,Category,SIP,Policy,RefundFor,Account,PaymentMode,Tags');
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

  it('escapes double-quotes in remark', () => {
    const csv = buildCsv([makeRow({ remark: 'Bank "remark"' })]);
    expect(csv).toContain('"Bank ""remark"""');
  });

  it('renders an empty quoted field for a null remark', () => {
    const csv = buildCsv([makeRow({ remark: null })]);
    const cols = csv.split('\r\n')[1].split(',');
    expect(cols[2]).toBe('""'); // Remark is the 3rd column
    expect(csv).not.toContain('null');
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

  it('handles null accountNumberLast4 — falls back to empty string suffix', () => {
    // line 525: accountNumberLast4 ?? '' when bankAccount exists but last4 is null
    const csv = buildCsv([makeRow({ bankAccount: { bankName: 'SBI', accountNumberLast4: null } })]);
    expect(csv).toContain('SBI ····');
    expect(csv).not.toContain('null');
  });

  it('renders empty string for null paymentMode via ?? operator (line 526)', () => {
    const csv = buildCsv([makeRow({ paymentMode: null })]);
    // paymentMode is column 11 (0-indexed 10): null → escape('') → ""
    expect(csv).not.toContain('null');
    expect(csv).not.toContain('undefined');
    // The paymentMode column renders as an empty quoted field
    const dataLine = csv.split('\r\n')[1];
    const cols = dataLine.split(',');
    expect(cols[10]).toBe('""'); // paymentMode column is empty quoted string
  });

  it('exports SIP fund name when present', () => {
    const csv = buildCsv([makeRow({ sip: { fundName: 'Mirae SIP' } })]);
    expect(csv).toContain('"Mirae SIP"');
  });

  it('exports insurance policy name when present', () => {
    const csv = buildCsv([makeRow({ insurancePolicy: { providerName: 'LIC', policyName: 'Term Plan', policyNumber: 'P1' } })]);
    expect(csv).toContain('"LIC · Term Plan"');
  });

  it('exports linked original expense for refunds when present', () => {
    const csv = buildCsv([
      makeRow({
        type: 'INCOME',
        refundFor: {
          description: 'Flight ticket',
          amount: 4500,
          date: new Date('2025-04-03'),
        },
      }),
    ]);
    expect(csv).toContain('"Flight ticket (2025-04-03, ₹4500.00)"');
  });

  it('joins multiple tags with semicolons', () => {
    const csv = buildCsv([makeRow({ tags: ['food', 'lunch', 'work'] })]);
    expect(csv).toContain('food;lunch;work');
  });

  it('returns only header for empty rows array', () => {
    const csv = buildCsv([]);
    expect(csv).toBe('Date,Description,Remark,Type,Amount,Category,SIP,Policy,RefundFor,Account,PaymentMode,Tags');
  });
});

/**
 * The template delete-guard that used to live here is gone: a recurring rule carries its
 * own specification now, so there is no template Transaction to protect. The guard was a
 * workaround for templates being in the ledger at all.
 */
describe('softDeleteTransaction — ordinary transactions', () => {
  it('deletes an ordinary transaction', async () => {
    await softDeleteTransaction('tx-1', 'u1', 'MEMBER');
    expect(txMock.update).toHaveBeenCalled();
  });
});

/**
 * Attributing a REAL charge to a subscription is what makes "charged more than expected"
 * mean anything: without it the only rows carrying a subscriptionId are ones generation
 * created at exactly the recorded price, so the check could never fire on the vendor
 * behaviour it claims to detect.
 */
describe('createTransaction — subscription attribution', () => {
  const base = {
    amount: 649, type: 'EXPENSE', description: 'Netflix', date: '2026-08-01',
  };

  it('links an expense to a subscription the user owns', async () => {
    (prisma as any).subscription.findFirst.mockResolvedValue({ id: 'sub-1' });

    await createTransaction('u1', { ...base, subscriptionId: 'sub-1' } as never);

    expect(txMock.create.mock.calls[0][0].data.subscriptionId).toBe('sub-1');
  });

  it('refuses a subscription belonging to someone else', async () => {
    (prisma as any).subscription.findFirst.mockResolvedValue(null);

    await expect(createTransaction('u1', { ...base, subscriptionId: 'sub-of-u2' } as never))
      .rejects.toThrow(/subscription/i);

    expect(txMock.create).not.toHaveBeenCalled();
  });

  it('ignores the link on a non-EXPENSE transaction', async () => {
    // A subscription charge is money going out; attributing income to one is meaningless.
    await createTransaction('u1', { ...base, type: 'INCOME', subscriptionId: 'sub-1' } as never);

    expect(txMock.create.mock.calls[0][0].data.subscriptionId).toBeUndefined();
    expect((prisma as any).subscription.findFirst).not.toHaveBeenCalled();
  });
});
