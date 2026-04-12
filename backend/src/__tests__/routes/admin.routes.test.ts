/**
 * Route integration tests for /api/admin.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'admin-1', email: 'admin@example.com', role: 'ADMIN' };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../services/adminService', () => ({
  getAllUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  resetUserPassword: vi.fn(),
  getAuditLog: vi.fn(),
}));

import adminRouter from '../../routes/admin';
import * as svc from '../../services/adminService';
import { makeApp } from '../helpers/makeApp';

const getAllUsersMock = svc.getAllUsers as ReturnType<typeof vi.fn>;
const createUserMock = svc.createUser as ReturnType<typeof vi.fn>;
const updateUserMock = svc.updateUser as ReturnType<typeof vi.fn>;
const deleteUserMock = svc.deleteUser as ReturnType<typeof vi.fn>;
const resetPasswordMock = svc.resetUserPassword as ReturnType<typeof vi.fn>;
const getAuditLogMock = svc.getAuditLog as ReturnType<typeof vi.fn>;

const app = makeApp(adminRouter, '/api/admin');

const MOCK_USER = { id: 'u2', name: 'Bob', email: 'bob@example.com', role: 'MEMBER', isActive: true };

beforeEach(() => {
  vi.clearAllMocks();
  getAllUsersMock.mockResolvedValue([MOCK_USER]);
  createUserMock.mockResolvedValue({ ...MOCK_USER, id: 'u-new' });
  updateUserMock.mockResolvedValue(MOCK_USER);
  deleteUserMock.mockResolvedValue(undefined);
  resetPasswordMock.mockResolvedValue(undefined);
  getAuditLogMock.mockResolvedValue({ items: [], total: 0 });
});

describe('GET /api/admin/users', () => {
  it('returns 200 with user list', async () => {
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(getAllUsersMock).toHaveBeenCalled();
  });
});

describe('POST /api/admin/users', () => {
  const VALID_USER = { name: 'Charlie', email: 'charlie@example.com', password: 'SecurePass1' };

  it('returns 201 on valid user creation', async () => {
    const res = await request(app).post('/api/admin/users').send(VALID_USER);
    expect(res.status).toBe(201);
    expect(createUserMock).toHaveBeenCalled();
  });

  it('returns 422 when email is invalid', async () => {
    const res = await request(app).post('/api/admin/users').send({ ...VALID_USER, email: 'not-email' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when password is too short', async () => {
    const res = await request(app).post('/api/admin/users').send({ ...VALID_USER, password: 'short' });
    expect(res.status).toBe(422);
  });
});

describe('PUT /api/admin/users/:id', () => {
  it('returns 200 on valid update', async () => {
    const res = await request(app).put('/api/admin/users/u2').send({ name: 'Bobby' });
    expect(res.status).toBe(200);
    expect(updateUserMock).toHaveBeenCalledWith('u2', 'admin-1', { name: 'Bobby' });
  });
});

describe('DELETE /api/admin/users/:id', () => {
  it('returns 204 on deletion', async () => {
    const res = await request(app).delete('/api/admin/users/u2');
    expect(res.status).toBe(204);
    expect(deleteUserMock).toHaveBeenCalledWith('u2', 'admin-1');
  });
});

describe('POST /api/admin/users/:id/reset-password', () => {
  it('returns 200 on valid password reset', async () => {
    const res = await request(app).post('/api/admin/users/u2/reset-password').send({ password: 'NewPass12' });
    expect(res.status).toBe(200);
  });

  it('returns 422 when password is too short', async () => {
    const res = await request(app).post('/api/admin/users/u2/reset-password').send({ password: 'short' });
    expect(res.status).toBe(422);
  });
});

describe('GET /api/admin/audit-log', () => {
  it('returns 200 with audit log data', async () => {
    const res = await request(app).get('/api/admin/audit-log');
    expect(res.status).toBe(200);
    expect(getAuditLogMock).toHaveBeenCalled();
  });
});
