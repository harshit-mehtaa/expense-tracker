/**
 * Route integration tests for /api/accounts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'u1', email: 'a@b.com', role: 'ADMIN' };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../services/accountService', () => ({
  getAccounts: vi.fn(),
  getAccountById: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  reconcileAccount: vi.fn(),
}));

import accountsRouter from '../../routes/accounts';
import * as svc from '../../services/accountService';
import { makeApp } from '../helpers/makeApp';

const app = makeApp(accountsRouter, '/api/accounts');

const getAccountsMock = svc.getAccounts as ReturnType<typeof vi.fn>;
const getByIdMock = svc.getAccountById as ReturnType<typeof vi.fn>;
const createMock = svc.createAccount as ReturnType<typeof vi.fn>;
const updateMock = svc.updateAccount as ReturnType<typeof vi.fn>;
const deleteMock = svc.deleteAccount as ReturnType<typeof vi.fn>;
const reconcileMock = svc.reconcileAccount as ReturnType<typeof vi.fn>;

const MOCK_ACCOUNT = { id: 'acc-1', bankName: 'HDFC', accountType: 'SAVINGS', currentBalance: 50000 };

beforeEach(() => {
  vi.clearAllMocks();
  getAccountsMock.mockResolvedValue([MOCK_ACCOUNT]);
  getByIdMock.mockResolvedValue(MOCK_ACCOUNT);
  createMock.mockResolvedValue({ ...MOCK_ACCOUNT, id: 'acc-new' });
  updateMock.mockResolvedValue(MOCK_ACCOUNT);
  deleteMock.mockResolvedValue(undefined);
  reconcileMock.mockResolvedValue({ ...MOCK_ACCOUNT, currentBalance: 45000 });
});

describe('GET /api/accounts', () => {
  it('returns 200 with account list', async () => {
    const res = await request(app).get('/api/accounts');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('GET /api/accounts/:id', () => {
  it('returns 200 with the account', async () => {
    const res = await request(app).get('/api/accounts/acc-1');
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('acc-1');
  });

  it('propagates 404 from service', async () => {
    const { AppError } = await import('../../utils/AppError');
    getByIdMock.mockRejectedValue(AppError.notFound('Account'));
    const res = await request(app).get('/api/accounts/nonexistent');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/accounts', () => {
  const VALID_BODY = { bankName: 'SBI', accountType: 'SAVINGS', currentBalance: 10000 };

  it('returns 201 on valid creation', async () => {
    const res = await request(app).post('/api/accounts').send(VALID_BODY);
    expect(res.status).toBe(201);
    expect(createMock).toHaveBeenCalled();
  });

  it('returns 422 when bankName is empty', async () => {
    const res = await request(app).post('/api/accounts').send({ ...VALID_BODY, bankName: '' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when accountType is invalid', async () => {
    const res = await request(app).post('/api/accounts').send({ ...VALID_BODY, accountType: 'INVALID' });
    expect(res.status).toBe(422);
  });
});

describe('PUT /api/accounts/:id', () => {
  it('returns 200 on successful update', async () => {
    const res = await request(app).put('/api/accounts/acc-1').send({ bankName: 'ICICI' });
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith('acc-1', 'u1', 'ADMIN', { bankName: 'ICICI' });
  });
});

describe('DELETE /api/accounts/:id', () => {
  it('returns 204 on deletion', async () => {
    const res = await request(app).delete('/api/accounts/acc-1');
    expect(res.status).toBe(204);
    expect(deleteMock).toHaveBeenCalledWith('acc-1', 'u1', 'ADMIN');
  });
});

describe('POST /api/accounts/:id/reconcile', () => {
  it('returns 200 on valid reconciliation', async () => {
    const res = await request(app).post('/api/accounts/acc-1/reconcile').send({ actualBalance: 45000 });
    expect(res.status).toBe(200);
  });

  it('returns 422 when actualBalance is negative', async () => {
    const res = await request(app).post('/api/accounts/acc-1/reconcile').send({ actualBalance: -100 });
    expect(res.status).toBe(422);
  });
});
