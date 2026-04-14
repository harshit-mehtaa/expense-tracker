import { describe, it, expect } from 'vitest';
import { formatINR, formatINRShort, parseINR, roundINR } from '../lib/indianFormat';

describe('formatINR', () => {
  it('formats thousands correctly', () => {
    expect(formatINR(1000)).toBe('₹1,000.00');
  });

  it('formats lakhs with Indian grouping (2-2-3)', () => {
    expect(formatINR(100000)).toBe('₹1,00,000.00');
    expect(formatINR(1234567)).toBe('₹12,34,567.00');
    expect(formatINR(12345678)).toBe('₹1,23,45,678.00');
  });

  it('formats amounts under 1000', () => {
    expect(formatINR(999)).toBe('₹999.00');
    expect(formatINR(0)).toBe('₹0.00');
  });

  it('handles negative amounts', () => {
    expect(formatINR(-1234567)).toBe('-₹12,34,567.00');
  });

  it('shows 2 decimal places for amounts with paise', () => {
    expect(formatINR(1234.56)).toBe('₹1,234.56');
    expect(formatINR(100000.50)).toBe('₹1,00,000.50');
  });

  it('always shows 2 decimal places for whole amounts', () => {
    expect(formatINR(1234.00)).toBe('₹1,234.00');
    expect(formatINR(100000.00)).toBe('₹1,00,000.00');
  });

  it('handles very large amounts (crores)', () => {
    expect(formatINR(10000000)).toBe('₹1,00,00,000.00');
    expect(formatINR(123456789)).toBe('₹12,34,56,789.00');
  });
});

describe('formatINRShort', () => {
  it('formats amounts under 1 lakh as full INR with 2dp', () => {
    expect(formatINRShort(99999)).toBe('₹99,999.00');
    expect(formatINRShort(1000)).toBe('₹1,000.00');
  });

  it('formats lakhs with 2 decimal places', () => {
    expect(formatINRShort(100000)).toBe('₹1.00L');
    expect(formatINRShort(150000)).toBe('₹1.50L');
    expect(formatINRShort(1234567)).toBe('₹12.35L');
    expect(formatINRShort(9900000)).toBe('₹99.00L');
  });

  it('formats crores with 2 decimal places', () => {
    expect(formatINRShort(10000000)).toBe('₹1.00Cr');
    expect(formatINRShort(34567890)).toBe('₹3.46Cr');
    expect(formatINRShort(100000000)).toBe('₹10.00Cr');
  });

  it('handles negative amounts', () => {
    expect(formatINRShort(-1500000)).toBe('-₹15.00L');
    expect(formatINRShort(-10000000)).toBe('-₹1.00Cr');
  });

  it('formats zero', () => {
    expect(formatINRShort(0)).toBe('₹0.00');
  });

  it('lakh/crore boundary is exactly at 1 crore', () => {
    expect(formatINRShort(9999999)).toBe('₹100.00L'); // just under 1 crore — shows as lakhs
    expect(formatINRShort(10000000)).toBe('₹1.00Cr'); // exactly 1 crore
  });
});

describe('parseINR', () => {
  it('parses Indian formatted strings back to numbers', () => {
    expect(parseINR('₹12,34,567')).toBe(1234567);
    expect(parseINR('1,00,000')).toBe(100000);
    expect(parseINR('₹1,234.56')).toBe(1234.56);
  });

  it('handles plain numbers', () => {
    expect(parseINR('12345')).toBe(12345);
    expect(parseINR('0')).toBe(0);
  });

  it('throws when input cannot be parsed as a number', () => {
    expect(() => parseINR('not-a-number')).toThrow('Cannot parse "not-a-number" as INR amount');
    expect(() => parseINR('abc')).toThrow();
  });
});

describe('roundINR', () => {
  it('rounds to 2 decimal places (paise precision)', () => {
    expect(roundINR(10.005)).toBe(10.01);
    expect(roundINR(10.004)).toBe(10);
    expect(roundINR(100.999)).toBe(101);
  });

  it('handles zero and whole numbers', () => {
    expect(roundINR(0)).toBe(0);
    expect(roundINR(1000)).toBe(1000);
  });

  it('handles negative amounts', () => {
    // Math.round rounds towards +infinity, so -10.001 rounds to -10 (not -10.01)
    expect(roundINR(-10.001)).toBe(-10);
    expect(roundINR(-10.006)).toBe(-10.01);
    expect(roundINR(-10.999)).toBe(-11);
  });
});
