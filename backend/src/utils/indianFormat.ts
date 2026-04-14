/**
 * Indian number formatting utilities.
 * These are the canonical implementations — frontend mirrors them exactly.
 * Never use raw .toLocaleString() without these helpers.
 */

const LAKH = 100_000;
const CRORE = 10_000_000;

/**
 * Formats a number using the Indian numbering system with ₹ prefix.
 * Indian grouping: last 3 digits, then groups of 2 from the right.
 * Always shows 2 decimal places.
 *
 * Examples:
 *   1000       → ₹1,000.00
 *   100000     → ₹1,00,000.00
 *   1234567    → ₹12,34,567.00
 *   1234567.89 → ₹12,34,567.89
 *   -1234567   → -₹12,34,567.00
 */
export function formatINR(amount: number, forcePaise: boolean = false): string { // forcePaise retained for backwards compatibility; always 2dp now
  const negative = amount < 0;
  const abs = Math.abs(amount);

  const formatted = abs.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return `${negative ? '-' : ''}₹${formatted}`;
}

/**
 * Formats a number to a short Indian representation.
 * Uses L (lakh) and Cr (crore) suffixes for large values.
 * Always shows 2 decimal places.
 *
 * Examples:
 *   999        → ₹999.00
 *   100000     → ₹1.00L
 *   1234567    → ₹12.35L
 *   10000000   → ₹1.00Cr
 *   34567890   → ₹3.46Cr
 *   -1500000   → -₹15.00L
 */
export function formatINRShort(amount: number): string {
  if (amount === 0) return '₹0.00';

  const negative = amount < 0;
  const abs = Math.abs(amount);
  const sign = negative ? '-' : '';

  if (abs >= CRORE) {
    return `${sign}₹${(abs / CRORE).toFixed(2)}Cr`;
  }

  if (abs >= LAKH) {
    return `${sign}₹${(abs / LAKH).toFixed(2)}L`;
  }

  return `${sign}₹${abs.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Parses an Indian-formatted currency string to a number.
 * Strips ₹ symbol and commas before parsing.
 *
 * Examples:
 *   "₹12,34,567"   → 1234567
 *   "1,00,000"     → 100000
 *   "₹1,234.56"    → 1234.56
 */
export function parseINR(value: string): number {
  const cleaned = value.replace(/[₹,\s]/g, '');
  const parsed = parseFloat(cleaned);
  if (isNaN(parsed)) throw new Error(`Cannot parse "${value}" as INR amount`);
  return parsed;
}

/**
 * Rounds to 2 decimal places (for paise precision in financial calculations).
 * Uses "round half away from zero" to match standard financial rounding.
 */
export function roundINR(amount: number): number {
  return Math.round(amount * 100) / 100;
}
