/**
 * Tests for loanService — pure amortization math + DB-touching CRUD functions.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { computeEmi } from '../utils/loanMath';

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
    // assertActiveLoanOwners checks every owner is an active family member.
    user: { findMany: vi.fn() },
    // assertAssetOwned confirms the collateral belongs to the loan's owner.
    asset: { findFirst: vi.fn() },
    loanPrepayment: { create: vi.fn(), findMany: vi.fn() },
    // recordLoanPrepayment's second write is the array form, which just runs each
    // already-invoked op — the individual mocks below control what each resolves to.
    $transaction: vi.fn((ops: unknown) => Promise.all(ops as Promise<unknown>[])),
  };
  return { default: mockPrisma, prisma: mockPrisma };
});

// createTransaction is the ONE existing writer of outstandingBalance
// (transactionService.ts) — recordLoanPrepayment reuses it rather than duplicating the
// decrement (see loanService.ts's own comment on why). Mocked wholesale rather than
// simulated through raw prisma calls: its own behavior is transactionService.test.ts's
// job, not loanService's.
vi.mock('../services/transactionService', () => ({
  createTransaction: vi.fn(),
}));

import { prisma } from '../config/prisma';
import { createTransaction } from '../services/transactionService';
import {
  buildAmortizationSchedule,
  getLoans,
  createLoan,
  updateLoan,
  deleteLoan,
  getLoanAmortization,
  simulatePrepayment,
  getLoanForAudit,
  recordLoanPrepayment,
  listLoanPrepayments,
} from '../services/loanService';

const loanMock = (prisma as any).loan;
const userMock = (prisma as any).user;
const assetMock = (prisma as any).asset;
const prepaymentMock = (prisma as any).loanPrepayment;
const createTransactionMock = createTransaction as unknown as ReturnType<typeof vi.fn>;

const MOCK_LOAN = {
  id: 'loan-1',
  userId: 'u1',
  loanType: 'PERSONAL',
  assetId: null,
  outstandingBalance: 4500000,
  interestRate: 8.5,
  emiAmount: 45000,
  emiDate: 5,
  prepaymentChargesAmount: null,
  owners: [],
};

/** The include shape every loan read now uses. */
const LOAN_INCLUDE = {
  user: { select: { name: true } },
  owners: { include: { user: { select: { name: true } } } },
  asset: true,
};

/** A loan is visible to its primary owner OR anyone holding a share of it. */
const ownerInclusive = (userId: string) => ({
  OR: [{ userId }, { owners: { some: { userId } } }],
});

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
  // Default: the asset exists and belongs to the loan's owner. Tests that specifically
  // exercise the cross-owner leak override this with null.
  assetMock.findFirst.mockResolvedValue({ id: 'asset-1' });
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
      where: ownerInclusive('u1'),
      include: LOAN_INCLUDE,
      orderBy: { emiDate: 'asc' },
    });
    expect(result).toHaveLength(1);
  });

  it('returns all loans when no userId given (family-wide)', async () => {
    loanMock.findMany.mockResolvedValue([MOCK_LOAN]);
    await getLoans();
    expect(loanMock.findMany).toHaveBeenCalledWith({
      where: {},
      include: LOAN_INCLUDE,
      orderBy: { emiDate: 'asc' },
    });
  });

  it('flattens the joined user name into userName and drops the nested user object', async () => {
    loanMock.findMany.mockResolvedValue([{ ...MOCK_LOAN, user: { name: 'Harshit' } }]);
    const [row] = await getLoans();
    expect(row.userName).toBe('Harshit');
    expect(row).not.toHaveProperty('user');
  });

  it('falls back to an empty userName when the join returns no user', async () => {
    loanMock.findMany.mockResolvedValue([{ ...MOCK_LOAN, user: null }]);
    const [row] = await getLoans();
    expect(row.userName).toBe('');
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
    // A HOME loan is secured, so it now needs an asset — see the secured-type tests below.
    const withAsset = { ...data, assetId: 'asset-1' };
    userMock.findMany.mockResolvedValue([{ id: 'u1' }]);
    loanMock.create.mockResolvedValue({ ...withAsset, id: 'loan-new', userId: 'u1', owners: [] });

    const result = await createLoan('u1', withAsset as any);

    expect(loanMock.create).toHaveBeenCalledWith({
      data: {
        ...withAsset,
        userId: 'u1',
        // Omitting owners seeds the creator at 100%, preserving pre-multi-owner behaviour.
        owners: { create: [{ userId: 'u1', sharePercent: 100 }] },
      },
      include: LOAN_INCLUDE,
    });
    expect((result as any).id).toBe('loan-new');
  });
});

describe('updateLoan', () => {
  it('returns updated loan when found', async () => {
    loanMock.findFirst.mockResolvedValue(MOCK_LOAN);
    loanMock.update.mockResolvedValue({ ...MOCK_LOAN, emiAmount: 46000 });
    const result = await updateLoan('u1', 'loan-1', { emiAmount: 46000 });
    expect(loanMock.update).toHaveBeenCalledWith({
      where: { id: 'loan-1' }, data: { emiAmount: 46000 }, include: LOAN_INCLUDE,
    });
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

describe('getLoanForAudit', () => {
  it('scopes to the requester for MEMBER', async () => {
    loanMock.findFirst.mockResolvedValue(MOCK_LOAN);
    const result = await getLoanForAudit('u1', 'loan-1', 'MEMBER');
    expect(loanMock.findFirst).toHaveBeenCalledWith({ where: { id: 'loan-1', ...ownerInclusive('u1') } });
    expect(result).toBe(MOCK_LOAN);
  });

  it('drops the owner filter for ADMIN — can fetch another member\'s loan', async () => {
    loanMock.findFirst.mockResolvedValue(MOCK_LOAN);
    await getLoanForAudit('admin-1', 'loan-1', 'ADMIN');
    expect(loanMock.findFirst).toHaveBeenCalledWith({ where: { id: 'loan-1' } });
  });

  it('returns null when not found — does not throw (audit snapshot, not an authz check)', async () => {
    loanMock.findFirst.mockResolvedValue(null);
    const result = await getLoanForAudit('u1', 'nonexistent');
    expect(result).toBeNull();
  });

  it('defaults requesterRole to MEMBER when omitted', async () => {
    await getLoanForAudit('u1', 'loan-1');
    expect(loanMock.findFirst).toHaveBeenCalledWith({ where: { id: 'loan-1', ...ownerInclusive('u1') } });
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
    expect(loanMock.findFirst).toHaveBeenCalledWith({ where: { id: 'loan-1', ...ownerInclusive('u1') } });
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

  it('reduce_emi derives the new EMI from computeEmi, not an inline formula', async () => {
    // Guards the extraction: simulatePrepayment used to carry its own copy of
    // P*r*(1+r)^n/((1+r)^n-1). The derived EMI must clear buildAmortizationSchedule's
    // first-month-interest floor, which is exactly why computeEmi rounds UP.
    loanMock.findFirst.mockResolvedValue(MOCK_LOAN);

    // The guard is structural: buildAmortizationSchedule THROWS on an EMI at or below
    // the first month's interest, so a schedule that builds at all proves the derived
    // EMI cleared the floor. A nearest-rounded EMI can fail exactly here.
    const result = await simulatePrepayment('u1', 'loan-1', 500_000, 'reduce_emi');

    expect(result.after.months).toBeGreaterThan(0);
    // reduce_emi keeps the tenure and shrinks the payment, unlike reduce_tenure.
    const reduceTenure = await simulatePrepayment('u1', 'loan-1', 500_000, 'reduce_tenure');
    expect(result.after.months).toBeGreaterThan(reduceTenure.after.months);
    expect(result.savings.monthsSaved).toBeLessThan(reduceTenure.savings.monthsSaved);
  });

  it('reduce_emi survives a prepayment that clears the whole balance', async () => {
    // newOutstanding hits 0, so computeEmi returns null and the existing EMI is used.
    // Without the fallback this passed null into buildAmortizationSchedule.
    loanMock.findFirst.mockResolvedValue(MOCK_LOAN);
    const full = Number(MOCK_LOAN.outstandingBalance);

    const result = await simulatePrepayment('u1', 'loan-1', full, 'reduce_emi');
    expect(result.after.months).toBe(0);
    expect(result.after.totalInterest).toBe(0);
    expect(result.savings.interestSaved).toBeGreaterThan(0);
  });

  it('prepaymentCharges is 0 when no charge is recorded', async () => {
    loanMock.findFirst.mockResolvedValue({ ...MOCK_LOAN, prepaymentChargesAmount: 0 });
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

// ─── recordLoanPrepayment / listLoanPrepayments ────────────────────────────────

// Needs the fields simulatePrepayment's MOCK_LOAN never touches: lenderName feeds the
// transaction description, tenureMonths/disbursementDate/firstEmiDate feed the
// reduce_tenure endDate recompute.
const PREPAY_LOAN = {
  ...MOCK_LOAN,
  lenderName: 'HDFC Bank',
  tenureMonths: 240,
  disbursementDate: new Date('2020-01-01'),
  firstEmiDate: null,
  endDate: new Date('2040-01-01'),
};

const MOCK_TRANSACTION = { id: 'txn-1', loanId: 'loan-1', amount: 500_000 };

describe('recordLoanPrepayment', () => {
  beforeEach(() => {
    loanMock.findFirst.mockResolvedValue(PREPAY_LOAN);
    createTransactionMock.mockResolvedValue(MOCK_TRANSACTION);
    prepaymentMock.create.mockImplementation((args: any) => Promise.resolve({ id: 'prepay-1', ...args.data }));
    loanMock.update.mockImplementation((args: any) => Promise.resolve({ ...PREPAY_LOAN, ...args.data }));
  });

  it('VQ2: decrements outstandingBalance through createTransaction only — never writes it directly', async () => {
    await recordLoanPrepayment('u1', 'MEMBER', 'loan-1', {
      amount: 500_000, date: '2024-01-15', mode: 'reduce_tenure',
    });

    expect(createTransactionMock).toHaveBeenCalledWith('u1', expect.objectContaining({
      type: 'EXPENSE', amount: 500_000, loanId: 'loan-1',
    }));
    // The loan.update call (LoanPrepayment side-effect) must never itself carry
    // outstandingBalance — createTransaction is the only writer of that field.
    const loanUpdateCall = loanMock.update.mock.calls[0][0];
    expect(loanUpdateCall.data).not.toHaveProperty('outstandingBalance');
  });

  it('DQ4: reduce_emi persists reducedEmi computed by the SAME computeEmi primitive simulatePrepayment uses', async () => {
    const outstanding = Number(PREPAY_LOAN.outstandingBalance);
    const rate = Number(PREPAY_LOAN.interestRate);
    const current = buildAmortizationSchedule(outstanding, rate, Number(PREPAY_LOAN.emiAmount), PREPAY_LOAN.emiDate, new Date());
    const expectedEmi = computeEmi(outstanding - 500_000, rate, current.length) ?? Number(PREPAY_LOAN.emiAmount);

    const result = await recordLoanPrepayment('u1', 'MEMBER', 'loan-1', {
      amount: 500_000, date: '2024-01-15', mode: 'reduce_emi',
    });

    const prepaymentCreateCall = prepaymentMock.create.mock.calls[0][0];
    expect(prepaymentCreateCall.data.reducedEmi).toBe(expectedEmi);
    expect(prepaymentCreateCall.data.tenureReduced).toBeNull();

    // emiAmount actually changes on the loan; tenure/endDate do not.
    const loanUpdateCall = loanMock.update.mock.calls[0][0];
    expect(loanUpdateCall.data).toHaveProperty('emiAmount');
    expect(loanUpdateCall.data).not.toHaveProperty('tenureMonths');
    expect(loanUpdateCall.data).not.toHaveProperty('endDate');
    expect(result.loan.emiAmount).toBe(loanUpdateCall.data.emiAmount);
  });

  it('VQ1/VQ3: reduce_tenure persists tenureReduced and recomputes endDate via deriveEndDate', async () => {
    await recordLoanPrepayment('u1', 'MEMBER', 'loan-1', {
      amount: 500_000, date: '2024-01-15', mode: 'reduce_tenure',
    });

    const prepaymentCreateCall = prepaymentMock.create.mock.calls[0][0];
    expect(prepaymentCreateCall.data.reducedEmi).toBeNull();
    expect(prepaymentCreateCall.data.tenureReduced).toBeGreaterThan(0);

    const loanUpdateCall = loanMock.update.mock.calls[0][0];
    expect(loanUpdateCall.data).toHaveProperty('tenureMonths');
    expect(loanUpdateCall.data).toHaveProperty('endDate');
    expect(loanUpdateCall.data).not.toHaveProperty('emiAmount');
    // endDate must be strictly earlier than the loan's original endDate — a prepayment
    // that does not shorten the loan is not actually reducing tenure.
    expect((loanUpdateCall.data.endDate as Date).getTime()).toBeLessThan(PREPAY_LOAN.endDate.getTime());
  });

  it('passes through notes, bankAccountId and categoryId to the linked transaction', async () => {
    await recordLoanPrepayment('u1', 'MEMBER', 'loan-1', {
      amount: 500_000, date: '2024-01-15', mode: 'reduce_tenure',
      notes: 'Annual bonus', bankAccountId: 'acct-1', categoryId: 'cat-1',
    });

    expect(createTransactionMock).toHaveBeenCalledWith('u1', expect.objectContaining({
      bankAccountId: 'acct-1', categoryId: 'cat-1',
    }));
    const prepaymentCreateCall = prepaymentMock.create.mock.calls[0][0];
    expect(prepaymentCreateCall.data.notes).toBe('Annual bonus');
  });

  it('VQ4/DQ6: attributes the transaction to the LOAN\'s primary owner, not the requester', async () => {
    // A co-owner (requester 'u2') records a prepayment on a loan primarily owned by 'u1'.
    loanMock.findFirst.mockResolvedValue({ ...PREPAY_LOAN, userId: 'u1' });
    await recordLoanPrepayment('u2', 'MEMBER', 'loan-1', {
      amount: 500_000, date: '2024-01-15', mode: 'reduce_tenure',
    });
    expect(createTransactionMock).toHaveBeenCalledWith('u1', expect.anything());
  });

  it('VQ8: a co-owner (not primary owner) can write, via userLoanWriteWhere', async () => {
    await recordLoanPrepayment('u2', 'MEMBER', 'loan-1', {
      amount: 100_000, date: '2024-01-15', mode: 'reduce_tenure',
    });
    expect(loanMock.findFirst).toHaveBeenCalledWith({
      where: { id: 'loan-1', OR: [{ userId: 'u2' }, { owners: { some: { userId: 'u2' } } }] },
    });
  });

  it('VQ8: ADMIN can write any loan regardless of ownership', async () => {
    await recordLoanPrepayment('admin-1', 'ADMIN', 'loan-1', {
      amount: 100_000, date: '2024-01-15', mode: 'reduce_tenure',
    });
    expect(loanMock.findFirst).toHaveBeenCalledWith({ where: { id: 'loan-1' } });
  });

  it('404s for a loan the requester cannot write to', async () => {
    loanMock.findFirst.mockResolvedValue(null);
    await expect(recordLoanPrepayment('u3', 'MEMBER', 'loan-1', {
      amount: 100_000, date: '2024-01-15', mode: 'reduce_tenure',
    })).rejects.toThrow(/not found/i);
    expect(createTransactionMock).not.toHaveBeenCalled();
  });

  it('VQ7: an amount exceeding the outstanding balance fails via createTransaction\'s own check', async () => {
    createTransactionMock.mockRejectedValue(new Error('Payment amount exceeds outstanding loan balance'));
    await expect(recordLoanPrepayment('u1', 'MEMBER', 'loan-1', {
      amount: 99_000_000, date: '2024-01-15', mode: 'reduce_tenure',
    })).rejects.toThrow(/exceeds outstanding/i);
    // Money movement failed — the audit row and loan update must never have run.
    expect(prepaymentMock.create).not.toHaveBeenCalled();
    expect(loanMock.update).not.toHaveBeenCalled();
  });
});

describe('listLoanPrepayments', () => {
  it('lists prepayments for a loan the user can see, most recent first', async () => {
    loanMock.findFirst.mockResolvedValue(PREPAY_LOAN);
    prepaymentMock.findMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);

    const result = await listLoanPrepayments('u1', 'loan-1');

    expect(loanMock.findFirst).toHaveBeenCalledWith({
      where: { id: 'loan-1', OR: [{ userId: 'u1' }, { owners: { some: { userId: 'u1' } } }] },
    });
    expect(prepaymentMock.findMany).toHaveBeenCalledWith({
      where: { loanId: 'loan-1' }, orderBy: { date: 'desc' },
    });
    expect(result).toEqual([{ id: 'p1' }, { id: 'p2' }]);
  });

  it('family-wide (ADMIN, no userId) queries by id only', async () => {
    loanMock.findFirst.mockResolvedValue(PREPAY_LOAN);
    prepaymentMock.findMany.mockResolvedValue([]);
    await listLoanPrepayments(undefined, 'loan-1');
    expect(loanMock.findFirst).toHaveBeenCalledWith({ where: { id: 'loan-1' } });
  });

  it('404s when the loan is not visible to the requester', async () => {
    loanMock.findFirst.mockResolvedValue(null);
    await expect(listLoanPrepayments('u3', 'loan-1')).rejects.toThrow(/not found/i);
  });
});

// ─── Requirement 4: co-owner visibility (the security surface) ────────────────

describe('loan visibility — who can see and edit a shared loan', () => {
  beforeEach(() => {
    userMock.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
  });

  it('a MEMBER sees loans they own OR co-own, and nothing else', async () => {
    loanMock.findMany.mockResolvedValue([]);
    await getLoans('u2');

    // The OR is the whole point: without the owners clause a co-owner sees nothing.
    expect(loanMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ userId: 'u2' }, { owners: { some: { userId: 'u2' } } }] },
      }),
    );
  });

  it.each([
    ['updateLoan', () => updateLoan('u2', 'loan-1', { emiAmount: 1 })],
    ['deleteLoan', () => deleteLoan('u2', 'loan-1')],
    ['getLoanForAudit', () => getLoanForAudit('u2', 'loan-1')],
  ])('%s scopes a MEMBER to loans they own or co-own', async (_name, call) => {
    loanMock.findFirst.mockResolvedValue({ ...MOCK_LOAN, userId: 'u1' });
    loanMock.update.mockResolvedValue(MOCK_LOAN);
    loanMock.delete.mockResolvedValue(MOCK_LOAN);

    await call().catch(() => { /* only the predicate matters here */ });

    expect(loanMock.findFirst).toHaveBeenCalledWith({
      where: { id: 'loan-1', OR: [{ userId: 'u2' }, { owners: { some: { userId: 'u2' } } }] },
    });
  });

  it.each([
    ['updateLoan', () => updateLoan('admin-1', 'loan-1', { emiAmount: 1 }, 'ADMIN')],
    ['deleteLoan', () => deleteLoan('admin-1', 'loan-1', 'ADMIN')],
    ['getLoanForAudit', () => getLoanForAudit('admin-1', 'loan-1', 'ADMIN')],
  ])('%s drops the owner filter entirely for an ADMIN', async (_name, call) => {
    loanMock.findFirst.mockResolvedValue(MOCK_LOAN);
    loanMock.update.mockResolvedValue(MOCK_LOAN);
    loanMock.delete.mockResolvedValue(MOCK_LOAN);

    await call();
    expect(loanMock.findFirst).toHaveBeenCalledWith({ where: { id: 'loan-1' } });
  });

  it('a stranger gets NotFound, not someone else\'s loan', async () => {
    // The predicate matches nothing, so findFirst returns null and the service 404s.
    loanMock.findFirst.mockResolvedValue(null);
    await expect(updateLoan('stranger', 'loan-1', {})).rejects.toThrow(/not found/i);
    await expect(deleteLoan('stranger', 'loan-1')).rejects.toThrow(/not found/i);
    expect(loanMock.update).not.toHaveBeenCalled();
    expect(loanMock.delete).not.toHaveBeenCalled();
  });

  it('a co-owner cannot hijack the primary by omitting owners', async () => {
    // Owners default from the ROW's userId, never the requester — otherwise u2 could
    // send owners:[] and quietly become the sole 100% owner.
    loanMock.findFirst.mockResolvedValue({ ...MOCK_LOAN, userId: 'u1' });
    loanMock.update.mockResolvedValue({ ...MOCK_LOAN, owners: [] });

    await updateLoan('u2', 'loan-1', {}, 'MEMBER', []);

    const call = loanMock.update.mock.calls[0][0];
    expect(call.data.owners.create).toEqual([{ userId: 'u1', sharePercent: 100 }]);
  });

  it('a co-owner cannot remove the primary owner with a NON-empty owners array', async () => {
    // The empty-array default above only guards the empty case. A non-empty array was
    // taken verbatim and written with `deleteMany: {}`, so a 1% co-owner could send
    // [{self, 100}] and delete the primary owner's row from their own loan.
    loanMock.findFirst.mockResolvedValue({ ...MOCK_LOAN, userId: 'u1' });

    await expect(
      updateLoan('u2', 'loan-1', {}, 'MEMBER', [{ userId: 'u2', sharePercent: 100 }]),
    ).rejects.toThrow(/only the loan owner or an admin/i);

    expect(loanMock.update).not.toHaveBeenCalled();
  });

  it('the primary owner may restructure ownership away from themselves', async () => {
    loanMock.findFirst.mockResolvedValue({ ...MOCK_LOAN, userId: 'u1' });
    loanMock.update.mockResolvedValue({ ...MOCK_LOAN, owners: [] });
    userMock.findMany.mockResolvedValue([{ id: 'u2' }]);

    await updateLoan('u1', 'loan-1', {}, 'MEMBER', [{ userId: 'u2', sharePercent: 100 }]);

    const call = loanMock.update.mock.calls[0][0];
    expect(call.data.owners.create).toEqual([{ userId: 'u2', sharePercent: 100 }]);
  });

  it('refuses to attach an asset belonging to another member', async () => {
    // loanInclude returns the asset's name and value, so an unvalidated assetId let
    // member A read member B's collateral back through their own loan — and B's asset
    // list then disclosed A's loan in return.
    loanMock.findFirst.mockResolvedValue({ ...MOCK_LOAN, userId: 'u1' });
    assetMock.findFirst.mockResolvedValue(null); // not owned by the loan's owner

    await expect(
      updateLoan('u1', 'loan-1', { assetId: 'asset-of-u2' } as never, 'MEMBER'),
    ).rejects.toThrow(/asset/i);

    expect(loanMock.update).not.toHaveBeenCalled();
    expect(assetMock.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'asset-of-u2', userId: 'u1' } }),
    );
  });

  it('a non-numeric share is rejected', async () => {
    loanMock.findFirst.mockResolvedValue({ ...MOCK_LOAN, userId: 'u1' });

    await expect(
      updateLoan('u1', 'loan-1', {}, 'MEMBER', [
        { userId: 'u1', sharePercent: Number.NaN },
      ]),
    ).rejects.toThrow(/greater than 0/i);

    expect(loanMock.update).not.toHaveBeenCalled();
  });

  it('a share that rounds to 0% is rejected rather than granting silent write access', async () => {
    // 0.001 passed the raw `> 0` check and then stored as 0. Because the visibility
    // predicates key on owner membership alone, that 0% row still granted full
    // view/edit/delete rights on the loan.
    loanMock.findFirst.mockResolvedValue({ ...MOCK_LOAN, userId: 'u1' });

    await expect(
      updateLoan('u1', 'loan-1', {}, 'MEMBER', [
        { userId: 'u1', sharePercent: 99.999 },
        { userId: 'u3', sharePercent: 0.001 },
      ]),
    ).rejects.toThrow(/greater than 0/i);

    expect(loanMock.update).not.toHaveBeenCalled();
  });
});

// ─── Owner share validation ───────────────────────────────────────────────────

describe('loan owner shares', () => {
  beforeEach(() => {
    userMock.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
    loanMock.create.mockResolvedValue({ ...MOCK_LOAN, owners: [] });
  });

  const base = { lenderName: 'HDFC', loanType: 'PERSONAL', principalAmount: 100000 };

  it('accepts shares that total 100', async () => {
    await createLoan('u1', base as any, [
      { userId: 'u1', sharePercent: 60 },
      { userId: 'u2', sharePercent: 40 },
    ]);
    expect(loanMock.create).toHaveBeenCalled();
  });

  it('accepts fractional shares within the 0.01 tolerance', async () => {
    await createLoan('u1', base as any, [
      { userId: 'u1', sharePercent: 33.33 },
      { userId: 'u2', sharePercent: 66.67 },
    ]);
    expect(loanMock.create).toHaveBeenCalled();
  });

  it.each([
    [[{ userId: 'u1', sharePercent: 60 }, { userId: 'u2', sharePercent: 30 }], /add up to 100/i],
    [[{ userId: 'u1', sharePercent: 60 }, { userId: 'u2', sharePercent: 50 }], /add up to 100/i],
    [[{ userId: 'u1', sharePercent: 50 }, { userId: 'u1', sharePercent: 50 }], /only be added once/i],
    [[{ userId: 'u1', sharePercent: 0 }, { userId: 'u2', sharePercent: 100 }], /greater than 0/i],
    [[{ userId: 'u1', sharePercent: 101 }], /at most 100/i],
    [[{ userId: '', sharePercent: 100 }], /owner is required/i],
  ])('rejects invalid shares (%#)', async (owners, message) => {
    await expect(createLoan('u1', base as any, owners as any)).rejects.toThrow(message);
    expect(loanMock.create).not.toHaveBeenCalled();
  });

  it('rejects an inactive or deleted family member as an owner', async () => {
    userMock.findMany.mockResolvedValue([{ id: 'u1' }]); // u2 is not active
    await expect(createLoan('u1', base as any, [
      { userId: 'u1', sharePercent: 50 },
      { userId: 'u2', sharePercent: 50 },
    ])).rejects.toThrow(/active family members/i);
  });
});

// ─── Requirement 5: secured loans must name their collateral ──────────────────

describe('secured loans require an asset', () => {
  beforeEach(() => {
    userMock.findMany.mockResolvedValue([{ id: 'u1' }]);
    loanMock.create.mockResolvedValue({ ...MOCK_LOAN, owners: [] });
  });

  it.each(['HOME', 'AUTO', 'LAP', 'GOLD'])('rejects a %s loan with no asset', async (loanType) => {
    await expect(createLoan('u1', { loanType, lenderName: 'X' } as any))
      .rejects.toThrow(/secured and must be linked to an asset/i);
    expect(loanMock.create).not.toHaveBeenCalled();
  });

  it.each(['PERSONAL', 'EDUCATION', 'BUSINESS', 'OTHER'])(
    'allows an unsecured %s loan with no asset', async (loanType) => {
      await createLoan('u1', { loanType, lenderName: 'X' } as any);
      expect(loanMock.create).toHaveBeenCalled();
    },
  );

  it('allows a secured loan once an asset is linked', async () => {
    await createLoan('u1', { loanType: 'HOME', lenderName: 'X', assetId: 'asset-1' } as any);
    expect(loanMock.create).toHaveBeenCalled();
  });

  it('blocks a PARTIAL update that flips an assetless loan to a secured type', async () => {
    // The route parses updates with .partial(), so the body carries no assetId for a Zod
    // refinement to inspect. Only the service sees the merged state.
    loanMock.findFirst.mockResolvedValue({ ...MOCK_LOAN, loanType: 'PERSONAL', assetId: null });
    await expect(updateLoan('u1', 'loan-1', { loanType: 'HOME' } as any))
      .rejects.toThrow(/secured and must be linked to an asset/i);
    expect(loanMock.update).not.toHaveBeenCalled();
  });

  it('allows that same flip when an asset is supplied in the same update', async () => {
    loanMock.findFirst.mockResolvedValue({ ...MOCK_LOAN, loanType: 'PERSONAL', assetId: null });
    loanMock.update.mockResolvedValue({ ...MOCK_LOAN, owners: [] });
    await updateLoan('u1', 'loan-1', { loanType: 'HOME', assetId: 'asset-1' } as any);
    expect(loanMock.update).toHaveBeenCalled();
  });

  it('keeps an existing asset when the update only changes the type', async () => {
    loanMock.findFirst.mockResolvedValue({ ...MOCK_LOAN, loanType: 'AUTO', assetId: 'asset-9' });
    loanMock.update.mockResolvedValue({ ...MOCK_LOAN, owners: [] });
    await updateLoan('u1', 'loan-1', { loanType: 'HOME' } as any);
    expect(loanMock.update).toHaveBeenCalled();
  });
});

// ─── Share apportionment (what stops a co-owned loan being counted twice) ─────

describe('per-user share decoration', () => {
  const shared = {
    ...MOCK_LOAN,
    userId: 'u1',
    outstandingBalance: 5_000_000,
    emiAmount: 50_000,
    owners: [
      { userId: 'u1', sharePercent: 60, user: { name: 'Asha' } },
      { userId: 'u2', sharePercent: 40, user: { name: 'Ravi' } },
    ],
    user: { name: 'Asha' },
  };

  it('gives each owner their own share of the balance and EMI', async () => {
    loanMock.findMany.mockResolvedValue([shared]);

    const [forAsha] = await getLoans('u1');
    expect(forAsha.sharePercent).toBe(60);
    expect(forAsha.outstandingBalanceShare).toBe(3_000_000);
    expect(forAsha.emiAmountShare).toBe(30_000);

    const [forRavi] = await getLoans('u2');
    expect(forRavi.sharePercent).toBe(40);
    expect(forRavi.outstandingBalanceShare).toBe(2_000_000);

    // The point of all this: the two shares reconstitute the whole, never double it.
    expect(forAsha.outstandingBalanceShare + forRavi.outstandingBalanceShare)
      .toBe(Number(shared.outstandingBalance));
  });

  it('exposes every owner with their name, for the UI', async () => {
    loanMock.findMany.mockResolvedValue([shared]);
    const [loan] = await getLoans('u1');
    expect(loan.owners).toEqual([
      { userId: 'u1', sharePercent: 60, userName: 'Asha' },
      { userId: 'u2', sharePercent: 40, userName: 'Ravi' },
    ]);
  });

  it('gives a non-owner a 0% share rather than the full amount', async () => {
    // Reachable for an ADMIN viewing family-wide: they see the loan but hold none of it.
    loanMock.findMany.mockResolvedValue([shared]);
    const [loan] = await getLoans('stranger');
    expect(loan.sharePercent).toBe(0);
    expect(loan.outstandingBalanceShare).toBe(0);
  });

  it('falls back to 100% for a legacy loan with no owner rows', async () => {
    loanMock.findMany.mockResolvedValue([{ ...shared, owners: [] }]);
    const [loan] = await getLoans('u1');
    expect(loan.sharePercent).toBe(100);
    expect(loan.outstandingBalanceShare).toBe(5_000_000);
  });

  it('gives the primary owner 0% when they assigned the whole share away', async () => {
    // u1 is Loan.userId but holds no share. Crediting them 100% here — as an earlier
    // version did — meant u1 AND u2 each reported the full balance and each claimed the
    // full section 24B interest on one loan. Owner rows are the source of truth.
    loanMock.findMany.mockResolvedValue([{
      ...shared,
      owners: [{ userId: 'u2', sharePercent: 100, user: { name: 'Ravi' } }],
    }]);
    const [loan] = await getLoans('u1');
    expect(loan.sharePercent).toBe(0);
    expect(loan.outstandingBalanceShare).toBe(0);
  });

  it('never lets two people report more than the whole loan between them', async () => {
    loanMock.findMany.mockResolvedValue([{
      ...shared,
      owners: [{ userId: 'u2', sharePercent: 100, user: { name: 'Ravi' } }],
    }]);
    const [asPrimary] = await getLoans('u1');
    loanMock.findMany.mockResolvedValue([{
      ...shared,
      owners: [{ userId: 'u2', sharePercent: 100, user: { name: 'Ravi' } }],
    }]);
    const [asOwner] = await getLoans('u2');

    expect(asPrimary.outstandingBalanceShare + asOwner.outstandingBalanceShare)
      .toBe(Number(shared.outstandingBalance));
  });

  it('reports 100% on the family-wide view, where no user is scoped', async () => {
    loanMock.findMany.mockResolvedValue([shared]);
    const [loan] = await getLoans();
    expect(loan.sharePercent).toBe(100);
    expect(loan.outstandingBalanceShare).toBe(5_000_000);
  });

  it('handles a missing owner name without crashing', async () => {
    loanMock.findMany.mockResolvedValue([{
      ...shared,
      owners: [{ userId: 'u1', sharePercent: 100, user: null }],
    }]);
    const [loan] = await getLoans('u1');
    expect(loan.owners[0].userName).toBe('');
  });
});
