/**
 * Route integration tests for /api/categories.
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
  };
  return { default: prisma, prisma };
});

import categoriesRouter from '../../routes/categories';
import { prisma } from '../../config/prisma';
import { makeApp } from '../helpers/makeApp';

const catMock = (prisma as any).category;
const app = makeApp(categoriesRouter, '/api/categories');

const MOCK_CAT = { id: 'cat-1', name: 'Food', type: 'EXPENSE', userId: 'u1' };

beforeEach(() => {
  vi.clearAllMocks();
  catMock.findMany.mockResolvedValue([MOCK_CAT]);
  catMock.create.mockResolvedValue({ ...MOCK_CAT, id: 'cat-new' });
  catMock.findFirst.mockResolvedValue(MOCK_CAT);
  catMock.update.mockResolvedValue(MOCK_CAT);
  catMock.delete.mockResolvedValue(MOCK_CAT);
});

describe('GET /api/categories', () => {
  it('returns 200 with categories list', async () => {
    const res = await request(app).get('/api/categories');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(catMock.findMany).toHaveBeenCalled();
  });
});

describe('POST /api/categories', () => {
  it('returns 201 on valid category creation', async () => {
    const res = await request(app).post('/api/categories').send({ name: 'Food', type: 'EXPENSE' });
    expect(res.status).toBe(201);
    expect(catMock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'Food', type: 'EXPENSE', userId: 'u1' }),
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
});

describe('PUT /api/categories/:id', () => {
  it('returns 200 on valid update', async () => {
    const res = await request(app).put('/api/categories/cat-1').send({ name: 'Dining' });
    expect(res.status).toBe(200);
    expect(catMock.update).toHaveBeenCalled();
  });

  it('returns 404 when category not found', async () => {
    catMock.findFirst.mockResolvedValue(null);
    const res = await request(app).put('/api/categories/nonexistent').send({ name: 'X' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/categories/:id', () => {
  it('returns 204 on deletion', async () => {
    const res = await request(app).delete('/api/categories/cat-1');
    expect(res.status).toBe(204);
  });

  it('returns 404 when category not found', async () => {
    catMock.findFirst.mockResolvedValue(null);
    const res = await request(app).delete('/api/categories/nonexistent');
    expect(res.status).toBe(404);
  });
});
