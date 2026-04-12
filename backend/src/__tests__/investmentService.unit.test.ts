/**
 * Unit tests for pure math functions in investmentService.ts.
 *
 * calcFDMaturity and calcRDMaturity are exported — tested directly.
 * xirr is internal — tested indirectly via getPortfolioSummary with mocked prisma.
 *
 * No real DB needed — all prisma calls are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma (dual export — investmentService uses named import)
vi.mock('../config/prisma', () => {
  const mockPrisma = {
    investment: { findMany: vi.fn() },
    exchangeRate: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { default: mockPrisma, prisma: mockPrisma };
});

import prisma from '../config/prisma';
import {
  calcFDMaturity,
  calcRDMaturity,
  getPortfolioSummary,
} from '../services/investmentService';

const investmentFindMany = prisma.investment.findMany as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
  (prisma.exchangeRate.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
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
      // (1 + 0/4)^n = 1 → returns principal
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
      // 10000 + 10000 * 0.10 * 1 = 11000
      const result = calcFDMaturity(10_000, 10, 12, 'MONTHLY');
      expect(result).toBeCloseTo(11_000, 0);
    });

    it('QUARTERLY: simple interest for 12 months at 8%', () => {
      // 50000 + 50000 * 0.08 * 1 = 54000
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
    // r = 8/400 = 0.02, n = 4 (quarters), n*3 = 12
    // 5000 * (1.02^12 - 1) / (1.02^3 - 1) * 1.02^3 ≈ 23253.52
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
      id: 'inv-1',
      userId: 'u1',
      type: 'MUTUAL_FUND',
      currency: 'INR',
      purchaseExchangeRate: null,
      unitsOrQuantity: 10,
      purchasePricePerUnit: 100,
      currentPricePerUnit: 120,
      purchaseDate: ONE_YEAR_AGO,
      sipTransactions: [],
      isTaxSaving: false,
      ...overrides,
    };
  }

  it('returns a finite non-null xirr for a profitable investment', async () => {
    // outflow: -1000 (1 year ago), inflow: +1200 (now) → ~20% XIRR
    investmentFindMany.mockResolvedValue([makeInvestment()]);
    const result = await getPortfolioSummary('u1');
    expect(result.xirr).not.toBeNull();
    expect(isFinite(result.xirr!)).toBe(true);
    expect(result.xirr!).toBeGreaterThan(0); // profit → positive XIRR
  });

  it('returns null xirr when current value is 0 (all-outflow cashflows)', async () => {
    // No inflow (currentPricePerUnit=0) → xirr has no positive cashflows → null
    investmentFindMany.mockResolvedValue([makeInvestment({ currentPricePerUnit: 0 })]);
    const result = await getPortfolioSummary('u1');
    expect(result.xirr).toBeNull();
  });

  it('returns null xirr when there are no investments', async () => {
    investmentFindMany.mockResolvedValue([]);
    const result = await getPortfolioSummary('u1');
    expect(result.xirr).toBeNull();
  });

  it('aggregates portfolio metrics correctly', async () => {
    investmentFindMany.mockResolvedValue([
      makeInvestment({ unitsOrQuantity: 10, purchasePricePerUnit: 100, currentPricePerUnit: 120 }),
    ]);
    const result = await getPortfolioSummary('u1');
    expect(result.totalInvested).toBeCloseTo(1_000, 0);
    expect(result.totalCurrentValue).toBeCloseTo(1_200, 0);
    expect(result.absoluteGain).toBeCloseTo(200, 0);
    expect(result.absoluteReturnPct).toBeCloseTo(20, 1);
  });

  it('returns zero metrics for empty portfolio', async () => {
    investmentFindMany.mockResolvedValue([]);
    const result = await getPortfolioSummary('u1');
    expect(result.totalInvested).toBe(0);
    expect(result.totalCurrentValue).toBe(0);
    expect(result.absoluteGain).toBe(0);
    expect(result.absoluteReturnPct).toBe(0);
  });

  it('applies fx rate for non-INR investments', async () => {
    (prisma.exchangeRate.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { fromCurrency: 'USD', toCurrency: 'INR', rate: 83 },
    ]);
    investmentFindMany.mockResolvedValue([
      makeInvestment({ currency: 'USD', purchasePricePerUnit: 10, currentPricePerUnit: 10 }),
    ]);
    const result = await getPortfolioSummary('u1');
    // 10 units × $10 × ₹83 = ₹8300 invested and current (no gain)
    expect(result.totalInvested).toBeCloseTo(8_300, 0);
    expect(result.totalCurrentValue).toBeCloseTo(8_300, 0);
  });
});
