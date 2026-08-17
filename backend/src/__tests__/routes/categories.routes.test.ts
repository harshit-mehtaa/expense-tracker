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
      findFirstOrThrow: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    budget: {
      count: vi.fn(),
      updateMany: vi.fn(),
    },
    // The logic moved into categoryService, which reaches further: usage figures, the
    // dependency counts behind safe delete, and the four tables a merge moves.
    transaction: { groupBy: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
    categoryRule: { count: vi.fn(), updateMany: vi.fn() },
    recurringRule: { count: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
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
  // Nothing uses any category unless a test says so, and $transaction runs inline.
  (prisma as any).transaction.groupBy.mockResolvedValue([]);
  (prisma as any).transaction.count.mockResolvedValue(0);
  (prisma as any).categoryRule.count.mockResolvedValue(0);
  (prisma as any).recurringRule.count.mockResolvedValue(0);
  (prisma as any).$transaction.mockImplementation(async (fn: any) => fn(prisma));
  catMock.findMany.mockResolvedValue([MOCK_CAT]);
  catMock.create.mockResolvedValue({ ...MOCK_CAT, id: 'cat-new' });
  catMock.findFirst.mockResolvedValue(MOCK_CAT);
  catMock.count.mockResolvedValue(0);
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

  it('assigns a default icon when one is not provided', async () => {
    const res = await request(app).post('/api/categories').send({ name: 'Salon', type: 'EXPENSE' });
    expect(res.status).toBe(201);
    expect(catMock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'Salon', type: 'EXPENSE', icon: '💇' }),
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

  it('accepts emoji icons', async () => {
    const res = await request(app)
      .post('/api/categories')
      .send({ name: 'Groceries', type: 'EXPENSE', icon: '🛒' });

    expect(res.status).toBe(201);
    expect(catMock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'Groceries', type: 'EXPENSE', icon: '🛒' }),
    });
  });

  it('creates a child category under a same-type parent', async () => {
    catMock.findFirst.mockResolvedValueOnce({ id: 'cmparentcategory0000000001', type: 'EXPENSE', parentId: null });

    const res = await request(app)
      .post('/api/categories')
      .send({ name: 'Netflix', type: 'EXPENSE', parentId: 'cmparentcategory0000000001' });

    expect(res.status).toBe(201);
    expect(catMock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Netflix',
        type: 'EXPENSE',
        parentId: 'cmparentcategory0000000001',
      }),
    });
  });

  it('rejects child category when parent type differs', async () => {
    catMock.findFirst.mockResolvedValueOnce({ id: 'cmparentcategory0000000001', type: 'INCOME', parentId: null });

    const res = await request(app)
      .post('/api/categories')
      .send({ name: 'Netflix', type: 'EXPENSE', parentId: 'cmparentcategory0000000001' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('same type');
  });

  it('uses a default icon when create receives a blank icon', async () => {
    const res = await request(app)
      .post('/api/categories')
      .send({ name: 'Groceries', type: 'EXPENSE', icon: '   ' });

    expect(res.status).toBe(201);
    expect(catMock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ icon: '🛒' }),
    });
  });

  it('transforms empty string color to undefined (strips the field)', async () => {
    const res = await request(app).post('/api/categories').send({ name: 'Food', type: 'EXPENSE', color: '' });
    expect(res.status).toBe(201);
    // color: '' is stripped by the schema transform (z.literal('').transform → undefined)
    expect(catMock.create).toHaveBeenCalledWith({
      data: expect.not.objectContaining({ color: '' }),
    });
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

  it('re-throws non-P2002 errors as 500', async () => {
    catMock.create.mockRejectedValue(new Error('DB connection lost'));
    const res = await request(app).post('/api/categories').send({ name: 'Test', type: 'EXPENSE' });
    expect(res.status).toBe(500);
  });
});

// ── PUT ───────────────────────────────────────────────────────────────────────

describe('PUT /api/categories/:id', () => {
  it('returns 200 on valid update of non-default category', async () => {
    const res = await request(app).put('/api/categories/cat-1').send({ name: 'Dining' });
    expect(res.status).toBe(200);
    expect(catMock.update).toHaveBeenCalled();
  });

  it('updates emoji icon', async () => {
    const res = await request(app).put('/api/categories/cat-1').send({ icon: '🧾' });
    expect(res.status).toBe(200);
    expect(catMock.update).toHaveBeenCalledWith({
      where: { id: 'cat-1' },
      data: expect.objectContaining({ icon: '🧾' }),
    });
  });

  it('clears emoji icon when empty string is sent', async () => {
    const res = await request(app).put('/api/categories/cat-1').send({ icon: '' });
    expect(res.status).toBe(200);
    expect(catMock.update).toHaveBeenCalledWith({
      where: { id: 'cat-1' },
      data: expect.objectContaining({ icon: null }),
    });
  });

  it('updates parent category', async () => {
    catMock.findFirst
      .mockResolvedValueOnce(MOCK_CAT)
      .mockResolvedValueOnce({ id: 'cmparentcategory0000000001', type: 'EXPENSE', parentId: null });

    const res = await request(app)
      .put('/api/categories/cat-1')
      .send({ parentId: 'cmparentcategory0000000001' });

    expect(res.status).toBe(200);
    expect(catMock.update).toHaveBeenCalledWith({
      where: { id: 'cat-1' },
      data: expect.objectContaining({ parentId: 'cmparentcategory0000000001' }),
    });
  });

  it('detaches the parent when parentId is sent as an empty string', async () => {
    // The zod schema coerces '' → null, which also makes validateParentCategory
    // return early instead of looking up a parent.
    const res = await request(app).put('/api/categories/cat-1').send({ parentId: '' });
    expect(res.status).toBe(200);
    expect(catMock.update).toHaveBeenCalledWith({
      where: { id: 'cat-1' },
      data: expect.objectContaining({ parentId: null }),
    });
  });

  it('rejects a parentId that does not resolve to a family category', async () => {
    catMock.findFirst
      .mockResolvedValueOnce(MOCK_CAT)   // the category being updated
      .mockResolvedValueOnce(null);      // the parent lookup misses
    const res = await request(app)
      .put('/api/categories/cat-1')
      .send({ parentId: 'cmparentcategory0000000001' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/parent category not found/i);
  });

  it('rejects moving a category underneath its own sub-category', async () => {
    // Walking up from the proposed parent reaches cat-1 itself, which would create a cycle.
    catMock.findFirst
      .mockResolvedValueOnce(MOCK_CAT)                                                              // target
      .mockResolvedValueOnce({ id: 'cmchildcategory00000000001', type: 'EXPENSE', parentId: 'cat-1' }); // proposed parent
    const res = await request(app)
      .put('/api/categories/cat-1')
      .send({ parentId: 'cmchildcategory00000000001' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/own sub-category/i);
  });

  it('walks the full ancestor chain before accepting a deep re-parent', async () => {
    // grandchild -> child -> (null): no ancestor is cat-1, so the loop runs and exits cleanly.
    catMock.findFirst
      .mockResolvedValueOnce(MOCK_CAT)
      .mockResolvedValueOnce({ id: 'cmgrandchild000000000001', type: 'EXPENSE', parentId: 'cmmid00000000000000000001' })
      .mockResolvedValueOnce({ id: 'cmmid00000000000000000001', type: 'EXPENSE', parentId: null });
    const res = await request(app)
      .put('/api/categories/cat-1')
      .send({ parentId: 'cmgrandchild000000000001' });
    expect(res.status).toBe(200);
    expect(catMock.findFirst).toHaveBeenCalledTimes(3);
  });

  it('rejects a type change while the category still has sub-categories', async () => {
    catMock.count.mockResolvedValue(2);
    const res = await request(app).put('/api/categories/cat-1').send({ type: 'INCOME' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/while it has sub-categories/i);
  });

  it('allows a type change when the category has no sub-categories', async () => {
    catMock.count.mockResolvedValue(0);
    const res = await request(app).put('/api/categories/cat-1').send({ type: 'INCOME' });
    expect(res.status).toBe(200);
    expect(catMock.update).toHaveBeenCalledWith({
      where: { id: 'cat-1' },
      data: expect.objectContaining({ type: 'INCOME' }),
    });
  });

  it('rejects moving category under itself', async () => {
    const id = 'cmolduqjx003i9vmqbwslrvh7';
    catMock.findFirst.mockResolvedValueOnce({ ...MOCK_CAT, id });
    const res = await request(app).put(`/api/categories/${id}`).send({ parentId: id });
    expect(res.status).toBe(400);
  });

  it('returns 404 when category not found', async () => {
    catMock.findFirst.mockResolvedValue(null);
    const res = await request(app).put('/api/categories/nonexistent').send({ name: 'X' });
    expect(res.status).toBe(404);
  });

  it('returns 200 when renaming a default category (only type changes are blocked)', async () => {
    catMock.findFirst.mockResolvedValue(DEFAULT_CAT);
    const res = await request(app).put('/api/categories/cat-default').send({ name: 'NewName' });
    expect(res.status).toBe(200);
  });

  it('returns 400 when attempting to change the type of a default category', async () => {
    catMock.findFirst.mockResolvedValue(DEFAULT_CAT);
    const res = await request(app).put('/api/categories/cat-default').send({ type: 'EXPENSE' });
    expect(res.status).toBe(400);
  });

  it('returns 409 when update causes a duplicate name+type conflict (P2002)', async () => {
    const { Prisma } = await import('@prisma/client');
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.x',
    });
    catMock.update.mockRejectedValue(p2002);
    const res = await request(app).put('/api/categories/cat-1').send({ name: 'Salary' });
    expect(res.status).toBe(409);
  });

  it('re-throws non-P2002 errors from update as 500', async () => {
    catMock.update.mockRejectedValue(new Error('DB timeout'));
    const res = await request(app).put('/api/categories/cat-1').send({ name: 'Dining' });
    expect(res.status).toBe(500);
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

  it('returns 409 when category is used by multiple budgets (plural message)', async () => {
    budgetMock.count.mockResolvedValue(2);
    const res = await request(app).delete('/api/categories/cat-1');
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('2 budgets');
  });

  it('returns 409 when category has child categories', async () => {
    catMock.count.mockResolvedValueOnce(2);
    const res = await request(app).delete('/api/categories/cat-1');
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('sub-categories');
  });

  it('returns 409 with singular "budget" (not "1 budgets") when only one budget uses it', async () => {
    budgetMock.count.mockResolvedValue(1);
    const res = await request(app).delete('/api/categories/cat-1');
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('1 budget');
    expect(res.body.message).not.toContain('1 budgets');
  });

  it('returns 409 with singular "sub-category" when exactly one child exists', async () => {
    catMock.count.mockResolvedValueOnce(1);
    const res = await request(app).delete('/api/categories/cat-1');
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('1 sub-category');
    expect(res.body.message).not.toContain('sub-categories');
  });
});

describe('POST /api/categories/:id/merge', () => {
  it('folds one category into another and returns the survivor', async () => {
    const cat = (prisma as any).category;
    cat.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(where.id === 'clxsource0000000000000000'
        ? { id: 'clxsource0000000000000000', type: 'EXPENSE', isDefault: false, userId: null, parentId: null }
        : { id: 'clxtarget0000000000000000', type: 'EXPENSE', isDefault: false, userId: null, parentId: null }));
    cat.findFirstOrThrow.mockResolvedValue({ id: 'clxtarget0000000000000000', name: 'Kept' });

    const res = await request(app)
      .post('/api/categories/clxsource0000000000000000/merge')
      .send({ targetId: 'clxtarget0000000000000000' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Kept');
  });

  it('rejects a target that is not a cuid', async () => {
    const res = await request(app)
      .post('/api/categories/clxsource0000000000000000/merge')
      .send({ targetId: 'not-an-id' });

    expect(res.status).toBe(422);
  });
});

describe('GET /api/categories/:id/dependencies', () => {
  it('reports what points at the category', async () => {
    (prisma as any).category.count.mockResolvedValue(1);
    (prisma as any).transaction.count.mockResolvedValue(2);
    (prisma as any).budget.count.mockResolvedValue(0);

    const res = await request(app).get('/api/categories/c1/dependencies');

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ children: 1, transactions: 2, budgets: 0 });
  });
});

describe('DELETE /api/categories/:id?reassignTo=', () => {
  it('accepts a reassignment target and records it', async () => {
    const cat = (prisma as any).category;
    cat.findFirst
      .mockResolvedValueOnce({ id: 'c1', type: 'EXPENSE', isDefault: false, userId: null })
      .mockResolvedValueOnce({ id: 'c1', type: 'EXPENSE', isDefault: false, userId: null })
      .mockResolvedValueOnce({ id: 'clxtarget0000000000000000', type: 'EXPENSE', isDefault: false, userId: null });
    (prisma as any).transaction.count.mockResolvedValue(3);
    cat.delete.mockResolvedValue({ id: 'c1' });

    const res = await request(app)
      .delete('/api/categories/c1?reassignTo=clxtarget0000000000000000');

    expect(res.status).toBe(204);
    expect((prisma as any).transaction.updateMany).toHaveBeenCalled();
  });
});
