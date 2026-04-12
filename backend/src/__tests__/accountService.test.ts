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

  it('ADMIN without userId: falls back to requesterId', async () => {
    acctMock.findMany.mockResolvedValue([]);
    await getAccounts('', 'admin-1', 'ADMIN'); // empty userId
    expect(acctMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'admin-1', isActive: true } }),
    );
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
