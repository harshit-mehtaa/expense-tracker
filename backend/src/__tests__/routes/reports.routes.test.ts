/**
 * Route integration tests for /api/reports.
 * Prisma and dashboardService are fully mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const ADMIN_USER = { userId: 'admin-id', email: 'admin@example.com', role: 'ADMIN' as const };
const MEMBER_USER = { userId: 'member-id', email: 'member@example.com', role: 'MEMBER' as const };

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = (req as any).__testUser ?? ADMIN_USER;
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../config/prisma', () => {
  const prisma = {
    user: { findFirst: vi.fn() },
    transaction: { groupBy: vi.fn(), findMany: vi.fn() },
    category: { findMany: vi.fn() },
  };
  return { default: prisma, prisma };
});

vi.mock('../../services/dashboardService', () => ({
  computeNetWorthStatement: vi.fn(),
  getProfitAndLoss: vi.fn(),
  getTrialBalance: vi.fn(),
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import reportsRouter from '../../routes/reports';
import { prisma } from '../../config/prisma';
import * as dashboardService from '../../services/dashboardService';
import { errorHandler } from '../../middleware/errorHandler';
import { makeApp } from '../helpers/makeApp';

const userFindFirstMock = (prisma as any).user.findFirst as ReturnType<typeof vi.fn>;
const txGroupByMock = (prisma as any).transaction.groupBy as ReturnType<typeof vi.fn>;
const txFindManyMock = (prisma as any).transaction.findMany as ReturnType<typeof vi.fn>;
const categoryFindManyMock = (prisma as any).category.findMany as ReturnType<typeof vi.fn>;
const computeNetWorthMock = dashboardService.computeNetWorthStatement as ReturnType<typeof vi.fn>;
const getPnLMock = dashboardService.getProfitAndLoss as ReturnType<typeof vi.fn>;
const getTBMock = dashboardService.getTrialBalance as ReturnType<typeof vi.fn>;

function makeAdminApp() {
  return makeApp(reportsRouter, '/api/reports');
}

function makeMemberApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((req: any, _res: any, next: any) => { req.__testUser = MEMBER_USER; next(); });
  app.use('/api/reports', reportsRouter);
  app.use(errorHandler);
  return app;
}

const MOCK_SPENDING = [{ categoryId: 'cat-1', _sum: { amount: 5000 } }];
const MOCK_CATEGORY = [{ id: 'cat-1', name: 'Food' }];
const MOCK_NET_WORTH = { assets: { bankBalances: 100000 }, liabilities: { loans: 50000 }, totalAssets: 100000, totalLiabilities: 50000, netWorth: 50000 };

beforeEach(() => {
  vi.clearAllMocks();
  txGroupByMock.mockResolvedValue(MOCK_SPENDING);
  txFindManyMock.mockResolvedValue([]);
  categoryFindManyMock.mockResolvedValue(MOCK_CATEGORY);
  computeNetWorthMock.mockResolvedValue(MOCK_NET_WORTH);
  getPnLMock.mockResolvedValue({ summary: {}, monthly: [], expenseCategories: [], incomeCategories: [] });
  getTBMock.mockResolvedValue({ fy: '2025-26', entries: [], totals: { totalDebits: 0, totalCredits: 0, netSavings: 0 } });
  userFindFirstMock.mockResolvedValue({ id: 'other-user-id' });
});

// ─── GET /api/reports/spending-by-category ────────────────────────────────────

describe('GET /api/reports/spending-by-category', () => {
  it('MEMBER — returns 200 with own spending (no userId filter override)', async () => {
    const res = await request(makeMemberApp()).get('/api/reports/spending-by-category?fy=2025-26');
    expect(res.status).toBe(200);
    // MEMBER: effectiveUserId = member-id; userFilter = { userId: 'member-id' }
    expect(txGroupByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'member-id' }),
      }),
    );
  });

  it('ADMIN without targetUserId — returns 200 family-wide (no userId filter)', async () => {
    const res = await request(makeAdminApp()).get('/api/reports/spending-by-category?fy=2025-26');
    expect(res.status).toBe(200);
    // ADMIN + no targetUserId: effectiveUserId = undefined; userFilter = {}
    const call = txGroupByMock.mock.calls[0][0];
    expect(call.where).not.toHaveProperty('userId');
  });

  it('ADMIN with valid targetUserId — returns 200 scoped to that user', async () => {
    const res = await request(makeAdminApp()).get(
      '/api/reports/spending-by-category?fy=2025-26&targetUserId=clm1234567890abcdefghij',
    );
    expect(res.status).toBe(200);
    expect(txGroupByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'clm1234567890abcdefghij' }),
      }),
    );
  });

  it('ADMIN with invalid targetUserId format — returns 400', async () => {
    const res = await request(makeAdminApp()).get(
      '/api/reports/spending-by-category?fy=2025-26&targetUserId=not-a-cuid',
    );
    expect(res.status).toBe(400);
  });

  it('ADMIN with non-existent targetUserId — returns 404', async () => {
    userFindFirstMock.mockResolvedValue(null);
    const res = await request(makeAdminApp()).get(
      '/api/reports/spending-by-category?fy=2025-26&targetUserId=clm1234567890abcdefghij',
    );
    expect(res.status).toBe(404);
  });

  it('merges the same category across members, then sorts the merged rows by name', async () => {
    // Two members spending on cat-z produce two distinct map keys ("u1:cat-z", "u2:cat-z")
    // that the reduce must fold into one row — and >= 2 resulting rows are what make
    // Array.prototype.sort actually invoke the compareCategoryNames comparator.
    txGroupByMock.mockResolvedValue([
      { userId: 'u1', categoryId: 'cat-z', _sum: { amount: 100 } },
      { userId: 'u2', categoryId: 'cat-z', _sum: { amount: 50 } },
      { userId: 'u1', categoryId: 'cat-a', _sum: { amount: 30 } },
    ]);
    categoryFindManyMock.mockResolvedValue([
      { id: 'cat-z', name: 'Zoo' },
      { id: 'cat-a', name: 'Apples' },
    ]);
    const res = await request(makeAdminApp()).get('/api/reports/spending-by-category?fy=2025-26');
    expect(res.status).toBe(200);
    expect(res.body.data.map((d: any) => d.categoryId)).toEqual(['cat-a', 'cat-z']);
    expect(res.body.data.find((d: any) => d.categoryId === 'cat-z').total).toBe(150);
  });

  it('labels a null-category row "Uncategorized" and sorts it accordingly', async () => {
    // A null categoryId yields the map key "u1:", whose split(':')[1] is '' → null.
    txGroupByMock.mockResolvedValue([
      { userId: 'u1', categoryId: null, _sum: { amount: 10 } },
      { userId: 'u1', categoryId: 'cat-a', _sum: { amount: 30 } },
    ]);
    categoryFindManyMock.mockResolvedValue([{ id: 'cat-a', name: 'Apples' }]);
    const res = await request(makeAdminApp()).get('/api/reports/spending-by-category?fy=2025-26');
    expect(res.status).toBe(200);
    // 'Apples' < 'Uncategorized', so the null row sorts last and carries a null category
    expect(res.body.data.map((d: any) => d.categoryId)).toEqual(['cat-a', null]);
    expect(res.body.data[1].category).toBeNull();
  });

  it('applies the "Uncategorized" fallback on the left side of the comparison', async () => {
    // Rows are pre-sorted by total descending before the name sort, so giving the
    // null-category row the LARGER total is what puts it in the comparator's `a`
    // position. Ordering the mock differently is not enough — the total sort
    // normalises that away, leaving this arm unvisited.
    txGroupByMock.mockResolvedValue([
      { userId: 'u1', categoryId: 'cat-a', _sum: { amount: 30 } },
      { userId: 'u1', categoryId: null, _sum: { amount: 100 } },
    ]);
    categoryFindManyMock.mockResolvedValue([{ id: 'cat-a', name: 'Apples' }]);
    const res = await request(makeAdminApp()).get('/api/reports/spending-by-category?fy=2025-26');
    expect(res.status).toBe(200);
    // 'Apples' still sorts before 'Uncategorized' despite the larger total
    expect(res.body.data.map((d: any) => d.categoryId)).toEqual(['cat-a', null]);
  });

  it('falls back to "Uncategorized" when the joined category row has no name', async () => {
    txGroupByMock.mockResolvedValue([
      { userId: 'u1', categoryId: 'cat-a', _sum: { amount: 30 } },
      { userId: 'u1', categoryId: 'cat-x', _sum: { amount: 10 } },
    ]);
    categoryFindManyMock.mockResolvedValue([
      { id: 'cat-a', name: 'Apples' },
      { id: 'cat-x', name: null },
    ]);
    const res = await request(makeAdminApp()).get('/api/reports/spending-by-category?fy=2025-26');
    expect(res.status).toBe(200);
    expect(res.body.data.map((d: any) => d.categoryId)).toEqual(['cat-a', 'cat-x']);
  });

  it('MEMBER cannot override with targetUserId — still gets own data', async () => {
    const res = await request(makeMemberApp()).get(
      '/api/reports/spending-by-category?fy=2025-26&targetUserId=clm1234567890abcdefghij',
    );
    expect(res.status).toBe(200);
    // MEMBER: resolveTargetUserId returns undefined; effectiveUserId = member-id
    expect(txGroupByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'member-id' }),
      }),
    );
  });

  it('handles null categoryId and null _sum.amount gracefully', async () => {
    txGroupByMock.mockResolvedValue([{ categoryId: null, _sum: { amount: null } }]);
    categoryFindManyMock.mockResolvedValue([]);
    const res = await request(makeAdminApp()).get('/api/reports/spending-by-category?fy=2025-26');
    expect(res.status).toBe(200);
    const item = res.body.data[0];
    expect(item.category).toBeNull();
    expect(item.total).toBe(0);
  });
});

// ─── GET /api/reports/net-worth-statement ─────────────────────────────────────

describe('GET /api/reports/net-worth-statement', () => {
  it('MEMBER — returns 200 with own net worth', async () => {
    const res = await request(makeMemberApp()).get('/api/reports/net-worth-statement');
    expect(res.status).toBe(200);
    // MEMBER: effectiveUserId = 'member-id'
    expect(computeNetWorthMock).toHaveBeenCalledWith('member-id');
  });

  it('ADMIN without targetUserId — returns 200 family-wide (undefined)', async () => {
    const res = await request(makeAdminApp()).get('/api/reports/net-worth-statement');
    expect(res.status).toBe(200);
    // ADMIN + no targetUserId: effectiveUserId = undefined → family aggregate
    expect(computeNetWorthMock).toHaveBeenCalledWith(undefined);
  });

  it('ADMIN with valid targetUserId — returns 200 scoped to that user', async () => {
    const res = await request(makeAdminApp()).get(
      '/api/reports/net-worth-statement?targetUserId=clm1234567890abcdefghij',
    );
    expect(res.status).toBe(200);
    expect(computeNetWorthMock).toHaveBeenCalledWith('clm1234567890abcdefghij');
  });

  it('ADMIN with invalid targetUserId format — returns 400', async () => {
    const res = await request(makeAdminApp()).get(
      '/api/reports/net-worth-statement?targetUserId=not-a-cuid',
    );
    expect(res.status).toBe(400);
  });

  it('ADMIN with non-existent targetUserId — returns 404', async () => {
    userFindFirstMock.mockResolvedValue(null);
    const res = await request(makeAdminApp()).get(
      '/api/reports/net-worth-statement?targetUserId=clm1234567890abcdefghij',
    );
    expect(res.status).toBe(404);
  });

  it('MEMBER cannot override with targetUserId — still gets own data', async () => {
    const res = await request(makeMemberApp()).get(
      '/api/reports/net-worth-statement?targetUserId=clm1234567890abcdefghij',
    );
    expect(res.status).toBe(200);
    expect(computeNetWorthMock).toHaveBeenCalledWith('member-id');
  });
});

// ─── GET /api/reports/profit-and-loss ────────────────────────────────────────

describe('GET /api/reports/profit-and-loss', () => {
  it('MEMBER — returns 200 with own data (no targetUserId passed to service)', async () => {
    const res = await request(makeMemberApp()).get('/api/reports/profit-and-loss?fy=2025-26');
    expect(res.status).toBe(200);
    expect(getPnLMock).toHaveBeenCalledWith('member-id', 'MEMBER', expect.any(String), undefined);
  });

  it('MEMBER cannot override with targetUserId — service called with undefined targetUserId', async () => {
    const res = await request(makeMemberApp()).get(
      '/api/reports/profit-and-loss?fy=2025-26&targetUserId=clm1234567890abcdefghij',
    );
    expect(res.status).toBe(200);
    expect(getPnLMock).toHaveBeenCalledWith('member-id', 'MEMBER', expect.any(String), undefined);
  });

  it('ADMIN without targetUserId — returns 200 family-wide', async () => {
    const res = await request(makeAdminApp()).get('/api/reports/profit-and-loss?fy=2025-26');
    expect(res.status).toBe(200);
    expect(getPnLMock).toHaveBeenCalledWith('admin-id', 'ADMIN', expect.any(String), undefined);
  });

  it('ADMIN with valid targetUserId — scoped to that user', async () => {
    const res = await request(makeAdminApp()).get(
      '/api/reports/profit-and-loss?fy=2025-26&targetUserId=clm1234567890abcdefghij',
    );
    expect(res.status).toBe(200);
    expect(getPnLMock).toHaveBeenCalledWith(
      'admin-id', 'ADMIN', expect.any(String), 'clm1234567890abcdefghij',
    );
  });

  it('returns 400 for invalid targetUserId format', async () => {
    const res = await request(makeAdminApp()).get(
      '/api/reports/profit-and-loss?fy=2025-26&targetUserId=not-a-cuid',
    );
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/reports/trial-balance ──────────────────────────────────────────

describe('GET /api/reports/trial-balance', () => {
  it('MEMBER — returns 200, service called with memberId, MEMBER role, undefined targetUserId', async () => {
    const res = await request(makeMemberApp()).get('/api/reports/trial-balance?fy=2025-26');
    expect(res.status).toBe(200);
    expect(getTBMock).toHaveBeenCalledWith('member-id', 'MEMBER', expect.any(String), undefined);
  });

  it('MEMBER cannot override with targetUserId — service still called with undefined targetUserId', async () => {
    const res = await request(makeMemberApp()).get(
      '/api/reports/trial-balance?fy=2025-26&targetUserId=clm1234567890abcdefghij',
    );
    expect(res.status).toBe(200);
    expect(getTBMock).toHaveBeenCalledWith('member-id', 'MEMBER', expect.any(String), undefined);
  });

  it('ADMIN without targetUserId — returns 200 family-wide', async () => {
    const res = await request(makeAdminApp()).get('/api/reports/trial-balance?fy=2025-26');
    expect(res.status).toBe(200);
    expect(getTBMock).toHaveBeenCalledWith('admin-id', 'ADMIN', expect.any(String), undefined);
  });

  it('ADMIN with valid targetUserId — scoped to that user', async () => {
    const res = await request(makeAdminApp()).get(
      '/api/reports/trial-balance?fy=2025-26&targetUserId=clm1234567890abcdefghij',
    );
    expect(res.status).toBe(200);
    expect(getTBMock).toHaveBeenCalledWith(
      'admin-id', 'ADMIN', expect.any(String), 'clm1234567890abcdefghij',
    );
  });

  it('returns 400 for invalid targetUserId format', async () => {
    const res = await request(makeAdminApp()).get(
      '/api/reports/trial-balance?fy=2025-26&targetUserId=not-a-cuid',
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent targetUserId', async () => {
    userFindFirstMock.mockResolvedValue(null);
    const res = await request(makeAdminApp()).get(
      '/api/reports/trial-balance?fy=2025-26&targetUserId=clm1234567890abcdefghij',
    );
    expect(res.status).toBe(404);
  });

  it('invalid fy param falls back to current FY without 400', async () => {
    const res = await request(makeAdminApp()).get('/api/reports/trial-balance?fy=invalid-fy');
    expect(res.status).toBe(200);
  });
});
