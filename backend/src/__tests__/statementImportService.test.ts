/**
 * Unit tests for statementImportService — the persistence half of a bank-statement
 * import, extracted out of index.ts (where it was excluded from the coverage gate and
 * had zero tests, including the account-ownership check).
 *
 * Uses named import { prisma } — dual-export mock required.
 */
import crypto from 'crypto';
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
  transaction: { create: vi.fn(), createMany: vi.fn() },
  bankAccount: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
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
  txClient.transaction.createMany.mockImplementation(async ({ data }: any) => ({
    count: Array.isArray(data) ? data.length : 1,
  }));
  txClient.bankAccount.findFirst.mockResolvedValue(null);
  txClient.bankAccount.create.mockResolvedValue({ id: 'cash-1', userId: 'u1', isCashAccount: true });
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
    expect(txClient.transaction.createMany).toHaveBeenCalledTimes(1);
    expect(txClient.transaction.createMany.mock.calls[0][0].data).toHaveLength(1);
  });

  it('throws "Bank account not found" and writes NOTHING when the account is another user\'s', async () => {
    acctMock.findFirst.mockResolvedValue(null);

    await expect(
      persistParsedStatement({ ...BASE, accountId: 'someone-elses', transactions: [makeTx()] }),
    ).rejects.toThrow('Bank account not found');

    // The authorization boundary: no rows, no balance change, no import record.
    expect($transactionMock).not.toHaveBeenCalled();
    expect(txClient.transaction.createMany).not.toHaveBeenCalled();
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
    // acctMock.findFirst is ALSO used by the fuzzy-dedup cash-account lookup (a
    // different query, unconditional regardless of accountId) — so this asserts no
    // call was made with ownership-check-shaped args specifically, not that the mock
    // was never invoked at all.
    expect(acctMock.findFirst).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: expect.anything() }) }),
    );
  });
});

// ─── Dedup scoping ────────────────────────────────────────────────────────────

describe('persistParsedStatement — dedup scope', () => {
  it('hashes against the accountId when linked', async () => {
    const tx = makeTx();
    await persistParsedStatement({ ...BASE, accountId: 'acc1', transactions: [tx] });

    const expected = makeImportHash(tx.date, tx.amount, tx.type, tx.description, 'acc1');
    expect(txMock.findMany).toHaveBeenCalledWith({
      where: { importHash: { in: [expected] }, deletedAt: null },
      select: { importHash: true },
    });
  });

  it('falls back to hashing against the userId when unlinked', async () => {
    const tx = makeTx();
    await persistParsedStatement({ ...BASE, transactions: [tx] });

    const expected = makeImportHash(tx.date, tx.amount, tx.type, tx.description, 'u1');
    expect(txMock.findMany).toHaveBeenCalledWith({
      where: { importHash: { in: [expected] }, deletedAt: null },
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
    expect(txClient.transaction.createMany).toHaveBeenCalledTimes(1);
    expect(txClient.transaction.createMany.mock.calls[0][0].data).toHaveLength(2);
  });

  it('skips only the rows whose hash already exists', async () => {
    const a = makeTx({ description: 'A' });
    const b = makeTx({ description: 'B' });
    const existing = makeImportHash(a.date, a.amount, a.type, a.description, 'u1');
    txMock.findMany.mockResolvedValueOnce([{ importHash: existing }]);

    const result = await persistParsedStatement({ ...BASE, rowCount: 2, transactions: [a, b] });

    expect(result.imported).toBe(1);
    expect(result.duplicatesSkipped).toBe(1);
    expect(txClient.transaction.createMany).toHaveBeenCalledTimes(1);
    // The one that got through is B.
    const batch = txClient.transaction.createMany.mock.calls[0][0].data;
    expect(batch).toHaveLength(1);
    expect(batch[0].description).toBe('B');
  });

  it('creates nothing when every row is a duplicate (re-import is safe)', async () => {
    const a = makeTx({ description: 'A' });
    const b = makeTx({ description: 'B' });
    txMock.findMany.mockResolvedValueOnce([
      { importHash: makeImportHash(a.date, a.amount, a.type, a.description, 'u1') },
      { importHash: makeImportHash(b.date, b.amount, b.type, b.description, 'u1') },
    ]);

    const result = await persistParsedStatement({ ...BASE, rowCount: 2, transactions: [a, b] });

    expect(result.imported).toBe(0);
    expect(result.duplicatesSkipped).toBe(2);
    expect(txClient.transaction.createMany).not.toHaveBeenCalled();
    // Still records the import attempt.
    expect(importMock.create).toHaveBeenCalled();
  });

  it('handles an empty transaction list', async () => {
    const result = await persistParsedStatement({ ...BASE, rowCount: 0, transactions: [] });
    expect(result.imported).toBe(0);
    expect(result.duplicatesSkipped).toBe(0);
  });

  // A soft-deleted row's hash must not permanently block re-importing that same row —
  // the dedup query filters deletedAt: null (softDeleteTransaction nulls the deleted
  // row's own importHash too, for the same reason at the DB-constraint level).
  it('recreates a row whose hash matches only a soft-deleted transaction (deletedAt filter)', async () => {
    const tx = makeTx();
    // findMany itself is mocked to resolve with whatever matches its own `where` filter
    // in real Prisma; here we simulate "deletedAt: null" already excluding the deleted
    // row by having the mock return no matches at all.
    txMock.findMany.mockResolvedValue([]);

    const result = await persistParsedStatement({ ...BASE, transactions: [tx] });

    expect(txMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
    );
    expect(result.imported).toBe(1);
    expect(result.duplicatesSkipped).toBe(0);
  });

  // Two identical rows in ONE statement previously both survived into toCreate and
  // collided on insert (P2002), hard-failing the whole batch with a deterministic,
  // unrecoverable "please try again". They must now be deduped pre-insert instead.
  it('dedupes an intra-batch duplicate (two identical rows in one statement) instead of colliding on insert', async () => {
    const a = makeTx({ description: 'Coffee' });
    const duplicate = makeTx({ description: 'Coffee' }); // byte-identical -> same hash

    const result = await persistParsedStatement({ ...BASE, rowCount: 2, transactions: [a, duplicate] });

    expect(result.imported).toBe(1);
    expect(result.duplicatesSkipped).toBe(1);
    expect(txClient.transaction.createMany).toHaveBeenCalledTimes(1);
    expect(txClient.transaction.createMany.mock.calls[0][0].data).toHaveLength(1);
  });

  it('dedupes THREE identical intra-batch rows down to one, counting the other two as duplicates', async () => {
    const rows = [makeTx({ description: 'Rent' }), makeTx({ description: 'Rent' }), makeTx({ description: 'Rent' })];
    const result = await persistParsedStatement({ ...BASE, rowCount: 3, transactions: rows });

    expect(result.imported).toBe(1);
    expect(result.duplicatesSkipped).toBe(2);
    expect(txClient.transaction.createMany.mock.calls[0][0].data).toHaveLength(1);
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

    expect(txClient.transaction.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        userId: 'u1',
        bankAccountId: 'acc1',
        amount: 250.5,
        type: 'INCOME',
        categoryId: 'cat-1',
        remark: 'monthly',
        paymentMode: 'UPI',
        balanceImpactApplied: true,
      })],
    });
  });

  it('nulls remark, paymentMode, categoryId and bankAccountId when absent', async () => {
    await persistParsedStatement({ ...BASE, transactions: [makeTx()] });

    expect(txClient.transaction.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        bankAccountId: null,
        categoryId: null,
        remark: null,
        paymentMode: null,
      })],
    });
  });

  it('stores the computed importHash on the row so a re-import dedups', async () => {
    const tx = makeTx();
    await persistParsedStatement({ ...BASE, transactions: [tx] });
    const expected = makeImportHash(tx.date, tx.amount, tx.type, tx.description, 'u1');
    expect(txClient.transaction.createMany.mock.calls[0][0].data[0].importHash).toBe(expected);
  });
});

// ─── Cash account routing ─────────────────────────────────────────────────────

describe('persistParsedStatement — CASH rows, unlinked import (no accountId)', () => {
  it('resolves a CASH EXPENSE row to the cash account (single leg) and debits it', async () => {
    const tx = makeTx({ type: 'EXPENSE', amount: 500, paymentMode: 'CASH' as any });
    await persistParsedStatement({ ...BASE, transactions: [tx] });

    expect(txClient.bankAccount.findFirst).toHaveBeenCalledWith({ where: { userId: 'u1', isCashAccount: true } });
    expect(txClient.transaction.createMany).toHaveBeenCalledTimes(1);
    expect(txClient.transaction.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ bankAccountId: 'cash-1' })],
    });
    expect(txClient.bankAccount.update).toHaveBeenCalledWith({
      where: { id: 'cash-1' },
      data: { currentBalance: { increment: -500 } },
    });
  });

  it('resolves a CASH INCOME row to the cash account and credits it', async () => {
    const tx = makeTx({ type: 'INCOME', amount: 200, paymentMode: 'CASH' as any });
    await persistParsedStatement({ ...BASE, transactions: [tx] });

    expect(txClient.bankAccount.update).toHaveBeenCalledWith({
      where: { id: 'cash-1' },
      data: { currentBalance: { increment: 200 } },
    });
  });

  it('provisions the cash account when the user has none yet (self-healing)', async () => {
    txClient.bankAccount.findFirst.mockResolvedValue(null);
    const tx = makeTx({ type: 'EXPENSE', amount: 500, paymentMode: 'CASH' as any });
    await persistParsedStatement({ ...BASE, transactions: [tx] });

    expect(txClient.bankAccount.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'u1', isCashAccount: true }) }),
    );
  });
});

describe('persistParsedStatement — CASH rows, linked import (accountId present)', () => {
  it('keeps the original row on the linked account AND creates a paired synthetic credit leg on the cash account', async () => {
    const tx = makeTx({ type: 'EXPENSE', amount: 1000, paymentMode: 'CASH' as any, description: 'ATM WDL' });
    const result = await persistParsedStatement({ ...BASE, accountId: 'acc1', transactions: [tx] });

    // Normal rows and synthetic rows are merged into one createMany batch.
    expect(txClient.transaction.createMany).toHaveBeenCalledTimes(1);
    const batch = txClient.transaction.createMany.mock.calls[0][0].data;
    expect(batch).toHaveLength(2);
    const originalRow = batch.find((r: any) => r.bankAccountId === 'acc1');
    const syntheticRow = batch.find((r: any) => r.bankAccountId === 'cash-1');
    expect(originalRow.bankAccountId).toBe('acc1');
    expect(originalRow.type).toBe('EXPENSE');
    expect(syntheticRow.bankAccountId).toBe('cash-1');
    expect(syntheticRow.type).toBe('INCOME');
    expect(syntheticRow.categoryId).toBeNull();

    // Both legs are a real double-entry pair, not independent rows.
    expect(originalRow.transferPairId).toBeDefined();
    expect(originalRow.transferPairId).toBe(syntheticRow.transferPairId);

    // Linked account debited — unchanged existing behavior.
    expect(txClient.bankAccount.update).toHaveBeenCalledWith({
      where: { id: 'acc1' },
      data: { currentBalance: { increment: -1000 } },
    });
    // Cash account credited — new.
    expect(txClient.bankAccount.update).toHaveBeenCalledWith({
      where: { id: 'cash-1' },
      data: { currentBalance: { increment: 1000 } },
    });

    // imported counts statement rows only; the synthetic leg is reported separately.
    expect(result.imported).toBe(1);
    expect(result.cashLegsCreated).toBe(1);
  });

  it('drops a rule-derived category from BOTH legs of a linked-CASH pair (transfers are never categorized)', async () => {
    const tx = { ...makeTx({ type: 'EXPENSE', amount: 1000, paymentMode: 'CASH' as any, description: 'ATM WDL' }), categoryId: 'cat-misc' };
    await persistParsedStatement({ ...BASE, accountId: 'acc1', transactions: [tx] });
    const batch = txClient.transaction.createMany.mock.calls[0][0].data;
    expect(batch.every((r: any) => r.transferPairId && r.categoryId === null)).toBe(true);
  });

  it('keeps a rule-derived category on an ordinary (unpaired) imported row', async () => {
    const tx = { ...makeTx({ type: 'EXPENSE', amount: 250, description: 'SWIGGY' }), categoryId: 'cat-food' };
    await persistParsedStatement({ ...BASE, accountId: 'acc1', transactions: [tx] });
    const [row] = txClient.transaction.createMany.mock.calls[0][0].data;
    expect(row.transferPairId).toBeUndefined();
    expect(row.categoryId).toBe('cat-food');
  });

  it('flips the synthetic leg\'s type for a CASH INCOME row (e.g. a cash deposit into the bank)', async () => {
    const tx = makeTx({ type: 'INCOME', amount: 300, paymentMode: 'CASH' as any });
    await persistParsedStatement({ ...BASE, accountId: 'acc1', transactions: [tx] });

    const batch = txClient.transaction.createMany.mock.calls[0][0].data;
    const syntheticRow = batch.find((r: any) => r.bankAccountId === 'cash-1');
    expect(syntheticRow.type).toBe('EXPENSE');
    expect(txClient.bankAccount.update).toHaveBeenCalledWith({
      where: { id: 'cash-1' },
      data: { currentBalance: { increment: -300 } },
    });
  });

  it('derives the synthetic leg\'s hash from the original row\'s own hash, so it can never collide across statements/accounts', async () => {
    const tx = makeTx({ type: 'EXPENSE', amount: 1000, paymentMode: 'CASH' as any, description: 'ATM WDL' });
    await persistParsedStatement({ ...BASE, accountId: 'acc1', transactions: [tx] });

    const batch = txClient.transaction.createMany.mock.calls[0][0].data;
    const originalRow = batch.find((r: any) => r.bankAccountId === 'acc1');
    const syntheticRow = batch.find((r: any) => r.bankAccountId === 'cash-1');
    expect(originalRow.importHash).not.toBe(syntheticRow.importHash);
    // Two different linked accounts (different scopeId) produce different original
    // hashes, and therefore different synthetic hashes too — no shared "cashAccount.id"
    // scope for two unrelated imports to collide on.
    const expectedSyntheticHash = crypto
      .createHash('sha256')
      .update(`${originalRow.importHash}|cash-leg`)
      .digest('hex');
    expect(syntheticRow.importHash).toBe(expectedSyntheticHash);
  });

  it('partitions deltas correctly for a mix of CASH and non-CASH rows', async () => {
    const upi = makeTx({ description: 'upi', type: 'EXPENSE', amount: 300, paymentMode: 'UPI' as any });
    const cash = makeTx({ description: 'atm', type: 'EXPENSE', amount: 1000, paymentMode: 'CASH' as any });
    await persistParsedStatement({ ...BASE, accountId: 'acc1', rowCount: 2, transactions: [upi, cash] });

    // Linked account: both EXPENSE rows debit it — unchanged existing math.
    expect(txClient.bankAccount.update).toHaveBeenCalledWith({
      where: { id: 'acc1' },
      data: { currentBalance: { increment: -1300 } },
    });
    // Cash account: only the synthetic leg from the CASH row.
    expect(txClient.bankAccount.update).toHaveBeenCalledWith({
      where: { id: 'cash-1' },
      data: { currentBalance: { increment: 1000 } },
    });
  });

  it('keeps importedCount to statement rows (not the synthetic leg), preserving imported + duplicatesSkipped === rowCount', async () => {
    const tx = makeTx({ type: 'EXPENSE', amount: 1000, paymentMode: 'CASH' as any });
    const result = await persistParsedStatement({ ...BASE, accountId: 'acc1', rowCount: 1, transactions: [tx] });

    expect(importMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ importedCount: 1 }) }),
    );
    expect(result.imported).toBe(1);
    expect(result.duplicatesSkipped).toBe(0);
  });

  it('reports the synthetic leg count separately, distinct from imported', async () => {
    const tx = makeTx({ type: 'EXPENSE', amount: 1000, paymentMode: 'CASH' as any });
    const result = await persistParsedStatement({ ...BASE, accountId: 'acc1', rowCount: 1, transactions: [tx] });

    expect(result.cashLegsCreated).toBe(1);
  });

  it('rejects importing a statement directly into the cash account', async () => {
    acctMock.findFirst.mockResolvedValue({ id: 'cash-1', userId: 'u1', isCashAccount: true });

    await expect(
      persistParsedStatement({ ...BASE, accountId: 'cash-1', transactions: [makeTx()] }),
    ).rejects.toThrow(/cannot import.*cash account/i);
    expect($transactionMock).not.toHaveBeenCalled();
  });

  it('re-importing a previously-imported linked-CASH row skips both the original and synthetic legs', async () => {
    const tx = makeTx({ type: 'EXPENSE', amount: 1000, paymentMode: 'CASH' as any, description: 'ATM WDL' });
    const originalHash = makeImportHash(tx.date, tx.amount, tx.type, tx.description, 'acc1');
    txMock.findMany.mockResolvedValueOnce([{ importHash: originalHash }]);

    const result = await persistParsedStatement({ ...BASE, accountId: 'acc1', transactions: [tx] });

    expect(result.imported).toBe(0);
    expect(result.duplicatesSkipped).toBe(1);
    expect(txClient.transaction.createMany).not.toHaveBeenCalled();
    expect(txClient.bankAccount.update).not.toHaveBeenCalled();
  });
});

describe('persistParsedStatement — no CASH rows', () => {
  it('never calls ensureCashAccount when no row is paymentMode CASH', async () => {
    await persistParsedStatement({ ...BASE, transactions: [makeTx({ paymentMode: 'UPI' as any })] });
    expect(txClient.bankAccount.findFirst).not.toHaveBeenCalled();
    expect(txClient.bankAccount.create).not.toHaveBeenCalled();
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

    expect(txClient.transaction.createMany).toHaveBeenCalledTimes(1);
    expect(txClient.transaction.createMany.mock.calls[0][0].data).toHaveLength(2);
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
    txMock.findMany.mockResolvedValueOnce([
      { importHash: makeImportHash(tx.date, tx.amount, tx.type, tx.description, 'acc1') },
    ]);

    await persistParsedStatement({ ...BASE, accountId: 'acc1', transactions: [tx] });
    expect(txClient.bankAccount.update).not.toHaveBeenCalled();
  });
});

// ─── Batch size (the fix this task exists for) ───────────────────────────────
//
// P2028 is a round-trip-count problem, not a row-count problem — a large statement
// used to mean N (or 2N) awaited `create()` calls inside one $transaction, each
// paying full network round-trip latency. The property that actually closes that
// risk is "one createMany call regardless of N", not a wall-clock timing assertion
// (which would be flaky in CI and meaningless against a mock with no real latency).

describe('persistParsedStatement — batch size', () => {
  it('inserts 500 rows via a single createMany call, never per-row create', async () => {
    const txs = Array.from({ length: 500 }, (_, i) => makeTx({ description: `Row ${i}`, amount: 10 + i }));
    const result = await persistParsedStatement({ ...BASE, rowCount: 500, transactions: txs });

    expect(result.imported).toBe(500);
    expect(txClient.transaction.createMany).toHaveBeenCalledTimes(1);
    expect(txClient.transaction.createMany.mock.calls[0][0].data).toHaveLength(500);
    expect(txClient.transaction.create).not.toHaveBeenCalled();
  });

  it('a mixed batch producing synthetic cash legs still issues exactly 1 createMany call, regardless of row count', async () => {
    const nonCash = Array.from({ length: 200 }, (_, i) => makeTx({ description: `UPI ${i}`, amount: 10 + i, paymentMode: 'UPI' as any }));
    const cash = Array.from({ length: 200 }, (_, i) => makeTx({ description: `ATM ${i}`, amount: 10 + i, paymentMode: 'CASH' as any }));
    const result = await persistParsedStatement({
      ...BASE, accountId: 'acc1', rowCount: 400, transactions: [...nonCash, ...cash],
    });

    expect(result.imported).toBe(400);
    expect(result.cashLegsCreated).toBe(200);
    // Normal rows (400) + synthetic legs (200) merged into one 600-row batch — no
    // ordering dependency between the two groups, so one call covers both.
    expect(txClient.transaction.createMany).toHaveBeenCalledTimes(1);
    expect(txClient.transaction.createMany.mock.calls[0][0].data).toHaveLength(600);
    expect(txClient.transaction.create).not.toHaveBeenCalled();
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
    txMock.findMany.mockResolvedValueOnce([
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

// ═══ Fuzzy dedup safety net (the fix for the cross-source duplicate-import incident) ═

describe('persistParsedStatement — fuzzy dedup: candidate query', () => {
  it('does not query fuzzy candidates for an empty transaction list', async () => {
    await persistParsedStatement({ ...BASE, rowCount: 0, transactions: [] });
    // Only the exact-hash query (also a no-op on empty input, but still issued) —
    // the fuzzy query is skipped entirely when there's nothing to bucket.
    expect(txMock.findMany).toHaveBeenCalledTimes(1);
  });

  it('queries candidates scoped by userId only, not accountId', async () => {
    const tx = makeTx({ date: new Date('2025-04-01T00:00:00.000Z'), amount: 500 });
    await persistParsedStatement({ ...BASE, accountId: 'acc1', transactions: [tx] });

    expect(txMock.findMany).toHaveBeenCalledTimes(2);
    const fuzzyCall = txMock.findMany.mock.calls[1][0];
    expect(fuzzyCall.where.userId).toBe('u1');
    expect(fuzzyCall.where.accountId).toBeUndefined();
    // transferPairId is deliberately NOT part of the where clause — see the
    // "excludes only the synthetic cash leg" tests below for why.
    expect(fuzzyCall.where.transferPairId).toBeUndefined();
    expect(fuzzyCall.where.importHash).toEqual({ not: null });
    expect(fuzzyCall.where.amount).toEqual({ in: ['500.00'] });
    expect(fuzzyCall.where.OR).toEqual([
      { date: { gte: new Date('2025-04-01T00:00:00.000Z'), lt: new Date('2025-04-02T00:00:00.000Z') } },
    ]);
  });

  it('looks up the user\'s cash account once, to identify (not query-filter) synthetic legs', async () => {
    await persistParsedStatement({ ...BASE, transactions: [makeTx()] });
    expect(acctMock.findFirst).toHaveBeenCalledWith({
      where: { userId: 'u1', isCashAccount: true },
      select: { id: true, openingBalanceDate: true },
    });
  });

  it('excludes a candidate on the cash account (a synthetic leg) from matching', async () => {
    acctMock.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.isCashAccount) return { id: 'cash-1' };
      return { id: 'acc1', userId: 'u1' };
    });
    txMock.findMany.mockResolvedValueOnce([]);
    txMock.findMany.mockResolvedValueOnce([
      { id: 'synthetic-leg', date: new Date('2025-04-01T00:00:00.000Z'), amount: { toFixed: () => '500.00' }, type: 'EXPENSE', description: 'ATM WDL SELF CASH WITHDRAWAL', bankAccountId: 'cash-1' },
    ]);

    const result = await persistParsedStatement({
      ...BASE, accountId: 'acc1', transactions: [makeTx({ description: 'ATM WDL SELF CASH WITHDRAWAL', amount: 500 })],
    });

    // The candidate lives on the cash account — a synthetic leg, not a real
    // statement row — so it must not be usable as a fuzzy match.
    expect(result.fuzzyDuplicatesSkipped).toBe(0);
    expect(result.imported).toBe(1);
  });

  it('DOES match a real linked-CASH statement row (on the real bank account, not the cash account)', async () => {
    acctMock.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.isCashAccount) return { id: 'cash-1' };
      return { id: 'acc1', userId: 'u1' };
    });
    txMock.findMany.mockResolvedValueOnce([]);
    txMock.findMany.mockResolvedValueOnce([
      { id: 'real-cash-row', date: new Date('2025-04-01T00:00:00.000Z'), amount: { toFixed: () => '500.00' }, type: 'EXPENSE', description: 'ATM WDL SELF CASH WITHDRAWAL', bankAccountId: 'acc1' },
    ]);

    const result = await persistParsedStatement({
      ...BASE, transactions: [makeTx({ description: 'ATM WDL SELF CASH WITHDRAWAL', amount: 500 })],
    });

    // This is the incident's own scenario: a real linked-CASH row (e.g. an ATM
    // withdrawal that keeps its real account per statementImportService's own
    // linked-CASH pairing logic) re-imported unlinked must still be caught.
    expect(result.fuzzyDuplicatesSkipped).toBe(1);
  });

  it('deduplicates the day/amount lists across multiple rows sharing a date or amount', async () => {
    const txs = [
      makeTx({ date: new Date('2025-04-01T00:00:00.000Z'), amount: 500, description: 'A' }),
      makeTx({ date: new Date('2025-04-01T00:00:00.000Z'), amount: 700, description: 'B' }),
      makeTx({ date: new Date('2025-04-02T00:00:00.000Z'), amount: 500, description: 'C' }),
    ];
    await persistParsedStatement({ ...BASE, rowCount: 3, transactions: txs });

    const fuzzyCall = txMock.findMany.mock.calls[1][0];
    expect(fuzzyCall.where.amount.in.sort()).toEqual(['500.00', '700.00']);
    expect(fuzzyCall.where.OR).toHaveLength(2);
  });
});

describe('persistParsedStatement — fuzzy dedup: matching behaviour', () => {
  it('catches the real incident shape: PDF-parsed description with a prepended label matches the CSV form', async () => {
    // Real matched pair from the incident, verbatim.
    const csvDescription = 'MMT/IMPS/616398334211/Payout/API Bankin';
    const pdfDescription = 'Payout MMT/IMPS/616398334211/Payout/API Bankin';
    const tx = makeTx({
      date: new Date('2026-06-12T00:00:00.000Z'), amount: 1, description: pdfDescription,
    });
    txMock.findMany.mockResolvedValueOnce([]); // exact-hash: no match
    txMock.findMany.mockResolvedValueOnce([
      { id: 'existing-1', date: new Date('2026-06-12T00:00:00.000Z'), amount: { toFixed: () => '1.00' }, type: 'INCOME', description: csvDescription },
    ]);

    const result = await persistParsedStatement({
      ...BASE, rowCount: 1, transactions: [{ ...tx, type: 'INCOME' }],
    });

    expect(result.imported).toBe(0);
    expect(result.fuzzyDuplicatesSkipped).toBe(1);
    expect(result.duplicatesSkipped).toBe(1);
    expect(txClient.transaction.createMany).not.toHaveBeenCalled();
  });

  it('catches the label-is-itself-a-marker-word case ("UPI UPI/..." vs "UPI/...")', async () => {
    const csvDescription = 'UPI/616398334211/Pay/d97476a4fe58771ea';
    const pdfDescription = 'UPI UPI/616398334211/Pay/d97476a4fe58771ea';
    txMock.findMany.mockResolvedValueOnce([]);
    txMock.findMany.mockResolvedValueOnce([
      { id: 'existing-1', date: new Date('2025-04-01T00:00:00.000Z'), amount: { toFixed: () => '500.00' }, type: 'EXPENSE', description: csvDescription },
    ]);

    const result = await persistParsedStatement({
      ...BASE, transactions: [makeTx({ description: pdfDescription, amount: 500 })],
    });

    expect(result.fuzzyDuplicatesSkipped).toBe(1);
  });

  it('catches a stray mid-token space from a PDF line-wrap artifact', async () => {
    const csvDescription = 'UPI/PINGARA HO/paytm-69801761/UPI/YES BANK L/651818644573/ICI78d217e09192419d97476a4fe58771ea/';
    const pdfDescription = 'PINGARA HO UPI/PINGARA HO/paytm-69801761/UPI/YES BANK L/651818644573/ICI78d217e09192419d97476a4fe 58771ea/';
    txMock.findMany.mockResolvedValueOnce([]);
    txMock.findMany.mockResolvedValueOnce([
      { id: 'existing-1', date: new Date('2025-04-01T00:00:00.000Z'), amount: { toFixed: () => '221.00' }, type: 'EXPENSE', description: csvDescription },
    ]);

    const result = await persistParsedStatement({
      ...BASE, transactions: [makeTx({ description: pdfDescription, amount: 221 })],
    });

    expect(result.fuzzyDuplicatesSkipped).toBe(1);
  });

  it('does NOT match two genuinely different transactions on the same date/amount/type', async () => {
    txMock.findMany.mockResolvedValueOnce([]);
    txMock.findMany.mockResolvedValueOnce([
      { id: 'existing-1', date: new Date('2025-04-01T00:00:00.000Z'), amount: { toFixed: () => '500.00' }, type: 'EXPENSE', description: 'UPI/616398334211/Pay/aaaaaaaaaaaaaaaa' },
    ]);

    const result = await persistParsedStatement({
      ...BASE, transactions: [makeTx({ description: 'UPI/616398334299/Pay/bbbbbbbbbbbbbbbb', amount: 500 })],
    });

    expect(result.fuzzyDuplicatesSkipped).toBe(0);
    expect(result.imported).toBe(1);
  });

  it('does NOT match a short generic narration purely on the min-length guard', async () => {
    txMock.findMany.mockResolvedValueOnce([]);
    txMock.findMany.mockResolvedValueOnce([
      { id: 'existing-1', date: new Date('2025-04-01T00:00:00.000Z'), amount: { toFixed: () => '100.00' }, type: 'EXPENSE', description: 'ATM WDL SELF ATM WDL' },
    ]);

    const result = await persistParsedStatement({
      ...BASE, transactions: [makeTx({ description: 'ATM WDL', amount: 100 })],
    });

    expect(result.fuzzyDuplicatesSkipped).toBe(0);
  });

  it('does NOT match on the EXACT-equality path either, when both descriptions are short and generic', async () => {
    // The min-length guard must apply even when the two normalized strings are byte-
    // identical, not just on the suffix-containment path — otherwise a short generic
    // narration ("cash") would collide across a user's different real accounts, since
    // the fuzzy query is deliberately userId-scoped rather than accountId-scoped.
    txMock.findMany.mockResolvedValueOnce([]);
    txMock.findMany.mockResolvedValueOnce([
      { id: 'existing-1', date: new Date('2025-04-01T00:00:00.000Z'), amount: { toFixed: () => '100.00' }, type: 'EXPENSE', description: 'cash' },
    ]);

    const result = await persistParsedStatement({
      ...BASE, transactions: [makeTx({ description: 'cash', amount: 100 })],
    });

    expect(result.fuzzyDuplicatesSkipped).toBe(0);
    expect(result.imported).toBe(1);
  });

  it('DOES match on the exact-equality path once the normalized length clears the guard', async () => {
    txMock.findMany.mockResolvedValueOnce([]);
    txMock.findMany.mockResolvedValueOnce([
      { id: 'existing-1', date: new Date('2025-04-01T00:00:00.000Z'), amount: { toFixed: () => '100.00' }, type: 'EXPENSE', description: 'Genuine Duplicate Narration' },
    ]);

    const result = await persistParsedStatement({
      ...BASE, transactions: [makeTx({ description: 'Genuine Duplicate Narration', amount: 100 })],
    });

    expect(result.fuzzyDuplicatesSkipped).toBe(1);
  });

  it('does not let one existing row absorb two different incoming rows (each candidate matches at most once)', async () => {
    txMock.findMany.mockResolvedValueOnce([]);
    txMock.findMany.mockResolvedValueOnce([
      { id: 'existing-1', date: new Date('2025-04-01T00:00:00.000Z'), amount: { toFixed: () => '500.00' }, type: 'EXPENSE', description: 'UPI/616398334211/Pay/genuinereference1234567890' },
    ]);

    const txs = [
      makeTx({ description: 'A UPI/616398334211/Pay/genuinereference1234567890', amount: 500 }),
      makeTx({ description: 'B UPI/616398334211/Pay/genuinereference1234567890', amount: 500 }),
    ];
    const result = await persistParsedStatement({ ...BASE, rowCount: 2, transactions: txs });

    // Only ONE of the two incoming rows can be the true duplicate of the single
    // existing row — the other must be imported as a genuine new transaction, not
    // also silently dropped against the same already-consumed candidate.
    expect(result.fuzzyDuplicatesSkipped).toBe(1);
    expect(result.imported).toBe(1);
  });

  it('does NOT match when the dropped prefix exceeds the cap, even if one string is a real suffix of the other', async () => {
    // Constructed so ONLY the FUZZY_MAX_DROPPED_PREFIX (60) guard rejects this — the
    // suffix (63 chars) is well above FUZZY_MIN_MATCH_LENGTH, and the dropped prefix
    // (61 chars) is LESS than the suffix's own length, so the `shorter.length` half of
    // `Math.min(shorter.length, 60)` is not what's doing the rejecting here.
    const suffix = 'UPI/616398334211/Pay/genuinereferencenumberthatislongenough1234';
    const longUnrelatedPrefix = 'X'.repeat(61);
    txMock.findMany.mockResolvedValueOnce([]);
    txMock.findMany.mockResolvedValueOnce([
      { id: 'existing-1', date: new Date('2025-04-01T00:00:00.000Z'), amount: { toFixed: () => '500.00' }, type: 'EXPENSE', description: suffix },
    ]);

    const result = await persistParsedStatement({
      ...BASE, transactions: [makeTx({ description: `${longUnrelatedPrefix} ${suffix}`, amount: 500 })],
    });

    expect(result.fuzzyDuplicatesSkipped).toBe(0);
  });

  it('matches identical normalized descriptions with no prefix at all', async () => {
    txMock.findMany.mockResolvedValueOnce([]);
    txMock.findMany.mockResolvedValueOnce([
      { id: 'existing-1', date: new Date('2025-04-01T00:00:00.000Z'), amount: { toFixed: () => '500.00' }, type: 'EXPENSE', description: 'BIL/INFT/FF57281737/CC BillPay-9018/Self' },
    ]);

    const result = await persistParsedStatement({
      ...BASE, transactions: [makeTx({ description: 'BIL/INFT/FF57281737/CC BillPay-9018/Self', amount: 500 })],
    });

    expect(result.fuzzyDuplicatesSkipped).toBe(1);
  });

  it('constructs distinct UTC day-range boundaries for adjacent days (no gap or overlap)', async () => {
    // A real regression here would be an off-by-one in the day-range construction —
    // this asserts the query's OWN shape, not a mocked response, so it can't pass
    // vacuously the way asserting on a stubbed `[]` would.
    await persistParsedStatement({
      ...BASE, transactions: [makeTx({ date: new Date('2025-04-01T23:59:59.999Z') })],
    });
    const fuzzyCall = txMock.findMany.mock.calls[1][0];
    const range = fuzzyCall.where.OR[0].date;
    expect(range.gte).toEqual(new Date('2025-04-01T00:00:00.000Z'));
    expect(range.lt).toEqual(new Date('2025-04-02T00:00:00.000Z'));
  });

  it('excludes soft-deleted and non-imported (manual) transactions from fuzzy candidates by construction', async () => {
    // The where clause itself enforces deletedAt: null and importHash: { not: null } —
    // asserted directly since the mock can't distinguish "excluded by the DB" from
    // "never existed" any other way.
    await persistParsedStatement({ ...BASE, transactions: [makeTx()] });
    const fuzzyCall = txMock.findMany.mock.calls[1][0];
    expect(fuzzyCall.where.deletedAt).toBeNull();
    expect(fuzzyCall.where.importHash).toEqual({ not: null });
  });

  it('does not double-count a row that is both an exact-hash AND a fuzzy duplicate', async () => {
    const tx = makeTx({ description: 'Coffee shop', amount: 500 });
    const exactHash = makeImportHash(tx.date, tx.amount, tx.type, tx.description, 'u1');
    txMock.findMany.mockResolvedValueOnce([{ importHash: exactHash }]);
    txMock.findMany.mockResolvedValueOnce([
      { id: 'existing-1', date: tx.date, amount: { toFixed: () => '500.00' }, type: 'EXPENSE', description: 'Coffee shop' },
    ]);

    const result = await persistParsedStatement({ ...BASE, transactions: [tx] });

    expect(result.duplicatesSkipped).toBe(1);
    expect(result.fuzzyDuplicatesSkipped).toBe(0);
  });

  it('CASH row fuzzy-skipped: no synthetic leg created, no balance impact', async () => {
    const tx = makeTx({ type: 'EXPENSE', amount: 1000, paymentMode: 'CASH' as any, description: 'ATM WDL SELF CASH WITHDRAWAL AT BRANCH' });
    txMock.findMany.mockResolvedValueOnce([]);
    txMock.findMany.mockResolvedValueOnce([
      { id: 'existing-1', date: tx.date, amount: { toFixed: () => '1000.00' }, type: 'EXPENSE', description: 'ATM WDL SELF CASH WITHDRAWAL AT BRANCH' },
    ]);

    const result = await persistParsedStatement({ ...BASE, accountId: 'acc1', transactions: [tx] });

    expect(result.imported).toBe(0);
    expect(txClient.transaction.createMany).not.toHaveBeenCalled();
    expect(txClient.bankAccount.update).not.toHaveBeenCalled();
  });
});

describe('persistParsedStatement — fuzzy dedup: warnings and observability', () => {
  it('emits no warning when nothing was fuzzy-skipped', async () => {
    const result = await persistParsedStatement({ ...BASE, transactions: [makeTx()] });
    expect(result.warnings).toEqual([]);
  });

  it('emits a singular warning naming the skipped row for exactly one fuzzy skip', async () => {
    txMock.findMany.mockResolvedValueOnce([]);
    txMock.findMany.mockResolvedValueOnce([
      { id: 'existing-1', date: new Date('2025-04-01T00:00:00.000Z'), amount: { toFixed: () => '500.00' }, type: 'EXPENSE', description: 'BIL/INFT/FF57281737/CC BillPay-9018/Self' },
    ]);

    const result = await persistParsedStatement({
      ...BASE, transactions: [makeTx({ description: 'BIL/INFT/FF57281737/CC BillPay-9018/Self', amount: 500 })],
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/^1 row matched/);
    expect(result.warnings[0]).toMatch(/was skipped/);
    expect(result.warnings[0]).toContain('2025-04-01');
    expect(result.warnings[0]).toContain('500.00');
  });

  it('emits a plural warning and truncates the sample past 3 skipped rows', async () => {
    const shared = 'BIL/INFT/FF57281737/CC BillPay-9018/Self';
    txMock.findMany.mockResolvedValueOnce([]);
    txMock.findMany.mockResolvedValueOnce(
      [1, 2, 3, 4].map((n) => ({
        id: `existing-${n}`,
        date: new Date(`2025-04-0${n}T00:00:00.000Z`),
        amount: { toFixed: () => '500.00' },
        type: 'EXPENSE',
        description: shared,
      })),
    );

    const txs = [1, 2, 3, 4].map((n) => makeTx({
      date: new Date(`2025-04-0${n}T00:00:00.000Z`), description: shared, amount: 500,
    }));
    const result = await persistParsedStatement({ ...BASE, rowCount: 4, transactions: txs });

    expect(result.fuzzyDuplicatesSkipped).toBe(4);
    expect(result.warnings[0]).toMatch(/^4 rows matched/);
    expect(result.warnings[0]).toMatch(/were skipped/);
    expect(result.warnings[0]).toMatch(/and 1 more/);
  });

  it('logs a diagnosable record for every fuzzy skip', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    txMock.findMany.mockResolvedValueOnce([]);
    txMock.findMany.mockResolvedValueOnce([
      { id: 'existing-1', date: new Date('2025-04-01T00:00:00.000Z'), amount: { toFixed: () => '500.00' }, type: 'EXPENSE', description: 'BIL/INFT/FF57281737/CC BillPay-9018/Self' },
    ]);

    await persistParsedStatement({
      ...BASE, transactions: [makeTx({ description: 'BIL/INFT/FF57281737/CC BillPay-9018/Self', amount: 500 })],
    });

    expect(infoSpy).toHaveBeenCalledWith(
      '[import] fuzzy duplicate skipped',
      expect.objectContaining({ ownerUserId: 'u1', matchedId: 'existing-1' }),
    );
    infoSpy.mockRestore();
  });

  it('returns fuzzyDuplicatesSkipped separately from duplicatesSkipped for observability', async () => {
    const exactTx = makeTx({ description: 'Exact dup', amount: 100 });
    const exactHash = makeImportHash(exactTx.date, exactTx.amount, exactTx.type, exactTx.description, 'u1');
    const fuzzyTx = makeTx({ description: 'Fuzzy dup label BIL/INFT/FF57281737/CC BillPay-9018/Self', amount: 500 });
    txMock.findMany.mockResolvedValueOnce([{ importHash: exactHash }]);
    txMock.findMany.mockResolvedValueOnce([
      { id: 'existing-1', date: fuzzyTx.date, amount: { toFixed: () => '500.00' }, type: 'EXPENSE', description: 'BIL/INFT/FF57281737/CC BillPay-9018/Self' },
    ]);

    const result = await persistParsedStatement({
      ...BASE, rowCount: 2, transactions: [exactTx, fuzzyTx],
    });

    expect(result.duplicatesSkipped).toBe(2);
    expect(result.fuzzyDuplicatesSkipped).toBe(1);
  });
});

// ═══ Incident reproduction (the test that would have caught the original bug) ═══════

describe('persistParsedStatement — incident reproduction: CSV-linked then PDF-unlinked', () => {
  it('dedupes a PDF re-import of an already-imported CSV statement, even though the exact hash never matches', async () => {
    // Step 1: CSV import, linked to an account — establishes the "existing" rows.
    const csvRows = [
      makeTx({ date: new Date('2026-06-09T00:00:00.000Z'), amount: 720, type: 'INCOME', description: 'UPI/Bajaj Fins/poweraccess.ba/Bajaj Fins/AXIS BANK/675485111606/AXI644f77e0798d458a9f4d45aa282e34bc' }),
      makeTx({ date: new Date('2026-06-25T00:00:00.000Z'), amount: 288156, type: 'INCOME', description: 'ACH/SAL-NVIDIAGRAPPVTLTD/NVIDIA SAL Jun 26 39778 005225' }),
    ];
    await persistParsedStatement({ ...BASE, accountId: 'acc1', rowCount: 2, transactions: csvRows });
    expect(txClient.transaction.createMany).toHaveBeenCalledTimes(1);
    vi.clearAllMocks();
    acctMock.findFirst.mockResolvedValue({ id: 'acc1', userId: 'u1' });
    importMock.create.mockResolvedValue({ id: 'imp-2' });
    txClient.transaction.create.mockResolvedValue({ id: 'tx-1' });
    txClient.transaction.createMany.mockImplementation(async ({ data }: any) => ({ count: data.length }));
    txClient.bankAccount.findFirst.mockResolvedValue(null);
    txClient.bankAccount.update.mockResolvedValue({});
    $transactionMock.mockImplementation(async (cb: any) => cb(txClient));

    // Step 2: PDF re-import of the SAME statement, unlinked — the incident. Exact-hash
    // check finds nothing (different scopeId AND different description formatting).
    const pdfRows = [
      makeTx({ date: new Date('2026-06-09T00:00:00.000Z'), amount: 720, type: 'INCOME', description: 'Bajaj Fins UPI/Bajaj Fins/poweraccess.ba/Bajaj Fins/AXIS BANK/675485111606/AXI644f77e0798d458a9f4d45aa282e34bc' }),
      makeTx({ date: new Date('2026-06-25T00:00:00.000Z'), amount: 288156, type: 'INCOME', description: 'NACH trxn ACH/SAL-NVIDIAGRAPPVTLTD/NVIDIA SAL Jun 26 39778 005225' }),
    ];
    txMock.findMany.mockResolvedValueOnce([]); // exact-hash: no match — this IS the bug
    txMock.findMany.mockResolvedValueOnce([
      { id: 'orig-1', date: new Date('2026-06-09T00:00:00.000Z'), amount: { toFixed: () => '720.00' }, type: 'INCOME', description: csvRows[0].description },
      { id: 'orig-2', date: new Date('2026-06-25T00:00:00.000Z'), amount: { toFixed: () => '288156.00' }, type: 'INCOME', description: csvRows[1].description },
    ]);

    const result = await persistParsedStatement({ ...BASE, rowCount: 2, transactions: pdfRows });

    // Without the fuzzy net, `imported` would be 2 (the actual incident) — with it,
    // both rows are recognized as duplicates and nothing new is created.
    expect(result.imported).toBe(0);
    expect(result.fuzzyDuplicatesSkipped).toBe(2);
    expect(txClient.transaction.createMany).not.toHaveBeenCalled();
    expect(result.warnings.some((w) => /2 rows matched/.test(w))).toBe(true);
  });
});

describe('persistParsedStatement — fuzzy dedup: multiple candidates in one bucket', () => {
  it('checks every candidate sharing a date/amount/type bucket, not just the first', async () => {
    txMock.findMany.mockResolvedValueOnce([]);
    txMock.findMany.mockResolvedValueOnce([
      { id: 'existing-1', date: new Date('2025-04-01T00:00:00.000Z'), amount: { toFixed: () => '500.00' }, type: 'EXPENSE', description: 'UPI/AAAA/Pay/genuinereference1111111111' },
      { id: 'existing-2', date: new Date('2025-04-01T00:00:00.000Z'), amount: { toFixed: () => '500.00' }, type: 'EXPENSE', description: 'UPI/BBBB/Pay/genuinereference2222222222' },
    ]);

    const result = await persistParsedStatement({
      ...BASE, transactions: [makeTx({ description: 'BBBB UPI/BBBB/Pay/genuinereference2222222222', amount: 500 })],
    });

    expect(result.fuzzyDuplicatesSkipped).toBe(1);
  });
});

describe('persistParsedStatement — fuzzy dedup: candidate query truncation', () => {
  it('warns when the candidate query hits the take cap (result may be incomplete)', async () => {
    const candidates = Array.from({ length: 2000 }, (_, i) => ({
      id: `existing-${i}`,
      date: new Date('2025-04-01T00:00:00.000Z'),
      amount: { toFixed: () => '500.00' },
      type: 'EXPENSE',
      description: `unrelated narration number ${i}`,
      bankAccountId: null,
    }));
    txMock.findMany.mockResolvedValueOnce([]);
    txMock.findMany.mockResolvedValueOnce(candidates);

    const result = await persistParsedStatement({ ...BASE, transactions: [makeTx({ amount: 500 })] });

    expect(result.warnings.some((w) => /duplicate check was limited/i.test(w))).toBe(true);
  });

  it('does not warn when the candidate count is under the cap', async () => {
    const result = await persistParsedStatement({ ...BASE, transactions: [makeTx()] });
    expect(result.warnings.some((w) => /duplicate check was limited/i.test(w))).toBe(false);
  });
});

describe('persistParsedStatement — fuzzy dedup: no cash account exists yet', () => {
  it('handles a user with no cash account provisioned yet (cash-account lookup returns null)', async () => {
    acctMock.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.isCashAccount) return null;
      return { id: 'acc1', userId: 'u1' };
    });

    const result = await persistParsedStatement({ ...BASE, transactions: [makeTx()] });
    expect(result.imported).toBe(1);
  });
});

// ─── Opening-balance anchor: rows are still inserted, but excluded from balance deltas ──

describe('persistParsedStatement — opening-balance anchor supersession', () => {
  function mockLinkedAccountAnchor(anchorDate: Date | null) {
    acctMock.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.isCashAccount) return { id: 'cash-1', openingBalanceDate: null };
      return { id: 'acc1', userId: 'u1', openingBalanceDate: anchorDate };
    });
  }

  it('still INSERTS a pre-anchor row (visible in lists) but flags it superseded and excludes it from the balance delta', async () => {
    mockLinkedAccountAnchor(new Date('2026-01-01'));
    const preAnchorTx = makeTx({ date: new Date('2025-12-15T00:00:00.000Z'), amount: 500, type: 'EXPENSE' });
    const result = await persistParsedStatement({ ...BASE, accountId: 'acc1', transactions: [preAnchorTx] });

    expect(result.imported).toBe(1);
    expect(result.supersededByAnchorCount).toBe(1);
    expect(txClient.transaction.createMany.mock.calls[0][0].data[0]).toEqual(
      expect.objectContaining({ balanceSupersededByAnchor: true }),
    );
    // No balance sync call at all — the only row in this batch is excluded from netDelta.
    expect(txClient.bankAccount.update).not.toHaveBeenCalled();
  });

  it('a post-anchor row on the same account is not superseded and still moves the balance', async () => {
    mockLinkedAccountAnchor(new Date('2026-01-01'));
    const postAnchorTx = makeTx({ date: new Date('2026-02-01T00:00:00.000Z'), amount: 500, type: 'EXPENSE' });
    const result = await persistParsedStatement({ ...BASE, accountId: 'acc1', transactions: [postAnchorTx] });

    expect(result.supersededByAnchorCount).toBe(0);
    expect(txClient.transaction.createMany.mock.calls[0][0].data[0]).toEqual(
      expect.objectContaining({ balanceSupersededByAnchor: false }),
    );
    expect(txClient.bankAccount.update).toHaveBeenCalledWith({
      where: { id: 'acc1' },
      data: { currentBalance: { increment: -500 } },
    });
  });

  it('a transaction dated exactly on the anchor date is superseded (E1)', async () => {
    mockLinkedAccountAnchor(new Date('2026-01-01'));
    const sameDayTx = makeTx({ date: new Date('2026-01-01T00:00:00.000Z'), amount: 500, type: 'EXPENSE' });
    const result = await persistParsedStatement({ ...BASE, accountId: 'acc1', transactions: [sameDayTx] });
    expect(result.supersededByAnchorCount).toBe(1);
  });

  it('adds a warning mentioning the superseded count', async () => {
    mockLinkedAccountAnchor(new Date('2026-01-01'));
    const preAnchorTx = makeTx({ date: new Date('2025-12-15T00:00:00.000Z'), amount: 500, type: 'EXPENSE' });
    const result = await persistParsedStatement({ ...BASE, accountId: 'acc1', transactions: [preAnchorTx] });
    expect(result.warnings.some((w) => /1 row.*opening-balance date/.test(w))).toBe(true);
  });

  it('pluralizes the superseded-count warning for more than one row', async () => {
    mockLinkedAccountAnchor(new Date('2026-01-01'));
    const rows = [
      makeTx({ date: new Date('2025-12-14T00:00:00.000Z'), amount: 500, type: 'EXPENSE', description: 'first pre-anchor row' }),
      makeTx({ date: new Date('2025-12-15T00:00:00.000Z'), amount: 700, type: 'EXPENSE', description: 'second pre-anchor row' }),
    ];
    const result = await persistParsedStatement({ ...BASE, accountId: 'acc1', transactions: rows });
    expect(result.supersededByAnchorCount).toBe(2);
    expect(result.warnings.some((w) => /^2 rows dated on or before an account's opening-balance date were imported/.test(w))).toBe(true);
  });

  it('checks the cash account\'s anchor INDEPENDENTLY of the linked account\'s, for a linked-CASH row\'s synthetic leg', async () => {
    // Linked account has NO anchor, but the cash account does — the synthetic
    // counterpart leg on the cash account must still be excluded from cashDeltas.
    acctMock.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.isCashAccount) return { id: 'cash-1', openingBalanceDate: new Date('2026-01-01') };
      return { id: 'acc1', userId: 'u1', openingBalanceDate: null };
    });
    txClient.bankAccount.findFirst.mockResolvedValue({ id: 'cash-1', userId: 'u1', isCashAccount: true });

    const preAnchorCashTx = makeTx({
      date: new Date('2025-12-15T00:00:00.000Z'), amount: 500, type: 'EXPENSE', paymentMode: 'CASH' as any,
    });
    const result = await persistParsedStatement({ ...BASE, accountId: 'acc1', transactions: [preAnchorCashTx] });

    expect(result.supersededByAnchorCount).toBe(1);
    // The real row (on the linked, unanchored account) still moves that account's balance...
    expect(txClient.bankAccount.update).toHaveBeenCalledWith({
      where: { id: 'acc1' },
      data: { currentBalance: { increment: -500 } },
    });
    // ...but the cash account (anchored) does not get a balance sync call at all, since
    // its only leg this batch is superseded.
    expect(txClient.bankAccount.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cash-1' } }),
    );
    const syntheticRow = txClient.transaction.createMany.mock.calls[0][0].data.find((r: any) => r.bankAccountId === 'cash-1');
    expect(syntheticRow.balanceSupersededByAnchor).toBe(true);
  });

  it('a pre-cash-anchor row on an UNLINKED CASH import is inserted but excluded from the cash balance', async () => {
    acctMock.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.isCashAccount) return { id: 'cash-1', openingBalanceDate: new Date('2026-01-01') };
      return { id: 'acc1', userId: 'u1', openingBalanceDate: null };
    });
    txClient.bankAccount.findFirst.mockResolvedValue({ id: 'cash-1', userId: 'u1', isCashAccount: true });

    const preAnchorCashTx = makeTx({
      date: new Date('2025-12-15T00:00:00.000Z'), amount: 500, type: 'EXPENSE', paymentMode: 'CASH' as any,
    });
    const result = await persistParsedStatement({ ...BASE, transactions: [preAnchorCashTx] });

    expect(result.imported).toBe(1);
    expect(result.supersededByAnchorCount).toBe(1);
    expect(txClient.bankAccount.update).not.toHaveBeenCalled();
  });
});
