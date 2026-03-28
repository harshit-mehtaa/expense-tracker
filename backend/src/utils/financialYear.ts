import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

const IST = 'Asia/Kolkata';

/**
 * Returns the Indian Financial Year string for a given date.
 * FY runs Apr 1 – Mar 31. All comparisons done in IST.
 * Example: Apr 1, 2024 → "2024-25"; Mar 31, 2024 → "2023-24"
 */
export function getFYFromDate(date: Date): string {
  const d = dayjs(date).tz(IST);
  const year = d.year();
  const month = d.month() + 1; // dayjs months are 0-indexed

  if (month >= 4) {
    // April or later: FY started this year
    return `${year}-${String(year + 1).slice(-2)}`;
  } else {
    // Jan–Mar: FY started last year
    return `${year - 1}-${String(year).slice(-2)}`;
  }
}

/**
 * Returns the current Indian Financial Year string.
 * Based on the current date in IST.
 */
export function getCurrentFY(): string {
  return getFYFromDate(new Date());
}

/**
 * Returns the UTC-equivalent start and end of an Indian FY.
 * Start: Apr 1 00:00:00.000 IST (= Mar 31 18:30:00.000 UTC)
 * End:   Mar 31 23:59:59.999 IST (= Mar 31 18:29:59.999 UTC)
 *
 * These dates are used in Prisma queries for FY-scoped filtering.
 */
export function getFYRange(fy: string): { start: Date; end: Date; fy: string; label: string } {
  const [startYearStr] = fy.split('-');
  const startYear = parseInt(startYearStr, 10);
  const endYear = startYear + 1;

  // Apr 1 of startYear at 00:00 IST
  const start = dayjs.tz(`${startYear}-04-01 00:00:00`, IST).toDate();

  // Mar 31 of endYear at 23:59:59.999 IST
  const end = dayjs.tz(`${endYear}-03-31 23:59:59.999`, IST).toDate();

  return {
    start,
    end,
    fy,
    label: `FY ${fy}`,
  };
}

/**
 * Returns the previous Financial Year string.
 * "2024-25" → "2023-24"
 */
export function getPreviousFY(fy: string): string {
  const [startYearStr] = fy.split('-');
  const startYear = parseInt(startYearStr, 10);
  const prevYear = startYear - 1;
  return `${prevYear}-${String(startYear).slice(-2)}`;
}

/**
 * Returns the next Financial Year string.
 * "2024-25" → "2025-26"
 */
export function getNextFY(fy: string): string {
  const [startYearStr] = fy.split('-');
  const startYear = parseInt(startYearStr, 10);
  const nextYear = startYear + 1;
  return `${nextYear}-${String(nextYear + 1).slice(-2)}`;
}

/**
 * Returns true if two dates fall within the same Indian Financial Year.
 */
export function isSameFY(d1: Date, d2: Date): boolean {
  return getFYFromDate(d1) === getFYFromDate(d2);
}

/**
 * Returns an array of FY strings, starting from current FY going back N years.
 * Useful for FY picker dropdowns.
 */
export function listFYOptions(count: number = 5): string[] {
  const current = getCurrentFY();
  const options: string[] = [current];
  let fy = current;
  for (let i = 1; i < count; i++) {
    fy = getPreviousFY(fy);
    options.push(fy);
  }
  return options;
}

/**
 * Formats a FY string to a display label.
 * "2024-25" → "FY 2024-25 (Apr 2024 – Mar 2025)"
 */
export function formatFYLabel(fy: string): string {
  const [startYearStr] = fy.split('-');
  const startYear = parseInt(startYearStr, 10);
  return `FY ${fy} (Apr ${startYear} – Mar ${startYear + 1})`;
}

/**
 * Validates and normalises a FY string (e.g. "2024-25").
 * Returns the input if valid, otherwise falls back to the current FY.
 */
export function validateFY(fy: unknown): string {
  const s = typeof fy === 'string' ? fy : getCurrentFY();
  if (!/^\d{4}-\d{2}$/.test(s)) return getCurrentFY();
  return s;
}

/**
 * Returns the first day of the current month at midnight IST as a UTC Date.
 * Used for idempotent monthly snapshot upserts.
 */
export function getMonthStart(): Date {
  return dayjs().tz(IST).startOf('month').toDate();
}
