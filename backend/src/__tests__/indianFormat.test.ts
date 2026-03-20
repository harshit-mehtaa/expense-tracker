import { describe, it, expect } from 'vitest';
import { formatINR, formatINRShort, parseINR } from '../utils/indianFormat';

describe('formatINR', () => {
  it('formats thousands correctly', () => {
    expect(formatINR(1000)).toBe('₹1,000');
  });

  it('formats lakhs with Indian grouping (2-2-3)', () => {
    expect(formatINR(100000)).toBe('₹1,00,000');
    expect(formatINR(1234567)).toBe('₹12,34,567');
    expect(formatINR(12345678)).toBe('₹1,23,45,678');
  });

  it('formats amounts under 1000 with no separator', () => {
    expect(formatINR(999)).toBe('₹999');
    expect(formatINR(0)).toBe('₹0');
  });

  it('handles negative amounts', () => {
    expect(formatINR(-1234567)).toBe('-₹12,34,567');
  });

  it('includes paise when non-zero', () => {
    expect(formatINR(1234.56)).toBe('₹1,234.56');
    expect(formatINR(100000.50)).toBe('₹1,00,000.50');
  });

  it('omits paise when zero', () => {
    expect(formatINR(1234.00)).toBe('₹1,234');
    expect(formatINR(100000.00)).toBe('₹1,00,000');
  });

  it('handles very large amounts (crores)', () => {
    expect(formatINR(10000000)).toBe('₹1,00,00,000');
    expect(formatINR(123456789)).toBe('₹12,34,56,789');
  });
});

describe('formatINRShort', () => {
  it('formats amounts under 1 lakh as full INR', () => {
    expect(formatINRShort(99999)).toBe('₹99,999');
    expect(formatINRShort(1000)).toBe('₹1,000');
  });

  it('formats lakhs', () => {
    expect(formatINRShort(100000)).toBe('₹1.0L');
    expect(formatINRShort(150000)).toBe('₹1.5L');
    expect(formatINRShort(1234567)).toBe('₹12.3L');
    expect(formatINRShort(9900000)).toBe('₹99.0L');
  });

  it('formats crores', () => {
    expect(formatINRShort(10000000)).toBe('₹1.0Cr');
    expect(formatINRShort(34567890)).toBe('₹3.5Cr');
    expect(formatINRShort(100000000)).toBe('₹10.0Cr');
  });

  it('handles negative amounts', () => {
    expect(formatINRShort(-1500000)).toBe('-₹15.0L');
    expect(formatINRShort(-10000000)).toBe('-₹1.0Cr');
  });

  it('formats zero', () => {
    expect(formatINRShort(0)).toBe('₹0');
  });

  it('lakh/crore boundary is exactly at 1 crore', () => {
    expect(formatINRShort(9999999)).toBe('₹100.0L'); // just under 1 crore — shows as lakhs
    expect(formatINRShort(10000000)).toBe('₹1.0Cr'); // exactly 1 crore
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
});
