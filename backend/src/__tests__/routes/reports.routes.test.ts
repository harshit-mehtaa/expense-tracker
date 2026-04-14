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
    transaction: { groupBy: vi.fn() },
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
