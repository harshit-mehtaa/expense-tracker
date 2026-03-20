import { describe, it, expect } from 'vitest';
import {
  getCurrentFY,
  getFYRange,
  getPreviousFY,
  getNextFY,
  getFYFromDate,
  isSameFY,
  listFYOptions,
} from '../utils/financialYear';

describe('getCurrentFY', () => {
  it('returns correct FY for a date in April (new FY starts)', () => {
    // Apr 1, 2024 IST = start of FY 2024-25
    const aprilFirst = new Date('2024-04-01T00:00:00+05:30');
    expect(getFYFromDate(aprilFirst)).toBe('2024-25');
  });

  it('returns correct FY for a date in March (old FY ends)', () => {
    // Mar 31, 2024 IST = last day of FY 2023-24
    const marchLast = new Date('2024-03-31T23:59:59+05:30');
    expect(getFYFromDate(marchLast)).toBe('2023-24');
  });

  it('correctly assigns Mar 31 23:59 IST to the ending FY', () => {
    // A transaction at 11:59 PM IST on Mar 31 belongs to FY 2023-24
    const istMidnight = new Date('2024-03-31T18:29:59Z'); // 23:59:59 IST = 18:29:59 UTC
    expect(getFYFromDate(istMidnight)).toBe('2023-24');
  });

  it('correctly assigns Apr 1 00:00 IST to the new FY', () => {
    // A transaction at midnight IST on Apr 1 belongs to FY 2024-25
    const istAprFirst = new Date('2024-03-31T18:30:00Z'); // 00:00 IST = 18:30 UTC of previous day
    expect(getFYFromDate(istAprFirst)).toBe('2024-25');
  });

  it('handles Jan correctly — still same FY (started April)', () => {
    const january = new Date('2025-01-15T10:00:00+05:30');
    expect(getFYFromDate(january)).toBe('2024-25');
  });
});

describe('getFYRange', () => {
  it('returns correct start and end dates for a given FY', () => {
    const range = getFYRange('2024-25');
    // Start: Apr 1, 2024 00:00 IST = Mar 31, 2024 18:30 UTC
    expect(range.start.toISOString()).toBe('2024-03-31T18:30:00.000Z');
    // End: Mar 31, 2025 23:59:59.999 IST = Mar 31, 2025 18:29:59.999 UTC
    expect(range.end.toISOString()).toBe('2025-03-31T18:29:59.999Z');
  });

  it('start of range is inclusive (Apr 1 00:00 IST)', () => {
    const range = getFYRange('2024-25');
    // Apr 1 00:00:00 IST should be WITHIN the range
    const aprilFirst = new Date('2024-04-01T00:00:00+05:30');
    expect(aprilFirst >= range.start).toBe(true);
    expect(aprilFirst <= range.end).toBe(true);
  });

  it('end of range is inclusive (Mar 31 23:59:59 IST)', () => {
    const range = getFYRange('2024-25');
    const marchLast = new Date('2025-03-31T23:59:59+05:30');
    expect(marchLast >= range.start).toBe(true);
    expect(marchLast <= range.end).toBe(true);
  });

  it('Apr 1 of next year is NOT in the range', () => {
    const range = getFYRange('2024-25');
    const nextApril = new Date('2025-04-01T00:00:00+05:30');
    expect(nextApril > range.end).toBe(true);
  });
});

describe('getPreviousFY', () => {
  it('returns correct previous FY', () => {
    expect(getPreviousFY('2024-25')).toBe('2023-24');
    expect(getPreviousFY('2023-24')).toBe('2022-23');
    expect(getPreviousFY('2020-21')).toBe('2019-20');
  });
});

describe('getNextFY', () => {
  it('returns correct next FY', () => {
    expect(getNextFY('2024-25')).toBe('2025-26');
    expect(getNextFY('2023-24')).toBe('2024-25');
  });
});

describe('isSameFY', () => {
  it('returns true for two dates in the same FY', () => {
    const d1 = new Date('2024-05-15T10:00:00+05:30');
    const d2 = new Date('2025-02-10T10:00:00+05:30');
    expect(isSameFY(d1, d2)).toBe(true);
  });

  it('returns false for dates in different FYs', () => {
    const d1 = new Date('2024-03-31T10:00:00+05:30'); // FY 2023-24
    const d2 = new Date('2024-04-01T10:00:00+05:30'); // FY 2024-25
    expect(isSameFY(d1, d2)).toBe(false);
  });
});

describe('listFYOptions', () => {
  it('returns array of FY strings', () => {
    const options = listFYOptions(3);
    expect(options).toHaveLength(3);
    expect(options[0]).toMatch(/^\d{4}-\d{2}$/);
  });
});
