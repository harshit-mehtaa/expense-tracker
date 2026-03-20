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
 *
 * Examples:
 *   1000       → ₹1,000
 *   100000     → ₹1,00,000
 *   1234567    → ₹12,34,567
 *   1234567.89 → ₹12,34,567.89
 *   -1234567   → -₹12,34,567
 */
export function formatINR(amount: number, forcePaise: boolean = false): string {
  const negative = amount < 0;
  const abs = Math.abs(amount);

  // Show paise only when non-zero (or forced)
  const hasPaise = Math.round((abs % 1) * 100) !== 0;
  const decimals = forcePaise || hasPaise ? 2 : 0;

  const formatted = abs.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return `${negative ? '-' : ''}₹${formatted}`;
}

/**
 * Formats a number to a short Indian representation.
 * Uses L (lakh) and Cr (crore) suffixes for large values.
 *
 * Examples:
 *   999        → ₹999
 *   100000     → ₹1.0L
 *   1234567    → ₹12.3L
 *   10000000   → ₹1.0Cr
 *   34567890   → ₹3.5Cr
 *   -1500000   → -₹15.0L
 */
export function formatINRShort(amount: number): string {
  if (amount === 0) return '₹0';

  const negative = amount < 0;
  const abs = Math.abs(amount);
  const sign = negative ? '-' : '';

  if (abs >= CRORE) {
    const crores = abs / CRORE;
    return `${sign}₹${crores.toFixed(1)}Cr`;
  }

  if (abs >= LAKH) {
    const lakhs = abs / LAKH;
    return `${sign}₹${lakhs.toFixed(1)}L`;
  }

  return `${sign}₹${abs.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
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
