/**
 * Tests for loanService.buildAmortizationSchedule — pure math function, no DB.
 */
import { describe, it, expect } from 'vitest';
import { buildAmortizationSchedule } from '../services/loanService';

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
