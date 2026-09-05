/**
 * Indian Financial Year utilities — frontend mirror of backend/src/utils/financialYear.ts
 * FY runs April 1 – March 31. IST-aware.
 */

// IST is +5:30 (330 minutes), no DST — a fixed offset is exact for every date.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** IST calendar year/month for a UTC timestamp, via offset-shift-then-read-UTC-
 *  getters — NOT local getters (assumes the browser's own tz is IST, not
 *  guaranteed for a self-hosted app) and NOT a raw UTC ISO slice (a month-start
 *  Date like `dayjs().tz('Asia/Kolkata').startOf('month')` is always "previous
 *  UTC day, 18:30 UTC", so a raw slice reads one calendar month early, always —
 *  not just near midnight). */
function toISTYearMonth(date: Date): { year: number; month: number } {
  const istDate = new Date(date.getTime() + IST_OFFSET_MS);
  return { year: istDate.getUTCFullYear(), month: istDate.getUTCMonth() + 1 };
}

export function getFYFromDate(date: Date): string {
  const { year, month } = toISTYearMonth(date);

  if (month >= 4) {
    return `${year}-${String(year + 1).slice(-2)}`;
  }
  return `${year - 1}-${String(year).slice(-2)}`;
}

/** "YYYY-MM" for a date's IST calendar month — see toISTYearMonth. */
export function getISTMonthKey(date: Date): string {
  const { year, month } = toISTYearMonth(date);
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function getCurrentFY(): string {
  return getFYFromDate(new Date());
}

export function getPreviousFY(fy: string): string {
  const startYear = parseInt(fy.split('-')[0]);
  return `${startYear - 1}-${String(startYear).slice(-2)}`;
}

export function getNextFY(fy: string): string {
  const startYear = parseInt(fy.split('-')[0]);
  const next = startYear + 1;
  return `${next}-${String(next + 1).slice(-2)}`;
}

export function formatFYLabel(fy: string): string {
  const startYear = parseInt(fy.split('-')[0]);
  return `FY ${fy} (Apr ${startYear} – Mar ${startYear + 1})`;
}

export function listFYOptions(count: number = 5): string[] {
  const current = getCurrentFY();
  const options = [current];
  let fy = current;
  for (let i = 1; i < count; i++) {
    fy = getPreviousFY(fy);
    options.push(fy);
  }
  return options;
}
