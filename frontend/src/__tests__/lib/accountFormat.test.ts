/**
 * accountFormat.ts had zero direct tests despite being shared across Accounts.tsx,
 * Transactions.tsx, and the subscription form — see vision.md tech debt. This covers
 * the exported surface, including CASH (system-managed, auto-provisioned per user).
 */
import { describe, it, expect } from 'vitest';
import { ACCOUNT_TYPE_LABELS, accountTypeLabel, formatAccountOption, formatAccountShort } from '@/lib/accountFormat';

describe('ACCOUNT_TYPE_LABELS', () => {
  it('labels CASH as "Cash"', () => {
    expect(ACCOUNT_TYPE_LABELS.CASH).toBe('Cash');
  });
});

describe('accountTypeLabel', () => {
  it('returns the mapped label for a known type', () => {
    expect(accountTypeLabel('SAVINGS')).toBe('Savings');
    expect(accountTypeLabel('CASH')).toBe('Cash');
  });

  it('falls back to the raw value for an unmapped type', () => {
    expect(accountTypeLabel('UNKNOWN_TYPE')).toBe('UNKNOWN_TYPE');
  });

  it('returns empty string for null/undefined/empty', () => {
    expect(accountTypeLabel(null)).toBe('');
    expect(accountTypeLabel(undefined)).toBe('');
    expect(accountTypeLabel('')).toBe('');
  });
});

describe('formatAccountOption', () => {
  it('formats bank name, last4, and type', () => {
    expect(formatAccountOption({ bankName: 'HDFC Bank', accountNumberLast4: '4821', accountType: 'CREDIT_CARD' }))
      .toBe('HDFC Bank ····4821 (Credit Card)');
  });

  it('formats the cash account with its Cash type label', () => {
    expect(formatAccountOption({ bankName: 'Cash', accountType: 'CASH' })).toBe('Cash (Cash)');
  });

  it('omits the last4 suffix and type suffix when absent', () => {
    expect(formatAccountOption({ bankName: 'Wallet' })).toBe('Wallet');
  });

  it('prefixes the owner name when showOwner is set and userName is present', () => {
    expect(formatAccountOption(
      { bankName: 'HDFC Bank', accountType: 'SAVINGS', userName: 'Alice' },
      { showOwner: true },
    )).toBe('Alice - HDFC Bank (Savings)');
  });

  it('falls back to fallbackOwnerName when showOwner is set but userName is missing', () => {
    expect(formatAccountOption(
      { bankName: 'HDFC Bank', accountType: 'SAVINGS' },
      { showOwner: true, fallbackOwnerName: 'Family Member' },
    )).toBe('Family Member - HDFC Bank (Savings)');
  });

  it('does not prefix an owner name when showOwner is not set', () => {
    expect(formatAccountOption({ bankName: 'HDFC Bank', accountType: 'SAVINGS', userName: 'Alice' }))
      .toBe('HDFC Bank (Savings)');
  });
});

describe('formatAccountShort', () => {
  it('formats bank name and last4 without the type', () => {
    expect(formatAccountShort({ bankName: 'HDFC Bank', accountNumberLast4: '4821' })).toBe('HDFC Bank ····4821');
  });

  it('omits the last4 suffix when absent', () => {
    expect(formatAccountShort({ bankName: 'Cash' })).toBe('Cash');
  });

  it('returns empty string for a missing account', () => {
    expect(formatAccountShort(null)).toBe('');
    expect(formatAccountShort(undefined)).toBe('');
  });
});
