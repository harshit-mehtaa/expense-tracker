/**
 * Boundary tests for date presentation.
 *
 * The point of the module is padding and determinism, so the tests that matter are the
 * single-digit cases and the month-end / year-roll edges of `nextOccurrence`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  formatDate, formatDateTime, nextOccurrence, formatNextOccurrence, toDateInputValue,
} from '@/lib/dateFormat';

/** Local-time construction — the helpers use local getters deliberately. */
const local = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

afterEach(() => vi.useRealTimers());

describe('formatDate', () => {
  it('pads a single-digit day AND month — the whole reason this exists', () => {
    // toLocaleDateString('en-IN') rendered this as "5/8/2026".
    expect(formatDate(local(2026, 8, 5))).toBe('05/08/2026');
  });

  it('leaves double-digit values alone', () => {
    expect(formatDate(local(2026, 12, 25))).toBe('25/12/2026');
  });

  it('pads the day but not the month when only one needs it', () => {
    expect(formatDate(local(2026, 11, 3))).toBe('03/11/2026');
    expect(formatDate(local(2026, 3, 30))).toBe('30/03/2026');
  });

  it('accepts a Date, an ISO string and an epoch number alike', () => {
    const d = local(2026, 1, 9);
    expect(formatDate(d)).toBe('09/01/2026');
    expect(formatDate(d.toISOString())).toBe('09/01/2026');
    expect(formatDate(d.getTime())).toBe('09/01/2026');
  });

  it('renders a dash rather than the words "Invalid Date"', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('')).toBe('—');
    expect(formatDate('not a date')).toBe('—');
  });

  it('reads the date in LOCAL time, matching the behaviour it replaced', () => {
    // An ISO instant late in the UTC day is already the NEXT day in IST. Using UTC
    // getters here would shift every such date back by one, product-wide.
    const d = new Date('2026-08-05T20:00:00Z');
    expect(formatDate(d)).toBe(
      `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`,
    );
  });
});

describe('formatDateTime', () => {
  it('appends a zero-padded 24-hour time', () => {
    expect(formatDateTime(local(2026, 8, 5, 9, 5))).toBe('05/08/2026 09:05');
  });

  it('renders midnight as 00:00, not 24:00 or 12:00', () => {
    expect(formatDateTime(local(2026, 8, 5, 0, 0))).toBe('05/08/2026 00:00');
  });

  it('dashes an unusable value', () => {
    expect(formatDateTime(null)).toBe('—');
  });
});

describe('nextOccurrence', () => {
  it('is later this month when the day is still ahead', () => {
    expect(nextOccurrence(20, local(2026, 8, 17))).toEqual(local(2026, 8, 20, 0, 0));
  });

  it('counts TODAY as the next occurrence — money due today is not missed', () => {
    expect(nextOccurrence(17, local(2026, 8, 17))).toEqual(local(2026, 8, 17, 0, 0));
  });

  it('rolls into next month once the day has passed', () => {
    expect(nextOccurrence(5, local(2026, 8, 17))).toEqual(local(2026, 9, 5, 0, 0));
  });

  it('rolls the year from December into January', () => {
    expect(nextOccurrence(5, local(2026, 12, 17))).toEqual(local(2027, 1, 5, 0, 0));
  });

  it('clamps day 31 to the end of a 30-day month rather than overflowing into the next', () => {
    // premiumDueDate is an unbounded Int?. Left to Date's overflow, "31 November" becomes
    // 1 December — a due date reported in the wrong month.
    expect(nextOccurrence(31, local(2026, 11, 5))).toEqual(local(2026, 11, 30, 0, 0));
  });

  it('clamps to 28 in a non-leap February', () => {
    expect(nextOccurrence(30, local(2026, 2, 5))).toEqual(local(2026, 2, 28, 0, 0));
  });

  it('reaches 29 February in a leap year', () => {
    expect(nextOccurrence(29, local(2028, 2, 5))).toEqual(local(2028, 2, 29, 0, 0));
  });

  it('handles the last day of a month rolling forward', () => {
    expect(nextOccurrence(1, local(2026, 8, 31))).toEqual(local(2026, 9, 1, 0, 0));
  });

  it('returns null for a missing or nonsensical day', () => {
    expect(nextOccurrence(null)).toBeNull();
    expect(nextOccurrence(undefined)).toBeNull();
    expect(nextOccurrence(0, local(2026, 8, 17))).toBeNull();
    expect(nextOccurrence(32, local(2026, 8, 17))).toBeNull();
    expect(nextOccurrence(5.5, local(2026, 8, 17))).toBeNull();
    expect(nextOccurrence(Number.NaN, local(2026, 8, 17))).toBeNull();
  });
});

describe('formatNextOccurrence', () => {
  it('renders the next date in dd/mm/yyyy', () => {
    expect(formatNextOccurrence(5, local(2026, 8, 17))).toBe('05/09/2026');
  });

  it('dashes rather than printing a bare number when there is no day', () => {
    expect(formatNextOccurrence(null)).toBe('—');
  });
});

describe('toDateInputValue', () => {
  it('produces yyyy-mm-dd in LOCAL time', () => {
    expect(toDateInputValue(local(2026, 8, 5))).toBe('2026-08-05');
  });

  it('does not slip to the previous day the way toISOString does', () => {
    // 02:00 IST on 5 Aug is 20:30 UTC on 4 Aug, so toISOString().slice(0,10) yields the
    // 4th. On a field that drives billing, yesterday means "charge now".
    const earlyMorning = local(2026, 8, 5, 2, 0);
    expect(toDateInputValue(earlyMorning)).toBe('2026-08-05');
  });

  it('keeps a month range on its own month — the dashboard drill-down bug', () => {
    // These are LOCAL midnights. toISOString() converted them to UTC, which in any
    // positive-offset zone lands on the previous day: clicking "Aug 26" navigated to
    // 2026-07-31 -> 2026-08-30, pulling in a July day and dropping 31 August.
    const start = new Date(2026, 7, 1);
    const end = new Date(2026, 8, 0);
    expect(toDateInputValue(start)).toBe('2026-08-01');
    expect(toDateInputValue(end)).toBe('2026-08-31');
  });

  it('returns an empty string for a missing value, so the input renders blank', () => {
    expect(toDateInputValue(null)).toBe('');
    expect(toDateInputValue('nonsense')).toBe('');
  });
});
