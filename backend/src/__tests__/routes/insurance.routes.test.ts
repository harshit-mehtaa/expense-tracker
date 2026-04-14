/**
 * Route integration tests for /api/insurance.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'u1', email: 'a@b.com', role: 'ADMIN' };
    next();
  },
}));

vi.mock('../../services/insuranceService', () => ({
  getInsurancePolicies: vi.fn(),
  getPremiumCalendar: vi.fn(),
  get80DSummary: vi.fn(),
  createInsurancePolicy: vi.fn(),
  updateInsurancePolicy: vi.fn(),
  deleteInsurancePolicy: vi.fn(),
}));

import insuranceRouter from '../../routes/insurance';
import * as svc from '../../services/insuranceService';
import { makeApp } from '../helpers/makeApp';

const app = makeApp(insuranceRouter, '/api/insurance');

const getMock = svc.getInsurancePolicies as ReturnType<typeof vi.fn>;
const calendarMock = svc.getPremiumCalendar as ReturnType<typeof vi.fn>;
const summary80dMock = svc.get80DSummary as ReturnType<typeof vi.fn>;
const createMock = svc.createInsurancePolicy as ReturnType<typeof vi.fn>;
const updateMock = svc.updateInsurancePolicy as ReturnType<typeof vi.fn>;
const deleteMock = svc.deleteInsurancePolicy as ReturnType<typeof vi.fn>;

const MOCK_POLICY = {
  id: 'pol-1',
  policyType: 'TERM_LIFE',
  providerName: 'LIC',
  policyNumber: 'LIC-001',
  policyName: 'Term Plan',
  sumAssured: 1_000_000,
  premiumAmount: 10_000,
  premiumFrequency: 'ANNUALLY',
  startDate: '2020-01-01',
};

const VALID_BODY = {
  policyType: 'TERM_LIFE',
  providerName: 'LIC',
  policyNumber: 'LIC-001',
  policyName: 'Term Plan',
  sumAssured: 1_000_000,
  premiumAmount: 10_000,
  premiumFrequency: 'ANNUALLY',
  startDate: '2020-01-01',
};

beforeEach(() => {
  vi.clearAllMocks();
  getMock.mockResolvedValue([MOCK_POLICY]);
  calendarMock.mockResolvedValue([]);
  summary80dMock.mockResolvedValue({ totalPremium: 0, exemptAmount: 0 });
  createMock.mockResolvedValue({ ...MOCK_POLICY, id: 'pol-new' });
  updateMock.mockResolvedValue(MOCK_POLICY);
  deleteMock.mockResolvedValue(undefined);
});

// ─── GET /api/insurance ───────────────────────────────────────────────────────

describe('GET /api/insurance', () => {
  it('returns 200 with list of policies', async () => {
    const res = await request(app).get('/api/insurance');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].policyNumber).toBe('LIC-001');
  });

  it('calls service with resolved targetUserId, requesterId, and role', async () => {
    await request(app).get('/api/insurance');
    // No ?userId= param → resolveTargetUserId returns undefined (family-wide for ADMIN)
    expect(getMock).toHaveBeenCalledWith(undefined, 'u1', 'ADMIN');
  });
});

// ─── GET /api/insurance/premium-calendar ─────────────────────────────────────

describe('GET /api/insurance/premium-calendar', () => {
  it('returns 200 with calendar data', async () => {
    calendarMock.mockResolvedValue([{ month: 'April', amount: 10_000 }]);
    const res = await request(app).get('/api/insurance/premium-calendar');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

// ─── GET /api/insurance/80d-summary ──────────────────────────────────────────

describe('GET /api/insurance/80d-summary', () => {
  it('returns 200 with 80D summary', async () => {
    summary80dMock.mockResolvedValue({ totalPremium: 25_000, exemptAmount: 25_000 });
    const res = await request(app).get('/api/insurance/80d-summary');
    expect(res.status).toBe(200);
    expect(res.body.data.totalPremium).toBe(25_000);
  });
});

// ─── POST /api/insurance ──────────────────────────────────────────────────────

describe('POST /api/insurance', () => {
  it('returns 201 on valid policy creation', async () => {
    const res = await request(app).post('/api/insurance').send(VALID_BODY);
    expect(res.status).toBe(201);
    expect(createMock).toHaveBeenCalled();
  });

  it('returns 422 when required fields are missing', async () => {
    const res = await request(app).post('/api/insurance').send({ policyType: 'TERM_LIFE' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when policyType is invalid enum value', async () => {
    const res = await request(app).post('/api/insurance').send({ ...VALID_BODY, policyType: 'INVALID_TYPE' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when sumAssured is not positive', async () => {
    const res = await request(app).post('/api/insurance').send({ ...VALID_BODY, sumAssured: -1000 });
    expect(res.status).toBe(422);
  });
});

// ─── PUT /api/insurance/:id ───────────────────────────────────────────────────

describe('PUT /api/insurance/:id', () => {
  it('returns 200 on successful update', async () => {
    const res = await request(app).put('/api/insurance/pol-1').send({ providerName: 'HDFC Life' });
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith('u1', 'pol-1', expect.objectContaining({ providerName: 'HDFC Life' }));
  });

  it('propagates 404 from service', async () => {
    const { AppError } = await import('../../utils/AppError');
    updateMock.mockRejectedValue(AppError.notFound('Policy'));
    const res = await request(app).put('/api/insurance/nonexistent').send({ providerName: 'X' });
    expect(res.status).toBe(404);
  });
});

// ─── DELETE /api/insurance/:id ────────────────────────────────────────────────

describe('DELETE /api/insurance/:id', () => {
  it('returns 204 on successful deletion', async () => {
    const res = await request(app).delete('/api/insurance/pol-1');
    expect(res.status).toBe(204);
    expect(deleteMock).toHaveBeenCalledWith('u1', 'pol-1');
  });
});
