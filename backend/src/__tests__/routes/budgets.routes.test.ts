/**
 * Route integration tests for /api/budgets.
 * budgets.ts uses prisma directly (no service layer).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const MEMBER_USER = { userId: 'u1', email: 'a@b.com', role: 'MEMBER' as const };
const ADMIN_USER = { userId: 'admin-1', email: 'admin@b.com', role: 'ADMIN' as const };

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = (req as any).__testUser ?? MEMBER_USER;
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../config/prisma', () => {
  const prisma = {
    budget: {
      findMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    transaction: { groupBy: vi.fn() },
    user: { findFirst: vi.fn() },
  };
  return { default: prisma, prisma };
});

import budgetsRouter from '../../routes/budgets';
import { prisma } from '../../config/prisma';
import { makeApp } from '../helpers/makeApp';
import express from 'express';
import { errorHandler } from '../../middleware/errorHandler';

const budgetMock = (prisma as any).budget;
const txMock = (prisma as any).transaction;
const userMock = (prisma as any).user;
const app = makeApp(budgetsRouter, '/api/budgets');

/** Creates app with ADMIN user injected via __testUser */
function makeAdminApp() {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res: any, next: any) => { req.__testUser = ADMIN_USER; next(); });
  a.use('/api/budgets', budgetsRouter);
  a.use(errorHandler);
  return a;
}

const MOCK_BUDGET = {
  id: 'bud-1',
  userId: 'u1',
  categoryId: 'cat-1',
  amount: 5000,
  period: 'MONTHLY',
  fyYear: null,
  category: { id: 'cat-1', name: 'Food', color: null, icon: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  budgetMock.findMany.mockResolvedValue([MOCK_BUDGET]);
  budgetMock.create.mockResolvedValue({ ...MOCK_BUDGET, id: 'bud-new' });
  budgetMock.findFirst.mockResolvedValue(MOCK_BUDGET);
  budgetMock.update.mockResolvedValue(MOCK_BUDGET);
  budgetMock.delete.mockResolvedValue(MOCK_BUDGET);
  txMock.groupBy.mockResolvedValue([]);
  userMock.findFirst.mockResolvedValue({ id: 'u2' }); // default: user found
});

describe('GET /api/budgets', () => {
  it('returns 200 with budgets list', async () => {
    const res = await request(app).get('/api/budgets');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('GET /api/budgets/vs-actuals', () => {
  it('returns 200 with budget vs actuals data', async () => {
    const res = await request(app).get('/api/budgets/vs-actuals?fy=2025-26');
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toHaveProperty('actual');
    expect(res.body.data[0]).toHaveProperty('remaining');
    expect(res.body.data[0]).toHaveProperty('pctUsed');
  });

  it('computes pctUsed as 0 when no actuals', async () => {
    txMock.groupBy.mockResolvedValue([]);
    const res = await request(app).get('/api/budgets/vs-actuals?fy=2025-26');
    expect(res.body.data[0].pctUsed).toBe(0);
  });

  it('skips null categoryId entries when building actualsMap', async () => {
    // actuals entry with categoryId: null must not crash (null-guard: a.categoryId check in forEach)
    txMock.groupBy.mockResolvedValue([
      { categoryId: null, _sum: { amount: 500 } },
      { categoryId: 'cat-1', _sum: { amount: 3000 } },
    ]);
    const res = await request(app).get('/api/budgets/vs-actuals?fy=2025-26');
    expect(res.status).toBe(200);
    // The budget for cat-1 should show 3000 actual
    expect(res.body.data[0].actual).toBe(3000);
  });

  // ─── ADMIN targetUserId paths ─────────────────────────────────────────────

  it('ADMIN with invalid targetUserId format — returns 400', async () => {
    const res = await request(makeAdminApp()).get('/api/budgets/vs-actuals?targetUserId=bad!!id');
    expect(res.status).toBe(400);
  });

  it('ADMIN with valid CUID but user not found — returns 404', async () => {
    userMock.findFirst.mockResolvedValue(null);
    const res = await request(makeAdminApp()).get('/api/budgets/vs-actuals?targetUserId=clm1234567890abcdefghij');
    expect(res.status).toBe(404);
  });

  it('ADMIN with valid CUID and user found — returns 200 scoped to that user', async () => {
    const res = await request(makeAdminApp()).get('/api/budgets/vs-actuals?targetUserId=clm1234567890abcdefghij');
    expect(res.status).toBe(200);
    expect(budgetMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'clm1234567890abcdefghij' } }),
    );
  });

  it('ADMIN with no targetUserId — family-wide query (no userId filter)', async () => {
    budgetMock.findMany.mockResolvedValue([]);
    const res = await request(makeAdminApp()).get('/api/budgets/vs-actuals?fy=2025-26');
    expect(res.status).toBe(200);
    // family-wide: findMany called without userId constraint
    expect(budgetMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });
});

describe('POST /api/budgets', () => {
  it('returns 201 on valid budget', async () => {
    const res = await request(app).post('/api/budgets').send({
      categoryId: 'cat-1',
      amount: 5000,
      period: 'MONTHLY',
    });
    expect(res.status).toBe(201);
  });

  it('returns 422 when amount is non-positive', async () => {
    const res = await request(app).post('/api/budgets').send({
      categoryId: 'cat-1',
      amount: 0,
      period: 'MONTHLY',
    });
    expect(res.status).toBe(422);
  });
});

describe('PUT /api/budgets/:id', () => {
  it('returns 200 on valid update', async () => {
    const res = await request(app).put('/api/budgets/bud-1').send({ amount: 6000 });
    expect(res.status).toBe(200);
    expect(budgetMock.update).toHaveBeenCalled();
  });

  it('returns 404 when budget not found', async () => {
    budgetMock.findFirst.mockResolvedValue(null);
    const res = await request(app).put('/api/budgets/nonexistent').send({ amount: 6000 });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/budgets/:id', () => {
  it('returns 204 on deletion', async () => {
    const res = await request(app).delete('/api/budgets/bud-1');
    expect(res.status).toBe(204);
    expect(budgetMock.delete).toHaveBeenCalled();
  });

  it('returns 404 when budget not found', async () => {
    budgetMock.findFirst.mockResolvedValue(null);
    const res = await request(app).delete('/api/budgets/nonexistent');
    expect(res.status).toBe(404);
  });
});
