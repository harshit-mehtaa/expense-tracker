/**
 * Route tests for /api/users/members.
 *
 * This endpoint exists so a MEMBER can pick a co-owner. The thing to get right is that it
 * returns the least that makes the picker work, and grants nothing else.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const MEMBER_USER = { userId: 'u2', email: 'm@b.com', role: 'MEMBER' as const };

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = MEMBER_USER; next(); },
  requireAdmin: (_req: any, res: any) => res.status(403).json({ success: false }),
}));

vi.mock('../../config/prisma', () => {
  const prisma = { user: { findMany: vi.fn() } };
  return { default: prisma, prisma };
});

import usersRouter from '../../routes/users';
import { prisma } from '../../config/prisma';
import { makeApp } from '../helpers/makeApp';

const app = makeApp(usersRouter, '/api/users');
const findMany = (prisma as any).user.findMany as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([
    { id: 'u1', name: 'Harshit', colorTag: '#3b82f6' },
    { id: 'u2', name: 'Sneha', colorTag: '#ec4899' },
  ]);
});

describe('GET /api/users/members', () => {
  it('is reachable by a MEMBER — the entire point of it existing', async () => {
    const res = await request(app).get('/api/users/members');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('returns ONLY id, name and colour', async () => {
    // /admin/users returns email, masked PAN, last login and activity counts. None of
    // that is needed to pick a co-owner, and all of it would be a real widening.
    await request(app).get('/api/users/members');

    const select = findMany.mock.calls[0][0].select;
    expect(select).toEqual({ id: true, name: true, colorTag: true });
    expect(select.email).toBeUndefined();
    expect(select.panNumberMasked).toBeUndefined();
    expect(select.role).toBeUndefined();
    expect(select.lastLoginAt).toBeUndefined();
  });

  it('excludes deactivated and deleted users', async () => {
    await request(app).get('/api/users/members');
    expect(findMany.mock.calls[0][0].where).toEqual({ isActive: true, deletedAt: null });
  });

  it('sorts by name, so the picker is predictable', async () => {
    await request(app).get('/api/users/members');
    expect(findMany.mock.calls[0][0].orderBy).toEqual({ name: 'asc' });
  });

  it('exposes no route for reading another member, only for naming them', async () => {
    // The router has exactly one endpoint. Anything that could read another user's data
    // would have to be added deliberately.
    for (const path of ['/api/users', '/api/users/u1', '/api/users/u1/transactions']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(404);
    }
  });
});
