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
      findUnique: vi.fn(),
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
    user: {
      findMany: vi.fn().mockResolvedValue([]),
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
  getFDForAudit,
  getRDs,
  createRD,
  updateRD,
  deleteRD,
  getRDForAudit,
  getSIPs,
  getSIPsUpcoming,
  createSIP,
  updateSIP,
  deleteSIP,
  addSIPTransaction,
  getSIPForAudit,
  getGoldHoldings,
  createGoldHolding,
  updateGoldHolding,
  deleteGoldHolding,
  getGoldHoldingForAudit,
  getRealEstate,
  createRealEstate,
  updateRealEstate,
  deleteRealEstate,
  getRealEstateForAudit,
  getExchangeRates,
  upsertExchangeRate,
  getExchangeRateForAudit,
  getInvestmentForAudit,
} from '../services/investmentService';

const invMock = prisma.investment as any;
const fxMock = prisma.exchangeRate as any;
const fdMock = prisma.fixedDeposit as any;
const rdMock = prisma.recurringDeposit as any;
const sipMock = prisma.sIP as any;
const sipTxMock = prisma.sIPTransaction as any;
const goldMock = prisma.goldHolding as any;
const reMock = prisma.realEstate as any;
const userMock = (prisma as any).user;
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
  userMock.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
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

  it('non-INR investment with no fxRate entry falls back to 1 (lines 79/107 ?? true branch)', async () => {
    // fxMock returns empty → rateMap has no USD entry → rateMap['USD'] ?? 1 = 1
    fxMock.findMany.mockResolvedValue([]);
    invMock.findMany.mockResolvedValue([
      makeInvestment({ currency: 'USD', purchasePricePerUnit: 100, currentPricePerUnit: 120 }),
    ]);
    const result = await getPortfolioSummary('u1');
    // fxRate = 1 (fallback), so values are as if USD = 1 INR
    expect(result.totalInvested).toBeCloseTo(1000, 0);
    expect(result.totalCurrentValue).toBeCloseTo(1200, 0);
  });

  it('investment with purchaseExchangeRate uses it as buyFx (lines 83/108 truthy branch)', async () => {
    // purchaseExchangeRate=85 overrides the fxRate for the purchase calculation
    fxMock.findMany.mockResolvedValue([{ fromCurrency: 'USD', toCurrency: 'INR', rate: 83 }]);
    invMock.findMany.mockResolvedValue([
      makeInvestment({ currency: 'USD', purchasePricePerUnit: 10, currentPricePerUnit: 10, purchaseExchangeRate: 85 }),
    ]);
    const result = await getPortfolioSummary('u1');
    // invested = 10 units * 10 * 85 = 8500, current = 10 * 10 * 83 = 8300
    expect(result.totalInvested).toBeCloseTo(8_500, 0);
    expect(result.totalCurrentValue).toBeCloseTo(8_300, 0);
  });

  it('all-zero cashflows: hasNegative=false → xirr returns null (line 12 !hasNegative branch)', async () => {
    // purchasePricePerUnit=0 → invested=0 → allCashflows outflow = -0 (not negative) → hasNegative=false
    invMock.findMany.mockResolvedValue([
      makeInvestment({ purchasePricePerUnit: 0, currentPricePerUnit: 120 }),
    ]);
    const result = await getPortfolioSummary('u1');
    expect(result.xirr).toBeNull();
  });

  it('uses sipTransactions as cashflows when available (non-empty sipTransactions path)', async () => {
    // Investment with sipTransactions — triggers the allCashflows loop (lines 101-103)
    invMock.findMany.mockResolvedValue([
      makeInvestment({
        sipTransactions: [
          { amount: 1000, date: ONE_YEAR_AGO },
          { amount: 1000, date: new Date(ONE_YEAR_AGO.getTime() + 30 * 24 * 60 * 60 * 1000) },
        ],
      }),
    ]);
    const result = await getPortfolioSummary('u1');
    // With sipTransactions present, cashflows are built from them → xirr is computed
    expect(result.xirr).not.toBeNull();
    expect(isFinite(result.xirr!)).toBe(true);
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

  it('applies HALF_YEARLY frequency multiplier (×2) for insurance', async () => {
    invMock.findMany.mockResolvedValue([]);
    fdMock.findMany.mockResolvedValue([]);
    insMock.findMany.mockResolvedValue([
      { premiumAmount: 5000, premiumFrequency: 'HALF_YEARLY', is80cEligible: true },
    ]);
    const result = await get80CSummary('u1', '2025-26');
    expect(result.breakdown.insurance).toBe(10000); // 5000 * 2
  });

  it('uses raw premium amount as annual for non-standard frequency (default case)', async () => {
    // frequency not MONTHLY/QUARTERLY/HALF_YEARLY → treated as annual (×1)
    invMock.findMany.mockResolvedValue([]);
    fdMock.findMany.mockResolvedValue([]);
    insMock.findMany.mockResolvedValue([
      { premiumAmount: 8000, premiumFrequency: 'ANNUALLY', is80cEligible: true },
    ]);
    const result = await get80CSummary('u1', '2025-26');
    expect(result.breakdown.insurance).toBe(8000); // 8000 * 1
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

  it('non-INR with no fxRate entry falls back to 1 (line 194 ?? true branch)', async () => {
    fxMock.findMany.mockResolvedValue([]); // no exchange rates → rateMap empty
    invMock.count.mockResolvedValue(1);
    invMock.findMany.mockResolvedValue([{
      ...MOCK_INV_WITH_SIP,
      currency: 'USD',
      unitsOrQuantity: 1,
      purchasePricePerUnit: 100,
      currentPricePerUnit: 100,
    }]);
    const result = await getInvestments('u1');
    // fxRate falls back to 1 → invested = 100 * 1 = 100
    expect(result.items[0].investedINR).toBeCloseTo(100, 0);
  });

  it('purchaseExchangeRate set uses it as buyFx (line 195 truthy branch)', async () => {
    fxMock.findMany.mockResolvedValue([{ fromCurrency: 'USD', toCurrency: 'INR', rate: 83 }]);
    invMock.count.mockResolvedValue(1);
    invMock.findMany.mockResolvedValue([{
      ...MOCK_INV_WITH_SIP,
      currency: 'USD',
      unitsOrQuantity: 1,
      purchasePricePerUnit: 100,
      currentPricePerUnit: 100,
      purchaseExchangeRate: 85,
    }]);
    const result = await getInvestments('u1');
    // invested = 100 * 85 (purchaseExchangeRate), current = 100 * 83 (fxRate)
    expect(result.items[0].investedINR).toBeCloseTo(8500, 0);
    expect(result.items[0].currentValueINR).toBeCloseTo(8300, 0);
  });

  it('zero purchase price → gainPct=0 (line 200 false branch of invested>0)', async () => {
    invMock.count.mockResolvedValue(1);
    invMock.findMany.mockResolvedValue([{
      ...MOCK_INV_WITH_SIP,
      purchasePricePerUnit: 0,  // invested = 0 → gainPct = 0 (no division by zero)
    }]);
    const result = await getInvestments('u1');
    expect(result.items[0].gainPct).toBe(0);
  });

  it('builds per-investment XIRR from sipTransactions when non-empty (line 204 path)', async () => {
    const ONE_YEAR_AGO = new Date();
    ONE_YEAR_AGO.setFullYear(ONE_YEAR_AGO.getFullYear() - 1);
    const invWithSip = {
      ...MOCK_INV,
      sipTransactions: [
        { amount: 500, date: ONE_YEAR_AGO },
        { amount: 500, date: new Date(ONE_YEAR_AGO.getTime() + 30 * 24 * 60 * 60 * 1000) },
      ],
    };
    invMock.count.mockResolvedValue(1);
    invMock.findMany.mockResolvedValue([invWithSip]);
    const result = await getInvestments('u1');
    // Item has xirr computed via sipTransactions cashflows (not purchase-date fallback)
    expect(result.items[0].xirr).not.toBeNull();
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

describe('getInvestmentForAudit', () => {
  it('scopes to the requester for MEMBER', async () => {
    invMock.findFirst.mockResolvedValue(MOCK_INV);
    const result = await getInvestmentForAudit('u1', 'inv-1', 'MEMBER');
    expect(invMock.findFirst).toHaveBeenCalledWith({ where: { id: 'inv-1', userId: 'u1' } });
    expect(result).toBe(MOCK_INV);
  });

  it('drops the owner filter for ADMIN — can fetch another member\'s investment', async () => {
    invMock.findFirst.mockResolvedValue(MOCK_INV);
    await getInvestmentForAudit('admin-1', 'inv-1', 'ADMIN');
    expect(invMock.findFirst).toHaveBeenCalledWith({ where: { id: 'inv-1' } });
  });

  it('returns null when not found', async () => {
    invMock.findFirst.mockResolvedValue(null);
    const result = await getInvestmentForAudit('u1', 'inv-x');
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FD CRUD
// ─────────────────────────────────────────────────────────────────────────────

describe('getFDs', () => {
  it('MEMBER: scopes to requesterId, ignores passed userId', async () => {
    await getFDs('other-user', 'u1', 'MEMBER', 'ACTIVE' as any);
    expect(fdMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', status: 'ACTIVE' } }),
    );
  });

  it('MEMBER: queries without status filter when not provided', async () => {
    await getFDs(undefined, 'u1', 'MEMBER');
    const call = fdMock.findMany.mock.calls[0][0];
    expect(call.where.userId).toBe('u1');
    expect(call.where.status).toBeUndefined();
  });

  it('ADMIN with userId: scopes to specified member', async () => {
    await getFDs('u2', 'admin-1', 'ADMIN');
    expect(fdMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u2' } }),
    );
  });

  it('ADMIN with undefined userId: family-wide query (no userId filter), includes user name', async () => {
    fdMock.findMany.mockResolvedValueOnce([
      { id: 'fd-1', bankName: 'HDFC', user: { name: 'Alice' } },
    ]);
    const result = await getFDs(undefined, 'admin-1', 'ADMIN');
    const call = fdMock.findMany.mock.calls[0][0];
    expect(call.where).not.toHaveProperty('userId');
    expect(call.include).toEqual({ user: { select: { name: true } } });
    expect((result[0] as any).userName).toBe('Alice');
    expect((result[0] as any).user).toBeUndefined();
  });

  it('ADMIN with userId and status: status filter applied (line 251 true branch)', async () => {
    await getFDs('u2', 'admin-1', 'ADMIN', 'ACTIVE' as any);
    expect(fdMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u2', status: 'ACTIVE' } }),
    );
  });

  it('ADMIN family-wide with status: status filter applied (line 258 true branch)', async () => {
    fdMock.findMany.mockResolvedValueOnce([]);
    await getFDs(undefined, 'admin-1', 'ADMIN', 'ACTIVE' as any);
    const call = fdMock.findMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ status: 'ACTIVE' });
  });

  it('ADMIN family-wide: falls back to empty string when user.name is null (line 263 ?? branch)', async () => {
    fdMock.findMany.mockResolvedValueOnce([
      { id: 'fd-1', bankName: 'HDFC', user: { name: null } },
    ]);
    const result = await getFDs(undefined, 'admin-1', 'ADMIN');
    expect((result[0] as any).userName).toBe('');
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

  it('defaults interestPayoutType to CUMULATIVE when omitted (line 280 ?? true branch)', async () => {
    // No interestPayoutType → undefined ?? 'CUMULATIVE' → 'CUMULATIVE'
    const fdData = {
      principalAmount: 50000,
      interestRate: 7,
      tenureMonths: 6,
      bankName: 'SBI',
      startDate: new Date('2025-01-01'),
      maturityDate: new Date('2025-07-01'),
      status: 'ACTIVE',
    };
    fdMock.create.mockResolvedValue({ id: 'fd-new2', ...fdData });
    await createFD('u1', fdData as any);
    expect(fdMock.create).toHaveBeenCalled();
    expect(fdMock.create.mock.calls[0][0].data.maturityAmount).toBeGreaterThan(0);
  });
});

describe('updateFD', () => {
  it('updates FD when found', async () => {
    fdMock.update.mockResolvedValue({ id: 'fd-1' });
    await updateFD('u1', 'fd-1', { status: 'MATURED' } as any);
    expect(fdMock.update).toHaveBeenCalledWith({ where: { id: 'fd-1' }, data: { status: 'MATURED' } });
  });

  it('recalculates maturityAmount when financial fields change', async () => {
    fdMock.findFirst.mockResolvedValue({
      id: 'fd-1',
      userId: 'u1',
      principalAmount: 100000,
      interestRate: 7,
      tenureMonths: 12,
      interestPayoutType: 'CUMULATIVE',
    });
    fdMock.update.mockResolvedValue({ id: 'fd-1' });

    await updateFD('u1', 'fd-1', { principalAmount: 125000 } as any);

    expect(fdMock.update).toHaveBeenCalledWith({
      where: { id: 'fd-1' },
      data: expect.objectContaining({
        principalAmount: 125000,
        maturityAmount: expect.any(Number),
      }),
    });
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

describe('getFDForAudit', () => {
  it('scopes to the requester for MEMBER', async () => {
    fdMock.findFirst.mockResolvedValue({ id: 'fd-1' });
    const result = await getFDForAudit('u1', 'fd-1', 'MEMBER');
    expect(fdMock.findFirst).toHaveBeenCalledWith({ where: { id: 'fd-1', userId: 'u1' } });
    expect(result).toEqual({ id: 'fd-1' });
  });

  it('drops the owner filter for ADMIN — can fetch another member\'s FD', async () => {
    fdMock.findFirst.mockResolvedValue({ id: 'fd-1' });
    await getFDForAudit('admin-1', 'fd-1', 'ADMIN');
    expect(fdMock.findFirst).toHaveBeenCalledWith({ where: { id: 'fd-1' } });
  });

  it('returns null when not found', async () => {
    fdMock.findFirst.mockResolvedValue(null);
    const result = await getFDForAudit('u1', 'fd-x');
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RD CRUD
// ─────────────────────────────────────────────────────────────────────────────

describe('getRDs', () => {
  it('MEMBER: scopes to requesterId, ignores passed userId', async () => {
    await getRDs('other-user', 'u1', 'MEMBER', 'ACTIVE' as any);
    expect(rdMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', status: 'ACTIVE' } }),
    );
  });

  it('MEMBER without status: status ternary uses {} (line 305 false branch)', async () => {
    await getRDs('other-user', 'u1', 'MEMBER');
    expect(rdMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' } }),
    );
  });

  it('ADMIN with userId: scopes to specified member', async () => {
    await getRDs('u2', 'admin-1', 'ADMIN');
    expect(rdMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u2' } }),
    );
  });

  it('ADMIN with userId and status: status filter applied (line 313 true branch)', async () => {
    await getRDs('u2', 'admin-1', 'ADMIN', 'ACTIVE' as any);
    expect(rdMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u2', status: 'ACTIVE' } }),
    );
  });

  it('ADMIN with undefined userId: family-wide query (no userId filter), includes user name', async () => {
    rdMock.findMany.mockResolvedValueOnce([
      { id: 'rd-1', bankName: 'SBI', user: { name: 'Bob' } },
    ]);
    const result = await getRDs(undefined, 'admin-1', 'ADMIN');
    const call = rdMock.findMany.mock.calls[0][0];
    expect(call.where).not.toHaveProperty('userId');
    expect(call.include).toEqual({ user: { select: { name: true } } });
    expect((result[0] as any).userName).toBe('Bob');
    expect((result[0] as any).user).toBeUndefined();
  });

  it('ADMIN family-wide with status: status filter applied in family-wide query (line 320 true branch)', async () => {
    rdMock.findMany.mockResolvedValueOnce([]);
    await getRDs(undefined, 'admin-1', 'ADMIN', 'ACTIVE' as any);
    const call = rdMock.findMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ status: 'ACTIVE' });
  });

  it('ADMIN family-wide: falls back to empty string when user.name is null (line 325 ?? branch)', async () => {
    rdMock.findMany.mockResolvedValueOnce([
      { id: 'rd-1', bankName: 'SBI', user: { name: null } },
    ]);
    const result = await getRDs(undefined, 'admin-1', 'ADMIN');
    expect((result[0] as any).userName).toBe('');
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

  it('updates RD when found', async () => {
    const existing = { id: 'rd-1', userId: 'u1', monthlyInstallment: 2000, interestRate: 7, tenureMonths: 12 };
    const updated = { ...existing, monthlyInstallment: 3000 };
    rdMock.findFirst.mockResolvedValue(existing);
    rdMock.update.mockResolvedValue(updated);
    const result = await updateRD('u1', 'rd-1', { monthlyInstallment: 3000 });
    expect(rdMock.findFirst).toHaveBeenCalledWith({ where: { id: 'rd-1', userId: 'u1' } });
    expect(rdMock.update).toHaveBeenCalledWith({
      where: { id: 'rd-1' },
      data: expect.objectContaining({
        monthlyInstallment: 3000,
        maturityAmount: expect.any(Number),
      }),
    });
    expect(result).toEqual(updated);
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

describe('getRDForAudit', () => {
  it('scopes to the requester for MEMBER', async () => {
    rdMock.findFirst.mockResolvedValue({ id: 'rd-1' });
    const result = await getRDForAudit('u1', 'rd-1', 'MEMBER');
    expect(rdMock.findFirst).toHaveBeenCalledWith({ where: { id: 'rd-1', userId: 'u1' } });
    expect(result).toEqual({ id: 'rd-1' });
  });

  it('drops the owner filter for ADMIN — can fetch another member\'s RD', async () => {
    rdMock.findFirst.mockResolvedValue({ id: 'rd-1' });
    await getRDForAudit('admin-1', 'rd-1', 'ADMIN');
    expect(rdMock.findFirst).toHaveBeenCalledWith({ where: { id: 'rd-1' } });
  });

  it('returns null when not found', async () => {
    rdMock.findFirst.mockResolvedValue(null);
    const result = await getRDForAudit('u1', 'rd-x');
    expect(result).toBeNull();
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

  it('passes status filter when provided (line 355 truthy branch)', async () => {
    await getSIPs('u1', 'ACTIVE' as any);
    expect(sipMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', status: 'ACTIVE' } }),
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
  it('creates SIP with scalar foreign keys and returns with investment included', async () => {
    const sipResult = { id: 'sip-new', investment: MOCK_INV };
    sipMock.create.mockResolvedValue(sipResult);

    const result = await createSIP('u1', {
      investmentId: 'inv-1',
      sipDate: 15,
      monthlyAmount: 5000,
      startDate: new Date('2025-01-01'),
      status: 'ACTIVE',
    } as any);

    expect(invMock.findFirst).toHaveBeenCalledWith({
      where: { id: 'inv-1', userId: 'u1' },
      select: { id: true },
    });
    expect(sipMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u1',
          investmentId: 'inv-1',
        }),
        include: { investment: true, bankAccount: true },
      }),
    );
    expect(result).toBe(sipResult);
  });

  it('creates a mutual-fund investment automatically when investmentId is omitted', async () => {
    const startDate = new Date('2025-01-01');
    const sipResult = { id: 'sip-auto', investment: { ...MOCK_INV, id: 'inv-auto' } };
    invMock.create.mockResolvedValue({ id: 'inv-auto' });
    sipMock.create.mockResolvedValue(sipResult);

    const result = await createSIP('u1', {
      fundName: 'Axis Bluechip',
      folioNumber: 'FOLIO123',
      sipDate: 10,
      monthlyAmount: 5000,
      startDate,
      status: 'ACTIVE',
    } as any);

    expect(invMock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        type: 'MUTUAL_FUND',
        name: 'Axis Bluechip',
        currency: 'INR',
        unitsOrQuantity: 0,
        purchasePricePerUnit: 0,
        currentPricePerUnit: 0,
        purchaseDate: startDate,
        folioNumber: 'FOLIO123',
        notes: 'Auto-created from SIP setup',
      }),
    });
    expect(sipMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u1',
          investmentId: 'inv-auto',
          fundName: 'Axis Bluechip',
        }),
        include: { investment: true, bankAccount: true },
      }),
    );
    expect(result).toBe(sipResult);
  });

  it('throws when the linked investment does not belong to the user', async () => {
    invMock.findFirst.mockResolvedValue(null);

    await expect(createSIP('u1', {
      investmentId: 'inv-other',
      fundName: 'Axis Bluechip',
      sipDate: 10,
      monthlyAmount: 5000,
      startDate: new Date('2025-01-01'),
      status: 'ACTIVE',
    } as any)).rejects.toThrow(/investment/i);

    expect(sipMock.create).not.toHaveBeenCalled();
  });
});

describe('updateSIP / deleteSIP / addSIPTransaction', () => {
  it('throws NotFound for updateSIP when not found', async () => {
    sipMock.findFirst.mockResolvedValue(null);
    await expect(updateSIP('u1', 'sip-x', {})).rejects.toThrow(/not found/i);
  });

  it('updates SIP when found', async () => {
    const existing = { id: 'sip-1', userId: 'u1', amount: 5000, investmentId: 'inv-1' };
    const updated = { ...existing, amount: 7000 };
    sipMock.findFirst.mockResolvedValue(existing);
    sipMock.update.mockResolvedValue(updated);
    const result = await updateSIP('u1', 'sip-1', { amount: 7000 });
    expect(sipMock.findFirst).toHaveBeenCalledWith({ where: { id: 'sip-1', userId: 'u1' } });
    expect(sipMock.update).toHaveBeenCalledWith({
      where: { id: 'sip-1' },
      data: { amount: 7000 },
      include: { investment: true, bankAccount: true },
    });
    expect(result).toEqual(updated);
  });

  it('validates replacement investment ownership when SIP investment changes', async () => {
    const existing = { id: 'sip-1', userId: 'u1', investmentId: 'inv-old' };
    sipMock.findFirst.mockResolvedValue(existing);
    invMock.findFirst.mockResolvedValue({ id: 'inv-new' });
    sipMock.update.mockResolvedValue({ ...existing, investmentId: 'inv-new' });

    await updateSIP('u1', 'sip-1', { investmentId: 'inv-new' } as any);

    expect(invMock.findFirst).toHaveBeenCalledWith({
      where: { id: 'inv-new', userId: 'u1' },
      select: { id: true },
    });
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

describe('getSIPForAudit', () => {
  it('scopes to the requester for MEMBER', async () => {
    sipMock.findFirst.mockResolvedValue({ id: 'sip-1' });
    const result = await getSIPForAudit('u1', 'sip-1', 'MEMBER');
    expect(sipMock.findFirst).toHaveBeenCalledWith({ where: { id: 'sip-1', userId: 'u1' } });
    expect(result).toEqual({ id: 'sip-1' });
  });

  it('drops the owner filter for ADMIN — can fetch another member\'s SIP', async () => {
    sipMock.findFirst.mockResolvedValue({ id: 'sip-1' });
    await getSIPForAudit('admin-1', 'sip-1', 'ADMIN');
    expect(sipMock.findFirst).toHaveBeenCalledWith({ where: { id: 'sip-1' } });
  });

  it('returns null when not found', async () => {
    sipMock.findFirst.mockResolvedValue(null);
    const result = await getSIPForAudit('u1', 'sip-x');
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Gold Holdings CRUD
// ─────────────────────────────────────────────────────────────────────────────

describe('getGoldHoldings', () => {
  it('MEMBER: scopes to requesterId, aggregates summary metrics', async () => {
    goldMock.findMany.mockResolvedValue([
      { quantityGrams: 10, purchasePricePerGram: 5000, currentPricePerGram: 6000 },
      { quantityGrams: 5, purchasePricePerGram: 5500, currentPricePerGram: 6000 },
    ]);
    const result = await getGoldHoldings(undefined, 'u1', 'MEMBER');
    const call = goldMock.findMany.mock.calls[0][0];
    expect(call.where).toEqual({ userId: 'u1' });
    expect(result.summary.totalGrams).toBe(15);
    expect(result.summary.totalPurchaseValue).toBe(10 * 5000 + 5 * 5500);
    expect(result.summary.totalCurrentValue).toBe(15 * 6000);
    expect(result.summary.gain).toBe(result.summary.totalCurrentValue - result.summary.totalPurchaseValue);
  });

  it('ADMIN with userId: scopes to specified member', async () => {
    goldMock.findMany.mockResolvedValue([]);
    await getGoldHoldings('u2', 'admin-1', 'ADMIN');
    const call = goldMock.findMany.mock.calls[0][0];
    expect(call.where).toEqual({ userId: 'u2' });
  });

  it('ADMIN with undefined userId: family-wide query, includes user name', async () => {
    goldMock.findMany.mockResolvedValueOnce([
      { id: 'g-1', quantityGrams: 10, purchasePricePerGram: 5000, currentPricePerGram: 6000, user: { name: 'Alice' } },
    ]);
    const result = await getGoldHoldings(undefined, 'admin-1', 'ADMIN');
    const call = goldMock.findMany.mock.calls[0][0];
    expect(call.where).toEqual({ user: { isActive: true, deletedAt: null } });
    expect(call.include).toEqual({ user: { select: { name: true } } });
    expect((result.holdings[0] as any).userName).toBe('Alice');
    expect((result.holdings[0] as any).user).toBeUndefined();
  });

  it('ADMIN family-wide: falls back to empty string when user.name is null (line 427 ?? branch)', async () => {
    goldMock.findMany.mockResolvedValueOnce([
      { id: 'g-1', quantityGrams: 5, purchasePricePerGram: 5000, currentPricePerGram: 6000, user: { name: null } },
    ]);
    const result = await getGoldHoldings(undefined, 'admin-1', 'ADMIN');
    expect((result.holdings[0] as any).userName).toBe('');
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

describe('getGoldHoldingForAudit', () => {
  it('scopes to the requester for MEMBER', async () => {
    goldMock.findFirst.mockResolvedValue({ id: 'gold-1' });
    const result = await getGoldHoldingForAudit('u1', 'gold-1', 'MEMBER');
    expect(goldMock.findFirst).toHaveBeenCalledWith({ where: { id: 'gold-1', userId: 'u1' } });
    expect(result).toEqual({ id: 'gold-1' });
  });

  it('drops the owner filter for ADMIN — can fetch another member\'s gold holding', async () => {
    goldMock.findFirst.mockResolvedValue({ id: 'gold-1' });
    await getGoldHoldingForAudit('admin-1', 'gold-1', 'ADMIN');
    expect(goldMock.findFirst).toHaveBeenCalledWith({ where: { id: 'gold-1' } });
  });

  it('returns null when not found', async () => {
    goldMock.findFirst.mockResolvedValue(null);
    const result = await getGoldHoldingForAudit('u1', 'gold-x');
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Real Estate CRUD
// ─────────────────────────────────────────────────────────────────────────────

describe('getRealEstate', () => {
  it('MEMBER: scopes to requesterId, aggregates summary metrics', async () => {
    reMock.findMany.mockResolvedValue([
      { userId: 'u1', purchasePrice: 5000000, currentValue: 6000000, rentalIncomeMonthly: 25000, loan: null, owners: [{ userId: 'u1', sharePercent: 100, user: { id: 'u1', name: 'Alice', email: 'a@b.com', colorTag: null } }] },
      { userId: 'u1', purchasePrice: 3000000, currentValue: 3500000, rentalIncomeMonthly: null, loan: null, owners: [{ userId: 'u1', sharePercent: 100, user: { id: 'u1', name: 'Alice', email: 'a@b.com', colorTag: null } }] },
    ]);
    const result = await getRealEstate(undefined, 'u1', 'MEMBER');
    const call = reMock.findMany.mock.calls[0][0];
    expect(call.where).toEqual({ OR: [{ userId: 'u1' }, { owners: { some: { userId: 'u1' } } }] });
    expect(result.summary.totalPurchase).toBe(8000000);
    expect(result.summary.totalCurrent).toBe(9500000);
    expect(result.summary.totalMonthlyRental).toBe(25000);
    expect(result.summary.unrealisedGain).toBe(1500000);
  });

  it('ADMIN with userId: scopes to specified member', async () => {
    reMock.findMany.mockResolvedValue([]);
    await getRealEstate('u2', 'admin-1', 'ADMIN');
    const call = reMock.findMany.mock.calls[0][0];
    expect(call.where).toEqual({ OR: [{ userId: 'u2' }, { owners: { some: { userId: 'u2' } } }] });
  });

  it('ADMIN with undefined userId: family-wide query, includes user name', async () => {
    reMock.findMany.mockResolvedValueOnce([
      { id: 're-1', purchasePrice: 5000000, currentValue: 6000000, rentalIncomeMonthly: null, loan: null, owners: [], user: { name: 'Bob' } },
    ]);
    const result = await getRealEstate(undefined, 'admin-1', 'ADMIN');
    const call = reMock.findMany.mock.calls[0][0];
    expect(call.where).toEqual({ user: { isActive: true, deletedAt: null } });
    expect(call.include).toMatchObject({ loan: true, owners: expect.any(Object), user: { select: { name: true } } });
    expect((result.properties[0] as any).userName).toBe('Bob');
    expect((result.properties[0] as any).user).toBeUndefined();
  });

  it('ADMIN family-wide: falls back to empty string when user.name is null (line 478 ?? branch)', async () => {
    reMock.findMany.mockResolvedValueOnce([
      { id: 're-1', purchasePrice: 5000000, currentValue: 6000000, rentalIncomeMonthly: null, loan: null, owners: [], user: { name: null } },
    ]);
    const result = await getRealEstate(undefined, 'admin-1', 'ADMIN');
    expect((result.properties[0] as any).userName).toBe('');
  });

  it('member summaries count only the selected owner share', async () => {
    reMock.findMany.mockResolvedValue([
      {
        userId: 'u1',
        purchasePrice: 10000000,
        currentValue: 12000000,
        rentalIncomeMonthly: 40000,
        loan: null,
        owners: [
          { userId: 'u1', sharePercent: 60, user: { id: 'u1', name: 'Alice', email: 'a@b.com', colorTag: null } },
          { userId: 'u2', sharePercent: 40, user: { id: 'u2', name: 'Bob', email: 'b@b.com', colorTag: null } },
        ],
      },
    ]);

    const result = await getRealEstate(undefined, 'u2', 'MEMBER');

    expect(result.summary.totalPurchase).toBe(4000000);
    expect(result.summary.totalCurrent).toBe(4800000);
    expect(result.summary.totalMonthlyRental).toBe(16000);
    expect((result.properties[0] as any).sharePercent).toBe(40);
  });
});

describe('createRealEstate / updateRealEstate / deleteRealEstate', () => {
  it('creates real estate with userId merged', async () => {
    reMock.create.mockResolvedValue({ id: 're-new', userId: 'u1', purchasePrice: 5000000, currentValue: 5000000, rentalIncomeMonthly: null, owners: [] });
    await createRealEstate('u1', { purchasePrice: 5000000 } as any);
    expect(reMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u1',
          owners: { create: [{ userId: 'u1', sharePercent: 100 }] },
        }),
      }),
    );
  });

  it('rejects owner shares that do not total 100%', async () => {
    await expect(createRealEstate('u1', {
      purchasePrice: 5000000,
      owners: [{ userId: 'u1', sharePercent: 90 }],
    } as any)).rejects.toThrow(/100%/i);
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
    const updated = { id: 're-1', userId: 'u1', purchasePrice: 5000000, currentValue: 7000000, rentalIncomeMonthly: null, owners: [] };
    reMock.update.mockResolvedValue(updated);
    const result = await updateRealEstate('u1', 're-1', { currentValue: 7000000 });
    expect(reMock.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 're-1' }, data: { currentValue: 7000000 } }));
    expect(result.currentValue).toBe(7000000);
  });

  it('updates owner shares when provided', async () => {
    const updated = {
      id: 're-1',
      userId: 'u1',
      purchasePrice: 5000000,
      currentValue: 7000000,
      rentalIncomeMonthly: null,
      owners: [
        { userId: 'u1', sharePercent: 50, user: { id: 'u1', name: 'Alice', email: 'a@b.com', colorTag: null } },
        { userId: 'u2', sharePercent: 50, user: { id: 'u2', name: 'Bob', email: 'b@b.com', colorTag: null } },
      ],
    };
    reMock.update.mockResolvedValue(updated);

    const result = await updateRealEstate('u1', 're-1', {
      owners: [{ userId: 'u1', sharePercent: 50 }, { userId: 'u2', sharePercent: 50 }],
    } as any);

    expect(reMock.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        owners: {
          deleteMany: {},
          create: [{ userId: 'u1', sharePercent: 50 }, { userId: 'u2', sharePercent: 50 }],
        },
      }),
    }));
    expect((result as any).owners).toHaveLength(2);
  });
});

describe('getRealEstateForAudit', () => {
  it('scopes a MEMBER to properties they own or co-own', async () => {
    reMock.findFirst.mockResolvedValue({ id: 're-1' });
    const result = await getRealEstateForAudit('u1', 're-1');
    expect(reMock.findFirst).toHaveBeenCalledWith({
      where: {
        id: 're-1',
        OR: [
          { userId: 'u1' },
          { owners: { some: { userId: 'u1' } } },
        ],
      },
    });
    expect(result).toEqual({ id: 're-1' });
  });

  it('drops the owner filter for ADMIN — can snapshot another member\'s property', async () => {
    reMock.findFirst.mockResolvedValue({ id: 're-1' });
    await getRealEstateForAudit('admin-1', 're-1', 'ADMIN');
    expect(reMock.findFirst).toHaveBeenCalledWith({ where: { id: 're-1' } });
  });

  it('returns null when a MEMBER asks for a property they do not own', async () => {
    reMock.findFirst.mockResolvedValue(null);
    const result = await getRealEstateForAudit('u1', 're-x');
    expect(result).toBeNull();
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

describe('getExchangeRateForAudit', () => {
  it('queries by the fromCurrency/toCurrency composite key — global, no requesterId/role', async () => {
    fxMock.findUnique.mockResolvedValue({ fromCurrency: 'USD', rate: 83 });
    const result = await getExchangeRateForAudit('USD');
    expect(fxMock.findUnique).toHaveBeenCalledWith({
      where: { fromCurrency_toCurrency: { fromCurrency: 'USD', toCurrency: 'INR' } },
    });
    expect(result).toEqual({ fromCurrency: 'USD', rate: 83 });
  });

  it('returns null when no rate exists yet', async () => {
    fxMock.findUnique.mockResolvedValue(null);
    const result = await getExchangeRateForAudit('EUR');
    expect(result).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scoping branches: ADMIN family-wide vs member-scoped `where` construction
// ═════════════════════════════════════════════════════════════════════════════

describe('getPortfolioSummary — scoping', () => {
  it('ADMIN with no target user queries every active family member', async () => {
    await getPortfolioSummary(undefined, 'admin-1', 'ADMIN');
    expect(invMock.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { user: { isActive: true, deletedAt: null } },
    }));
  });

  it('ADMIN with an explicit target user scopes to that member', async () => {
    await getPortfolioSummary('u2', 'admin-1', 'ADMIN');
    expect(invMock.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u2' },
    }));
  });

  it('MEMBER with no userId falls back to the requester id', async () => {
    await getPortfolioSummary(undefined, 'u1', 'MEMBER');
    expect(invMock.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1' },
    }));
  });

  it('defaults requesterId to the passed userId when omitted', async () => {
    await getPortfolioSummary('u1');
    expect(invMock.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1' },
    }));
  });

  it('defaults requesterId to an empty string when both args are omitted', async () => {
    await getPortfolioSummary(undefined);
    expect(invMock.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: '' },
    }));
  });
});

describe('get80CSummary — scoping', () => {
  it('ADMIN with no target user aggregates across active family members', async () => {
    await get80CSummary(undefined, '2025-26', 'admin-1', 'ADMIN');
    const where = invMock.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ user: { isActive: true, deletedAt: null } });
  });

  it('ADMIN with an explicit target user scopes to that member', async () => {
    await get80CSummary('u2', '2025-26', 'admin-1', 'ADMIN');
    expect(invMock.findMany.mock.calls[0][0].where).toMatchObject({ userId: 'u2' });
  });

  it('MEMBER with no userId falls back to the requester id', async () => {
    await get80CSummary(undefined, '2025-26', 'u1', 'MEMBER');
    expect(invMock.findMany.mock.calls[0][0].where).toMatchObject({ userId: 'u1' });
  });

  it('falls back to userId when no requesterId is supplied', async () => {
    await get80CSummary('u1', '2025-26');
    expect(invMock.findMany.mock.calls[0][0].where).toMatchObject({ userId: 'u1' });
  });
});

describe('getInvestments — scoping and joined user name', () => {
  it('ADMIN with no target user lists every active family member\'s investments', async () => {
    await getInvestments(undefined as any, undefined, 1, 25, 'ADMIN');
    expect(invMock.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ user: { isActive: true, deletedAt: null } }),
    }));
  });

  it('flattens the joined user name onto each row', async () => {
    invMock.findMany.mockResolvedValue([{ ...MOCK_INV, user: { name: 'Harshit' } }]);
    invMock.count.mockResolvedValue(1);
    const { items } = await getInvestments('u1', undefined, 1, 25);
    expect(items[0].userName).toBe('Harshit');
  });

  it('falls back to an empty userName when the row has no joined user', async () => {
    invMock.findMany.mockResolvedValue([{ ...MOCK_INV }]);
    invMock.count.mockResolvedValue(1);
    const { items } = await getInvestments('u1', undefined, 1, 25);
    expect(items[0].userName).toBe('');
  });
});

describe('getSIPs — scoping', () => {
  it('ADMIN with no target user lists every active family member\'s SIPs', async () => {
    await getSIPs(undefined, undefined, 'ADMIN');
    expect(sipMock.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ user: { isActive: true, deletedAt: null } }),
    }));
  });

  it('ADMIN with an explicit target user scopes to that member', async () => {
    await getSIPs('u2', undefined, 'ADMIN');
    expect(sipMock.findMany.mock.calls[0][0].where).toMatchObject({ userId: 'u2' });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Maturity recalculation: each trigger field on its own, plus stored-value fallback
// ═════════════════════════════════════════════════════════════════════════════

describe('updateFD — maturity recalculation falls back to stored values', () => {
  it('uses the stored principal when only the rate changes', async () => {
    fdMock.findFirst.mockResolvedValue({
      id: 'fd-1', userId: 'u1', principalAmount: 100_000, interestRate: 7,
      tenureMonths: 12, interestPayoutType: 'CUMULATIVE',
    });
    fdMock.update.mockResolvedValue({});
    await updateFD('u1', 'fd-1', { interestRate: 8 });
    const { maturityAmount } = fdMock.update.mock.calls[0][0].data;
    // 100000 * (1 + 0.08/4)^4 = 108243.216
    expect(maturityAmount).toBeCloseTo(108_243.22, 2);
  });

  it('uses the stored payout type and tenure when only the principal changes', async () => {
    fdMock.findFirst.mockResolvedValue({
      id: 'fd-1', userId: 'u1', principalAmount: 100_000, interestRate: 8,
      tenureMonths: 12, interestPayoutType: 'CUMULATIVE',
    });
    fdMock.update.mockResolvedValue({});
    await updateFD('u1', 'fd-1', { principalAmount: 200_000 });
    const { maturityAmount } = fdMock.update.mock.calls[0][0].data;
    expect(maturityAmount).toBeCloseTo(216_486.43, 2);
  });
});

describe('updateRD — maturity recalculation triggers', () => {
  const STORED_RD = {
    id: 'rd-1', userId: 'u1', monthlyInstallment: 5_000, interestRate: 7, tenureMonths: 12,
  };

  it('recalculates when only monthlyInstallment changes', async () => {
    rdMock.findFirst.mockResolvedValue(STORED_RD);
    rdMock.update.mockResolvedValue({});
    await updateRD('u1', 'rd-1', { monthlyInstallment: 10_000 });
    expect(rdMock.update.mock.calls[0][0].data.maturityAmount)
      .toBeCloseTo(calcRDMaturity(10_000, 7, 12), 2);
  });

  it('recalculates when only interestRate changes', async () => {
    rdMock.findFirst.mockResolvedValue(STORED_RD);
    rdMock.update.mockResolvedValue({});
    await updateRD('u1', 'rd-1', { interestRate: 9 });
    expect(rdMock.update.mock.calls[0][0].data.maturityAmount)
      .toBeCloseTo(calcRDMaturity(5_000, 9, 12), 2);
  });

  it('recalculates when only tenureMonths changes', async () => {
    rdMock.findFirst.mockResolvedValue(STORED_RD);
    rdMock.update.mockResolvedValue({});
    await updateRD('u1', 'rd-1', { tenureMonths: 24 });
    expect(rdMock.update.mock.calls[0][0].data.maturityAmount)
      .toBeCloseTo(calcRDMaturity(5_000, 7, 24), 2);
  });

  it('does not recalculate when no maturity-affecting field changes', async () => {
    rdMock.findFirst.mockResolvedValue(STORED_RD);
    rdMock.update.mockResolvedValue({});
    await updateRD('u1', 'rd-1', { notes: 'renamed' } as any);
    expect(rdMock.update.mock.calls[0][0].data.maturityAmount).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SIP auto-created investment + investmentId re-link validation
// ═════════════════════════════════════════════════════════════════════════════

describe('createSIP — auto-created investment purchaseDate', () => {
  it('reuses a Date startDate as the auto-created investment purchaseDate', async () => {
    const startDate = new Date('2025-06-01');
    invMock.create.mockResolvedValue({ id: 'inv-new' });
    sipMock.create.mockResolvedValue({ id: 'sip-new' });
    await createSIP('u1', { fundName: 'Axis Bluechip', startDate } as any);
    expect(invMock.create.mock.calls[0][0].data.purchaseDate).toBe(startDate);
  });

  it('substitutes today when startDate is not a Date instance', async () => {
    invMock.create.mockResolvedValue({ id: 'inv-new' });
    sipMock.create.mockResolvedValue({ id: 'sip-new' });
    await createSIP('u1', { fundName: 'Axis Bluechip', startDate: '2025-06-01' } as any);
    expect(invMock.create.mock.calls[0][0].data.purchaseDate).toBeInstanceOf(Date);
  });
});

describe('updateSIP — investmentId re-link validation', () => {
  it('rejects re-linking to an investment the SIP owner does not hold', async () => {
    sipMock.findFirst.mockResolvedValue({ id: 'sip-1', userId: 'u1', investmentId: 'inv-1' });
    invMock.findFirst.mockResolvedValue(null); // target investment not owned by u1
    await expect(updateSIP('u1', 'sip-1', { investmentId: 'inv-other' }))
      .rejects.toThrow(/Investment not found/i);
    expect(sipMock.update).not.toHaveBeenCalled();
  });

  it('scopes the investment ownership check to the SIP owner', async () => {
    sipMock.findFirst.mockResolvedValue({ id: 'sip-1', userId: 'u1', investmentId: 'inv-1' });
    invMock.findFirst.mockResolvedValue({ id: 'inv-2' });
    sipMock.update.mockResolvedValue({});
    await updateSIP('u1', 'sip-1', { investmentId: 'inv-2' });
    expect(invMock.findFirst).toHaveBeenCalledWith({
      where: { id: 'inv-2', userId: 'u1' },
      select: { id: true },
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Real estate: owner normalization, active-owner assertion, decoration, ADMIN scope
// ═════════════════════════════════════════════════════════════════════════════

describe('createRealEstate — owner validation', () => {
  const BASE = { propertyName: 'Flat 3B', purchasePrice: 100, currentValue: 120 };

  it('rejects an owner row with a blank userId', async () => {
    await expect(createRealEstate('u1', { ...BASE, owners: [{ userId: '', sharePercent: 50 }] } as any))
      .rejects.toThrow(/Property owner is required/i);
  });

  it('rejects the same owner listed twice', async () => {
    await expect(createRealEstate('u1', {
      ...BASE,
      owners: [{ userId: 'u1', sharePercent: 50 }, { userId: 'u1', sharePercent: 50 }],
    } as any)).rejects.toThrow(/only be added once/i);
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['above 100', 101],
    ['non-numeric', Number.NaN],
  ])('rejects a %s share percent', async (_label, sharePercent) => {
    await expect(createRealEstate('u1', {
      ...BASE,
      owners: [{ userId: 'u1', sharePercent }],
    } as any)).rejects.toThrow(/share must be greater than 0 and at most 100/i);
  });

  it('rejects owners who are not active family members', async () => {
    userMock.findMany.mockResolvedValue([]); // none of the requested owners are active
    await expect(createRealEstate('u1', {
      ...BASE,
      owners: [{ userId: 'ghost', sharePercent: 100 }],
    } as any)).rejects.toThrow(/must be active family members/i);
    expect(reMock.create).not.toHaveBeenCalled();
  });

  it('defaults to a single 100% owner when no owners are supplied', async () => {
    userMock.findMany.mockResolvedValue([{ id: 'u1' }]);
    reMock.create.mockResolvedValue({ id: 're-1', userId: 'u1', purchasePrice: 100, currentValue: 120, owners: [] });
    await createRealEstate('u1', BASE as any);
    const created = reMock.create.mock.calls[0][0].data;
    expect(created.owners.create).toEqual([{ userId: 'u1', sharePercent: 100 }]);
  });
});

describe('getRealEstate — property decoration', () => {
  function propertyWith(owners: any[], extra: Record<string, unknown> = {}) {
    return {
      id: 're-1', userId: 'u1', purchasePrice: 1_000_000, currentValue: 1_500_000,
      rentalIncomeMonthly: null, owners, ...extra,
    };
  }

  it('maps joined owner user fields onto each owner row', async () => {
    reMock.findMany.mockResolvedValue([propertyWith([
      { id: 'o1', userId: 'u1', sharePercent: 60, user: { name: 'Harshit', email: 'h@x.com', colorTag: 'blue' } },
    ])]);
    const { properties } = await getRealEstate('u1', 'u1', 'MEMBER');
    expect(properties[0].owners[0]).toMatchObject({
      userId: 'u1', name: 'Harshit', email: 'h@x.com', colorTag: 'blue', sharePercent: 60,
    });
  });

  it('falls back to empty strings and null when an owner has no joined user', async () => {
    reMock.findMany.mockResolvedValue([propertyWith([
      { id: 'o1', userId: 'u1', sharePercent: 100 },
    ])]);
    const { properties } = await getRealEstate('u1', 'u1', 'MEMBER');
    expect(properties[0].owners[0]).toMatchObject({ name: '', email: '', colorTag: null });
  });

  it('treats a property with no owners array as having no owners', async () => {
    reMock.findMany.mockResolvedValue([{
      id: 're-1', userId: 'u1', purchasePrice: 1_000_000, currentValue: 1_500_000, rentalIncomeMonthly: null,
    }]);
    const { properties } = await getRealEstate('u1', 'u1', 'MEMBER');
    expect(properties[0].owners).toEqual([]);
  });

  it('uses the scoped owner\'s share percent when they are on the owners list', async () => {
    reMock.findMany.mockResolvedValue([propertyWith([
      { id: 'o1', userId: 'u1', sharePercent: 40, user: { name: 'A' } },
      { id: 'o2', userId: 'u2', sharePercent: 60, user: { name: 'B' } },
    ])]);
    const { properties } = await getRealEstate('u1', 'u1', 'MEMBER');
    expect(properties[0].sharePercent).toBe(40);
    expect(Number(properties[0].currentValueShare)).toBeCloseTo(600_000, 2);
  });

  it('gives the record owner 100% when they are not on the owners list', async () => {
    reMock.findMany.mockResolvedValue([propertyWith([
      { id: 'o2', userId: 'u2', sharePercent: 60, user: { name: 'B' } },
    ], { userId: 'u1' })]);
    const { properties } = await getRealEstate('u1', 'u1', 'MEMBER');
    expect(properties[0].sharePercent).toBe(100);
  });

  it('gives a non-owner viewer a 0% share', async () => {
    reMock.findMany.mockResolvedValue([propertyWith([
      { id: 'o2', userId: 'u2', sharePercent: 60, user: { name: 'B' } },
    ], { userId: 'u3' })]);
    const { properties } = await getRealEstate('u1', 'u1', 'MEMBER');
    expect(properties[0].sharePercent).toBe(0);
    expect(Number(properties[0].currentValueShare)).toBe(0);
  });

  it('sorts owners by name', async () => {
    reMock.findMany.mockResolvedValue([propertyWith([
      { id: 'o1', userId: 'u1', sharePercent: 50, user: { name: 'Zara' } },
      { id: 'o2', userId: 'u2', sharePercent: 50, user: { name: 'Amit' } },
    ])]);
    const { properties } = await getRealEstate('u1', 'u1', 'MEMBER');
    expect(properties[0].owners.map((o: any) => o.name)).toEqual(['Amit', 'Zara']);
  });
});

describe('real-estate write scoping', () => {
  it('ADMIN updates match on id alone (no ownership filter)', async () => {
    reMock.findFirst.mockResolvedValue({ id: 're-1', userId: 'u2' });
    reMock.update.mockResolvedValue({ id: 're-1', userId: 'u2', purchasePrice: 1, currentValue: 2, owners: [] });
    await updateRealEstate('admin-1', 're-1', { currentValue: 2 } as any, 'ADMIN');
    expect(reMock.findFirst).toHaveBeenCalledWith({ where: { id: 're-1' } });
  });

  it('MEMBER updates require ownership or an owner-row match', async () => {
    reMock.findFirst.mockResolvedValue({ id: 're-1', userId: 'u1' });
    reMock.update.mockResolvedValue({ id: 're-1', userId: 'u1', purchasePrice: 1, currentValue: 2, owners: [] });
    await updateRealEstate('u1', 're-1', { currentValue: 2 } as any, 'MEMBER');
    expect(reMock.findFirst).toHaveBeenCalledWith({
      where: {
        id: 're-1',
        OR: [{ userId: 'u1' }, { owners: { some: { userId: 'u1' } } }],
      },
    });
  });

  it('ADMIN deletes match on id alone', async () => {
    reMock.findFirst.mockResolvedValue({ id: 're-1', userId: 'u2' });
    reMock.delete.mockResolvedValue({ id: 're-1' });
    await deleteRealEstate('admin-1', 're-1', 'ADMIN');
    expect(reMock.findFirst).toHaveBeenCalledWith({ where: { id: 're-1' } });
  });
});
