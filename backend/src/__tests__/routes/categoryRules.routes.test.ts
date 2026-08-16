/**
 * Route integration tests for /api/category-rules.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const MEMBER_USER = { userId: 'u1', email: 'a@b.com', role: 'MEMBER' as const };
const ADMIN_USER = { userId: 'admin-1', email: 'admin@b.com', role: 'ADMIN' as const };

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = (req as any).__testUser ?? MEMBER_USER;
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../services/categoryRuleService', () => ({
  listCategoryRules: vi.fn(),
  createCategoryRule: vi.fn(),
  deleteCategoryRule: vi.fn(),
}));

vi.mock('../../services/auditService', () => ({
  recordAuditLog: vi.fn(),
}));

vi.mock('../../config/prisma', () => {
  const prisma = { user: { findFirst: vi.fn() } };
  return { default: prisma, prisma };
});

import categoryRulesRouter from '../../routes/categoryRules';
import * as svc from '../../services/categoryRuleService';
import { recordAuditLog } from '../../services/auditService';
import { prisma } from '../../config/prisma';
import { makeApp } from '../helpers/makeApp';
import { errorHandler } from '../../middleware/errorHandler';

const app = makeApp(categoryRulesRouter, '/api/category-rules');

function makeAdminApp() {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res: any, next: any) => { req.__testUser = ADMIN_USER; next(); });
  a.use('/api/category-rules', categoryRulesRouter);
  a.use(errorHandler);
  return a;
}

const userFindFirstMock = (prisma as any).user.findFirst as ReturnType<typeof vi.fn>;
const listMock = svc.listCategoryRules as ReturnType<typeof vi.fn>;
const createMock = svc.createCategoryRule as ReturnType<typeof vi.fn>;
const deleteMock = svc.deleteCategoryRule as ReturnType<typeof vi.fn>;
const auditMock = recordAuditLog as ReturnType<typeof vi.fn>;

const MOCK_RULE = { id: 'rule-1', userId: 'u1', keyword: 'swiggy', categoryId: 'cat-1' };
const VALID_BODY = { keyword: 'swiggy', categoryId: 'clm1234567890abcdefghij' };

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue([MOCK_RULE]);
  createMock.mockResolvedValue(MOCK_RULE);
  deleteMock.mockResolvedValue(MOCK_RULE);
  userFindFirstMock.mockResolvedValue({ id: 'u2' });
});

describe('GET /api/category-rules', () => {
  it('returns 200 with the rule list (MEMBER scoped to own userId)', async () => {
    const res = await request(app).get('/api/category-rules');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([MOCK_RULE]);
    expect(listMock).toHaveBeenCalledWith('u1');
  });

  it('ADMIN with no targetUserId — scopes to own userId (not family-wide)', async () => {
    const res = await request(makeAdminApp()).get('/api/category-rules');
    expect(res.status).toBe(200);
    // categoryRules.ts:20 — effectiveUserId = targetUserId ?? req.user!.userId, unlike
    // other routes' family-wide (undefined) fallback for ADMIN
    expect(listMock).toHaveBeenCalledWith('admin-1');
  });

  it('ADMIN with a valid targetUserId — scopes to that member', async () => {
    const res = await request(makeAdminApp()).get('/api/category-rules?targetUserId=clm1234567890abcdefghij');
    expect(res.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith('clm1234567890abcdefghij');
  });

  it('ADMIN with an invalid targetUserId format — 400', async () => {
    const res = await request(makeAdminApp()).get('/api/category-rules?targetUserId=not-valid!!');
    expect(res.status).toBe(400);
  });

  it('ADMIN with a targetUserId for a user that does not exist — 404', async () => {
    userFindFirstMock.mockResolvedValue(null);
    const res = await request(makeAdminApp()).get('/api/category-rules?targetUserId=clm1234567890abcdefghij');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/category-rules', () => {
  it('returns 201 and records a CREATE audit log entry', async () => {
    const res = await request(app).post('/api/category-rules').send(VALID_BODY);
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual(MOCK_RULE);
    expect(createMock).toHaveBeenCalledWith('u1', VALID_BODY);
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        performedByUserId: 'u1',
        action: 'CREATE',
        entityType: 'CategoryRule',
        entityId: MOCK_RULE.id,
        newValue: MOCK_RULE,
      }),
    );
  });

  it('returns 422 when the keyword is missing', async () => {
    const res = await request(app).post('/api/category-rules').send({ categoryId: 'clm1234567890abcdefghij' });
    expect(res.status).toBe(422);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('returns 422 when the keyword exceeds 80 characters', async () => {
    const res = await request(app).post('/api/category-rules').send({ keyword: 'x'.repeat(81), categoryId: 'clm1234567890abcdefghij' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when categoryId is not a valid CUID', async () => {
    const res = await request(app).post('/api/category-rules').send({ keyword: 'swiggy', categoryId: 'not-a-cuid' });
    expect(res.status).toBe(422);
  });

  it('ADMIN can create a rule for a specific member via targetUserId', async () => {
    const res = await request(makeAdminApp())
      .post('/api/category-rules?targetUserId=clm1234567890abcdefghij')
      .send(VALID_BODY);
    expect(res.status).toBe(201);
    expect(createMock).toHaveBeenCalledWith('clm1234567890abcdefghij', VALID_BODY);
  });
});

describe('DELETE /api/category-rules/:id', () => {
  it('returns 204 and records a DELETE audit log entry', async () => {
    const res = await request(app).delete('/api/category-rules/rule-1');
    expect(res.status).toBe(204);
    expect(deleteMock).toHaveBeenCalledWith('u1', 'rule-1', 'MEMBER');
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        performedByUserId: 'u1',
        action: 'DELETE',
        entityType: 'CategoryRule',
        entityId: MOCK_RULE.id,
        oldValue: MOCK_RULE,
      }),
    );
  });

  it('ADMIN deleting a rule passes their own userId but role=ADMIN', async () => {
    // deleteCategoryRule's ownerScopedWhere ignores userId when role is ADMIN — the
    // route always passes req.user!.userId (not resolveWriteUserId's target), so this
    // pins that behavior rather than assuming it.
    const res = await request(makeAdminApp()).delete('/api/category-rules/rule-1');
    expect(res.status).toBe(204);
    expect(deleteMock).toHaveBeenCalledWith('admin-1', 'rule-1', 'ADMIN');
  });

  it('returns 404 when the rule does not exist or is not owned', async () => {
    const { AppError } = await import('../../utils/AppError');
    deleteMock.mockRejectedValue(AppError.notFound('Category rule'));
    const res = await request(app).delete('/api/category-rules/rule-x');
    expect(res.status).toBe(404);
    expect(auditMock).not.toHaveBeenCalled();
  });
});
