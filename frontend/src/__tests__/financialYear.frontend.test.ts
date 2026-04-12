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
