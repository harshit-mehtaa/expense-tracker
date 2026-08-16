/**
 * Unit tests for loan derivation maths.
 *
 * The ceil-vs-round cases below are not stylistic preference — they are regression
 * guards for a real interaction with `buildAmortizationSchedule`'s EMI floor.
 */
import { describe, it, expect } from 'vitest';
import {
  computeEmi, computePreEmi, computeMonthlyPreEmi, monthsBetween, addMonths, deriveEndDate,
} from '../utils/loanMath';
import { buildAmortizationSchedule } from '../services/loanService';

describe('computeEmi', () => {
  it('computes a standard home-loan EMI', () => {
    // ₹50,00,000 at 8.5% over 240 months. Exact is 43391.161668, so the ceiling is
    // .17 — one paisa above what a nearest-rounding calculator would print.
    expect(computeEmi(5_000_000, 8.5, 240)).toBe(43_391.17);
  });

  it('rounds UP, never to nearest', () => {
    // Exact is 69921.450855 — nearest would be .45, but we always take the ceiling.
    expect(computeEmi(10_000_000, 7.5, 360)).toBe(69_921.46);
  });

  it.each([
    { principal: 0, rate: 8, tenure: 240, why: 'zero principal' },
    { principal: -5, rate: 8, tenure: 240, why: 'negative principal' },
    { principal: 100_000, rate: 0, tenure: 240, why: 'zero rate — the mid-typing case' },
    { principal: 100_000, rate: -1, tenure: 240, why: 'negative rate' },
    { principal: 100_000, rate: 8, tenure: 0, why: 'zero tenure' },
    { principal: 100_000, rate: 8, tenure: -12, why: 'negative tenure' },
  ])('returns null (never NaN) for $why', ({ principal, rate, tenure }) => {
    const result = computeEmi(principal, rate, tenure);
    expect(result).toBeNull();
    expect(Number.isNaN(result as unknown as number)).toBe(false);
  });

  it('returns null rather than Infinity for absurd inputs', () => {
    expect(computeEmi(1e308, 1e6, 1200)).toBeNull();
  });
});

// ─── The interaction that makes ceil load-bearing ─────────────────────────────

describe('computeEmi feeds buildAmortizationSchedule without tripping its EMI floor', () => {
  // buildAmortizationSchedule throws when emiAmount <= outstanding * monthlyRate,
  // because a smaller EMI never repays the principal. Rounding DOWN to the nearest
  // paisa can cross that floor, so the app would reject the EMI it just suggested.
  it.each([
    { principal: 100, rate: 24, tenure: 360, roundWouldGive: 2.0 },
    { principal: 50, rate: 30, tenure: 360, roundWouldGive: 1.25 },
  ])(
    'P=₹$principal at $rate% — round() gives $roundWouldGive which is rejected; ceil is accepted',
    ({ principal, rate, tenure, roundWouldGive }) => {
      const floor = principal * (rate / 100 / 12);

      // Confirm the hazard is real: the nearest-rounded value is at or below the floor.
      expect(roundWouldGive).toBeLessThanOrEqual(floor);
      expect(() => buildAmortizationSchedule(principal, rate, roundWouldGive, 5, new Date()))
        .toThrow(/must be greater than first month/i);

      // Our value clears it.
      const emi = computeEmi(principal, rate, tenure)!;
      expect(emi).toBeGreaterThan(floor);
      expect(() => buildAmortizationSchedule(principal, rate, emi, 5, new Date())).not.toThrow();
    },
  );

  it('a normal loan also survives the round trip', () => {
    const emi = computeEmi(5_000_000, 8.5, 240)!;
    const schedule = buildAmortizationSchedule(5_000_000, 8.5, emi, 5, new Date('2026-01-01'));
    expect(schedule.length).toBeGreaterThan(0);
    expect(schedule[schedule.length - 1].closingBalance).toBeLessThanOrEqual(0.5);
  });
});

describe('monthsBetween', () => {
  it('counts a month only once the day-of-month is reached', () => {
    expect(monthsBetween(new Date(2026, 0, 15), new Date(2026, 1, 14))).toBe(0);
    expect(monthsBetween(new Date(2026, 0, 15), new Date(2026, 1, 15))).toBe(1);
  });

  it('spans years', () => {
    expect(monthsBetween(new Date(2026, 0, 10), new Date(2027, 3, 10))).toBe(15);
  });

  it('never goes negative when the dates are reversed', () => {
    expect(monthsBetween(new Date(2027, 0, 1), new Date(2026, 0, 1))).toBe(0);
  });

  it('is 0 for identical dates', () => {
    const d = new Date(2026, 5, 1);
    expect(monthsBetween(d, new Date(d.getTime()))).toBe(0);
  });

  it('is 0 for invalid input rather than NaN', () => {
    expect(monthsBetween(new Date('nope'), new Date(2026, 0, 1))).toBe(0);
    expect(monthsBetween(new Date(2026, 0, 1), new Date('nope'))).toBe(0);
  });
});

describe('computePreEmi — interest across the disbursement -> first-EMI gap', () => {
  it('is the interest for the whole gap, not one month', () => {
    // ₹30,00,000 at 9% = ₹22,500/month. Disbursed 15 Jan, first EMI 15 Apr = 3 months.
    expect(computePreEmi(3_000_000, 9, new Date(2026, 0, 15), new Date(2026, 3, 15)))
      .toBe(67_500);
  });

  it('is null when the first EMI follows immediately — no pre-EMI period', () => {
    expect(computePreEmi(3_000_000, 9, new Date(2026, 0, 15), new Date(2026, 0, 20)))
      .toBeNull();
  });

  it('is null when the first EMI precedes disbursement', () => {
    expect(computePreEmi(3_000_000, 9, new Date(2026, 3, 15), new Date(2026, 0, 15)))
      .toBeNull();
  });

  it('rounds up to the paisa', () => {
    expect(computePreEmi(1_000_000, 8.33, new Date(2026, 0, 1), new Date(2026, 1, 1)))
      .toBe(6_941.67);
  });

  it.each([
    [0, 9],
    [-1, 9],
    [1_000_000, 0],
    [1_000_000, -1],
  ])('returns null for disbursed=%s rate=%s', (amount, rate) => {
    expect(computePreEmi(amount, rate, new Date(2026, 0, 1), new Date(2026, 6, 1)))
      .toBeNull();
  });
});

describe('computeMonthlyPreEmi', () => {
  it('is one month of interest on the disbursed amount', () => {
    expect(computeMonthlyPreEmi(3_000_000, 9)).toBe(22_500);
  });

  it.each([[0, 9], [1_000_000, 0]])('returns null for %s / %s', (amount, rate) => {
    expect(computeMonthlyPreEmi(amount, rate)).toBeNull();
  });
});

describe('addMonths', () => {
  it('clamps to the end of a short month instead of overflowing', () => {
    // Raw setMonth turns 31 Jan into 3 March, skipping February entirely.
    const result = addMonths(new Date(2026, 0, 31), 1);
    expect(result.getMonth()).toBe(1);      // February
    expect(result.getDate()).toBe(28);      // 2026 is not a leap year
  });

  it('clamps to 29 Feb in a leap year', () => {
    const result = addMonths(new Date(2028, 0, 31), 1);
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(29);
  });

  it('keeps the day when the target month is long enough', () => {
    const result = addMonths(new Date(2026, 0, 15), 3);
    expect(result.getMonth()).toBe(3);
    expect(result.getDate()).toBe(15);
  });

  it('rolls across a year boundary', () => {
    const result = addMonths(new Date(2026, 10, 30), 3);
    expect(result.getFullYear()).toBe(2027);
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(28);
  });

  it('does not mutate the input', () => {
    const original = new Date(2026, 0, 31);
    addMonths(original, 5);
    expect(original.getMonth()).toBe(0);
    expect(original.getDate()).toBe(31);
  });

  it('handles zero months', () => {
    const result = addMonths(new Date(2026, 5, 10), 0);
    expect(result.getMonth()).toBe(5);
    expect(result.getDate()).toBe(10);
  });
});

describe('deriveEndDate', () => {
  it('is disbursement + tenure when there is no moratorium', () => {
    const end = deriveEndDate(new Date(2026, 0, 15), 240)!;
    expect(end.getFullYear()).toBe(2046);
    expect(end.getMonth()).toBe(0);
    expect(end.getDate()).toBe(15);
  });

  it('counts the tenure from the FIRST EMI, so a pre-EMI gap pushes the end out', () => {
    // 240 payments beginning 2027-01-15 means the FIRST is 2027-01-15 and the 240th is
    // 239 months later — 2046-12-15, not 2047-01-15. Adding a full 240 months to the
    // first EMI describes a 241-payment loan.
    const withGap = deriveEndDate(new Date(2026, 0, 15), 240, new Date(2027, 0, 15))!;
    expect(withGap.getFullYear()).toBe(2046);
    expect(withGap.getMonth()).toBe(11);
    expect(withGap.getDate()).toBe(15);
  });

  it('agrees with the no-gap form when the first EMI is one month after disbursement', () => {
    // The two branches must describe the same loan. Without a firstEmiDate the first EMI
    // is implied to be one month after disbursement, so stating that date explicitly
    // must not move the end date.
    const implied = deriveEndDate(new Date(2026, 0, 15), 240)!;
    const explicit = deriveEndDate(new Date(2026, 0, 15), 240, new Date(2026, 1, 15))!;
    expect(explicit.getTime()).toBe(implied.getTime());
  });

  it('ignores a firstEmiDate at or before disbursement', () => {
    const base = deriveEndDate(new Date(2026, 0, 15), 12)!;
    const earlier = deriveEndDate(new Date(2026, 0, 15), 12, new Date(2025, 6, 1))!;
    expect(earlier.getTime()).toBe(base.getTime());
  });

  it('ignores an invalid firstEmiDate', () => {
    const base = deriveEndDate(new Date(2026, 0, 15), 12)!;
    const bad = deriveEndDate(new Date(2026, 0, 15), 12, new Date('nope'))!;
    expect(bad.getTime()).toBe(base.getTime());
  });

  it('clamps a month-end disbursement', () => {
    const end = deriveEndDate(new Date(2026, 0, 31), 1)!;
    expect(end.getDate()).toBe(28);
  });

  it.each([
    { tenure: 0, why: 'zero tenure' },
    { tenure: -12, why: 'negative tenure' },
  ])('returns null for $why', ({ tenure }) => {
    expect(deriveEndDate(new Date(2026, 0, 15), tenure)).toBeNull();
  });

  it('returns null for an invalid date', () => {
    expect(deriveEndDate(new Date('nonsense'), 240)).toBeNull();
  });
});
