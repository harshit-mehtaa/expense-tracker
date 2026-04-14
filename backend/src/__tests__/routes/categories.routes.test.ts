/**
 * Route integration tests for /api/categories.
 * All categories are family-shared (userId: null); no per-user scoping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'u1', email: 'a@b.com', role: 'MEMBER' };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../config/prisma', () => {
  const prisma = {
    category: {
      findMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    budget: {
      count: vi.fn(),
    },
  };
  return { default: prisma, prisma };
});

import categoriesRouter from '../../routes/categories';
import { prisma } from '../../config/prisma';
import { makeApp } from '../helpers/makeApp';

const catMock = (prisma as any).category;
const budgetMock = (prisma as any).budget;
const app = makeApp(categoriesRouter, '/api/categories');

const MOCK_CAT = { id: 'cat-1', name: 'Food', type: 'EXPENSE', userId: null, isDefault: false };
const DEFAULT_CAT = { id: 'cat-default', name: 'Salary', type: 'INCOME', userId: null, isDefault: true };

beforeEach(() => {
  vi.clearAllMocks();
  catMock.findMany.mockResolvedValue([MOCK_CAT]);
  catMock.create.mockResolvedValue({ ...MOCK_CAT, id: 'cat-new' });
  catMock.findFirst.mockResolvedValue(MOCK_CAT);
  catMock.update.mockResolvedValue(MOCK_CAT);
  catMock.delete.mockResolvedValue(MOCK_CAT);
  budgetMock.count.mockResolvedValue(0);
});

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET /api/categories', () => {
  it('returns 200 with family-shared categories list', async () => {
    const res = await request(app).get('/api/categories');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(catMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: null } }),
    );
  });
});

// ── POST ──────────────────────────────────────────────────────────────────────

describe('POST /api/categories', () => {
  it('returns 201 and creates category with userId: null (family-shared)', async () => {
    const res = await request(app).post('/api/categories').send({ name: 'Food', type: 'EXPENSE' });
    expect(res.status).toBe(201);
    expect(catMock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'Food', type: 'EXPENSE', userId: null, isDefault: false }),
    });
  });

  it('returns 422 when name is empty', async () => {
    const res = await request(app).post('/api/categories').send({ name: '', type: 'EXPENSE' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when type is invalid', async () => {
    const res = await request(app).post('/api/categories').send({ name: 'Food', type: 'INVALID' });
    expect(res.status).toBe(422);
  });

  it('returns 409 when duplicate name+type already exists (P2002)', async () => {
    const { Prisma } = await import('@prisma/client');
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.x',
    });
    catMock.create.mockRejectedValue(p2002);
    const res = await request(app).post('/api/categories').send({ name: 'Groceries', type: 'EXPENSE' });
    expect(res.status).toBe(409);
  });
});

// ── PUT ───────────────────────────────────────────────────────────────────────

describe('PUT /api/categories/:id', () => {
  it('returns 200 on valid update of non-default category', async () => {
    const res = await request(app).put('/api/categories/cat-1').send({ name: 'Dining' });
    expect(res.status).toBe(200);
    expect(catMock.update).toHaveBeenCalled();
  });

  it('returns 404 when category not found', async () => {
    catMock.findFirst.mockResolvedValue(null);
    const res = await request(app).put('/api/categories/nonexistent').send({ name: 'X' });
    expect(res.status).toBe(404);
  });

  it('returns 403 when attempting to edit a default category', async () => {
    catMock.findFirst.mockResolvedValue(DEFAULT_CAT);
    const res = await request(app).put('/api/categories/cat-default').send({ name: 'NewName' });
    expect(res.status).toBe(403);
  });
});

// ── DELETE ────────────────────────────────────────────────────────────────────

describe('DELETE /api/categories/:id', () => {
  it('returns 204 on successful deletion of non-default category', async () => {
    const res = await request(app).delete('/api/categories/cat-1');
    expect(res.status).toBe(204);
  });

  it('returns 404 when category not found', async () => {
    catMock.findFirst.mockResolvedValue(null);
    const res = await request(app).delete('/api/categories/nonexistent');
    expect(res.status).toBe(404);
  });

  it('returns 403 when attempting to delete a default category', async () => {
    catMock.findFirst.mockResolvedValue(DEFAULT_CAT);
    const res = await request(app).delete('/api/categories/cat-default');
    expect(res.status).toBe(403);
  });

  it('returns 409 when category is used by one or more budgets', async () => {
    budgetMock.count.mockResolvedValue(2);
    const res = await request(app).delete('/api/categories/cat-1');
    expect(res.status).toBe(409);
  });
});
