/**
 * Route integration tests for /api/recurring.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'u1', email: 'a@b.com', role: 'MEMBER' };
    next();
  },
}));

vi.mock('../../services/recurringService', () => ({
  listRecurringRules: vi.fn(),
  createRecurringRule: vi.fn(),
  updateRecurringRule: vi.fn(),
  deleteRecurringRule: vi.fn(),
  generateDueRecurringTransactions: vi.fn(),
}));

import recurringRouter from '../../routes/recurring';
import * as svc from '../../services/recurringService';
import { makeApp } from '../helpers/makeApp';

const app = makeApp(recurringRouter, '/api/recurring');

const listMock = svc.listRecurringRules as ReturnType<typeof vi.fn>;
const createMock = svc.createRecurringRule as ReturnType<typeof vi.fn>;
const updateMock = svc.updateRecurringRule as ReturnType<typeof vi.fn>;
const deleteMock = svc.deleteRecurringRule as ReturnType<typeof vi.fn>;
const generateMock = svc.generateDueRecurringTransactions as ReturnType<typeof vi.fn>;

const MOCK_RULE = {
  id: 'rule-1',
  amount: 5000,
  type: 'EXPENSE',
  description: 'Monthly rent',
  frequency: 'MONTHLY',
  isActive: true,
};

const VALID_BODY = {
  amount: 5000,
  type: 'EXPENSE',
  description: 'Monthly rent',
  frequency: 'MONTHLY',
};

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue([MOCK_RULE]);
  createMock.mockResolvedValue({ ...MOCK_RULE, id: 'rule-new' });
  updateMock.mockResolvedValue(MOCK_RULE);
  deleteMock.mockResolvedValue(undefined);
  generateMock.mockResolvedValue({ generated: 2 });
});

// ─── GET /api/recurring ───────────────────────────────────────────────────────

describe('GET /api/recurring', () => {
  it('returns 200 with list of rules', async () => {
    const res = await request(app).get('/api/recurring');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe('rule-1');
  });

  it('calls service with userId', async () => {
    await request(app).get('/api/recurring');
    expect(listMock).toHaveBeenCalledWith('u1');
  });
});

// ─── POST /api/recurring ──────────────────────────────────────────────────────

describe('POST /api/recurring', () => {
  it('returns 201 on valid rule creation', async () => {
    const res = await request(app).post('/api/recurring').send(VALID_BODY);
    expect(res.status).toBe(201);
    expect(createMock).toHaveBeenCalledWith('u1', expect.objectContaining({ amount: 5000 }));
  });

  it('returns 422 when amount is negative', async () => {
    const res = await request(app).post('/api/recurring').send({ ...VALID_BODY, amount: -100 });
    expect(res.status).toBe(422);
  });

  it('returns 422 when type is invalid enum', async () => {
    const res = await request(app).post('/api/recurring').send({ ...VALID_BODY, type: 'BAD_TYPE' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when description is missing', async () => {
    const { description: _, ...noDesc } = VALID_BODY;
    const res = await request(app).post('/api/recurring').send(noDesc);
    expect(res.status).toBe(422);
  });

  it('returns 422 when frequency is invalid', async () => {
    const res = await request(app).post('/api/recurring').send({ ...VALID_BODY, frequency: 'NEVER' });
    expect(res.status).toBe(422);
  });
});

// ─── PUT /api/recurring/:id ───────────────────────────────────────────────────

describe('PUT /api/recurring/:id', () => {
  it('returns 200 on successful update', async () => {
    const res = await request(app).put('/api/recurring/rule-1').send({ isActive: false });
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith('rule-1', 'u1', expect.objectContaining({ isActive: false }));
  });

  it('propagates 404 from service', async () => {
    const { AppError } = await import('../../utils/AppError');
    updateMock.mockRejectedValue(AppError.notFound('Rule'));
    const res = await request(app).put('/api/recurring/nonexistent').send({ isActive: true });
    expect(res.status).toBe(404);
  });
});

// ─── DELETE /api/recurring/:id ────────────────────────────────────────────────

describe('DELETE /api/recurring/:id', () => {
  it('returns 204 on successful deletion', async () => {
    const res = await request(app).delete('/api/recurring/rule-1');
    expect(res.status).toBe(204);
    expect(deleteMock).toHaveBeenCalledWith('rule-1', 'u1');
  });
});

// ─── POST /api/recurring/generate ────────────────────────────────────────────

describe('POST /api/recurring/generate', () => {
  it('returns 200 with generated transaction count', async () => {
    const res = await request(app).post('/api/recurring/generate');
    expect(res.status).toBe(200);
    expect(res.body.data.generated).toBe(2);
  });

  it('calls generateDueRecurringTransactions with userId', async () => {
    await request(app).post('/api/recurring/generate');
    expect(generateMock).toHaveBeenCalledWith('u1');
  });
});
