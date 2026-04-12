/**
 * Unit tests for investmentService.ts.
 *
 * Covers: calcFDMaturity, calcRDMaturity (pure math), xirr via getPortfolioSummary,
 * get80CSummary, getInvestments (pagination + FX), and CRUD for all investment types
 * (investments, FDs, RDs, SIPs, gold, real estate), exchange rates.
 *
 * investmentService uses named import { prisma }.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';

vi.mock('../config/prisma', () => {
  const mockPrisma = {
    investment: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    exchangeRate: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn(),
    },
    fixedDeposit: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    recurringDeposit: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    sIP: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    sIPTransaction: {
      create: vi.fn(),
    },
    goldHolding: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    realEstate: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    insurancePolicy: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  return { default: mockPrisma, prisma: mockPrisma };
});

import prisma from '../config/prisma';
import {
  calcFDMaturity,
  calcRDMaturity,
  getPortfolioSummary,
  get80CSummary,
  getInvestments,
  createInvestment,
  updateInvestment,
  deleteInvestment,
  getFDs,
  getFDsMaturing,
  createFD,
  updateFD,
  deleteFD,
  getRDs,
  createRD,
  updateRD,
  deleteRD,
  getSIPs,
  getSIPsUpcoming,
  createSIP,
  updateSIP,
  deleteSIP,
  addSIPTransaction,
  getGoldHoldings,
  createGoldHolding,
  updateGoldHolding,
  deleteGoldHolding,
  getRealEstate,
  createRealEstate,
  updateRealEstate,
  deleteRealEstate,
  getExchangeRates,
  upsertExchangeRate,
} from '../services/investmentService';

const invMock = prisma.investment as any;
const fxMock = prisma.exchangeRate as any;
const fdMock = prisma.fixedDeposit as any;
const rdMock = prisma.recurringDeposit as any;
const sipMock = prisma.sIP as any;
const sipTxMock = prisma.sIPTransaction as any;
const goldMock = prisma.goldHolding as any;
const reMock = prisma.realEstate as any;
const insMock = prisma.insurancePolicy as any;

const MOCK_INV = {
  id: 'inv-1',
  userId: 'u1',
  type: 'MUTUAL_FUND',
  currency: 'INR',
  purchaseExchangeRate: null,
  unitsOrQuantity: 10,
  purchasePricePerUnit: 100,
  currentPricePerUnit: 120,
  purchaseDate: new Date('2024-01-01'),
  sipTransactions: [],
  isTaxSaving: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  fxMock.findMany.mockResolvedValue([]);
  invMock.findMany.mockResolvedValue([]);
  invMock.count.mockResolvedValue(0);
  invMock.findFirst.mockResolvedValue(MOCK_INV);
  fdMock.findMany.mockResolvedValue([]);
  fdMock.findFirst.mockResolvedValue({ id: 'fd-1', userId: 'u1' });
  rdMock.findMany.mockResolvedValue([]);
  rdMock.findFirst.mockResolvedValue({ id: 'rd-1', userId: 'u1' });
  sipMock.findMany.mockResolvedValue([]);
  sipMock.findFirst.mockResolvedValue({ id: 'sip-1', userId: 'u1', investmentId: 'inv-1' });
  goldMock.findMany.mockResolvedValue([]);
  goldMock.findFirst.mockResolvedValue({ id: 'gold-1', userId: 'u1' });
  reMock.findMany.mockResolvedValue([]);
  reMock.findFirst.mockResolvedValue({ id: 're-1', userId: 'u1' });
  insMock.findMany.mockResolvedValue([]);
});

// ─────────────────────────────────────────────────────────────────────────────
// calcFDMaturity
// ─────────────────────────────────────────────────────────────────────────────

describe('calcFDMaturity', () => {
  describe('CUMULATIVE (quarterly compounding)', () => {
    it('basic quarterly compounding: principal=10K, rate=10%, 12 months', () => {
      // 10000 * (1 + 0.10/4)^(4) = 10000 * 1.025^4 ≈ 11038.13
      const result = calcFDMaturity(10_000, 10, 12, 'CUMULATIVE');
      expect(result).toBeCloseTo(11_038.13, 1);
    });

    it('longer tenure compounds correctly: principal=10K, rate=10%, 24 months', () => {
      // 10000 * (1.025)^8 ≈ 12184.03
      const result = calcFDMaturity(10_000, 10, 24, 'CUMULATIVE');
      expect(result).toBeCloseTo(12_184.03, 1);
    });

    it('zero rate returns principal unchanged', () => {
      const result = calcFDMaturity(50_000, 0, 12, 'CUMULATIVE');
      expect(result).toBeCloseTo(50_000, 0);
    });

    it('larger principal scales linearly', () => {
      const single = calcFDMaturity(10_000, 8, 12, 'CUMULATIVE');
      const double = calcFDMaturity(20_000, 8, 12, 'CUMULATIVE');
      expect(double).toBeCloseTo(single * 2, 1);
    });
  });

  describe('Non-CUMULATIVE (simple interest)', () => {
    it('MONTHLY: simple interest for 12 months at 10%', () => {
      const result = calcFDMaturity(10_000, 10, 12, 'MONTHLY');
      expect(result).toBeCloseTo(11_000, 0);
    });

    it('QUARTERLY: simple interest for 12 months at 8%', () => {
      const result = calcFDMaturity(50_000, 8, 12, 'QUARTERLY');
      expect(result).toBeCloseTo(54_000, 0);
    });

    it('simple interest for 6 months is half the annual interest', () => {
      const sixMonth = calcFDMaturity(100_000, 8, 6, 'MONTHLY');
      const twelveMonth = calcFDMaturity(100_000, 8, 12, 'MONTHLY');
      expect(sixMonth - 100_000).toBeCloseTo((twelveMonth - 100_000) / 2, 1);
    });

    it('non-cumulative always returns more than principal', () => {
      const result = calcFDMaturity(10_000, 6, 12, 'MONTHLY');
      expect(result).toBeGreaterThan(10_000);
    });
  });

  it('cumulative yields more than non-cumulative at same rate and tenure', () => {
    const cumulative = calcFDMaturity(100_000, 8, 24, 'CUMULATIVE');
    const simple = calcFDMaturity(100_000, 8, 24, 'MONTHLY');
    expect(cumulative).toBeGreaterThan(simple);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calcRDMaturity
// ─────────────────────────────────────────────────────────────────────────────

describe('calcRDMaturity', () => {
  it('higher monthly amount scales the maturity proportionally', () => {
    const single = calcRDMaturity(1_000, 8, 12);
    const double = calcRDMaturity(2_000, 8, 12);
    expect(double).toBeCloseTo(single * 2, 1);
  });

  it('higher rate produces higher maturity', () => {
    const lowRate = calcRDMaturity(5_000, 6, 12);
    const highRate = calcRDMaturity(5_000, 10, 12);
    expect(highRate).toBeGreaterThan(lowRate);
  });

  it('longer tenure produces higher maturity', () => {
    const short = calcRDMaturity(5_000, 8, 12);
    const long = calcRDMaturity(5_000, 8, 24);
    expect(long).toBeGreaterThan(short);
  });

  it('returns a positive number for valid inputs', () => {
    const result = calcRDMaturity(1_000, 8, 12);
    expect(result).toBeGreaterThan(0);
  });

  it('matches known formula output: monthly=5K, rate=8%, 12 months', () => {
    const result = calcRDMaturity(5_000, 8, 12);
    expect(result).toBeCloseTo(23_254, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// xirr (tested indirectly via getPortfolioSummary)
// ─────────────────────────────────────────────────────────────────────────────

describe('xirr via getPortfolioSummary', () => {
  const ONE_YEAR_AGO = new Date();
  ONE_YEAR_AGO.setFullYear(ONE_YEAR_AGO.getFullYear() - 1);

  function makeInvestment(overrides: Record<string, unknown> = {}) {
    return {
      ...MOCK_INV,
      purchaseDate: ONE_YEAR_AGO,
      ...overrides,
    };
  }

  it('returns a finite non-null xirr for a profitable investment', async () => {
    invMock.findMany.mockResolvedValue([makeInvestment()]);
    const result = await getPortfolioSummary('u1');
    expect(result.xirr).not.toBeNull();
    expect(isFinite(result.xirr!)).toBe(true);
    expect(result.xirr!).toBeGreaterThan(0);
  });

  it('returns null xirr when current value is 0 (all-outflow cashflows)', async () => {
    invMock.findMany.mockResolvedValue([makeInvestment({ currentPricePerUnit: 0 })]);
    const result = await getPortfolioSummary('u1');
    expect(result.xirr).toBeNull();
  });

  it('returns null xirr when there are no investments', async () => {
    invMock.findMany.mockResolvedValue([]);
    const result = await getPortfolioSummary('u1');
    expect(result.xirr).toBeNull();
  });

  it('aggregates portfolio metrics correctly', async () => {
    invMock.findMany.mockResolvedValue([
      makeInvestment({ unitsOrQuantity: 10, purchasePricePerUnit: 100, currentPricePerUnit: 120 }),
    ]);
    const result = await getPortfolioSummary('u1');
    expect(result.totalInvested).toBeCloseTo(1_000, 0);
    expect(result.totalCurrentValue).toBeCloseTo(1_200, 0);
    expect(result.absoluteGain).toBeCloseTo(200, 0);
    expect(result.absoluteReturnPct).toBeCloseTo(20, 1);
  });

  it('returns zero metrics for empty portfolio', async () => {
    invMock.findMany.mockResolvedValue([]);
    const result = await getPortfolioSummary('u1');
    expect(result.totalInvested).toBe(0);
    expect(result.totalCurrentValue).toBe(0);
    expect(result.absoluteGain).toBe(0);
    expect(result.absoluteReturnPct).toBe(0);
  });

  it('applies fx rate for non-INR investments', async () => {
    fxMock.findMany.mockResolvedValue([{ fromCurrency: 'USD', toCurrency: 'INR', rate: 83 }]);
    invMock.findMany.mockResolvedValue([
      makeInvestment({ currency: 'USD', purchasePricePerUnit: 10, currentPricePerUnit: 10 }),
    ]);
    const result = await getPortfolioSummary('u1');
    expect(result.totalInvested).toBeCloseTo(8_300, 0);
    expect(result.totalCurrentValue).toBeCloseTo(8_300, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// get80CSummary
// ─────────────────────────────────────────────────────────────────────────────

describe('get80CSummary', () => {
  it('sums investments + FDs + insurance premiums', async () => {
    invMock.findMany.mockResolvedValue([
      { ...MOCK_INV, isTaxSaving: true, unitsOrQuantity: 10, purchasePricePerUnit: 5000 },
    ]);
    fdMock.findMany.mockResolvedValue([{ principalAmount: 30000, isTaxSaver: true }]);
    insMock.findMany.mockResolvedValue([
      { premiumAmount: 1000, premiumFrequency: 'MONTHLY', is80cEligible: true },
    ]);
    const result = await get80CSummary('u1', '2025-26');
    // investments: 50000, FD: 30000, insurance: 12000 → total = 92000
    expect(result.breakdown.investments).toBe(50000);
    expect(result.breakdown.fixedDeposits).toBe(30000);
    expect(result.breakdown.insurance).toBe(12000);
    expect(result.total).toBe(92000);
  });

  it('caps total at ₹1.5L limit', async () => {
    invMock.findMany.mockResolvedValue([
      { ...MOCK_INV, isTaxSaving: true, unitsOrQuantity: 100, purchasePricePerUnit: 2000 },
    ]);
    fdMock.findMany.mockResolvedValue([{ principalAmount: 50000, isTaxSaver: true }]);
    insMock.findMany.mockResolvedValue([]);
    const result = await get80CSummary('u1', '2025-26');
    // investments: 200000 + FD: 50000 = 250000, capped at 150000
    expect(result.total).toBe(150000);
    expect(result.limit).toBe(150000);
    expect(result.utilized).toBe(100);
  });

  it('applies QUARTERLY frequency multiplier (×4) for insurance', async () => {
    invMock.findMany.mockResolvedValue([]);
    fdMock.findMany.mockResolvedValue([]);
    insMock.findMany.mockResolvedValue([
      { premiumAmount: 3000, premiumFrequency: 'QUARTERLY', is80cEligible: true },
    ]);
    const result = await get80CSummary('u1', '2025-26');
    expect(result.breakdown.insurance).toBe(12000);
  });

  it('returns zero when no eligible instruments', async () => {
    const result = await get80CSummary('u1', '2025-26');
    expect(result.total).toBe(0);
    expect(result.utilized).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getInvestments (paginated)
// ─────────────────────────────────────────────────────────────────────────────

describe('getInvestments', () => {
  const MOCK_INV_WITH_SIP = { ...MOCK_INV, sipTransactions: [] };

  it('returns paginated results with computed gains', async () => {
    invMock.count.mockResolvedValue(1);
    invMock.findMany.mockResolvedValue([MOCK_INV_WITH_SIP]);

    const result = await getInvestments('u1');

    expect(result.pagination.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].investedINR).toBeCloseTo(1000, 0);
    expect(result.items[0].currentValueINR).toBeCloseTo(1200, 0);
    expect(result.items[0].gainINR).toBeCloseTo(200, 0);
  });

  it('filters by type when provided', async () => {
    invMock.count.mockResolvedValue(0);
    invMock.findMany.mockResolvedValue([]);

    await getInvestments('u1', 'MUTUAL_FUND' as any);

    expect(invMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', type: 'MUTUAL_FUND' } }),
    );
  });

  it('applies page 2 pagination with correct skip', async () => {
    invMock.count.mockResolvedValue(50);
    invMock.findMany.mockResolvedValue([]);

    await getInvestments('u1', undefined, 2, 10);

    expect(invMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 }),
    );
  });

  it('applies FX rate for non-INR investment', async () => {
    fxMock.findMany.mockResolvedValue([{ fromCurrency: 'USD', toCurrency: 'INR', rate: 83 }]);
    invMock.count.mockResolvedValue(1);
    invMock.findMany.mockResolvedValue([{
      ...MOCK_INV_WITH_SIP,
      currency: 'USD',
      unitsOrQuantity: 1,
      purchasePricePerUnit: 100,
      currentPricePerUnit: 100,
    }]);

    const result = await getInvestments('u1');
    expect(result.items[0].investedINR).toBeCloseTo(8300, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Investment CRUD
// ─────────────────────────────────────────────────────────────────────────────

describe('createInvestment', () => {
  it('creates investment with userId merged', async () => {
    const created = { ...MOCK_INV, id: 'inv-new' };
    invMock.create.mockResolvedValue(created);
    const result = await createInvestment('u1', { type: 'MUTUAL_FUND' } as any);
    expect(invMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'u1' }) }),
    );
    expect(result).toBe(created);
  });
});

describe('updateInvestment', () => {
  it('updates investment when found', async () => {
    invMock.update.mockResolvedValue({ ...MOCK_INV, currentPricePerUnit: 150 });
    const result = await updateInvestment('u1', 'inv-1', { currentPricePerUnit: 150 } as any);
    expect(invMock.update).toHaveBeenCalledWith({ where: { id: 'inv-1' }, data: { currentPricePerUnit: 150 } });
    expect(result).toBeDefined();
  });

  it('throws NotFound when investment does not exist', async () => {
    invMock.findFirst.mockResolvedValue(null);
    await expect(updateInvestment('u1', 'inv-x', {})).rejects.toThrow(/not found/i);
  });
});

describe('deleteInvestment', () => {
  it('deletes investment when found', async () => {
    invMock.delete.mockResolvedValue(MOCK_INV);
    await deleteInvestment('u1', 'inv-1');
    expect(invMock.delete).toHaveBeenCalledWith({ where: { id: 'inv-1' } });
  });

  it('throws NotFound when investment does not exist', async () => {
    invMock.findFirst.mockResolvedValue(null);
    await expect(deleteInvestment('u1', 'inv-x')).rejects.toThrow(/not found/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FD CRUD
// ─────────────────────────────────────────────────────────────────────────────

describe('getFDs', () => {
  it('queries by userId, optionally with status filter', async () => {
    await getFDs('u1', 'ACTIVE' as any);
    expect(fdMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', status: 'ACTIVE' } }),
    );
  });

  it('queries without status filter when not provided', async () => {
    await getFDs('u1');
    const call = fdMock.findMany.mock.calls[0][0];
    expect(call.where.status).toBeUndefined();
  });
});

describe('getFDsMaturing', () => {
  beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2025-04-01')); });
  afterAll(() => vi.useRealTimers());

  it('filters ACTIVE FDs maturing within N days', async () => {
    await getFDsMaturing('u1', 30);
    const call = fdMock.findMany.mock.calls[0][0];
    expect(call.where.status).toBe('ACTIVE');
    expect(call.where.maturityDate.lte).toBeInstanceOf(Date);
    // Cutoff should be ~30 days after Apr 1 = ~May 1, 2025
    expect(call.where.maturityDate.lte.getFullYear()).toBe(2025);
  });
});

describe('createFD', () => {
  it('auto-computes maturityAmount via calcFDMaturity', async () => {
    const fdData = {
      principalAmount: 100000,
      interestRate: 8,
      tenureMonths: 12,
      interestPayoutType: 'CUMULATIVE',
      startDate: new Date('2025-01-01'),
      maturityDate: new Date('2026-01-01'),
      bankName: 'HDFC',
      status: 'ACTIVE',
    };
    fdMock.create.mockResolvedValue({ id: 'fd-new', ...fdData });

    await createFD('u1', fdData as any);

    const createCall = fdMock.create.mock.calls[0][0];
    // maturityAmount = calcFDMaturity(100000, 8, 12, 'CUMULATIVE') ≈ 108243
    expect(createCall.data.maturityAmount).toBeGreaterThan(100000);
    expect(createCall.data.userId).toBe('u1');
  });
});

describe('updateFD', () => {
  it('updates FD when found', async () => {
    fdMock.update.mockResolvedValue({ id: 'fd-1' });
    await updateFD('u1', 'fd-1', { status: 'MATURED' } as any);
    expect(fdMock.update).toHaveBeenCalledWith({ where: { id: 'fd-1' }, data: { status: 'MATURED' } });
  });

  it('throws NotFound when FD does not exist', async () => {
    fdMock.findFirst.mockResolvedValue(null);
    await expect(updateFD('u1', 'fd-x', {})).rejects.toThrow(/not found/i);
  });
});

describe('deleteFD', () => {
  it('deletes FD when found', async () => {
    fdMock.delete.mockResolvedValue({ id: 'fd-1' });
    await deleteFD('u1', 'fd-1');
    expect(fdMock.delete).toHaveBeenCalledWith({ where: { id: 'fd-1' } });
  });

  it('throws NotFound when FD does not exist', async () => {
    fdMock.findFirst.mockResolvedValue(null);
    await expect(deleteFD('u1', 'fd-x')).rejects.toThrow(/not found/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RD CRUD
// ─────────────────────────────────────────────────────────────────────────────

describe('getRDs', () => {
  it('queries by userId with optional status', async () => {
    await getRDs('u1', 'ACTIVE' as any);
    expect(rdMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', status: 'ACTIVE' } }),
    );
  });
});

describe('createRD', () => {
  it('auto-computes maturityAmount via calcRDMaturity', async () => {
    const rdData = {
      monthlyInstallment: 5000,
      interestRate: 7,
      tenureMonths: 12,
      bankName: 'SBI',
      startDate: new Date('2025-01-01'),
      maturityDate: new Date('2026-01-01'),
      status: 'ACTIVE',
    };
    rdMock.create.mockResolvedValue({ id: 'rd-new', ...rdData });

    await createRD('u1', rdData as any);

    const createCall = rdMock.create.mock.calls[0][0];
    expect(createCall.data.maturityAmount).toBeGreaterThan(0);
    expect(createCall.data.userId).toBe('u1');
  });
});

describe('updateRD / deleteRD', () => {
  it('throws NotFound for updateRD when not found', async () => {
    rdMock.findFirst.mockResolvedValue(null);
    await expect(updateRD('u1', 'rd-x', {})).rejects.toThrow(/not found/i);
  });

  it('throws NotFound for deleteRD when not found', async () => {
    rdMock.findFirst.mockResolvedValue(null);
    await expect(deleteRD('u1', 'rd-x')).rejects.toThrow(/not found/i);
  });

  it('deletes RD when found', async () => {
    rdMock.delete.mockResolvedValue({ id: 'rd-1' });
    await deleteRD('u1', 'rd-1');
    expect(rdMock.delete).toHaveBeenCalledWith({ where: { id: 'rd-1' } });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SIP CRUD
// ─────────────────────────────────────────────────────────────────────────────

describe('getSIPs', () => {
  it('includes investment and bankAccount in query', async () => {
    await getSIPs('u1');
    expect(sipMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: expect.objectContaining({ investment: true }) }),
    );
  });
});

// getSIPsUpcoming — standard window (today pinned to the 15th)
describe('getSIPsUpcoming — standard window', () => {
  beforeAll(() => {
    vi.useFakeTimers();
    // Use noon UTC to avoid local-timezone day shifts on midnight-boundary dates
    vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'));
  });
  afterAll(() => vi.useRealTimers());

  const makeActiveSIP = (sipDate: number) => ({
    id: `sip-${sipDate}`,
    userId: 'u1',
    sipDate,
    status: 'ACTIVE',
    investment: MOCK_INV,
  });

  it('includes SIPs due between today (15) and cutoff (25)', async () => {
    // today=15, days=10, cutoffDay=25 (≤28) → filter: d >= 15 && d <= 25
    sipMock.findMany.mockResolvedValue([
      makeActiveSIP(20), // passes: 15 ≤ 20 ≤ 25
      makeActiveSIP(10), // fails: 10 < 15
      makeActiveSIP(26), // fails: 26 > 25
    ]);
    const result = await getSIPsUpcoming('u1', 10);
    expect(result).toHaveLength(1);
    expect(result[0].sipDate).toBe(20);
  });

  it('attaches nextDate to each matching SIP', async () => {
    // sipDate=20, today=Jan 15 → nextDate = Jan 20, 2024 (not past, no month bump)
    sipMock.findMany.mockResolvedValue([makeActiveSIP(20)]);
    const result = await getSIPsUpcoming('u1', 10);
    expect(result[0].nextDate).toBeInstanceOf(Date);
    expect(result[0].nextDate.getDate()).toBe(20);
  });

  it('returns empty array when no SIPs fall within window', async () => {
    sipMock.findMany.mockResolvedValue([makeActiveSIP(10)]); // 10 < 15 → excluded
    const result = await getSIPsUpcoming('u1', 5);
    expect(result).toHaveLength(0);
  });
});

// getSIPsUpcoming — overflow window (today pinned to the 25th, window wraps into next month)
describe('getSIPsUpcoming — overflow window', () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-25T12:00:00.000Z'));
  });
  afterAll(() => vi.useRealTimers());

  const makeActiveSIP = (sipDate: number) => ({
    id: `sip-${sipDate}`,
    userId: 'u1',
    sipDate,
    status: 'ACTIVE',
    investment: MOCK_INV,
  });

  it('includes SIPs on day >= 25 OR day <= 7 (cutoffDay=35 wraps past 28)', async () => {
    // today=25, days=10, cutoffDay=35 (>28) → filter: d >= 25 || d <= 35-28=7
    sipMock.findMany.mockResolvedValue([
      makeActiveSIP(28), // passes: 28 >= 25
      makeActiveSIP(3),  // passes: 3 <= 7
      makeActiveSIP(10), // fails: 10 < 25 and 10 > 7
    ]);
    const result = await getSIPsUpcoming('u1', 10);
    expect(result).toHaveLength(2);
    // Numeric sort to avoid lexicographic ordering issue
    expect(result.map((s: any) => s.sipDate).sort((a: number, b: number) => a - b)).toEqual([3, 28]);
  });
});

describe('createSIP', () => {
  it('creates SIP with investment connect and returns with investment included', async () => {
    const sipResult = { id: 'sip-new', investment: MOCK_INV };
    sipMock.create.mockResolvedValue(sipResult);

    const result = await createSIP('u1', {
      investmentId: 'inv-1',
      sipDate: 15,
      monthlyAmount: 5000,
      startDate: new Date('2025-01-01'),
      status: 'ACTIVE',
    } as any);

    expect(sipMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u1',
          investment: { connect: { id: 'inv-1' } },
        }),
        include: { investment: true },
      }),
    );
    expect(result).toBe(sipResult);
  });
});

describe('updateSIP / deleteSIP / addSIPTransaction', () => {
  it('throws NotFound for updateSIP when not found', async () => {
    sipMock.findFirst.mockResolvedValue(null);
    await expect(updateSIP('u1', 'sip-x', {})).rejects.toThrow(/not found/i);
  });

  it('throws NotFound for deleteSIP when not found', async () => {
    sipMock.findFirst.mockResolvedValue(null);
    await expect(deleteSIP('u1', 'sip-x')).rejects.toThrow(/not found/i);
  });

  it('deletes SIP when found', async () => {
    sipMock.delete.mockResolvedValue({ id: 'sip-1' });
    await deleteSIP('u1', 'sip-1');
    expect(sipMock.delete).toHaveBeenCalledWith({ where: { id: 'sip-1' } });
  });

  it('throws NotFound for addSIPTransaction when SIP not found', async () => {
    sipMock.findFirst.mockResolvedValue(null);
    await expect(
      addSIPTransaction('u1', 'sip-x', { date: new Date(), units: 10, nav: 50, amount: 500 }),
    ).rejects.toThrow(/not found/i);
  });

  it('creates SIP transaction when SIP found', async () => {
    sipTxMock.create.mockResolvedValue({ id: 'sipt-1' });
    await addSIPTransaction('u1', 'sip-1', { date: new Date('2025-01-01'), units: 10, nav: 50, amount: 500 });
    expect(sipTxMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ investmentId: 'inv-1', units: 10, amount: 500 }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Gold Holdings CRUD
// ─────────────────────────────────────────────────────────────────────────────

describe('getGoldHoldings', () => {
  it('aggregates gold summary metrics', async () => {
    goldMock.findMany.mockResolvedValue([
      { quantityGrams: 10, purchasePricePerGram: 5000, currentPricePerGram: 6000 },
      { quantityGrams: 5, purchasePricePerGram: 5500, currentPricePerGram: 6000 },
    ]);
    const result = await getGoldHoldings('u1');
    expect(result.summary.totalGrams).toBe(15);
    expect(result.summary.totalPurchaseValue).toBe(10 * 5000 + 5 * 5500);
    expect(result.summary.totalCurrentValue).toBe(15 * 6000);
    expect(result.summary.gain).toBe(result.summary.totalCurrentValue - result.summary.totalPurchaseValue);
  });
});

describe('createGoldHolding', () => {
  it('creates with userId merged', async () => {
    goldMock.create.mockResolvedValue({ id: 'gold-new' });
    await createGoldHolding('u1', { quantityGrams: 10, purchasePricePerGram: 5000 } as any);
    expect(goldMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'u1' }) }),
    );
  });
});

describe('updateGoldHolding / deleteGoldHolding', () => {
  it('throws NotFound for updateGoldHolding when not found', async () => {
    goldMock.findFirst.mockResolvedValue(null);
    await expect(updateGoldHolding('u1', 'gold-x', {})).rejects.toThrow(/not found/i);
  });

  it('throws NotFound for deleteGoldHolding when not found', async () => {
    goldMock.findFirst.mockResolvedValue(null);
    await expect(deleteGoldHolding('u1', 'gold-x')).rejects.toThrow(/not found/i);
  });

  it('deletes gold holding when found', async () => {
    goldMock.delete.mockResolvedValue({ id: 'gold-1' });
    await deleteGoldHolding('u1', 'gold-1');
    expect(goldMock.delete).toHaveBeenCalledWith({ where: { id: 'gold-1' } });
  });

  it('updates gold holding when found', async () => {
    const updated = { id: 'gold-1', quantityGrams: 20 };
    goldMock.update.mockResolvedValue(updated);
    const result = await updateGoldHolding('u1', 'gold-1', { quantityGrams: 20 });
    expect(goldMock.update).toHaveBeenCalledWith({ where: { id: 'gold-1' }, data: { quantityGrams: 20 } });
    expect(result).toEqual(updated);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Real Estate CRUD
// ─────────────────────────────────────────────────────────────────────────────

describe('getRealEstate', () => {
  it('aggregates real estate summary metrics', async () => {
    reMock.findMany.mockResolvedValue([
      { purchasePrice: 5000000, currentValue: 6000000, rentalIncomeMonthly: 25000, loan: null },
      { purchasePrice: 3000000, currentValue: 3500000, rentalIncomeMonthly: null, loan: null },
    ]);
    const result = await getRealEstate('u1');
    expect(result.summary.totalPurchase).toBe(8000000);
    expect(result.summary.totalCurrent).toBe(9500000);
    expect(result.summary.totalMonthlyRental).toBe(25000);
    expect(result.summary.unrealisedGain).toBe(1500000);
  });
});

describe('createRealEstate / updateRealEstate / deleteRealEstate', () => {
  it('creates real estate with userId merged', async () => {
    reMock.create.mockResolvedValue({ id: 're-new' });
    await createRealEstate('u1', { purchasePrice: 5000000 } as any);
    expect(reMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'u1' }) }),
    );
  });

  it('throws NotFound for updateRealEstate when not found', async () => {
    reMock.findFirst.mockResolvedValue(null);
    await expect(updateRealEstate('u1', 're-x', {})).rejects.toThrow(/not found/i);
  });

  it('throws NotFound for deleteRealEstate when not found', async () => {
    reMock.findFirst.mockResolvedValue(null);
    await expect(deleteRealEstate('u1', 're-x')).rejects.toThrow(/not found/i);
  });

  it('deletes real estate when found', async () => {
    reMock.delete.mockResolvedValue({ id: 're-1' });
    await deleteRealEstate('u1', 're-1');
    expect(reMock.delete).toHaveBeenCalledWith({ where: { id: 're-1' } });
  });

  it('updates real estate when found', async () => {
    const updated = { id: 're-1', currentValue: 7000000 };
    reMock.update.mockResolvedValue(updated);
    const result = await updateRealEstate('u1', 're-1', { currentValue: 7000000 });
    expect(reMock.update).toHaveBeenCalledWith({ where: { id: 're-1' }, data: { currentValue: 7000000 } });
    expect(result).toEqual(updated);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Exchange Rates
// ─────────────────────────────────────────────────────────────────────────────

describe('getExchangeRates', () => {
  it('queries with toCurrency=INR, ordered by fromCurrency', async () => {
    await getExchangeRates();
    expect(fxMock.findMany).toHaveBeenCalledWith({
      where: { toCurrency: 'INR' },
      orderBy: { fromCurrency: 'asc' },
    });
  });
});

describe('upsertExchangeRate', () => {
  it('upserts with correct create/update shape', async () => {
    fxMock.upsert.mockResolvedValue({ fromCurrency: 'USD', rate: 83 });
    await upsertExchangeRate('USD', 83, 'admin-1');
    expect(fxMock.upsert).toHaveBeenCalledWith({
      where: { fromCurrency_toCurrency: { fromCurrency: 'USD', toCurrency: 'INR' } },
      create: { fromCurrency: 'USD', toCurrency: 'INR', rate: 83, updatedBy: 'admin-1' },
      update: { rate: 83, updatedBy: 'admin-1' },
    });
  });
});
