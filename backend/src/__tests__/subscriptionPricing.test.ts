/**
 * Boundary tests for subscription price resolution.
 *
 * Pre-mortem #1 for this feature was "the price-as-of lookup was off at a boundary, so
 * every backfilled charge silently used the wrong amount for months". These are the
 * tests that have to fail if that ever becomes true.
 */
import { describe, it, expect } from 'vitest';
import { priceAsOf, currentPrice, annualisedCost } from '../utils/subscriptionPricing';

const d = (iso: string) => new Date(iso);

/** Netflix: 499 from launch, 649 from 1 Jul 2026, 799 from 1 Jan 2027. */
const NETFLIX = [
  { amount: 499, effectiveFrom: d('2025-01-01') },
  { amount: 649, effectiveFrom: d('2026-07-01') },
  { amount: 799, effectiveFrom: d('2027-01-01') },
];

describe('priceAsOf', () => {
  it('returns the price in effect, not the latest one', () => {
    expect(priceAsOf(NETFLIX, d('2026-03-15'))).toBe(499);
  });

  it('applies a new price on the exact day it takes effect', () => {
    // The boundary that decides whether a same-day charge bills old or new. A vendor
    // raising its price on the 1st bills the 1st at the new price.
    expect(priceAsOf(NETFLIX, d('2026-07-01'))).toBe(649);
  });

  it('still bills the old price the instant before', () => {
    expect(priceAsOf(NETFLIX, d('2026-06-30T23:59:59'))).toBe(499);
  });

  it('returns the newest price for a date after every change', () => {
    expect(priceAsOf(NETFLIX, d('2030-01-01'))).toBe(799);
  });

  it('returns null before the first price rather than guessing', () => {
    // Falling back to the earliest price would invent a charge that never happened.
    expect(priceAsOf(NETFLIX, d('2024-12-31'))).toBeNull();
  });

  it('returns null for an empty history', () => {
    expect(priceAsOf([], d('2026-01-01'))).toBeNull();
  });

  it('returns null for an invalid date', () => {
    expect(priceAsOf(NETFLIX, new Date('nonsense'))).toBeNull();
  });

  it('ignores a corrupt row instead of letting it win the comparison', () => {
    const withJunk = [...NETFLIX, { amount: 9999, effectiveFrom: new Date('nonsense') }];
    expect(priceAsOf(withJunk, d('2026-03-15'))).toBe(499);
  });

  it('does not depend on array order', () => {
    const shuffled = [NETFLIX[2], NETFLIX[0], NETFLIX[1]];
    expect(priceAsOf(shuffled, d('2026-08-15'))).toBe(649);
    expect(priceAsOf(shuffled, d('2026-03-15'))).toBe(499);
  });

  it('handles a single-price subscription', () => {
    const one = [{ amount: 120, effectiveFrom: d('2026-01-01') }];
    expect(priceAsOf(one, d('2026-06-01'))).toBe(120);
    expect(priceAsOf(one, d('2025-06-01'))).toBeNull();
  });

  it('resolves each occurrence of a catch-up run independently', () => {
    // The actual failure this guards: a run backfilling May..Aug 2026 across the 1 Jul
    // rise must bill 499, 499, 649, 649 — not four charges at today's price.
    const dueDates = ['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01'].map(d);
    expect(dueDates.map((x) => priceAsOf(NETFLIX, x))).toEqual([499, 499, 649, 649]);
  });
});

describe('currentPrice', () => {
  it('is the price in effect NOW, not a future-dated one', () => {
    // A rise recorded as effective next month is real history but is not what is being
    // charged today. Returning it made the card disagree with what generation bills.
    expect(currentPrice(NETFLIX, d('2026-08-16'))).toBe(649);
    expect(currentPrice(NETFLIX, d('2027-06-01'))).toBe(799);
  });

  it('ignores array order', () => {
    expect(currentPrice([NETFLIX[2], NETFLIX[0], NETFLIX[1]], d('2026-08-16'))).toBe(649);
  });

  it('is null with no history', () => {
    expect(currentPrice([])).toBeNull();
  });

  it('is null when every row is corrupt', () => {
    expect(currentPrice([{ amount: 5, effectiveFrom: new Date('nonsense') }])).toBeNull();
  });

  it('is null before the subscription had any price', () => {
    expect(currentPrice(NETFLIX, d('2024-01-01'))).toBeNull();
  });
});

describe('annualisedCost', () => {
  it.each([
    ['MONTHLY', 649, 7788],
    ['YEARLY', 4999, 4999],
    ['QUARTERLY', 1500, 6000],
    ['WEEKLY', 100, 5200],
    ['DAILY', 10, 3650],
  ])('%s at %d costs %d a year', (frequency, amount, expected) => {
    expect(annualisedCost(amount, frequency)).toBe(expected);
  });

  it('returns 0 for an unknown frequency rather than NaN', () => {
    expect(annualisedCost(100, 'FORTNIGHTLY')).toBe(0);
  });
});
