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
    txMock.findMany.mockResolvedValue([{ importHash: existing }]);

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
    txMock.findMany.mockResolvedValue([
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
    txMock.findMany.mockResolvedValue([{ importHash: originalHash }]);

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
    txMock.findMany.mockResolvedValue([
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
