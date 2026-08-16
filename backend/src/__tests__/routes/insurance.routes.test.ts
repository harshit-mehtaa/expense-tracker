/**
 * Route integration tests for /api/insurance.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const ADMIN_USER = { userId: 'u1', email: 'a@b.com', role: 'ADMIN' as const };
const MEMBER_USER = { userId: 'u1', email: 'a@b.com', role: 'MEMBER' as const };

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = (req as any).__testUser ?? ADMIN_USER;
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
  getInsurancePolicyForAudit: vi.fn(),
}));

vi.mock('../../services/auditService', () => ({
  recordAuditLog: vi.fn(),
}));

import insuranceRouter from '../../routes/insurance';
import * as svc from '../../services/insuranceService';
import { recordAuditLog } from '../../services/auditService';
import { makeApp } from '../helpers/makeApp';
import { errorHandler } from '../../middleware/errorHandler';

const app = makeApp(insuranceRouter, '/api/insurance');

function makeMemberApp() {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res: any, next: any) => { req.__testUser = MEMBER_USER; next(); });
  a.use('/api/insurance', insuranceRouter);
  a.use(errorHandler);
  return a;
}

const getMock = svc.getInsurancePolicies as ReturnType<typeof vi.fn>;
const calendarMock = svc.getPremiumCalendar as ReturnType<typeof vi.fn>;
const summary80dMock = svc.get80DSummary as ReturnType<typeof vi.fn>;
const createMock = svc.createInsurancePolicy as ReturnType<typeof vi.fn>;
const updateMock = svc.updateInsurancePolicy as ReturnType<typeof vi.fn>;
const deleteMock = svc.deleteInsurancePolicy as ReturnType<typeof vi.fn>;
const getForAuditMock = svc.getInsurancePolicyForAudit as ReturnType<typeof vi.fn>;
const auditMock = recordAuditLog as ReturnType<typeof vi.fn>;

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
  getForAuditMock.mockResolvedValue(MOCK_POLICY);
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
    expect(updateMock).toHaveBeenCalledWith('u1', 'pol-1', expect.objectContaining({ providerName: 'HDFC Life' }), 'ADMIN');
  });

  it('propagates 404 from service', async () => {
    const { AppError } = await import('../../utils/AppError');
    updateMock.mockRejectedValue(AppError.notFound('Policy'));
    const res = await request(app).put('/api/insurance/nonexistent').send({ providerName: 'X' });
    expect(res.status).toBe(404);
  });

  it('records the audit log with the pre-mutation snapshot as oldValue', async () => {
    await request(app).put('/api/insurance/pol-1').send({ providerName: 'HDFC Life' });
    expect(getForAuditMock).toHaveBeenCalledWith('u1', 'pol-1', 'ADMIN');
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE', entityType: 'InsurancePolicy', entityId: MOCK_POLICY.id, oldValue: MOCK_POLICY }),
    );
  });

  it('MEMBER editing their own policy — oldValue is populated', async () => {
    await request(makeMemberApp()).put('/api/insurance/pol-1').send({ providerName: 'HDFC Life' });
    expect(getForAuditMock).toHaveBeenCalledWith('u1', 'pol-1', 'MEMBER');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ oldValue: MOCK_POLICY }));
  });

  it('fetches the audit snapshot before performing the update', async () => {
    await request(app).put('/api/insurance/pol-1').send({ providerName: 'HDFC Life' });
    expect(getForAuditMock.mock.invocationCallOrder[0]).toBeLessThan(updateMock.mock.invocationCallOrder[0]);
  });
});

// ─── DELETE /api/insurance/:id ────────────────────────────────────────────────

describe('DELETE /api/insurance/:id', () => {
  it('returns 204 on successful deletion', async () => {
    const res = await request(app).delete('/api/insurance/pol-1');
    expect(res.status).toBe(204);
    expect(deleteMock).toHaveBeenCalledWith('u1', 'pol-1', 'ADMIN');
  });

  it('records the audit log with the pre-mutation snapshot as oldValue', async () => {
    await request(app).delete('/api/insurance/pol-1');
    expect(getForAuditMock).toHaveBeenCalledWith('u1', 'pol-1', 'ADMIN');
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DELETE', entityType: 'InsurancePolicy', entityId: MOCK_POLICY.id, oldValue: MOCK_POLICY }),
    );
  });

  it('falls back to the URL param for entityId when deleteInsurancePolicy resolves falsy', async () => {
    deleteMock.mockResolvedValue(undefined);
    await request(app).delete('/api/insurance/pol-1');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'pol-1' }));
  });

  it('prefers the deleted row\'s own id for entityId when the service returns a record', async () => {
    // id deliberately differs from the URL param so this proves the left arm ran.
    deleteMock.mockResolvedValue({ id: 'deleted-policy-id' });
    await request(app).delete('/api/insurance/pol-1');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'deleted-policy-id' }));
  });

  it('fetches the audit snapshot before performing the delete', async () => {
    await request(app).delete('/api/insurance/pol-1');
    expect(getForAuditMock.mock.invocationCallOrder[0]).toBeLessThan(deleteMock.mock.invocationCallOrder[0]);
  });
});
