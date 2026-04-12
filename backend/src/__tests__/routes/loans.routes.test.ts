/**
 * Route integration tests for /api/loans.
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
import { makeApp } from '../helpers/makeApp';

const app = makeApp(loansRouter, '/api/loans');
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
  createMock.mockResolvedValue({ ...MOCK_LOAN, id: 'loan-new' });
  updateMock.mockResolvedValue(MOCK_LOAN);
  deleteMock.mockResolvedValue(undefined);
  getAmortizationMock.mockResolvedValue({ loan: MOCK_LOAN, schedule: [], summary: { totalInterest: 0, remainingMonths: 0 } });
  simulateMock.mockResolvedValue({ savings: 0, newSchedule: [] });
});

describe('GET /api/loans', () => {
  it('returns 200 with loan list', async () => {
    const res = await request(app).get('/api/loans');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(getLoansMock).toHaveBeenCalled();
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
});

describe('POST /api/loans/:id/prepayment-simulation', () => {
  it('returns 200 on valid prepayment simulation', async () => {
    const res = await request(app)
      .post('/api/loans/loan-1/prepayment-simulation')
      .send({ prepaymentAmount: 100000, mode: 'reduce_tenure' });
    expect(res.status).toBe(200);
    expect(simulateMock).toHaveBeenCalled();
  });

  it('returns 422 when prepaymentAmount is negative', async () => {
    const res = await request(app)
      .post('/api/loans/loan-1/prepayment-simulation')
      .send({ prepaymentAmount: -100, mode: 'reduce_tenure' });
    expect(res.status).toBe(422);
  });
});
