/**
 * Indian Financial Year utilities — frontend mirror of backend/src/utils/financialYear.ts
 * FY runs April 1 – March 31. IST-aware.
 */

export function getFYFromDate(date: Date): string {
  // IST offset is +5:30 (330 minutes)
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(date.getTime() + istOffset);
  const month = istDate.getUTCMonth() + 1; // 1-12
  const year = istDate.getUTCFullYear();

  if (month >= 4) {
    return `${year}-${String(year + 1).slice(-2)}`;
  }
  return `${year - 1}-${String(year).slice(-2)}`;
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
