/**
 * Smoke tests for the frontend financialYear.ts utility.
 * The backend has comprehensive tests for the same logic (financialYear.test.ts).
 * These tests guard against frontend/backend drift on the shared FY boundary logic.
 * Frontend uses a manual IST offset (no dayjs) — different implementation, same spec.
 */
import { describe, it, expect } from 'vitest';
import {
  getFYFromDate,
  getCurrentFY,
  getPreviousFY,
  getNextFY,
  formatFYLabel,
  listFYOptions,
  getISTMonthKey,
} from '@/lib/financialYear';

describe('getFYFromDate — IST boundary (frontend)', () => {
  it('Apr 1 IST → FY starts this year (e.g. 2025-26)', () => {
    // Apr 1 2025 00:00 IST = Mar 31 2025 18:30 UTC
    const d = new Date('2025-03-31T18:30:00.000Z');
    expect(getFYFromDate(d)).toBe('2025-26');
  });

  it('Mar 31 IST → FY started previous year (e.g. 2024-25)', () => {
    // Mar 31 2025 23:59 IST = Mar 31 2025 18:29 UTC
    const d = new Date('2025-03-31T18:29:00.000Z');
    expect(getFYFromDate(d)).toBe('2024-25');
  });

  it('mid-year date (July 2025) → 2025-26', () => {
    expect(getFYFromDate(new Date('2025-07-15'))).toBe('2025-26');
  });

  it('January 2026 → 2025-26 (pre-April in FY)', () => {
    expect(getFYFromDate(new Date('2026-01-01'))).toBe('2025-26');
  });
});

describe('getPreviousFY', () => {
  it('returns the year before', () => {
    expect(getPreviousFY('2025-26')).toBe('2024-25');
    expect(getPreviousFY('2024-25')).toBe('2023-24');
  });
});

describe('getNextFY', () => {
  it('returns the year after', () => {
    expect(getNextFY('2024-25')).toBe('2025-26');
    expect(getNextFY('2025-26')).toBe('2026-27');
  });
});

describe('formatFYLabel', () => {
  it('formats correctly', () => {
    expect(formatFYLabel('2025-26')).toBe('FY 2025-26 (Apr 2025 – Mar 2026)');
    expect(formatFYLabel('2024-25')).toBe('FY 2024-25 (Apr 2024 – Mar 2025)');
  });
});

describe('getISTMonthKey — IST calendar month, not raw UTC slice', () => {
  it('mid-month: no boundary crossed, matches naively', () => {
    // Jun 15 2025 10:30 IST = Jun 15 05:00 UTC
    expect(getISTMonthKey(new Date('2025-06-15T05:00:00.000Z'))).toBe('2025-06');
  });

  it('month-start crossover window: UTC still on the last day of the prior month', () => {
    // Apr 1 2025 00:05 IST = Mar 31 2025 18:35 UTC — a raw `.toISOString().slice(0,7)`
    // would read "2025-03" here; the true IST month is April.
    expect(getISTMonthKey(new Date('2025-03-31T18:35:00.000Z'))).toBe('2025-04');
  });

  it('month-start, past the crossover window: UTC has caught up to the new month', () => {
    // Apr 1 2025 08:00 IST = Apr 1 2025 02:30 UTC
    expect(getISTMonthKey(new Date('2025-04-01T02:30:00.000Z'))).toBe('2025-04');
  });

  it('month-end, late night IST: no false rollover to next month', () => {
    // Apr 30 2025 23:55 IST = Apr 30 2025 18:25 UTC
    expect(getISTMonthKey(new Date('2025-04-30T18:25:00.000Z'))).toBe('2025-04');
  });

  it('Dec 31 -> Jan 1 IST year boundary: year component also correct, not just month', () => {
    // Jan 1 2026 00:10 IST = Dec 31 2025 18:40 UTC
    expect(getISTMonthKey(new Date('2025-12-31T18:40:00.000Z'))).toBe('2026-01');
  });

  it('a real month-start snapshot instant (getMonthStart()-shaped) reads its OWN IST month, not the prior one', () => {
    // "Apr 1 2025 00:00:00 IST" — exactly what backend/src/utils/financialYear.ts's
    // getMonthStart() would store for an April snapshot. `.toISOString().slice(0,7)`
    // on this raw value reads "2025-03" (structurally, always, for every snapshot) —
    // this is the case that was silently broken for the entire month, not just near
    // midnight.
    expect(getISTMonthKey(new Date('2025-03-31T18:30:00.000Z'))).toBe('2025-04');
  });
});

describe('listFYOptions', () => {
  it('returns current FY as first option', () => {
    const options = listFYOptions(5);
    expect(options[0]).toBe(getCurrentFY());
  });

  it('returns the requested count', () => {
    expect(listFYOptions(3)).toHaveLength(3);
    expect(listFYOptions(7)).toHaveLength(7);
  });

  it('options are in descending order (newest first)', () => {
    const options = listFYOptions(3);
    const years = options.map((fy) => parseInt(fy.split('-')[0]));
    expect(years[0]).toBeGreaterThan(years[1]);
    expect(years[1]).toBeGreaterThan(years[2]);
  });
});
