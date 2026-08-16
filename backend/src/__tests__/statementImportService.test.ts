/**
 * Unit tests for statementImportService — the persistence half of a bank-statement
 * import, extracted out of index.ts (where it was excluded from the coverage gate and
 * had zero tests, including the account-ownership check).
 *
 * Uses named import { prisma } — dual-export mock required.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config/prisma', () => {
  const mock = {
    bankAccount: { findFirst: vi.fn(), update: vi.fn() },
    transaction: { findMany: vi.fn(), create: vi.fn() },
    bankStatementImport: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  return { default: mock, prisma: mock };
});

import { prisma } from '../config/prisma';
import { makeImportHash, type ParsedTransaction } from '../services/importService';
import { persistParsedStatement } from '../services/statementImportService';
import { AppError } from '../utils/AppError';

const acctMock = (prisma as any).bankAccount;
const txMock = (prisma as any).transaction;
const importMock = (prisma as any).bankStatementImport;
const $transactionMock = (prisma as any).$transaction;

/** Interactive-transaction client handed to the $transaction callback. */
const txClient = {
  transaction: { create: vi.fn() },
  bankAccount: { update: vi.fn() },
};

function makeTx(over: Partial<ParsedTransaction> = {}): ParsedTransaction {
  return {
    date: new Date('2025-04-01T00:00:00.000Z'),
    description: 'Coffee',
    amount: 100,
    type: 'EXPENSE',
    ...over,
  };
}

const BASE = {
  ownerUserId: 'u1',
  bank: 'HDFC',
  rowCount: 1,
  filename: 'statement.csv',
};

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  acctMock.findFirst.mockResolvedValue({ id: 'acc1', userId: 'u1' });
  txMock.findMany.mockResolvedValue([]);
  importMock.create.mockResolvedValue({ id: 'imp-1' });
  txClient.transaction.create.mockResolvedValue({ id: 'tx-1' });
  txClient.bankAccount.update.mockResolvedValue({});
  // Run the callback against our fake interactive client.
  $transactionMock.mockImplementation(async (cb: any) => cb(txClient));
});

afterEach(() => {
  errorSpy.mockRestore();
});

// ─── Account ownership ────────────────────────────────────────────────────────

describe('persistParsedStatement — account ownership', () => {
  it('queries the account scoped to the owner and proceeds when it matches', async () => {
    await persistParsedStatement({ ...BASE, accountId: 'acc1', transactions: [makeTx()] });
    expect(acctMock.findFirst).toHaveBeenCalledWith({
      where: { id: 'acc1', userId: 'u1' },
    });
    expect(txClient.transaction.create).toHaveBeenCalledTimes(1);
  });

  it('throws "Bank account not found" and writes NOTHING when the account is another user\'s', async () => {
    acctMock.findFirst.mockResolvedValue(null);

    await expect(
      persistParsedStatement({ ...BASE, accountId: 'someone-elses', transactions: [makeTx()] }),
    ).rejects.toThrow('Bank account not found');

    // The authorization boundary: no rows, no balance change, no import record.
    expect($transactionMock).not.toHaveBeenCalled();
    expect(txClient.transaction.create).not.toHaveBeenCalled();
    expect(importMock.create).not.toHaveBeenCalled();
  });

  it('rejects with a 404 AppError, not a generic Error', async () => {
    acctMock.findFirst.mockResolvedValue(null);
    const err = await persistParsedStatement({
      ...BASE, accountId: 'acc-x', transactions: [makeTx()],
    }).catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(404);
  });

  it('skips the ownership query entirely when no accountId is supplied', async () => {
    await persistParsedStatement({ ...BASE, transactions: [makeTx()] });
    expect(acctMock.findFirst).not.toHaveBeenCalled();
  });
});

// ─── Dedup scoping ────────────────────────────────────────────────────────────

describe('persistParsedStatement — dedup scope', () => {
  it('hashes against the accountId when linked', async () => {
    const tx = makeTx();
    await persistParsedStatement({ ...BASE, accountId: 'acc1', transactions: [tx] });

    const expected = makeImportHash(tx.date, tx.amount, tx.type, tx.description, 'acc1');
    expect(txMock.findMany).toHaveBeenCalledWith({
      where: { importHash: { in: [expected] } },
      select: { importHash: true },
    });
  });

  it('falls back to hashing against the userId when unlinked', async () => {
    const tx = makeTx();
    await persistParsedStatement({ ...BASE, transactions: [tx] });

    const expected = makeImportHash(tx.date, tx.amount, tx.type, tx.description, 'u1');
    expect(txMock.findMany).toHaveBeenCalledWith({
      where: { importHash: { in: [expected] } },
      select: { importHash: true },
    });
  });

  it('produces DIFFERENT hashes for the two scopes, so scope changes cannot collide', async () => {
    const tx = makeTx();
    const linked = makeImportHash(tx.date, tx.amount, tx.type, tx.description, 'acc1');
    const unlinked = makeImportHash(tx.date, tx.amount, tx.type, tx.description, 'u1');
    expect(linked).not.toBe(unlinked);
  });
});

// ─── Dedup outcomes ───────────────────────────────────────────────────────────

describe('persistParsedStatement — dedup outcomes', () => {
  it('imports every row when none already exist', async () => {
    const txs = [makeTx({ description: 'A' }), makeTx({ description: 'B' })];
    const result = await persistParsedStatement({ ...BASE, rowCount: 2, transactions: txs });

    expect(result.imported).toBe(2);
    expect(result.duplicatesSkipped).toBe(0);
    expect(txClient.transaction.create).toHaveBeenCalledTimes(2);
  });

  it('skips only the rows whose hash already exists', async () => {
    const a = makeTx({ description: 'A' });
    const b = makeTx({ description: 'B' });
    const existing = makeImportHash(a.date, a.amount, a.type, a.description, 'u1');
    txMock.findMany.mockResolvedValue([{ importHash: existing }]);

    const result = await persistParsedStatement({ ...BASE, rowCount: 2, transactions: [a, b] });

    expect(result.imported).toBe(1);
    expect(result.duplicatesSkipped).toBe(1);
    expect(txClient.transaction.create).toHaveBeenCalledTimes(1);
    // The one that got through is B.
    expect(txClient.transaction.create.mock.calls[0][0].data.description).toBe('B');
  });

  it('creates nothing when every row is a duplicate (re-import is safe)', async () => {
    const a = makeTx({ description: 'A' });
    const b = makeTx({ description: 'B' });
    txMock.findMany.mockResolvedValue([
      { importHash: makeImportHash(a.date, a.amount, a.type, a.description, 'u1') },
      { importHash: makeImportHash(b.date, b.amount, b.type, b.description, 'u1') },
    ]);

    const result = await persistParsedStatement({ ...BASE, rowCount: 2, transactions: [a, b] });

    expect(result.imported).toBe(0);
    expect(result.duplicatesSkipped).toBe(2);
    expect(txClient.transaction.create).not.toHaveBeenCalled();
    // Still records the import attempt.
    expect(importMock.create).toHaveBeenCalled();
  });

  it('handles an empty transaction list', async () => {
    const result = await persistParsedStatement({ ...BASE, rowCount: 0, transactions: [] });
    expect(result.imported).toBe(0);
    expect(result.duplicatesSkipped).toBe(0);
  });
});

// ─── Row shape / ?? null fallbacks ────────────────────────────────────────────

describe('persistParsedStatement — row shape', () => {
  it('passes through remark, paymentMode and categoryId when present', async () => {
    await persistParsedStatement({
      ...BASE,
      accountId: 'acc1',
      transactions: [makeTx({
        remark: 'monthly',
        paymentMode: 'UPI' as any,
        categoryId: 'cat-1',
        type: 'INCOME',
        amount: 250.5,
      })],
    });

    expect(txClient.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        bankAccountId: 'acc1',
        amount: 250.5,
        type: 'INCOME',
        categoryId: 'cat-1',
        remark: 'monthly',
        paymentMode: 'UPI',
        balanceImpactApplied: true,
      }),
    });
  });

  it('nulls remark, paymentMode, categoryId and bankAccountId when absent', async () => {
    await persistParsedStatement({ ...BASE, transactions: [makeTx()] });

    expect(txClient.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bankAccountId: null,
        categoryId: null,
        remark: null,
        paymentMode: null,
      }),
    });
  });

  it('stores the computed importHash on the row so a re-import dedups', async () => {
    const tx = makeTx();
    await persistParsedStatement({ ...BASE, transactions: [tx] });
    const expected = makeImportHash(tx.date, tx.amount, tx.type, tx.description, 'u1');
    expect(txClient.transaction.create.mock.calls[0][0].data.importHash).toBe(expected);
  });
});

// ─── Balance sync ─────────────────────────────────────────────────────────────

describe('persistParsedStatement — balance sync', () => {
  it('increments by the net delta (income positive, expense negative)', async () => {
    await persistParsedStatement({
      ...BASE,
      accountId: 'acc1',
      rowCount: 3,
      transactions: [
        makeTx({ description: 'in1', type: 'INCOME', amount: 1000 }),
        makeTx({ description: 'in2', type: 'INCOME', amount: 1000 }),
        makeTx({ description: 'out', type: 'EXPENSE', amount: 400 }),
      ],
    });

    expect(txClient.bankAccount.update).toHaveBeenCalledWith({
      where: { id: 'acc1' },
      data: { currentBalance: { increment: 1600 } },
    });
  });

  it('rounds the delta to 2dp before writing', async () => {
    await persistParsedStatement({
      ...BASE,
      accountId: 'acc1',
      rowCount: 2,
      transactions: [
        makeTx({ description: 'a', type: 'INCOME', amount: 0.1 }),
        makeTx({ description: 'b', type: 'INCOME', amount: 0.2 }),
      ],
    });

    // 0.1 + 0.2 === 0.30000000000000004 in float; must land as exactly 0.3.
    expect(txClient.bankAccount.update).toHaveBeenCalledWith({
      where: { id: 'acc1' },
      data: { currentBalance: { increment: 0.3 } },
    });
  });

  it('skips the update when the delta rounds to zero', async () => {
    await persistParsedStatement({
      ...BASE,
      accountId: 'acc1',
      rowCount: 2,
      transactions: [
        makeTx({ description: 'in', type: 'INCOME', amount: 100 }),
        makeTx({ description: 'out', type: 'EXPENSE', amount: 100 }),
      ],
    });

    expect(txClient.transaction.create).toHaveBeenCalledTimes(2);
    expect(txClient.bankAccount.update).not.toHaveBeenCalled();
  });

  it('skips the update when a float residue would otherwise fake a non-zero delta', async () => {
    // A mathematically-cancelling pair that leaves ~1e-13 in raw float arithmetic.
    await persistParsedStatement({
      ...BASE,
      accountId: 'acc1',
      rowCount: 3,
      transactions: [
        makeTx({ description: 'a', type: 'INCOME', amount: 0.1 }),
        makeTx({ description: 'b', type: 'INCOME', amount: 0.2 }),
        makeTx({ description: 'c', type: 'EXPENSE', amount: 0.3 }),
      ],
    });

    // Without round2 this is -5.55e-17 !== 0 and would write a bogus increment.
    expect(txClient.bankAccount.update).not.toHaveBeenCalled();
  });

  it('skips the update when there is no linked account', async () => {
    await persistParsedStatement({
      ...BASE,
      transactions: [makeTx({ type: 'INCOME', amount: 500 })],
    });
    expect(txClient.bankAccount.update).not.toHaveBeenCalled();
  });

  it('skips the update when every row was a duplicate', async () => {
    const tx = makeTx({ type: 'INCOME', amount: 500 });
    txMock.findMany.mockResolvedValue([
      { importHash: makeImportHash(tx.date, tx.amount, tx.type, tx.description, 'acc1') },
    ]);

    await persistParsedStatement({ ...BASE, accountId: 'acc1', transactions: [tx] });
    expect(txClient.bankAccount.update).not.toHaveBeenCalled();
  });
});

// ─── Atomic failure (P8) ──────────────────────────────────────────────────────

describe('persistParsedStatement — atomic batch failure', () => {
  it('logs the ORIGINAL error with identifying context, so the cause is not lost', async () => {
    const cause = new Error('P2028: Transaction already closed');
    $transactionMock.mockRejectedValue(cause);

    await expect(
      persistParsedStatement({ ...BASE, accountId: 'acc1', transactions: [makeTx()] }),
    ).rejects.toThrow(AppError);

    // errorHandler short-circuits operational errors before its own context-rich log,
    // so this line is the ONLY record of the failure — it must carry enough to identify
    // whose import broke, not just the bare error.
    expect(errorSpy).toHaveBeenCalledWith('[import] batch insert failed', {
      ownerUserId: BASE.ownerUserId,
      accountId: 'acc1',
      rowCount: 1,
      err: cause,
    });
  });

  it('logs accountId as null when the import is not linked to an account', async () => {
    const cause = new Error('connection reset');
    $transactionMock.mockRejectedValue(cause);

    await expect(
      persistParsedStatement({ ...BASE, transactions: [makeTx()] }),
    ).rejects.toThrow(AppError);

    expect(errorSpy).toHaveBeenCalledWith(
      '[import] batch insert failed',
      expect.objectContaining({ accountId: null }),
    );
  });

  it('throws an operational 500 whose message is safe to show the user', async () => {
    $transactionMock.mockRejectedValue(new Error('connection reset'));

    const err = await persistParsedStatement({
      ...BASE, transactions: [makeTx()],
    }).catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('IMPORT_FAILED');
    // isOperational must be forced true, or errorHandler masks the message and the user
    // is left unable to tell whether a retry would duplicate data.
    expect(err.isOperational).toBe(true);
    expect(err.message).toBe('Import failed — no transactions were saved. Please try again.');
  });

  it('does NOT write an import record for a fully rolled-back batch', async () => {
    $transactionMock.mockRejectedValue(new Error('boom'));

    await expect(
      persistParsedStatement({ ...BASE, transactions: [makeTx()] }),
    ).rejects.toThrow();

    expect(importMock.create).not.toHaveBeenCalled();
  });
});

// ─── Import record ────────────────────────────────────────────────────────────

describe('persistParsedStatement — import record', () => {
  it('records bank, counts and the linked account', async () => {
    const a = makeTx({ description: 'A' });
    const b = makeTx({ description: 'B' });
    txMock.findMany.mockResolvedValue([
      { importHash: makeImportHash(a.date, a.amount, a.type, a.description, 'acc1') },
    ]);

    await persistParsedStatement({
      ...BASE, accountId: 'acc1', bank: 'ICICI', rowCount: 2, transactions: [a, b],
    });

    expect(importMock.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        bankAccountId: 'acc1',
        bankName: 'ICICI',
        rowCount: 2,
        importedCount: 1,
        duplicatesSkipped: 1,
        errorsCount: 0,
        filename: 'statement.csv',
      },
    });
  });

  it('nulls bankAccountId on the record when the import was unlinked', async () => {
    await persistParsedStatement({ ...BASE, transactions: [makeTx()] });
    expect(importMock.create.mock.calls[0][0].data.bankAccountId).toBeNull();
  });

  it('sanitizes the filename at the write boundary (stored-XSS mitigation)', async () => {
    await persistParsedStatement({
      ...BASE,
      filename: '<script>x</script>.csv',
      transactions: [makeTx()],
    });

    const written = importMock.create.mock.calls[0][0].data.filename;
    expect(written).toBe('_script_x__script_.csv');
    expect(written).not.toContain('<');
    expect(written).not.toContain('>');
  });

  it('returns the created record alongside the counts', async () => {
    importMock.create.mockResolvedValue({ id: 'imp-99' });
    const result = await persistParsedStatement({ ...BASE, transactions: [makeTx()] });
    expect(result.importRecord).toEqual({ id: 'imp-99' });
  });
});

// ─── Timeout path (P2028) ──────────────────────────────────────────────────────

describe('persistParsedStatement — transaction timeout', () => {
  it('passes an explicit timeout, since Prisma defaults to 5s and this loop is unbounded', async () => {
    await persistParsedStatement({ ...BASE, transactions: [makeTx()] });
    // 2nd arg to $transaction is the options bag.
    expect($transactionMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({ timeout: 30_000 }),
    );
  });

  it('tells a timed-out user to split the statement, NOT to retry (retry is deterministic)', async () => {
    const timeout = Object.assign(new Error('Transaction already closed'), { code: 'P2028' });
    $transactionMock.mockRejectedValue(timeout);

    const err = await persistParsedStatement({ ...BASE, transactions: [makeTx()] })
      .catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.message).toMatch(/timed out/i);
    expect(err.message).toMatch(/smaller date ranges/i);
    expect(err.message).not.toMatch(/try again/i);
  });

  it('keeps the generic retry message for non-timeout failures', async () => {
    $transactionMock.mockRejectedValue(new Error('connection reset'));

    const err = await persistParsedStatement({ ...BASE, transactions: [makeTx()] })
      .catch((e) => e);

    expect(err.message).toMatch(/Please try again/i);
    expect(err.message).not.toMatch(/timed out/i);
  });
});
