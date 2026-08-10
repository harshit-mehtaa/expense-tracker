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
      create: vi.fn(),
      update: vi.fn(),
    },
    transaction: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return { default: mockPrisma, prisma: mockPrisma };
});

import prisma from '../config/prisma';
import {
  getAccounts,
  getAccountById,
  createAccount,
  updateAccount,
  reconcileAccount,
  deleteAccount,
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
  acctMock.update.mockResolvedValue(MOCK_ACCOUNT);
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
});
