/**
 * Indian number formatting — frontend mirror of backend/src/utils/indianFormat.ts
 * Must stay in sync. Tests are duplicated in both to catch drift.
 * Never use raw .toLocaleString() in components — always use these helpers.
 */

const LAKH = 100_000;
const CRORE = 10_000_000;

export function formatINR(amount: number, forcePaise: boolean = false): string { // forcePaise retained for backwards compatibility; always 2dp now
  const negative = amount < 0;
  const abs = Math.abs(amount);

  const formatted = abs.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return `${negative ? '-' : ''}₹${formatted}`;
}

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

export function parseINR(value: string): number {
  const cleaned = value.replace(/[₹,\s]/g, '');
  const parsed = parseFloat(cleaned);
  if (isNaN(parsed)) throw new Error(`Cannot parse "${value}" as INR amount`);
  return parsed;
}

export function roundINR(amount: number): number {
  return Math.round(amount * 100) / 100;
}
