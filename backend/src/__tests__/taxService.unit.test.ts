/**
 * Unit tests for pure tax calculation functions in taxService.ts.
 *
 * The internal functions (calcOldRegimeTax, calcNewRegimeTax, addSurchargeAndCess,
 * resolveNewRegimeSlab) are exercised indirectly through getTaxSummary with a mocked
 * prisma that returns a controlled profile and empty arrays for all deduction queries.
 * calcHRAExemption is exported and tested directly.
 *
 * No real DB needed — all prisma calls are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma (dual export — taxService uses both named and default imports)
vi.mock('../config/prisma', () => {
  const mockPrisma = {
    taxProfile: { findUnique: vi.fn() },
    investment: { findMany: vi.fn().mockResolvedValue([]) },
    fixedDeposit: { findMany: vi.fn().mockResolvedValue([]) },
    insurancePolicy: { findMany: vi.fn().mockResolvedValue([]) },
    loan: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { default: mockPrisma, prisma: mockPrisma };
});

// taxService imports buildAmortizationSchedule from loanService
vi.mock('../services/loanService', () => ({
  buildAmortizationSchedule: vi.fn().mockReturnValue([]),
}));

// getITR2Summary imports these three; getTaxSummary does NOT
vi.mock('../services/capitalGainsService', () => ({
  calcCapitalGainsSummary: vi.fn().mockResolvedValue({
    stcg: 0,
    ltcg: 0,
    totalTaxableGain: 0,
    entries: [],
  }),
}));
vi.mock('../services/otherIncomeService', () => ({
  calcOtherIncomeSummary: vi.fn().mockResolvedValue({
    breakdown: {},
    foreignDividend: 0,
    totalForeignWithholdingTax: 0,
    grossTotal: 0,
    deduction80TTA: 0,
    taxableTotal: 0,
    totalTdsDeducted: 0,
  }),
}));
vi.mock('../services/housePropertyService', () => ({
  calcHousePropertyIncome: vi.fn().mockResolvedValue({
    properties: [],
    totalHPIncome: 0,
    hpLossSetOff: 0,
    taxableHPIncome: 0,
  }),
}));

import prisma from '../config/prisma';
import {
  calcHRAExemption,
  getTaxSummary,
  getITR2Summary,
} from '../services/taxService';
import { calcCapitalGainsSummary } from '../services/capitalGainsService';
import { calcOtherIncomeSummary } from '../services/otherIncomeService';
import { calcHousePropertyIncome } from '../services/housePropertyService';
import { buildAmortizationSchedule } from '../services/loanService';

const profileMock = prisma.taxProfile.findUnique as ReturnType<typeof vi.fn>;

/**
 * Build a zero-deduction profile for a given grossSalary and regime/fy.
 * All deduction fields are 0 so the only driver of tax is the salary.
 */
function makeProfile(grossSalary: number, regime: 'OLD' | 'NEW' = 'OLD') {
  return {
    grossSalary,
    regime,
    hraReceived: 0,
    rentPaidMonthly: 0,
    cityType: 'NON_METRO',
    taxPaidAdvance: 0,
    taxPaidTds: 0,
    taxPaidSelfAssessment: 0,
    deduction80C: 0,
    nps80Ccd1B: 0,
    deduction80E: 0,
    deduction80G: 0,
    otherDeductions: 0,
  };
}

beforeEach(() => {
  // resetAllMocks clears both call history AND implementations, giving each test
  // a guaranteed clean slate rather than relying on prior test's mock state.
  vi.resetAllMocks();
  // Re-apply defaults for all mocks (resetAllMocks wipes vi.mock() factory implementations too)
  (prisma.investment.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (prisma.fixedDeposit.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (prisma.insurancePolicy.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (prisma.loan.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (buildAmortizationSchedule as ReturnType<typeof vi.fn>).mockReturnValue([]);
  (calcCapitalGainsSummary as ReturnType<typeof vi.fn>).mockResolvedValue({
    stcg: 0, ltcg: 0, totalTaxableGain: 0, entries: [],
  });
  (calcOtherIncomeSummary as ReturnType<typeof vi.fn>).mockResolvedValue({
    breakdown: {}, foreignDividend: 0, totalForeignWithholdingTax: 0,
    grossTotal: 0, deduction80TTA: 0, taxableTotal: 0, totalTdsDeducted: 0,
  });
  (calcHousePropertyIncome as ReturnType<typeof vi.fn>).mockResolvedValue({
    properties: [], totalHPIncome: 0, hpLossSetOff: 0, taxableHPIncome: 0,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calcHRAExemption (directly exported)
// ─────────────────────────────────────────────────────────────────────────────

describe('calcHRAExemption', () => {
  // min(hraReceived, rentExcess, metroLimit)

  it('hraReceived is the binding limit when it is smallest', () => {
    // basic=600K, hra=5K, rent=300K metro → min(5K, 240K, 300K) = 5K
    expect(calcHRAExemption(600_000, 5_000, 300_000, true)).toBe(5_000);
  });

  it('rent excess is the binding limit when it is smallest', () => {
    // basic=600K, hra=200K, rent=65K metro → rentExcess=max(65K-60K,0)=5K → min(200K,5K,300K)=5K
    expect(calcHRAExemption(600_000, 200_000, 65_000, true)).toBe(5_000);
  });

  it('metro limit (50% of basic) is the binding limit', () => {
    // basic=600K, hra=400K, rent=400K metro → rentExcess=340K, metroLimit=300K → min(400K,340K,300K)=300K
    expect(calcHRAExemption(600_000, 400_000, 400_000, true)).toBe(300_000);
  });

  it('non-metro limit is 40% of basic', () => {
    // basic=600K, hra=400K, rent=400K non-metro → nonMetroLimit=240K → min(400K,340K,240K)=240K
    expect(calcHRAExemption(600_000, 400_000, 400_000, false)).toBe(240_000);
  });

  it('zero rent paid yields zero exemption', () => {
    // rentExcess = max(0 - 60K, 0) = 0 → min(anything, 0, anything) = 0
    expect(calcHRAExemption(600_000, 200_000, 0, true)).toBe(0);
  });

  it('returns 0 when rent does not exceed 10% of basic', () => {
    // basic=500K, rent=49K → rentExcess=max(49K-50K,0)=0
    expect(calcHRAExemption(500_000, 150_000, 49_000, true)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calcOldRegimeTax + addSurchargeAndCess (via getTaxSummary, old regime)
// ─────────────────────────────────────────────────────────────────────────────

describe('getTaxSummary — old regime tax slabs', () => {
  const FY = '2025-26';

  it('income below ₹2.5L: tax = 0', async () => {
    // grossSalary=300K → taxable=250K (std deduction 50K)
    profileMock.mockResolvedValue(makeProfile(300_000));
    const result = await getTaxSummary('u1', FY);
    expect(result.oldRegime.tax).toBe(0);
  });

  it('87A rebate covers entire 5% slab: income in 5% slab (taxable 300K) → tax = 0', async () => {
    // grossSalary=350K → taxable=300K → rawTax=2500 but rebate=12500 → max(-10000,0)=0
    // The Sec 87A rebate eliminates ALL tax for taxable income ≤ ₹5L in old regime
    profileMock.mockResolvedValue(makeProfile(350_000));
    const result = await getTaxSummary('u1', FY);
    expect(result.oldRegime.tax).toBe(0);
  });

  it('87A rebate: taxable income = ₹5L → tax is 0 after rebate', async () => {
    // grossSalary=550K → taxable=500K → rawTax=12500 → rebate=12500 → tax=0 → with cess=0
    profileMock.mockResolvedValue(makeProfile(550_000));
    const result = await getTaxSummary('u1', FY);
    expect(result.oldRegime.tax).toBe(0);
  });

  it('income in 20% slab: correct tax + cess', async () => {
    // grossSalary=1050K → taxable=1000K → rawTax=12500+(500K*0.20)=112500 → with cess=117000
    profileMock.mockResolvedValue(makeProfile(1_050_000));
    const result = await getTaxSummary('u1', FY);
    expect(result.oldRegime.tax).toBeCloseTo(117_000, 0);
  });

  it('income in 30% slab: correct tax + cess', async () => {
    // grossSalary=1200K → taxable=1150K → rawTax=112500+(150K*0.30)=157500 → with cess=163800
    profileMock.mockResolvedValue(makeProfile(1_200_000));
    const result = await getTaxSummary('u1', FY);
    expect(result.oldRegime.tax).toBeCloseTo(163_800, 0);
  });

  it('surcharge applies at 10% for taxable income > ₹50L', async () => {
    // grossSalary=5100K → taxable=5050K
    // rawTax=112500+(4050K*0.30)=1327500
    // surcharge=1327500*0.10=132750
    // total=(1327500+132750)*1.04=1518660
    profileMock.mockResolvedValue(makeProfile(5_100_000));
    const result = await getTaxSummary('u1', FY);
    expect(result.oldRegime.tax).toBeCloseTo(1_518_660, 0);
  });

  it('taxableIncome field is set correctly', async () => {
    profileMock.mockResolvedValue(makeProfile(600_000));
    const result = await getTaxSummary('u1', FY);
    expect(result.oldRegime.taxableIncome).toBe(550_000); // 600K - 50K std deduction
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calcNewRegimeTax + resolveNewRegimeSlab (via getTaxSummary, new regime)
// ─────────────────────────────────────────────────────────────────────────────

describe('getTaxSummary — new regime 2025-26 slabs', () => {
  it('income ≤ ₹12L rebate threshold → tax = 0 (87A rebate)', async () => {
    // grossSalary=1275K → taxable=1275K-75K(stdDed)=1200K → rebate applies → tax=0
    profileMock.mockResolvedValue(makeProfile(1_275_000, 'NEW'));
    const result = await getTaxSummary('u1', '2025-26');
    expect(result.newRegime.tax).toBe(0);
  });

  it('income just above ₹12L → tax > 0', async () => {
    // grossSalary=1375K → taxable=1300K → no rebate
    // slab: 60000+(1300K-1200K)*0.15=75000 → with cess=78000
    profileMock.mockResolvedValue(makeProfile(1_375_000, 'NEW'));
    const result = await getTaxSummary('u1', '2025-26');
    expect(result.newRegime.tax).toBeCloseTo(78_000, 0);
  });

  it('new regime uses 75K standard deduction (not 50K old regime)', async () => {
    // 2025-26 new regime: std deduction = 75K
    profileMock.mockResolvedValue(makeProfile(1_375_000, 'NEW'));
    const result = await getTaxSummary('u1', '2025-26');
    expect(result.newRegime.taxableIncome).toBe(1_300_000); // 1375K - 75K
  });
});

describe('getTaxSummary — new regime 2024-25 slabs', () => {
  it('2024-25 rebate threshold is ₹7L (not ₹12L)', async () => {
    // grossSalary=875K → taxable=875K-75K=800K > 700K rebate threshold → no rebate
    // slab: 20000+(800K-700K)*0.10=30000 → with cess=31200
    profileMock.mockResolvedValue(makeProfile(875_000, 'NEW'));
    const result = await getTaxSummary('u1', '2024-25');
    expect(result.newRegime.tax).toBeCloseTo(31_200, 0);
  });

  it('2024-25 income within ₹7L → 0 tax after rebate', async () => {
    // grossSalary=775K → taxable=775K-75K=700K → rebate threshold=700K → tax=0
    profileMock.mockResolvedValue(makeProfile(775_000, 'NEW'));
    const result = await getTaxSummary('u1', '2024-25');
    expect(result.newRegime.tax).toBe(0);
  });
});

describe('getTaxSummary — resolveNewRegimeSlab fallback', () => {
  it('unknown future FY uses 2025-26 slabs (closest known)', async () => {
    // FY '2030-31' → resolves to '2025-26': taxable=800K ≤ rebate 1200K → tax=0
    profileMock.mockResolvedValue(makeProfile(875_000, 'NEW'));
    const future = await getTaxSummary('u1', '2030-31');
    expect(future.newRegime.tax).toBe(0); // 2025-26 rebate applies
  });

  it('pre-history FY uses oldest known slab (2024-25)', async () => {
    // FY '2020-21' → no known FY at or before → falls back to '2024-25'
    // taxable=800K > 700K (2024-25 rebate threshold) → tax = 31200
    profileMock.mockResolvedValue(makeProfile(875_000, 'NEW'));
    const old = await getTaxSummary('u1', '2020-21');
    expect(old.newRegime.tax).toBeCloseTo(31_200, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getTaxSummary metadata fields
// ─────────────────────────────────────────────────────────────────────────────

describe('getTaxSummary — metadata', () => {
  it('returns the requested FY', async () => {
    profileMock.mockResolvedValue(makeProfile(500_000));
    const result = await getTaxSummary('u1', '2025-26');
    expect(result.fy).toBe('2025-26');
  });

  it('electedRegime falls back to OLD when profile has none', async () => {
    profileMock.mockResolvedValue(null); // no profile
    const result = await getTaxSummary('u1', '2025-26');
    expect(result.electedRegime).toBe('OLD');
    expect(result.grossSalary).toBe(0);
  });

  it('recommendedRegime is NEW when new regime tax is lower (concrete case)', async () => {
    // grossSalary=1.2M, FY 2025-26:
    // Old regime: taxable=1150K, rawTax=112500+(150K*0.30)=157500, cess=163800
    // New regime: taxable=1125K ≤ 12L rebate threshold → tax=0
    // → New regime is cheaper → recommendedRegime=NEW
    profileMock.mockResolvedValue(makeProfile(1_200_000));
    const result = await getTaxSummary('u1', '2025-26');
    expect(result.recommendedRegime).toBe('NEW');
  });

  it('savings = absolute difference between old and new tax (concrete case)', async () => {
    // Same scenario: old=163800, new=0 → savings=163800
    profileMock.mockResolvedValue(makeProfile(1_200_000));
    const result = await getTaxSummary('u1', '2025-26');
    expect(result.savings).toBeCloseTo(163_800, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getITR2Summary (exercises capitalGainsService, otherIncomeService, housePropertyService)
// ─────────────────────────────────────────────────────────────────────────────

describe('getITR2Summary', () => {
  it('returns correct structure with zero-value mocked services', async () => {
    profileMock.mockResolvedValue(makeProfile(1_000_000, 'OLD'));
    const result = await getITR2Summary('u1', '2025-26');

    expect(result.fy).toBe('2025-26');
    expect(result.regime).toBe('OLD');

    expect(result.scheduleCG).toMatchObject({
      stcg: 0,
      ltcg: 0,
      totalTaxableGain: 0,
      entryCount: 0,
    });
    expect(result.scheduleOS).toMatchObject({
      grossTotal: 0,
      taxableTotal: 0,
    });
    expect(result.scheduleHP).toMatchObject({
      totalHPIncome: 0,
      taxableHPIncome: 0,
    });
  });

  it('uses profile regime when present', async () => {
    profileMock.mockResolvedValue({ regime: 'NEW' });
    const result = await getITR2Summary('u1', '2025-26');
    expect(result.regime).toBe('NEW');
  });

  it('defaults regime to OLD when no profile exists', async () => {
    profileMock.mockResolvedValue(null);
    const result = await getITR2Summary('u1', '2025-26');
    expect(result.regime).toBe('OLD');
  });
});
