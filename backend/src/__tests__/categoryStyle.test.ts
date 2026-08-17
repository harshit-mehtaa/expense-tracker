/**
 * Unit tests for categoryStyle.ts
 *
 * Covers getDefaultCategoryStyle's full resolution chain, in priority order:
 *   1. exact name match in STYLE_BY_NAME (after normalization)
 *   2. first matching regex in KEYWORD_STYLES
 *   3. FALLBACK_STYLE_BY_TYPE[type]
 *   4. FALLBACK_STYLE_BY_TYPE.EXPENSE when the type is unrecognised
 *
 * Pure function — no mocks needed. CategoryType is used only as a type in the
 * source (the import is erased at runtime), so plain strings are valid inputs.
 */
import { describe, it, expect } from 'vitest';
import { getDefaultCategoryStyle } from '../utils/categoryStyle';
import type { CategoryType } from '@prisma/client';

/** Matches no STYLE_BY_NAME key and no KEYWORD_STYLES regex — forces the type fallback. */
const UNMATCHED_NAME = 'Miscellaneous';

describe('getDefaultCategoryStyle — exact name match (priority 1)', () => {
  it('returns the mapped style for a known category name', () => {
    expect(getDefaultCategoryStyle('Salary', 'INCOME')).toEqual({ icon: '💼', color: '#22c55e' });
  });

  it('matches case-insensitively', () => {
    expect(getDefaultCategoryStyle('GROCERIES', 'EXPENSE')).toEqual({ icon: '🛒', color: '#3b82f6' });
  });

  it('normalizes "&" to "and" before matching', () => {
    // 'Food & Beverages' → 'food and beverages'
    expect(getDefaultCategoryStyle('Food & Beverages', 'EXPENSE')).toEqual({ icon: '🍽️', color: '#ec4899' });
  });

  it('collapses punctuation and extra whitespace before matching', () => {
    // The play button moved to YouTube, where it is the canonical mark; Prime gets a
    // package. The point of this test is the normalisation, not the emoji.
    expect(getDefaultCategoryStyle('  Amazon-Prime!!  ', 'EXPENSE')).toEqual({ icon: '📦', color: '#00a8e1' });
  });

  it('takes priority over a keyword match the name would also satisfy', () => {
    // 'medical' is an exact key (💊) and also nothing in KEYWORD_STYLES — but
    // 'subscriptions' proves ordering: it is an exact key, and would not fall through.
    expect(getDefaultCategoryStyle('Subscriptions', 'EXPENSE')).toEqual({ icon: '📺', color: '#8b5cf6' });
  });
});

describe('getDefaultCategoryStyle — keyword regex match (priority 2)', () => {
  it('matches a keyword appearing alongside other words', () => {
    expect(getDefaultCategoryStyle('House Rent', 'EXPENSE')).toEqual({ icon: '🏠', color: '#f59e0b' });
  });

  it('matches on a substring of a larger word', () => {
    // 'utilities' hits the electric|utility|utilities|... pattern
    expect(getDefaultCategoryStyle('Home Utilities', 'EXPENSE')).toEqual({ icon: '🏠', color: '#f59e0b' });
  });

  it('returns the FIRST matching pattern when several would match', () => {
    // 'home' (pattern #1, 🏠) precedes 'insurance' (pattern #8, 🛡️) in KEYWORD_STYLES
    expect(getDefaultCategoryStyle('Home Insurance', 'EXPENSE')).toEqual({ icon: '🏠', color: '#f59e0b' });
  });

  it.each([
    ['Fuel Expenses', { icon: '🚗', color: '#f97316' }],
    ['College Tuition', { icon: '🎓', color: '#3b82f6' }],
    ['Flight Bookings', { icon: '✈️', color: '#0ea5e9' }],
    ['Mutual Fund Purchases', { icon: '📈', color: '#8b5cf6' }],
  ])('resolves %s via keyword lookup', (name, expected) => {
    expect(getDefaultCategoryStyle(name, 'EXPENSE')).toEqual(expected);
  });
});

describe('getDefaultCategoryStyle — type fallback (priority 3)', () => {
  it.each<[CategoryType, { icon: string; color: string }]>([
    ['INCOME', { icon: '💰', color: '#22c55e' }],
    ['EXPENSE', { icon: '🧾', color: '#64748b' }],
    ['ASSET', { icon: '🏦', color: '#3b82f6' }],
    ['LIABILITY', { icon: '💳', color: '#ef4444' }],
  ])('falls back to the %s default style when the name matches nothing', (type, expected) => {
    expect(getDefaultCategoryStyle(UNMATCHED_NAME, type)).toEqual(expected);
  });
});

describe('getDefaultCategoryStyle — EXPENSE fallback (priority 4)', () => {
  it('falls back to the EXPENSE style for an unrecognised type', () => {
    expect(getDefaultCategoryStyle(UNMATCHED_NAME, 'SOMETHING_ELSE')).toEqual({ icon: '🧾', color: '#64748b' });
  });

  it('falls back to the EXPENSE style for an empty type', () => {
    expect(getDefaultCategoryStyle(UNMATCHED_NAME, '')).toEqual({ icon: '🧾', color: '#64748b' });
  });

  it('handles a name that normalizes to an empty string', () => {
    expect(getDefaultCategoryStyle('!!!', 'INCOME')).toEqual({ icon: '💰', color: '#22c55e' });
  });
});

describe('getDefaultCategoryStyle — utilities and transport are distinguishable', () => {
  it('gives water, gas and electricity three different icons', () => {
    // All three used to fall into one keyword rule and render as the same light bulb.
    const water = getDefaultCategoryStyle('Water bill', 'EXPENSE');
    const gas = getDefaultCategoryStyle('Gas bill', 'EXPENSE');
    const power = getDefaultCategoryStyle('Electricity bill', 'EXPENSE');

    expect(new Set([water.icon, gas.icon, power.icon]).size).toBe(3);
  });

  it('distinguishes a trip from the flight taken on it', () => {
    expect(getDefaultCategoryStyle('Travel', 'EXPENSE').icon)
      .not.toBe(getDefaultCategoryStyle('Flight', 'EXPENSE').icon);
  });

  it('distinguishes household help from the house itself', () => {
    expect(getDefaultCategoryStyle('Househelp', 'EXPENSE').icon)
      .not.toBe(getDefaultCategoryStyle('Rent', 'EXPENSE').icon);
  });

  it('reads an Indian "Auto" as an auto-rickshaw, not a car', () => {
    expect(getDefaultCategoryStyle('Auto', 'EXPENSE').icon).toBe('🛺');
  });

  it('resolves a cab, which previously matched nothing and fell back', () => {
    expect(getDefaultCategoryStyle('Cab', 'EXPENSE').icon).toBe('🚕');
  });

  it('sends property tax to the tax icon rather than the house icon', () => {
    expect(getDefaultCategoryStyle('Property tax', 'EXPENSE').icon)
      .not.toBe(getDefaultCategoryStyle('House rent', 'EXPENSE').icon);
  });

  it('matches a common misspelling of maintenance as typed', () => {
    expect(getDefaultCategoryStyle('Maintainence', 'EXPENSE').icon).toBe('🔧');
    expect(getDefaultCategoryStyle('Maintenance', 'EXPENSE').icon).toBe('🔧');
  });

  it('gives none of these the generic receipt fallback', () => {
    for (const name of ['Parking', 'Cab', 'Cook', 'Nanny', 'Youtube', 'Maintainence']) {
      expect(getDefaultCategoryStyle(name, 'EXPENSE').icon).not.toBe('🧾');
    }
  });
});

describe('getDefaultCategoryStyle — Indian streaming services', () => {
  it('gives each OTT service its own colour rather than the default green', () => {
    // Simple Icons ships no mark for any of these (trademark), so the emoji stands in —
    // but they must at least be distinguishable from one another.
    const colours = ['Hotstar', 'Zee5', 'SonyLIV', 'JioCinema']
      .map((n) => getDefaultCategoryStyle(n, 'EXPENSE').color);
    expect(new Set(colours).size).toBe(colours.length);
  });

  it('does not leave a new OTT category on the generic receipt', () => {
    for (const name of ['Hotstar', 'Zee5', 'SonyLIV', 'JioCinema', 'Voot']) {
      expect(getDefaultCategoryStyle(name, 'EXPENSE').icon).not.toBe('🧾');
    }
  });
});
