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
}));

vi.mock('../../config/prisma', () => {
  const prisma = { user: { findFirst: vi.fn() } };
  return { default: prisma, prisma };
});

import loansRouter from '../../routes/loans';
import * as svc from '../../services/loanService';
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
    expect(updateMock).toHaveBeenCalledWith('u1', 'loan-1', { emiAmount: 46000 });
  });
});

describe('DELETE /api/loans/:id', () => {
  it('returns 204 on deletion', async () => {
    const res = await request(app).delete('/api/loans/loan-1');
    expect(res.status).toBe(204);
    expect(deleteMock).toHaveBeenCalledWith('u1', 'loan-1');
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
