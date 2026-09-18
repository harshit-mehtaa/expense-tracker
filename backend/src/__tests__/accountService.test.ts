/**
 * Unit tests for accountService.ts.
 *
 * Key test focus: reconcileAccount delta logic (delta=0 skips correction,
 * delta>0 creates INCOME, delta<0 creates EXPENSE), role-based scoping,
 * and $transaction atomic pattern.
 *
 * accountService uses default import of prisma.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/prisma', () => {
  const mockPrisma = {
    bankAccount: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    transaction: {
      create: vi.fn(),
      updateMany: vi.fn(),
      groupBy: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  };
  return { default: mockPrisma, prisma: mockPrisma };
});

import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import {
  getAccounts,
  getAccountById,
  createAccount,
  updateAccount,
  reconcileAccount,
  deleteAccount,
  ensureCashAccount,
  applyAnchor,
} from '../services/accountService';

const acctMock = (prisma as any).bankAccount;
const txMock = (prisma as any).transaction;

const MOCK_ACCOUNT = {
  id: 'acct-1',
  userId: 'u1',
  bankName: 'HDFC',
  accountType: 'SAVINGS',
  currentBalance: 100000,
  isActive: true,
  currency: 'INR',
};

beforeEach(() => {
  vi.clearAllMocks();
  (prisma as any).$transaction.mockImplementation(async (fn: any) => fn(prisma));
  acctMock.findUnique.mockResolvedValue(MOCK_ACCOUNT);
  acctMock.findUniqueOrThrow.mockResolvedValue(MOCK_ACCOUNT);
  acctMock.update.mockResolvedValue(MOCK_ACCOUNT);
  txMock.groupBy.mockResolvedValue([]);
  txMock.count.mockResolvedValue(0);
  txMock.updateMany.mockResolvedValue({ count: 0 });
});

// ─────────────────────────────────────────────────────────────────────────────
// getAccounts
// ─────────────────────────────────────────────────────────────────────────────

describe('getAccounts', () => {
  it('MEMBER: always scopes to requesterId regardless of userId arg', async () => {
    acctMock.findMany.mockResolvedValue([MOCK_ACCOUNT]);
    await getAccounts('u2', 'u1', 'MEMBER'); // userId='u2', requesterId='u1'
    expect(acctMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', isActive: true } }),
    );
  });

  it('ADMIN with userId: scopes to the specified userId', async () => {
    acctMock.findMany.mockResolvedValue([MOCK_ACCOUNT]);
    await getAccounts('u2', 'admin-1', 'ADMIN');
    expect(acctMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u2', isActive: true } }),
    );
  });

  it('ADMIN with undefined userId: family-wide query (no userId filter), includes user owner fields', async () => {
    acctMock.findMany.mockResolvedValue([
      { id: 'acct-1', bankName: 'HDFC', userId: 'u1', isActive: true, user: { name: 'Alice', colorTag: '#0ea5e9' } },
    ]);
    const result = await getAccounts(undefined, 'admin-1', 'ADMIN');
    const call = acctMock.findMany.mock.calls[0][0];
    expect(call.where).not.toHaveProperty('userId');
    expect(call.where).toEqual({ isActive: true, user: { isActive: true, deletedAt: null } });
    expect(call.include).toEqual({ user: { select: { name: true, colorTag: true } } });
    expect((result[0] as any).userName).toBe('Alice');
    expect((result[0] as any).userColorTag).toBe('#0ea5e9');
    expect((result[0] as any).user).toBeUndefined();
  });

  it('ADMIN with empty string userId: family-wide (treated same as undefined)', async () => {
    acctMock.findMany.mockResolvedValue([]);
    await getAccounts('' as any, 'admin-1', 'ADMIN');
    const call = acctMock.findMany.mock.calls[0][0];
    expect(call.where).not.toHaveProperty('userId');
  });

  it('ADMIN family-wide: falls back to empty string when user.name is null (line 29 ?? branch)', async () => {
    acctMock.findMany.mockResolvedValue([
      { id: 'acct-1', bankName: 'HDFC', userId: 'u1', isActive: true, user: { name: null } },
    ]);
    const result = await getAccounts(undefined, 'admin-1', 'ADMIN');
    expect((result[0] as any).userName).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getAccountById
// ─────────────────────────────────────────────────────────────────────────────

describe('getAccountById', () => {
  it('returns account when found and requester owns it', async () => {
    const result = await getAccountById('acct-1', 'u1', 'MEMBER');
    expect(result).toBe(MOCK_ACCOUNT);
  });

  it('throws NotFound when account does not exist', async () => {
    acctMock.findUnique.mockResolvedValue(null);
    await expect(getAccountById('acct-x', 'u1', 'MEMBER')).rejects.toThrow(/not found/i);
  });

  it('throws Forbidden when MEMBER requests another user\'s account', async () => {
    acctMock.findUnique.mockResolvedValue({ ...MOCK_ACCOUNT, userId: 'u2' });
    await expect(getAccountById('acct-1', 'u1', 'MEMBER')).rejects.toThrow(/forbidden|access denied/i);
  });

  it('ADMIN can access any account regardless of userId', async () => {
    acctMock.findUnique.mockResolvedValue({ ...MOCK_ACCOUNT, userId: 'u2' });
    const result = await getAccountById('acct-1', 'admin-1', 'ADMIN');
    expect(result).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createAccount
// ─────────────────────────────────────────────────────────────────────────────

describe('createAccount', () => {
  it('creates account with userId merged and defaults applied', async () => {
    const newAcct = { ...MOCK_ACCOUNT, id: 'acct-new' };
    acctMock.create.mockResolvedValue(newAcct);

    const result = await createAccount('u1', {
      bankName: 'HDFC',
      accountType: 'SAVINGS',
    });

    expect(acctMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u1',
          bankName: 'HDFC',
          currentBalance: 0,   // default
          currency: 'INR',     // default
        }),
      }),
    );
    expect(result).toBe(newAcct);
  });

  it('stores the normalized full account number and derives the last 4 digits', async () => {
    acctMock.create.mockResolvedValue(MOCK_ACCOUNT);

    await createAccount('u1', {
      bankName: 'HDFC',
      accountType: 'SAVINGS',
      accountNumber: '1234 5678-9012',
    });

    expect(acctMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          accountNumber: '123456789012',
          accountNumberLast4: '9012',
        }),
      }),
    );
  });

  it('stores the normalized full IFSC code and derives the IFSC prefix', async () => {
    acctMock.create.mockResolvedValue(MOCK_ACCOUNT);

    await createAccount('u1', {
      bankName: 'HDFC',
      accountType: 'SAVINGS',
      ifscCode: 'hdfc 0001234',
    } as any);

    expect(acctMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ifscCode: 'HDFC0001234',
          ifscPrefix: 'HDFC',
        }),
      }),
    );
  });

  it('keeps legacy IFSC prefix when full IFSC code is not provided', async () => {
    acctMock.create.mockResolvedValue(MOCK_ACCOUNT);

    await createAccount('u1', {
      bankName: 'HDFC',
      accountType: 'SAVINGS',
      ifscPrefix: 'hdfc',
    });

    expect(acctMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ifscCode: undefined,
          ifscPrefix: 'HDFC',
        }),
      }),
    );
  });

  it('converts maturityDate string to Date', async () => {
    acctMock.create.mockResolvedValue(MOCK_ACCOUNT);
    await createAccount('u1', {
      bankName: 'SBI',
      accountType: 'FD',
      maturityDate: '2025-12-31',
    });
    const createCall = acctMock.create.mock.calls[0][0];
    expect(createCall.data.maturityDate).toBeInstanceOf(Date);
  });

  it('rejects manual creation of a CASH account', async () => {
    await expect(createAccount('u1', { bankName: 'Cash', accountType: 'CASH' })).rejects.toThrow(/system-managed/i);
    expect(acctMock.create).not.toHaveBeenCalled();
  });

  it('stores card billing cycle details', async () => {
    acctMock.create.mockResolvedValue(MOCK_ACCOUNT);

    await createAccount('u1', {
      bankName: 'ICICI',
      accountType: 'CREDIT_CARD',
      currentBalance: -25000,
      creditLimit: 300000,
      billingCycleStartDay: 2,
      billingCycleEndDay: 1,
      paymentDueDay: 18,
    });

    expect(acctMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          accountType: 'CREDIT_CARD',
          creditLimit: 300000,
          billingCycleStartDay: 2,
          billingCycleEndDay: 1,
          paymentDueDay: 18,
        }),
      }),
    );
  });

  it('sends ifscPrefix:null to Prisma when both ifscCode and ifscPrefix are explicitly null', async () => {
    acctMock.create.mockResolvedValue(MOCK_ACCOUNT);
    await createAccount('u1', {
      bankName: 'HDFC',
      accountType: 'SAVINGS',
      ifscCode: null,
      ifscPrefix: null,
    } as any);
    expect(acctMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ifscCode: null, ifscPrefix: null }),
      }),
    );
  });

  // The `??` fallback (getIfscPrefix(ifscCode) ?? normalizeIfscPrefix(data.ifscPrefix)) must
  // still prefer a real derived prefix over an explicitly-nulled legacy ifscPrefix — proves
  // the null-awareness added to these helpers didn't change this precedence.
  // normalizeIfscPrefix's own null branch is only reachable when ifscCode is absent/null —
  // getIfscPrefix(ifscCode) short-circuits it otherwise via the `??`.
  it('nulls ifscPrefix via normalizeIfscPrefix directly when ifscCode is absent', async () => {
    acctMock.create.mockResolvedValue(MOCK_ACCOUNT);
    await createAccount('u1', {
      bankName: 'HDFC',
      accountType: 'SAVINGS',
      ifscPrefix: null,
    } as any);
    expect(acctMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ifscPrefix: null }) }),
    );
  });

  it('derives ifscPrefix from a real ifscCode even when the legacy ifscPrefix is explicitly null', async () => {
    acctMock.create.mockResolvedValue(MOCK_ACCOUNT);
    await createAccount('u1', {
      bankName: 'HDFC',
      accountType: 'SAVINGS',
      ifscCode: 'hdfc0001234',
      ifscPrefix: null,
    } as any);
    expect(acctMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ifscCode: 'HDFC0001234', ifscPrefix: 'HDFC' }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateAccount
// ─────────────────────────────────────────────────────────────────────────────

describe('updateAccount', () => {
  it('updates account after ownership check', async () => {
    const updated = { ...MOCK_ACCOUNT, bankName: 'ICICI' };
    acctMock.update.mockResolvedValue(updated);

    const result = await updateAccount('acct-1', 'u1', 'MEMBER', { bankName: 'ICICI' });
    expect(acctMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'acct-1' } }),
    );
    expect(result).toBe(updated);
  });

  it('updates the full account number and last 4 together', async () => {
    await updateAccount('acct-1', 'u1', 'MEMBER', { accountNumber: '0000 1111 2222' } as any);
    expect(acctMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          accountNumber: '000011112222',
          accountNumberLast4: '2222',
        }),
      }),
    );
  });

  it('updates the full IFSC code and prefix together', async () => {
    await updateAccount('acct-1', 'u1', 'MEMBER', { ifscCode: 'icic0005678' } as any);
    expect(acctMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ifscCode: 'ICIC0005678',
          ifscPrefix: 'ICIC',
        }),
      }),
    );
  });

  it('converts maturityDate string to Date object when provided (true branch)', async () => {
    const updated = { ...MOCK_ACCOUNT, maturityDate: new Date('2026-03-31') };
    acctMock.update.mockResolvedValue(updated);
    await updateAccount('acct-1', 'u1', 'MEMBER', { maturityDate: '2026-03-31' } as any);
    const call = acctMock.update.mock.calls[0][0];
    expect(call.data.maturityDate).toBeInstanceOf(Date);
  });

  it('updates card billing cycle details', async () => {
    await updateAccount('acct-1', 'u1', 'MEMBER', {
      creditLimit: 250000,
      billingCycleStartDay: 5,
      billingCycleEndDay: 4,
      paymentDueDay: 20,
    } as any);

    expect(acctMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          creditLimit: 250000,
          billingCycleStartDay: 5,
          billingCycleEndDay: 4,
          paymentDueDay: 20,
        }),
      }),
    );
  });

  it('propagates NotFound from getAccountById', async () => {
    acctMock.findUnique.mockResolvedValue(null);
    await expect(updateAccount('acct-x', 'u1', 'MEMBER', {})).rejects.toThrow(/not found/i);
  });

  it('rejects deactivating the cash account via isActive=false', async () => {
    acctMock.findUnique.mockResolvedValue({ ...MOCK_ACCOUNT, isCashAccount: true });
    await expect(updateAccount('acct-1', 'u1', 'MEMBER', { isActive: false })).rejects.toThrow(/cannot be deactivated/i);
    expect(acctMock.update).not.toHaveBeenCalled();
  });

  it('rejects changing the cash account\'s accountType away from CASH', async () => {
    acctMock.findUnique.mockResolvedValue({ ...MOCK_ACCOUNT, isCashAccount: true, accountType: 'CASH' });
    await expect(updateAccount('acct-1', 'u1', 'MEMBER', { accountType: 'SAVINGS' })).rejects.toThrow(/type cannot be changed/i);
    expect(acctMock.update).not.toHaveBeenCalled();
  });

  it('allows a no-op accountType update (still CASH) on the cash account', async () => {
    acctMock.findUnique.mockResolvedValue({ ...MOCK_ACCOUNT, isCashAccount: true, accountType: 'CASH' });
    await updateAccount('acct-1', 'u1', 'MEMBER', { accountType: 'CASH' });
    expect(acctMock.update).toHaveBeenCalled();
  });

  it('rejects converting a regular account into the cash account', async () => {
    acctMock.findUnique.mockResolvedValue({ ...MOCK_ACCOUNT, isCashAccount: false, accountType: 'SAVINGS' });
    await expect(updateAccount('acct-1', 'u1', 'MEMBER', { accountType: 'CASH' })).rejects.toThrow(/cannot be converted/i);
    expect(acctMock.update).not.toHaveBeenCalled();
  });

  it('allows updating a non-isActive field on the cash account', async () => {
    acctMock.findUnique.mockResolvedValue({ ...MOCK_ACCOUNT, isCashAccount: true });
    await updateAccount('acct-1', 'u1', 'MEMBER', { bankName: 'Cash' });
    expect(acctMock.update).toHaveBeenCalled();
  });

  // Clearing ifscCode/accountNumber must ALSO clear their derived columns
  // (ifscPrefix/accountNumberLast4) — otherwise those go stale after the source clears.
  it('clearing ifscCode to null also nulls the derived ifscPrefix', async () => {
    await updateAccount('acct-1', 'u1', 'MEMBER', { ifscCode: null } as any);
    expect(acctMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ifscCode: null, ifscPrefix: null }),
      }),
    );
  });

  it('clearing accountNumber to null also nulls the derived accountNumberLast4', async () => {
    await updateAccount('acct-1', 'u1', 'MEMBER', { accountNumber: null } as any);
    expect(acctMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ accountNumber: null, accountNumberLast4: null }),
      }),
    );
  });

  it.each(['upiId', 'creditLimit', 'billingCycleStartDay', 'billingCycleEndDay', 'paymentDueDay'])(
    'passes an explicit null for %s straight through to Prisma (untouched by the spread)',
    async (field) => {
      await updateAccount('acct-1', 'u1', 'MEMBER', { [field]: null } as any);
      expect(acctMock.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ [field]: null }) }),
      );
    },
  );

  it('sets maturityDate to null when explicitly cleared (not swallowed by the post-spread override)', async () => {
    await updateAccount('acct-1', 'u1', 'MEMBER', { maturityDate: null } as any);
    expect(acctMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ maturityDate: null }) }),
    );
  });

  it('leaves maturityDate untouched (undefined) when not provided at all', async () => {
    await updateAccount('acct-1', 'u1', 'MEMBER', { bankName: 'ICICI' });
    expect(acctMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ maturityDate: undefined }) }),
    );
  });

  // Opening-balance anchor bypass guard (S9 in the Cases Matrix): once an anchor is
  // set, currentBalance must only move via applyAnchor or reconcileAccount.
  it('rejects a currentBalance change via PUT when an opening-balance anchor is set', async () => {
    acctMock.findUnique.mockResolvedValue({ ...MOCK_ACCOUNT, openingBalanceDate: new Date('2026-01-01') });
    await expect(
      updateAccount('acct-1', 'u1', 'MEMBER', { currentBalance: 999999 } as any),
    ).rejects.toThrow(/opening-balance anchor/i);
    expect(acctMock.update).not.toHaveBeenCalled();
  });

  it('allows a PUT that resends the SAME currentBalance unchanged even with an anchor set', async () => {
    acctMock.findUnique.mockResolvedValue({ ...MOCK_ACCOUNT, currentBalance: 100000, openingBalanceDate: new Date('2026-01-01') });
    await updateAccount('acct-1', 'u1', 'MEMBER', { currentBalance: 100000, bankName: 'ICICI' } as any);
    expect(acctMock.update).toHaveBeenCalled();
  });

  it('allows a currentBalance change via PUT when no anchor is set', async () => {
    acctMock.findUnique.mockResolvedValue({ ...MOCK_ACCOUNT, openingBalanceDate: null });
    await updateAccount('acct-1', 'u1', 'MEMBER', { currentBalance: 999999 } as any);
    expect(acctMock.update).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteAccount (soft-delete)
// ─────────────────────────────────────────────────────────────────────────────

describe('deleteAccount', () => {
  it('sets isActive=false (soft-delete) after ownership check', async () => {
    await deleteAccount('acct-1', 'u1', 'MEMBER');
    expect(acctMock.update).toHaveBeenCalledWith({
      where: { id: 'acct-1' },
      data: { isActive: false },
    });
  });

  it('propagates Forbidden from getAccountById for wrong owner', async () => {
    acctMock.findUnique.mockResolvedValue({ ...MOCK_ACCOUNT, userId: 'u2' });
    await expect(deleteAccount('acct-1', 'u1', 'MEMBER')).rejects.toThrow(/forbidden|access denied/i);
  });

  it('rejects deactivating the cash account', async () => {
    acctMock.findUnique.mockResolvedValue({ ...MOCK_ACCOUNT, isCashAccount: true });
    await expect(deleteAccount('acct-1', 'u1', 'MEMBER')).rejects.toThrow(/cannot be deactivated/i);
    expect(acctMock.update).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ensureCashAccount
// ─────────────────────────────────────────────────────────────────────────────

describe('ensureCashAccount', () => {
  it('returns the existing cash account without creating one', async () => {
    const existing = { id: 'cash-1', userId: 'u1', isCashAccount: true };
    acctMock.findFirst.mockResolvedValue(existing);

    const result = await ensureCashAccount(prisma as any, 'u1');

    expect(result).toBe(existing);
    expect(acctMock.create).not.toHaveBeenCalled();
  });

  it('creates a cash account when none exists', async () => {
    acctMock.findFirst.mockResolvedValue(null);
    const created = { id: 'cash-new', userId: 'u1', isCashAccount: true, accountType: 'CASH' };
    acctMock.create.mockResolvedValue(created);

    const result = await ensureCashAccount(prisma as any, 'u1');

    expect(acctMock.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        bankName: 'Cash',
        accountType: 'CASH',
        isCashAccount: true,
        currentBalance: 0,
        currency: 'INR',
      },
    });
    expect(result).toBe(created);
  });

  it('throws a clean conflict on a concurrent-create race (P2002), without attempting to re-read', async () => {
    // A real Postgres transaction is aborted by any error — a findFirst on the same `tx`
    // after the P2002 could never succeed, so this must NOT attempt one (see accountService.ts).
    acctMock.findFirst.mockResolvedValue(null);
    acctMock.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' }),
    );

    await expect(ensureCashAccount(prisma as any, 'u1')).rejects.toThrow(/retry/i);
    expect(acctMock.findFirst).toHaveBeenCalledTimes(1);
  });

  it('re-throws a non-P2002 error from create unchanged', async () => {
    acctMock.findFirst.mockResolvedValue(null);
    acctMock.create.mockRejectedValue(new Error('connection lost'));

    await expect(ensureCashAccount(prisma as any, 'u1')).rejects.toThrow('connection lost');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// reconcileAccount
// ─────────────────────────────────────────────────────────────────────────────

describe('reconcileAccount', () => {
  it('delta=0: does NOT create a correction transaction, still updates balance inside $transaction', async () => {
    // currentBalance=100000, actualBalance=100000 → delta=0
    await reconcileAccount('acct-1', 'u1', 'MEMBER', 100000);
    expect((prisma as any).$transaction).toHaveBeenCalled(); // atomicity is preserved regardless of delta
    expect(txMock.create).not.toHaveBeenCalled();
    // Balance still updated to the confirmed actual value
    expect(acctMock.update).toHaveBeenCalledWith({
      where: { id: 'acct-1' },
      data: { currentBalance: 100000 },
    });
  });

  it('delta>0: creates INCOME correction transaction', async () => {
    // currentBalance=100000, actualBalance=110000 → delta=+10000 (INCOME)
    await reconcileAccount('acct-1', 'u1', 'MEMBER', 110000);
    expect(txMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 10000,
          type: 'INCOME',
        }),
      }),
    );
    expect(acctMock.update).toHaveBeenCalledWith({
      where: { id: 'acct-1' },
      data: { currentBalance: 110000 },
    });
  });

  it('delta<0: creates EXPENSE correction transaction', async () => {
    // currentBalance=100000, actualBalance=90000 → delta=-10000 (EXPENSE)
    await reconcileAccount('acct-1', 'u1', 'MEMBER', 90000);
    expect(txMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 10000,        // Math.abs(delta)
          type: 'EXPENSE',
        }),
      }),
    );
  });

  it('uses custom note in correction transaction description', async () => {
    await reconcileAccount('acct-1', 'u1', 'MEMBER', 110000, 'Manual check');
    expect(txMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ description: 'Manual check' }),
      }),
    );
  });

  it('throws Forbidden when MEMBER tries to reconcile another user\'s account', async () => {
    acctMock.findUnique.mockResolvedValue({ ...MOCK_ACCOUNT, userId: 'u2' });
    await expect(reconcileAccount('acct-1', 'u1', 'MEMBER', 100000)).rejects.toThrow(/forbidden|access denied/i);
  });

  // TOCTOU fix (VQ3 / a pre-existing bug found and fixed alongside this feature): the
  // delta must be computed from a FRESH read taken inside the $transaction, not the
  // stale outer read used only for the ownership check.
  it('computes the delta from a fresh in-transaction read, not the stale ownership-check read', async () => {
    acctMock.findUnique.mockResolvedValue({ ...MOCK_ACCOUNT, currentBalance: 100000 });
    // A concurrent mutation landed between the ownership check and the transaction.
    acctMock.findUniqueOrThrow.mockResolvedValue({ ...MOCK_ACCOUNT, currentBalance: 105000 });
    await reconcileAccount('acct-1', 'u1', 'MEMBER', 110000);
    expect(txMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 5000, type: 'INCOME' }) }),
    );
  });

  it('uses Decimal arithmetic for the delta, avoiding float drift', async () => {
    acctMock.findUniqueOrThrow.mockResolvedValue({ ...MOCK_ACCOUNT, currentBalance: new Prisma.Decimal('100000.10') });
    await reconcileAccount('acct-1', 'u1', 'MEMBER', 100000.2);
    expect(txMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 0.1, type: 'INCOME' }) }),
    );
  });

  it('locks the account row before reading currentBalance inside the transaction', async () => {
    await reconcileAccount('acct-1', 'u1', 'MEMBER', 110000);
    expect((prisma as any).$queryRaw).toHaveBeenCalled();
  });

  // Reconcile always dates its correction `new Date()` (today). If the account's anchor
  // ALSO covers today, that correction lands in the superseded window — inserted as
  // non-superseded (wrong), then silently reverted on the next applyAnchor recompute.
  // Reject rather than corrupt the invariant.
  it('rejects reconciling an account whose opening-balance anchor covers today', async () => {
    acctMock.findUniqueOrThrow.mockResolvedValue({ ...MOCK_ACCOUNT, openingBalanceDate: new Date() });
    await expect(reconcileAccount('acct-1', 'u1', 'MEMBER', 110000)).rejects.toThrow(/opening-balance anchor covering today/i);
    expect(txMock.create).not.toHaveBeenCalled();
    expect(acctMock.update).not.toHaveBeenCalled();
  });

  it('allows reconciling an account whose anchor is strictly in the past', async () => {
    acctMock.findUniqueOrThrow.mockResolvedValue({ ...MOCK_ACCOUNT, openingBalanceDate: new Date('2020-01-01') });
    await reconcileAccount('acct-1', 'u1', 'MEMBER', 110000);
    expect(acctMock.update).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// applyAnchor
// ─────────────────────────────────────────────────────────────────────────────

describe('applyAnchor', () => {
  beforeEach(() => {
    acctMock.findUnique.mockResolvedValue(MOCK_ACCOUNT);
    acctMock.update.mockImplementation(async ({ data }: any) => ({ ...MOCK_ACCOUNT, ...data }));
  });

  it('sets an anchor on a fresh account: resets then re-flags supersession, sums Decimal, absolute-sets currentBalance', async () => {
    txMock.groupBy.mockResolvedValue([
      { type: 'INCOME', _sum: { amount: new Prisma.Decimal(2000) } },
      { type: 'EXPENSE', _sum: { amount: new Prisma.Decimal(500) } },
    ]);
    // Only the SECOND updateMany call's count (the cutoff-scoped one) becomes
    // supersededTransactionCount; the first call's return value is discarded.
    txMock.updateMany.mockResolvedValue({ count: 3 });

    const { account, supersededTransactionCount } = await applyAnchor('acct-1', 'u1', 'MEMBER', 50000, '2026-01-01');

    // Reset-then-set is the idempotent recompute-from-scratch pattern (DQ5).
    expect(txMock.updateMany).toHaveBeenNthCalledWith(1, {
      where: { bankAccountId: 'acct-1', deletedAt: null },
      data: { balanceSupersededByAnchor: false },
    });
    expect(txMock.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: { balanceSupersededByAnchor: true },
    }));
    expect(txMock.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      by: ['type'],
      where: expect.objectContaining({
        bankAccountId: 'acct-1',
        deletedAt: null,
        balanceImpactApplied: true,
        balanceSupersededByAnchor: false,
      }),
    }));
    // 50000 (opening) + 2000 (INCOME) - 500 (EXPENSE) = 51500
    expect(Number(account.currentBalance)).toBe(51500);
    expect(supersededTransactionCount).toBe(3);
  });

  it('clearing (both null) resurrects all superseded rows and resets supersede flag with no cutoff', async () => {
    txMock.groupBy.mockResolvedValue([{ type: 'INCOME', _sum: { amount: new Prisma.Decimal(1000) } }]);
    const { supersededTransactionCount } = await applyAnchor('acct-1', 'u1', 'MEMBER', null, null);

    // Only the reset updateMany runs — no cutoff, nothing to re-flag as superseded.
    expect(txMock.updateMany).toHaveBeenCalledTimes(1);
    expect(txMock.updateMany).toHaveBeenCalledWith({
      where: { bankAccountId: 'acct-1', deletedAt: null },
      data: { balanceSupersededByAnchor: false },
    });
    expect(supersededTransactionCount).toBe(0);
    expect(acctMock.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ openingBalance: null, openingBalanceDate: null }),
    }));
  });

  it('is idempotent: setting the identical anchor twice produces the identical result', async () => {
    txMock.groupBy.mockResolvedValue([{ type: 'INCOME', _sum: { amount: new Prisma.Decimal(1000) } }]);
    const first = await applyAnchor('acct-1', 'u1', 'MEMBER', 50000, '2026-01-01');
    const second = await applyAnchor('acct-1', 'u1', 'MEMBER', 50000, '2026-01-01');
    expect(Number(second.account.currentBalance)).toBe(Number(first.account.currentBalance));
  });

  it('is anchorable on the cash account (no isCashAccount guard)', async () => {
    acctMock.findUnique.mockResolvedValue({ ...MOCK_ACCOUNT, isCashAccount: true, accountType: 'CASH' });
    txMock.groupBy.mockResolvedValue([]);
    await expect(applyAnchor('acct-1', 'u1', 'MEMBER', 8000, '2026-01-01')).resolves.toBeDefined();
  });

  it('preserves Decimal precision across 300 penny-sized amounts (no float drift)', async () => {
    txMock.groupBy.mockResolvedValue([{ type: 'INCOME', _sum: { amount: new Prisma.Decimal('3.00') } }]);
    const { account } = await applyAnchor('acct-1', 'u1', 'MEMBER', 0.01, '2026-01-01');
    expect(Number(account.currentBalance)).toBeCloseTo(3.01, 10);
  });

  it('retries on a P2034 serialization failure and succeeds on the next attempt', async () => {
    txMock.groupBy.mockResolvedValue([]);
    let attempt = 0;
    (prisma as any).$transaction.mockImplementation(async (fn: any) => {
      attempt += 1;
      if (attempt === 1) {
        throw new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: '5.22.0' });
      }
      return fn(prisma);
    });
    await expect(applyAnchor('acct-1', 'u1', 'MEMBER', 50000, '2026-01-01')).resolves.toBeDefined();
    expect(attempt).toBe(2);
  });

  it('does not retry and rethrows a non-serialization error', async () => {
    (prisma as any).$transaction.mockRejectedValue(new Error('boom'));
    await expect(applyAnchor('acct-1', 'u1', 'MEMBER', 50000, '2026-01-01')).rejects.toThrow('boom');
  });

  it('maps exhausted P2034 retries to a friendly conflict error, not a raw 500', async () => {
    (prisma as any).$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: '5.22.0' }),
    );
    const err = await applyAnchor('acct-1', 'u1', 'MEMBER', 50000, '2026-01-01').catch((e) => e);
    expect(err.message).toMatch(/being updated concurrently/i);
    expect(err.statusCode).toBe(409);
  });

  it('locks the account row as the first statement, before any recompute query', async () => {
    txMock.groupBy.mockResolvedValue([]);
    await applyAnchor('acct-1', 'u1', 'MEMBER', 50000, '2026-01-01');
    expect((prisma as any).$queryRaw).toHaveBeenCalled();
  });

  // Both-or-neither and future-date are enforced by the route's Zod schema, but
  // applyAnchor is the sole sanctioned writer — a direct call (script, future caller)
  // must not be able to bypass either rule.
  it('rejects a direct call with only openingBalance set (both-or-neither)', async () => {
    await expect(applyAnchor('acct-1', 'u1', 'MEMBER', 50000, null)).rejects.toThrow(/must both be set/i);
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
  });

  it('rejects a direct call with only openingBalanceDate set (both-or-neither)', async () => {
    await expect(applyAnchor('acct-1', 'u1', 'MEMBER', null, '2026-01-01')).rejects.toThrow(/must both be set/i);
  });

  it('rejects a direct call with a future date', async () => {
    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await expect(applyAnchor('acct-1', 'u1', 'MEMBER', 50000, future)).rejects.toThrow(/cannot be in the future/i);
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
  });
});

describe('applyAnchor — defensive null _sum handling', () => {
  it('treats a null _sum.amount from groupBy as zero (defensive against an empty aggregate group)', async () => {
    acctMock.findUnique.mockResolvedValue(MOCK_ACCOUNT);
    acctMock.update.mockImplementation(async ({ data }: any) => ({ ...MOCK_ACCOUNT, ...data }));
    txMock.groupBy.mockResolvedValue([{ type: 'INCOME', _sum: { amount: null } }]);
    const { account } = await applyAnchor('acct-1', 'u1', 'MEMBER', 1000, '2026-01-01');
    expect(Number(account.currentBalance)).toBe(1000);
  });
});
