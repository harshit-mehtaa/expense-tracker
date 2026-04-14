/**
 * Tests for API-layer Decimal normalizers.
 *
 * Prisma serializes @db.Decimal fields as strings in JSON (e.g. "10000000.00").
 * The normalizer functions coerce these to JS numbers before consumers see them,
 * preventing silent string-concatenation bugs in reduce/display logic.
 */
import { describe, it, expect } from 'vitest';
import { normalizePolicy } from '../api/insurance';
import { normalizeLoan } from '../api/loans';
import { normalizeInvestment, normalizeSIP, normalizeFD, normalizeRD, normalizeGoldHolding, normalizeRealEstateProperty } from '../api/investments';

// ─── Insurance ───────────────────────────────────────────────────────────────

describe('normalizePolicy', () => {
  const base = {
    id: 'p1', policyType: 'TERM_LIFE', providerName: 'LIC', policyNumber: 'L1',
    policyName: 'Term Plan', premiumFrequency: 'ANNUALLY', startDate: '2020-01-01',
    is80cEligible: false, is80dEligible: true, isForParents: false,
  };

  it('coerces sumAssured string to number', () => {
    const p = normalizePolicy({ ...base, sumAssured: '10000000.00' as any, premiumAmount: 10000 });
    expect(typeof p.sumAssured).toBe('number');
    expect(p.sumAssured).toBe(10000000);
  });

  it('coerces premiumAmount string to number', () => {
    const p = normalizePolicy({ ...base, sumAssured: 1000000, premiumAmount: '12500.50' as any });
    expect(typeof p.premiumAmount).toBe('number');
    expect(p.premiumAmount).toBe(12500.5);
  });

  it('produces correct totalSumAssured via reduce when fields were strings', () => {
    const policies = [
      { ...base, sumAssured: '10000000.00' as any, premiumAmount: '10000.00' as any },
      { ...base, id: 'p2', sumAssured: '7500000.00' as any, premiumAmount: '8000.00' as any },
      { ...base, id: 'p3', sumAssured: '750000.00' as any, premiumAmount: '5000.00' as any },
    ].map(normalizePolicy);

    const total = policies.reduce((s, p) => s + p.sumAssured, 0);
    expect(total).toBe(18250000);
    expect(typeof total).toBe('number');
  });

  it('is a no-op when fields are already numbers', () => {
    const p = normalizePolicy({ ...base, sumAssured: 5000000, premiumAmount: 9000 });
    expect(p.sumAssured).toBe(5000000);
    expect(p.premiumAmount).toBe(9000);
  });
});

// ─── Loans ───────────────────────────────────────────────────────────────────

describe('normalizeLoan', () => {
  const base = {
    id: 'l1', lenderName: 'HDFC', loanType: 'HOME', emiDate: 5,
    tenureMonths: 240, disbursementDate: '2020-01-01', endDate: '2040-01-01',
    isTaxDeductible: true, section24bEligible: true,
  };

  it('coerces all Decimal loan fields to numbers', () => {
    const l = normalizeLoan({
      ...base,
      principalAmount: '5000000.00' as any,
      outstandingBalance: '4800000.00' as any,
      interestRate: '8.5' as any,
      emiAmount: '43391.00' as any,
      prepaymentChargesPct: '2.0' as any,
    });
    expect(typeof l.principalAmount).toBe('number');
    expect(l.principalAmount).toBe(5000000);
    expect(l.outstandingBalance).toBe(4800000);
    expect(l.interestRate).toBe(8.5);
    expect(l.emiAmount).toBe(43391);
    expect(l.prepaymentChargesPct).toBe(2);
  });
});

// ─── Investments: FD ─────────────────────────────────────────────────────────

describe('normalizeFD', () => {
  const base = {
    id: 'fd1', bankName: 'SBI', tenureMonths: 12,
    startDate: '2024-01-01', maturityDate: '2025-01-01',
    interestPayoutType: 'CUMULATIVE', isTaxSaver: false, status: 'ACTIVE' as const,
  };

  it('coerces FD Decimal fields to numbers', () => {
    const fd = normalizeFD({
      ...base,
      principalAmount: '100000.00' as any,
      maturityAmount: '107000.00' as any,
      interestRate: '7.0' as any,
    });
    expect(fd.principalAmount).toBe(100000);
    expect(fd.maturityAmount).toBe(107000);
    expect(fd.interestRate).toBe(7);
  });
});

// ─── Investments: RD ─────────────────────────────────────────────────────────

describe('normalizeRD', () => {
  const base = {
    id: 'rd1', bankName: 'Kotak', tenureMonths: 12, installmentsPaid: 3,
    startDate: '2025-10-01', maturityDate: '2026-10-01', status: 'ACTIVE' as const,
  };

  it('coerces RD Decimal fields to numbers', () => {
    const rd = normalizeRD({
      ...base,
      monthlyInstallment: '1000.00' as any,
      maturityAmount: '12423.00' as any,
      totalDeposited: '3000.00' as any,
      interestRate: '6.5' as any,
    });
    expect(rd.monthlyInstallment).toBe(1000);
    expect(rd.maturityAmount).toBe(12423);
    expect(rd.totalDeposited).toBe(3000);
    expect(rd.interestRate).toBe(6.5);
  });
});

// ─── Investments: Gold ───────────────────────────────────────────────────────

describe('normalizeGoldHolding', () => {
  const base = { id: 'g1', type: 'PHYSICAL', purchaseDate: '2022-01-01' };

  it('coerces gold Decimal fields to numbers', () => {
    const h = normalizeGoldHolding({
      ...base,
      quantityGrams: '10.500' as any,
      purchasePricePerGram: '5500.00' as any,
      currentPricePerGram: '7850.00' as any,
    });
    expect(h.quantityGrams).toBe(10.5);
    expect(h.purchasePricePerGram).toBe(5500);
    expect(h.currentPricePerGram).toBe(7850);
  });

  it('allows computing current value correctly after normalization', () => {
    const h = normalizeGoldHolding({
      ...base,
      quantityGrams: '10.000' as any,
      purchasePricePerGram: '5500.00' as any,
      currentPricePerGram: '7850.00' as any,
    });
    expect(h.quantityGrams * h.currentPricePerGram).toBe(78500);
  });
});

// ─── Investments: Real Estate ─────────────────────────────────────────────────

describe('normalizeRealEstateProperty', () => {
  const base = {
    id: 're1', propertyType: 'RESIDENTIAL', propertyName: 'Home',
    location: 'Bangalore', purchaseDate: '2020-01-01',
  };

  it('coerces purchasePrice and currentValue to numbers', () => {
    const p = normalizeRealEstateProperty({
      ...base,
      purchasePrice: '5000000.00',
      currentValue: '7500000.00',
    });
    expect(p.purchasePrice).toBe(5000000);
    expect(p.currentValue).toBe(7500000);
  });

  it('coerces rentalIncomeMonthly when present', () => {
    const p = normalizeRealEstateProperty({
      ...base, purchasePrice: '5000000', currentValue: '7500000',
      rentalIncomeMonthly: '25000.00',
    });
    expect(p.rentalIncomeMonthly).toBe(25000);
  });

  it('preserves rentalIncomeMonthly as null when not set', () => {
    const p = normalizeRealEstateProperty({ ...base, purchasePrice: '5000000', currentValue: '7500000', rentalIncomeMonthly: null });
    expect(p.rentalIncomeMonthly).toBeNull();
  });

  it('coerces nested loan.outstandingBalance when loan present', () => {
    const p = normalizeRealEstateProperty({
      ...base, purchasePrice: '5000000', currentValue: '7500000',
      loan: { id: 'loan1', lenderName: 'SBI', outstandingBalance: '3800000.00' },
    });
    expect(p.loan.outstandingBalance).toBe(3800000);
  });

  it('produces correct gain arithmetic after normalization', () => {
    const p = normalizeRealEstateProperty({
      ...base,
      purchasePrice: '5000000.00',
      currentValue: '7500000.00',
    });
    expect(p.currentValue - p.purchasePrice).toBe(2500000);
  });
});

// ─── Investments: Investment ──────────────────────────────────────────────────

describe('normalizeInvestment', () => {
  const base = {
    id: 'inv1', type: 'STOCK', name: 'HDFC Bank', currency: 'INR',
    purchaseDate: '2022-01-01', isTaxSaving: false,
    investedINR: 50000, currentValueINR: 62000, gainINR: 12000, gainPct: 24,
  };

  it('coerces unitsOrQuantity, purchasePricePerUnit, currentPricePerUnit to numbers', () => {
    const inv = normalizeInvestment({
      ...base,
      unitsOrQuantity: '10.000' as any,
      purchasePricePerUnit: '5000.00' as any,
      currentPricePerUnit: '6200.00' as any,
    });
    expect(inv.unitsOrQuantity).toBe(10);
    expect(inv.purchasePricePerUnit).toBe(5000);
    expect(inv.currentPricePerUnit).toBe(6200);
  });

  it('preserves backend-computed number fields unchanged', () => {
    const inv = normalizeInvestment({ ...base, unitsOrQuantity: 10, purchasePricePerUnit: 5000, currentPricePerUnit: 6200 });
    expect(inv.investedINR).toBe(50000);
    expect(inv.gainPct).toBe(24);
  });
});

// ─── Investments: SIP ─────────────────────────────────────────────────────────

describe('normalizeSIP', () => {
  const baseInvestment = {
    id: 'inv1', type: 'ELSS', name: 'Parag Parikh Flexi Cap', currency: 'INR',
    purchaseDate: '2022-01-01', isTaxSaving: true,
    unitsOrQuantity: '100.000' as any,
    purchasePricePerUnit: '40.00' as any,
    currentPricePerUnit: '55.00' as any,
    investedINR: 4000, currentValueINR: 5500, gainINR: 1500, gainPct: 37.5,
  };

  it('coerces monthlyAmount and normalizes nested investment', () => {
    const sip = normalizeSIP({
      id: 's1', fundName: 'Parag Parikh', sipDate: 5,
      startDate: '2022-01-05', status: 'ACTIVE',
      monthlyAmount: '5000.00' as any,
      investment: baseInvestment,
    });
    expect(sip.monthlyAmount).toBe(5000);
    expect(sip.investment.unitsOrQuantity).toBe(100);
    expect(sip.investment.purchasePricePerUnit).toBe(40);
  });
});
