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
    expect(getDefaultCategoryStyle('  Amazon-Prime!!  ', 'EXPENSE')).toEqual({ icon: '▶️', color: '#00a8e1' });
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
