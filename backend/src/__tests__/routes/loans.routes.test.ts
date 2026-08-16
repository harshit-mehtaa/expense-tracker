/**
 * Route integration tests for /api/loans.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const MEMBER_USER = { userId: 'u1', email: 'a@b.com', role: 'MEMBER' as const };
const ADMIN_USER = { userId: 'admin-1', email: 'admin@b.com', role: 'ADMIN' as const };

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = (req as any).__testUser ?? MEMBER_USER;
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../services/loanService', () => ({
  getLoans: vi.fn(),
  createLoan: vi.fn(),
  updateLoan: vi.fn(),
  deleteLoan: vi.fn(),
  getLoanAmortization: vi.fn(),
  simulatePrepayment: vi.fn(),
  getLoanForAudit: vi.fn(),
}));

vi.mock('../../services/auditService', () => ({
  recordAuditLog: vi.fn(),
}));

vi.mock('../../config/prisma', () => {
  const prisma = { user: { findFirst: vi.fn() } };
  return { default: prisma, prisma };
});

import loansRouter from '../../routes/loans';
import * as svc from '../../services/loanService';
import { recordAuditLog } from '../../services/auditService';
import { prisma } from '../../config/prisma';
import { makeApp } from '../helpers/makeApp';
import express from 'express';
import { errorHandler } from '../../middleware/errorHandler';

const app = makeApp(loansRouter, '/api/loans');

/** Creates app with ADMIN user injected via __testUser */
function makeAdminApp() {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res: any, next: any) => { req.__testUser = ADMIN_USER; next(); });
  a.use('/api/loans', loansRouter);
  a.use(errorHandler);
  return a;
}

const userFindFirstMock = (prisma as any).user.findFirst as ReturnType<typeof vi.fn>;
const getLoansMock = svc.getLoans as ReturnType<typeof vi.fn>;
const createMock = svc.createLoan as ReturnType<typeof vi.fn>;
const updateMock = svc.updateLoan as ReturnType<typeof vi.fn>;
const deleteMock = svc.deleteLoan as ReturnType<typeof vi.fn>;
const getAmortizationMock = svc.getLoanAmortization as ReturnType<typeof vi.fn>;
const simulateMock = svc.simulatePrepayment as ReturnType<typeof vi.fn>;
const getForAuditMock = svc.getLoanForAudit as ReturnType<typeof vi.fn>;
const auditMock = recordAuditLog as ReturnType<typeof vi.fn>;

const MOCK_LOAN = {
  id: 'loan-1',
  userId: 'u1',
  lenderName: 'HDFC Bank',
  loanType: 'HOME',
  principalAmount: 5000000,
  outstandingBalance: 4500000,
  interestRate: 8.5,
  emiAmount: 45000,
  emiDate: 5,
  tenureMonths: 180,
  disbursementDate: new Date('2022-01-01'),
  endDate: new Date('2037-01-01'),
};

const VALID_LOAN_BODY = {
  lenderName: 'HDFC Bank',
  loanType: 'HOME',
  principalAmount: 5000000,
  outstandingBalance: 4500000,
  interestRate: 8.5,
  emiAmount: 45000,
  emiDate: 5,
  tenureMonths: 180,
  disbursementDate: '2022-01-01',
  endDate: '2037-01-01',
  // HOME is a secured type, so the asset link is now mandatory at the schema level.
  assetId: 'asset-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  getLoansMock.mockResolvedValue([MOCK_LOAN]);
  userFindFirstMock.mockResolvedValue({ id: 'u2' }); // default: user found
  createMock.mockResolvedValue({ ...MOCK_LOAN, id: 'loan-new' });
  updateMock.mockResolvedValue(MOCK_LOAN);
  deleteMock.mockResolvedValue(undefined);
  getAmortizationMock.mockResolvedValue({ loan: MOCK_LOAN, schedule: [], summary: { totalInterest: 0, remainingMonths: 0 } });
  simulateMock.mockResolvedValue({ savings: 0, newSchedule: [] });
  getForAuditMock.mockResolvedValue(MOCK_LOAN);
});

describe('GET /api/loans', () => {
  it('returns 200 with loan list (MEMBER)', async () => {
    const res = await request(app).get('/api/loans');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(getLoansMock).toHaveBeenCalledWith('u1'); // MEMBER scoped to own userId
  });

  it('ADMIN with no targetUserId — family-wide (effectiveUserId=undefined)', async () => {
    const res = await request(makeAdminApp()).get('/api/loans');
    expect(res.status).toBe(200);
    expect(getLoansMock).toHaveBeenCalledWith(undefined); // family-wide
  });

  it('ADMIN with invalid targetUserId format — returns 400', async () => {
    const res = await request(makeAdminApp()).get('/api/loans?targetUserId=not-valid!!');
    expect(res.status).toBe(400);
  });

  it('ADMIN with valid CUID but user not found — returns 404', async () => {
    userFindFirstMock.mockResolvedValue(null);
    const res = await request(makeAdminApp()).get('/api/loans?targetUserId=clm1234567890abcdefghij');
    expect(res.status).toBe(404);
  });

  it('ADMIN with valid CUID and user found — scopes to that userId', async () => {
    // userFindFirstMock returns a non-null user, so route proceeds — effectiveUserId stays as query param
    const res = await request(makeAdminApp()).get('/api/loans?targetUserId=clm1234567890abcdefghij');
    expect(res.status).toBe(200);
    expect(getLoansMock).toHaveBeenCalledWith('clm1234567890abcdefghij');
  });
});

describe('POST /api/loans', () => {
  it('returns 201 on valid loan creation', async () => {
    const res = await request(app).post('/api/loans').send(VALID_LOAN_BODY);
    expect(res.status).toBe(201);
    expect(createMock).toHaveBeenCalled();
  });

  it('returns 422 when loanType is invalid', async () => {
    const res = await request(app).post('/api/loans').send({ ...VALID_LOAN_BODY, loanType: 'INVALID' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when emiDate exceeds 28', async () => {
    const res = await request(app).post('/api/loans').send({ ...VALID_LOAN_BODY, emiDate: 29 });
    expect(res.status).toBe(422);
  });

  it('returns 422 when principalAmount is negative', async () => {
    const res = await request(app).post('/api/loans').send({ ...VALID_LOAN_BODY, principalAmount: -1000 });
    expect(res.status).toBe(422);
  });
});

describe('PUT /api/loans/:id', () => {
  it('returns 200 on valid update', async () => {
    const res = await request(app).put('/api/loans/loan-1').send({ emiAmount: 46000 });
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith('u1', 'loan-1', { emiAmount: 46000 }, 'MEMBER', undefined);
  });

  it('records the audit log with the pre-mutation snapshot as oldValue', async () => {
    await request(app).put('/api/loans/loan-1').send({ emiAmount: 46000 });
    expect(getForAuditMock).toHaveBeenCalledWith('u1', 'loan-1', 'MEMBER');
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE', entityType: 'Loan', entityId: MOCK_LOAN.id, oldValue: MOCK_LOAN, newValue: MOCK_LOAN }),
    );
  });

  it('ADMIN editing another member\'s loan — oldValue is populated, not silently null', async () => {
    // The regression this refactor exists to prevent: an admin-on-behalf-of edit must
    // not silently lose the audit trail's before-state.
    await request(makeAdminApp()).put('/api/loans/loan-1').send({ emiAmount: 46000 });
    expect(getForAuditMock).toHaveBeenCalledWith('admin-1', 'loan-1', 'ADMIN');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ oldValue: MOCK_LOAN }));
  });

  it('fetches the audit snapshot before performing the update', async () => {
    await request(app).put('/api/loans/loan-1').send({ emiAmount: 46000 });
    const fetchOrder = getForAuditMock.mock.invocationCallOrder[0];
    const updateOrder = updateMock.mock.invocationCallOrder[0];
    expect(fetchOrder).toBeLessThan(updateOrder);
  });

});

describe('DELETE /api/loans/:id', () => {
  it('returns 204 on deletion', async () => {
    const res = await request(app).delete('/api/loans/loan-1');
    expect(res.status).toBe(204);
    expect(deleteMock).toHaveBeenCalledWith('u1', 'loan-1', 'MEMBER');
  });

  it('records the audit log with the pre-mutation snapshot as oldValue', async () => {
    await request(app).delete('/api/loans/loan-1');
    expect(getForAuditMock).toHaveBeenCalledWith('u1', 'loan-1', 'MEMBER');
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DELETE', entityType: 'Loan', entityId: MOCK_LOAN.id, oldValue: MOCK_LOAN }),
    );
  });

  it('fetches the audit snapshot before performing the delete', async () => {
    await request(app).delete('/api/loans/loan-1');
    const fetchOrder = getForAuditMock.mock.invocationCallOrder[0];
    const deleteOrder = deleteMock.mock.invocationCallOrder[0];
    expect(fetchOrder).toBeLessThan(deleteOrder);
  });

  it('falls back to the URL param for entityId when deleteLoan resolves falsy', async () => {
    deleteMock.mockResolvedValue(undefined);
    await request(app).delete('/api/loans/loan-1');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'loan-1' }));
  });

  it('prefers the deleted row\'s own id for entityId when deleteLoan returns a record', async () => {
    // id deliberately differs from the URL param so this proves the left arm ran.
    deleteMock.mockResolvedValue({ id: 'deleted-loan-id' });
    await request(app).delete('/api/loans/loan-1');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'deleted-loan-id' }));
  });
});

describe('GET /api/loans/:id/amortization-schedule', () => {
  it('returns 200 with schedule', async () => {
    const res = await request(app).get('/api/loans/loan-1/amortization-schedule');
    expect(res.status).toBe(200);
    expect(getAmortizationMock).toHaveBeenCalled();
  });

  it('ADMIN role — ownerFilter is undefined (family-wide access)', async () => {
    await request(makeAdminApp()).get('/api/loans/loan-1/amortization-schedule');
    // Line 50: ownerFilter = ADMIN ? undefined : userId
    expect(getAmortizationMock).toHaveBeenCalledWith(undefined, 'loan-1');
  });
});

describe('POST /api/loans/:id/prepayment-simulation', () => {
  it('returns 200 on valid prepayment simulation', async () => {
    const res = await request(app)
      .post('/api/loans/loan-1/prepayment-simulation')
      .send({ prepaymentAmount: 100000, mode: 'reduce_tenure' });
    expect(res.status).toBe(200);
    expect(simulateMock).toHaveBeenCalled();
  });

  it('ADMIN role — ownerFilter is undefined (family-wide access)', async () => {
    await request(makeAdminApp())
      .post('/api/loans/loan-1/prepayment-simulation')
      .send({ prepaymentAmount: 100000, mode: 'reduce_tenure' });
    // Line 60: ownerFilter = ADMIN ? undefined : userId
    expect(simulateMock).toHaveBeenCalledWith(undefined, 'loan-1', 100000, 'reduce_tenure');
  });

  it('returns 422 when prepaymentAmount is negative', async () => {
    const res = await request(app)
      .post('/api/loans/loan-1/prepayment-simulation')
      .send({ prepaymentAmount: -100, mode: 'reduce_tenure' });
    expect(res.status).toBe(422);
  });
});

// ─── POST /api/loans/derive — the auto-fill source ───────────────────────────

describe('POST /api/loans/derive', () => {
  const BASE = { principalAmount: 5_000_000, interestRate: 8.5, tenureMonths: 240 };

  it('returns the EMI, rounded up so the app will accept its own suggestion', async () => {
    const res = await request(app).post('/api/loans/derive').send(BASE);
    expect(res.status).toBe(200);
    // Exact is 43391.161668 — ceil, because a nearest-rounded EMI can fall below the
    // amortization schedule's first-month-interest floor and be rejected on save.
    expect(res.body.data.emiAmount).toBe(43_391.17);
  });

  it('pre-fills the outstanding balance with the principal', async () => {
    const res = await request(app).post('/api/loans/derive').send(BASE);
    expect(res.body.data.outstandingBalance).toBe(5_000_000);
  });

  it('derives the end date from the disbursement date', async () => {
    const res = await request(app).post('/api/loans/derive')
      .send({ ...BASE, disbursementDate: '2026-01-15' });
    expect(res.body.data.endDate).toMatch(/^2046-01-15/);
  });

  it('pushes the end date out when a first-EMI date is supplied', async () => {
    const res = await request(app).post('/api/loans/derive')
      .send({ ...BASE, disbursementDate: '2026-01-15', firstEmiDate: '2027-01-15' });
    // 240 payments beginning 2027-01-15: the FIRST is 2027-01-15, so the 240th falls
    // 239 months later, on 2046-12-15. Counting a full 240 months from the first EMI
    // would describe a 241-payment loan and leave it showing as a liability for an
    // extra month after it is repaid.
    expect(res.body.data.endDate).toMatch(/^2046-12-15/);
  });

  it('computes the pre-EMI interest across the gap between the two dates', async () => {
    const res = await request(app).post('/api/loans/derive').send({
      principalAmount: 3_000_000, interestRate: 9, tenureMonths: 240,
      disbursementDate: '2026-01-15', firstEmiDate: '2026-04-15',
    });
    // 3,000,000 x 9% / 12 = 22,500/month over 3 months.
    expect(res.body.data.preEmiAmount).toBe(67_500);
    expect(res.body.data.monthlyPreEmiAmount).toBe(22_500);
  });

  it('returns null pre-EMI when there is no gap', async () => {
    const res = await request(app).post('/api/loans/derive')
      .send({ ...BASE, disbursementDate: '2026-01-15' });
    expect(res.body.data.preEmiAmount).toBeNull();
  });

  it.each([
    ['principalAmount', { ...BASE, principalAmount: 0 }],
    ['interestRate', { ...BASE, interestRate: 0 }],
    ['tenureMonths', { ...BASE, tenureMonths: 0 }],
  ])('rejects a non-positive %s with 422', async (_f, body) => {
    const res = await request(app).post('/api/loans/derive').send(body);
    expect(res.status).toBe(422);
  });

  it('ignores an unparseable date rather than returning NaN', async () => {
    const res = await request(app).post('/api/loans/derive')
      .send({ ...BASE, disbursementDate: 'not-a-date' });
    expect(res.status).toBe(200);
    expect(res.body.data.endDate).toBeNull();
  });
});

// ─── Secured loans must name their collateral ────────────────────────────────

describe('secured-type asset requirement', () => {
  it.each(['HOME', 'AUTO', 'LAP', 'GOLD'])(
    'rejects a %s loan created without an asset', async (loanType) => {
      const { assetId, ...withoutAsset } = VALID_LOAN_BODY;
      const res = await request(app).post('/api/loans').send({ ...withoutAsset, loanType });
      expect(res.status).toBe(422);
      expect(JSON.stringify(res.body)).toMatch(/secured and must be linked to an asset/i);
    },
  );

  it.each(['PERSONAL', 'EDUCATION', 'BUSINESS', 'OTHER'])(
    'accepts an unsecured %s loan without an asset', async (loanType) => {
      const { assetId, ...withoutAsset } = VALID_LOAN_BODY;
      const res = await request(app).post('/api/loans').send({ ...withoutAsset, loanType });
      expect(res.status).toBe(201);
    },
  );

  it('passes owners through to the service on create', async () => {
    const owners = [{ userId: 'u1', sharePercent: 60 }, { userId: 'u2', sharePercent: 40 }];
    await request(app).post('/api/loans').send({ ...VALID_LOAN_BODY, owners });
    expect(createMock).toHaveBeenCalledWith('u1', expect.any(Object), owners);
  });

  it('passes owners through on update', async () => {
    const owners = [{ userId: 'u2', sharePercent: 100 }];
    await request(app).put('/api/loans/loan-1').send({ owners });
    expect(updateMock).toHaveBeenCalledWith('u1', 'loan-1', expect.any(Object), 'MEMBER', owners);
  });

  it('rejects an owner share above 100', async () => {
    const res = await request(app).post('/api/loans')
      .send({ ...VALID_LOAN_BODY, owners: [{ userId: 'u1', sharePercent: 101 }] });
    expect(res.status).toBe(422);
  });

  it('rejects an empty owners array — omit the key instead', async () => {
    const res = await request(app).post('/api/loans').send({ ...VALID_LOAN_BODY, owners: [] });
    expect(res.status).toBe(422);
  });
});

// ─── New persisted fields ────────────────────────────────────────────────────

describe('pre-EMI and prepayment fields', () => {
  it('accepts firstEmiDate and preEmiAmount', async () => {
    const res = await request(app).post('/api/loans').send({
      ...VALID_LOAN_BODY, firstEmiDate: '2026-04-15', preEmiAmount: 67_500,
    });
    expect(res.status).toBe(201);
    const [, data] = createMock.mock.calls[0];
    expect(data.preEmiAmount).toBe(67_500);
    expect(data.firstEmiDate).toBeInstanceOf(Date);
  });

  it('takes prepayment charges as a rupee amount, not a percentage', async () => {
    const res = await request(app).post('/api/loans')
      .send({ ...VALID_LOAN_BODY, prepaymentChargesAmount: 25_000 });
    expect(res.status).toBe(201);
    expect(createMock.mock.calls[0][1].prepaymentChargesAmount).toBe(25_000);
  });

  it('defaults prepayment charges to 0', async () => {
    await request(app).post('/api/loans').send(VALID_LOAN_BODY);
    expect(createMock.mock.calls[0][1].prepaymentChargesAmount).toBe(0);
  });

  it('rejects a negative prepayment charge', async () => {
    const res = await request(app).post('/api/loans')
      .send({ ...VALID_LOAN_BODY, prepaymentChargesAmount: -1 });
    expect(res.status).toBe(422);
  });
});

/**
 * Regression: an HTML form serializes a cleared field as `""`, not as an absent key.
 * These fields previously reached Prisma as an `Invalid Date` and an FK matching no row,
 * surfacing as a bare HTTP 500 and making every pre-existing loan uneditable.
 *
 * The route suite mocks loanService, so these assert on what the SERVICE RECEIVES —
 * which is precisely the boundary the bug crossed.
 */
describe('empty-string form fields are normalized at the API boundary', () => {
  beforeEach(() => {
    createMock.mockResolvedValue(MOCK_LOAN);
    updateMock.mockResolvedValue(MOCK_LOAN);
    getForAuditMock.mockResolvedValue(MOCK_LOAN);
    userFindFirstMock.mockResolvedValue({ id: 'u1' });
  });

  it('turns an empty firstEmiDate into null, not an Invalid Date', async () => {
    const res = await request(app)
      .post('/api/loans')
      .send({ ...VALID_LOAN_BODY, firstEmiDate: '' });

    expect(res.status).toBe(201);
    const received = createMock.mock.calls[0][1];
    expect(received.firstEmiDate).toBeNull();
  });

  it('turns an empty assetId into null so the FK is not violated', async () => {
    const res = await request(app)
      .post('/api/loans')
      .send({ ...VALID_LOAN_BODY, loanType: 'PERSONAL', assetId: '' });

    expect(res.status).toBe(201);
    const received = createMock.mock.calls[0][1];
    expect(received.assetId).toBeNull();
  });

  it('turns an empty preEmiAmount into null rather than 0', async () => {
    const res = await request(app)
      .post('/api/loans')
      .send({ ...VALID_LOAN_BODY, preEmiAmount: '' });

    expect(res.status).toBe(201);
    expect(createMock.mock.calls[0][1].preEmiAmount).toBeNull();
  });

  it('still rejects a genuinely malformed date', async () => {
    const res = await request(app)
      .post('/api/loans')
      .send({ ...VALID_LOAN_BODY, firstEmiDate: 'not-a-date' });

    expect(res.status).toBe(422);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('edits a legacy loan whose optional fields are all empty', async () => {
    const res = await request(app)
      .put('/api/loans/loan-1')
      .send({ emiAmount: 46000, firstEmiDate: '', preEmiAmount: '', assetId: '' });

    expect(res.status).toBe(200);
    const received = updateMock.mock.calls[0][2];
    expect(received.firstEmiDate).toBeNull();
    expect(received.assetId).toBeNull();
  });
});
