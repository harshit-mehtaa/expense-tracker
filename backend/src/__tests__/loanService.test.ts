/**
 * Tests for loanService — pure amortization math + DB-touching CRUD functions.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';

// Mock prisma (loanService uses named import { prisma })
vi.mock('../config/prisma', () => {
  const mockPrisma = {
    loan: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
  return { default: mockPrisma, prisma: mockPrisma };
});

import { prisma } from '../config/prisma';
import {
  buildAmortizationSchedule,
  getLoans,
  createLoan,
  updateLoan,
  deleteLoan,
  getLoanAmortization,
  simulatePrepayment,
} from '../services/loanService';

const loanMock = (prisma as any).loan;

const MOCK_LOAN = {
  id: 'loan-1',
  userId: 'u1',
  outstandingBalance: 4500000,
  interestRate: 8.5,
  emiAmount: 45000,
  emiDate: 5,
  prepaymentChargesPct: null,
};

// Pin system time for deterministic amortization schedule assertions
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2024-01-01'));
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Guard conditions ─────────────────────────────────────────────────────────

describe('buildAmortizationSchedule — guard conditions', () => {
  it('throws when EMI equals first-month interest (balance would never reduce)', () => {
    // 10 lakh @ 12% annual → monthly interest = 10_00_000 * 0.01 = 10_000
    // EMI exactly equal to interest → principal = 0
    expect(() =>
      buildAmortizationSchedule(1_000_000, 12, 10_000, 1, new Date('2025-01-01')),
    ).toThrow(/EMI.*must be greater than.*interest/);
  });

  it('throws when EMI is less than first-month interest', () => {
    expect(() =>
      buildAmortizationSchedule(1_000_000, 12, 9_000, 1, new Date('2025-01-01')),
    ).toThrow();
  });

  it('returns empty array when outstanding balance is zero', () => {
    const rows = buildAmortizationSchedule(0, 8.5, 9_800, 5, new Date('2025-01-01'));
    expect(rows).toHaveLength(0);
  });
});

// ─── Amortization math ────────────────────────────────────────────────────────

describe('buildAmortizationSchedule — math correctness', () => {
  // Known loan: ₹5,00,000 @ 10% annual, ₹10,000 EMI
  // Monthly rate: 10/100/12 ≈ 0.008333
  // Month 1 interest: 5,00,000 * 0.008333 ≈ 4,166.67
  // Month 1 principal: 10,000 - 4,166.67 = 5,833.33
  const PRINCIPAL = 500_000;
  const RATE = 10; // % annual
  const EMI = 10_000;
  const START = new Date('2025-01-01');

  function getSchedule() {
    return buildAmortizationSchedule(PRINCIPAL, RATE, EMI, 1, START);
  }

  it('first row openingBalance equals the outstanding principal', () => {
    const [row1] = getSchedule();
    expect(row1.openingBalance).toBeCloseTo(PRINCIPAL, 2);
  });

  it('first row interest = outstanding * (rate/12/100)', () => {
    const [row1] = getSchedule();
    const expectedInterest = PRINCIPAL * (RATE / 100 / 12);
    expect(row1.interest).toBeCloseTo(expectedInterest, 2);
  });

  it('first row principal + interest = EMI', () => {
    const [row1] = getSchedule();
    expect(row1.principal + row1.interest).toBeCloseTo(EMI, 2);
  });

  it('first row closingBalance = openingBalance - principal', () => {
    const [row1] = getSchedule();
    expect(row1.closingBalance).toBeCloseTo(row1.openingBalance - row1.principal, 2);
  });

  it('subsequent row openingBalance = previous row closingBalance', () => {
    const rows = getSchedule();
    for (let i = 1; i < Math.min(rows.length, 10); i++) {
      expect(rows[i].openingBalance).toBeCloseTo(rows[i - 1].closingBalance, 2);
    }
  });

  it('last row closingBalance is <= 0.5 (loop termination)', () => {
    const rows = getSchedule();
    const last = rows[rows.length - 1];
    expect(last.closingBalance).toBeLessThanOrEqual(0.5);
  });

  it('totalInterestPaid in last row matches running sum of all interest', () => {
    const rows = getSchedule();
    const summedInterest = rows.reduce((s, r) => s + r.interest, 0);
    const lastTotalInterest = rows[rows.length - 1].totalInterestPaid;
    expect(lastTotalInterest).toBeCloseTo(summedInterest, 2);
  });

  it('month field increments by 1 for each row starting at 1', () => {
    const rows = getSchedule();
    rows.forEach((r, i) => {
      expect(r.month).toBe(i + 1);
    });
  });

  it('date advances by one month per row', () => {
    const rows = getSchedule();
    for (let i = 1; i < Math.min(rows.length, 6); i++) {
      const prevDate = rows[i - 1].date;
      const currDate = rows[i].date;
      // Months differ by 1 (wrapping at December handled by JS Date)
      const prevMonth = prevDate.getFullYear() * 12 + prevDate.getMonth();
      const currMonth = currDate.getFullYear() * 12 + currDate.getMonth();
      expect(currMonth - prevMonth).toBe(1);
    }
  });

  it('never exceeds 360 rows (guard against infinite loop)', () => {
    // Very small EMI just above the interest threshold
    const outstanding = 10_000;
    const annualRate = 12;
    const monthlyInterest = outstanding * (annualRate / 100 / 12); // 100
    const rows = buildAmortizationSchedule(outstanding, annualRate, monthlyInterest + 1, 1, new Date());
    expect(rows.length).toBeLessThanOrEqual(360);
  });
});

// ─── EMI field ────────────────────────────────────────────────────────────────

describe('buildAmortizationSchedule — EMI field', () => {
  it('all rows carry the original EMI amount (except possibly the last)', () => {
    const rows = buildAmortizationSchedule(500_000, 10, 10_000, 1, new Date('2025-01-01'));
    // All rows except the last should have emi === 10_000
    rows.slice(0, -1).forEach((r) => {
      expect(r.emi).toBe(10_000);
    });
  });
});

// ─── DB-touching functions (Prisma mocked) ────────────────────────────────────

describe('getLoans', () => {
  it('scopes query to userId when provided', async () => {
    loanMock.findMany.mockResolvedValue([MOCK_LOAN]);
    const result = await getLoans('u1');
    expect(loanMock.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      orderBy: { emiDate: 'asc' },
    });
    expect(result).toHaveLength(1);
  });

  it('returns all loans when no userId given (family-wide)', async () => {
    loanMock.findMany.mockResolvedValue([MOCK_LOAN]);
    await getLoans();
    expect(loanMock.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { emiDate: 'asc' },
    });
  });
});

describe('createLoan', () => {
  it('creates loan with userId merged into data', async () => {
    const data = {
      lenderName: 'HDFC',
      loanType: 'HOME',
      principalAmount: 5000000,
      outstandingBalance: 4500000,
      interestRate: 8.5,
      emiAmount: 45000,
      emiDate: 5,
      tenureMonths: 180,
    };
    loanMock.create.mockResolvedValue({ ...data, id: 'loan-new', userId: 'u1' });
    const result = await createLoan('u1', data as any);
    expect(loanMock.create).toHaveBeenCalledWith({ data: { ...data, userId: 'u1' } });
    expect((result as any).id).toBe('loan-new');
  });
});

describe('updateLoan', () => {
  it('returns updated loan when found', async () => {
    loanMock.findFirst.mockResolvedValue(MOCK_LOAN);
    loanMock.update.mockResolvedValue({ ...MOCK_LOAN, emiAmount: 46000 });
    const result = await updateLoan('u1', 'loan-1', { emiAmount: 46000 });
    expect(loanMock.update).toHaveBeenCalledWith({ where: { id: 'loan-1' }, data: { emiAmount: 46000 } });
    expect((result as any).emiAmount).toBe(46000);
  });

  it('throws NotFound when loan does not exist', async () => {
    loanMock.findFirst.mockResolvedValue(null);
    await expect(updateLoan('u1', 'nonexistent', {})).rejects.toThrow(/not found/i);
  });
});

describe('deleteLoan', () => {
  it('deletes loan when found', async () => {
    loanMock.findFirst.mockResolvedValue(MOCK_LOAN);
    loanMock.delete.mockResolvedValue(MOCK_LOAN);
    await deleteLoan('u1', 'loan-1');
    expect(loanMock.delete).toHaveBeenCalledWith({ where: { id: 'loan-1' } });
  });

  it('throws NotFound when loan does not exist', async () => {
    loanMock.findFirst.mockResolvedValue(null);
    await expect(deleteLoan('u1', 'nonexistent')).rejects.toThrow(/not found/i);
  });
});

describe('getLoanAmortization', () => {
  it('returns loan with schedule and summary', async () => {
    loanMock.findFirst.mockResolvedValue(MOCK_LOAN);
    const result = await getLoanAmortization('u1', 'loan-1');
    expect(result.loan).toBe(MOCK_LOAN);
    expect(Array.isArray(result.schedule)).toBe(true);
    expect(result.schedule.length).toBeGreaterThan(0);
    expect(result.summary.remainingMonths).toBe(result.schedule.length);
    expect(result.summary.totalInterest).toBeGreaterThan(0);
  });

  it('scopes findFirst to userId when provided', async () => {
    loanMock.findFirst.mockResolvedValue(MOCK_LOAN);
    await getLoanAmortization('u1', 'loan-1');
    expect(loanMock.findFirst).toHaveBeenCalledWith({ where: { id: 'loan-1', userId: 'u1' } });
  });

  it('omits userId in query when undefined (ADMIN family-wide)', async () => {
    loanMock.findFirst.mockResolvedValue(MOCK_LOAN);
    await getLoanAmortization(undefined, 'loan-1');
    expect(loanMock.findFirst).toHaveBeenCalledWith({ where: { id: 'loan-1' } });
  });

  it('throws NotFound when loan does not exist', async () => {
    loanMock.findFirst.mockResolvedValue(null);
    await expect(getLoanAmortization('u1', 'nonexistent')).rejects.toThrow(/not found/i);
  });
});

describe('simulatePrepayment', () => {
  it('reduce_tenure mode: shorter schedule and positive interest savings', async () => {
    loanMock.findFirst.mockResolvedValue(MOCK_LOAN);
    const result = await simulatePrepayment('u1', 'loan-1', 500_000, 'reduce_tenure');
    expect(result.after.months).toBeLessThan(result.current.months);
    expect(result.savings.interestSaved).toBeGreaterThan(0);
    expect(result.savings.monthsSaved).toBeGreaterThan(0);
  });

  it('reduce_emi mode: positive interest savings', async () => {
    loanMock.findFirst.mockResolvedValue(MOCK_LOAN);
    const result = await simulatePrepayment('u1', 'loan-1', 500_000, 'reduce_emi');
    expect(result.savings.interestSaved).toBeGreaterThan(0);
  });

  it('prepaymentCharges is 0 when prepaymentChargesPct is null', async () => {
    loanMock.findFirst.mockResolvedValue({ ...MOCK_LOAN, prepaymentChargesPct: null });
    const result = await simulatePrepayment('u1', 'loan-1', 100_000, 'reduce_tenure');
    expect(result.prepaymentCharges).toBe(0);
  });

  it('throws NotFound when loan does not exist', async () => {
    loanMock.findFirst.mockResolvedValue(null);
    await expect(simulatePrepayment('u1', 'nonexistent', 100_000, 'reduce_tenure')).rejects.toThrow(/not found/i);
  });

  it('queries by id only when userId is undefined (covers !userId branch)', async () => {
    loanMock.findFirst.mockResolvedValue(MOCK_LOAN);
    await simulatePrepayment(undefined, 'loan-1', 100_000, 'reduce_tenure');
    expect(loanMock.findFirst).toHaveBeenCalledWith({ where: { id: 'loan-1' } });
  });
});
