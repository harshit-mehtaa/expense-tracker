/**
 * Tests for transactionService filter logic and buildImportHash.
 *
 * Prisma is fully mocked — these tests verify the WHERE clause construction,
 * not the database behavior. The mock shape matches the module export:
 *   prisma (default export from '../config/prisma') is the PrismaClient instance.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildImportHash, getTransactions } from '../services/transactionService';

// Mock the Prisma singleton (default export from ../config/prisma)
vi.mock('../config/prisma', () => {
  const prisma = {
    transaction: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  return { default: prisma, prisma };
});

// Import the mock after vi.mock is registered
import prisma from '../config/prisma';

const countMock = prisma.transaction.count as ReturnType<typeof vi.fn>;
const findManyMock = prisma.transaction.findMany as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  countMock.mockResolvedValue(0);
  findManyMock.mockResolvedValue([]);
});

// Helper to capture the `where` argument passed to findMany
async function getWhere(
  requesterId: string,
  role: string,
  filters: Parameters<typeof getTransactions>[2],
) {
  await getTransactions(requesterId, role, filters);
  const call = findManyMock.mock.calls[0]?.[0];
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
    const where = await getWhere('user-1', 'MEMBER', {
      categoryIds: ['cat-1', 'cat-2'],
    });
    expect(where.categoryId).toEqual({ in: ['cat-1', 'cat-2'] });
  });

  it('uses scalar string for singular categoryId', async () => {
    const where = await getWhere('user-1', 'MEMBER', { categoryId: 'cat-1' });
    expect(where.categoryId).toBe('cat-1');
  });

  it('categoryIds array takes precedence over singular categoryId', async () => {
    const where = await getWhere('user-1', 'MEMBER', {
      categoryIds: ['cat-1'],
      categoryId: 'cat-2',
    });
    expect(where.categoryId).toEqual({ in: ['cat-1'] });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Multi-value paymentMode filter
// ─────────────────────────────────────────────────────────────────────────────

describe('getTransactions — paymentMode filter', () => {
  it('uses { in: [...] } for paymentModes array', async () => {
    const where = await getWhere('user-1', 'MEMBER', {
      paymentModes: ['UPI', 'CASH'],
    });
    expect(where.paymentMode).toEqual({ in: ['UPI', 'CASH'] });
  });

  it('uses scalar string for singular paymentMode', async () => {
    const where = await getWhere('user-1', 'MEMBER', { paymentMode: 'UPI' });
    expect(where.paymentMode).toBe('UPI');
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
    // Should use FY range, not explicit dates
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
    const where = await getWhere('user-1', 'MEMBER', {
      minAmount: 1000,
      maxAmount: 50000,
    });
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
