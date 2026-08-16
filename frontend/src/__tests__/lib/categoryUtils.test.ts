/**
 * Tests for categoryUtils — hierarchical category path building, sorting, and
 * ancestry checks.
 *
 * The interesting cases are the cycle guards. Both getCategoryPath and
 * isCategoryDescendant walk a parent chain, and a corrupt parentId pair (a -> b -> a)
 * would spin forever without the `seen` set. Those guards are asserted directly
 * against a genuine cycle, not merely assumed.
 */
import { describe, it, expect } from 'vitest';
import {
  getCategoryPath,
  getCategoryLabel,
  sortCategoriesByPath,
  sortCategoriesByNameAsc,
  isCategoryDescendant,
  type CategoryLike,
} from '@/lib/categoryUtils';

const FOOD: CategoryLike = { id: 'food', name: 'Food', type: 'EXPENSE', parentId: null };
const DINING: CategoryLike = { id: 'dining', name: 'Dining Out', type: 'EXPENSE', parentId: 'food' };
const COFFEE: CategoryLike = { id: 'coffee', name: 'Coffee', type: 'EXPENSE', parentId: 'dining' };
const SALARY: CategoryLike = { id: 'salary', name: 'Salary', type: 'INCOME', parentId: null };

const FLAT = [FOOD, DINING, COFFEE, SALARY];

// ─── getCategoryPath ──────────────────────────────────────────────────────────

describe('getCategoryPath', () => {
  it('returns just the name for a root category', () => {
    expect(getCategoryPath(FOOD, FLAT)).toBe('Food');
  });

  it('walks parentId up the list to build a two-level path', () => {
    expect(getCategoryPath(DINING, FLAT)).toBe('Food / Dining Out');
  });

  it('walks three levels, ordering ancestors first', () => {
    expect(getCategoryPath(COFFEE, FLAT)).toBe('Food / Dining Out / Coffee');
  });

  it('prefers an embedded parent object over a parentId lookup', () => {
    // `parent` wins at the ?? — the id points at Food but the object says Travel.
    const embedded: CategoryLike = {
      id: 'x', name: 'Taxi', parentId: 'food',
      parent: { id: 'travel', name: 'Travel', parentId: null },
    };
    expect(getCategoryPath(embedded, FLAT)).toBe('Travel / Taxi');
  });

  it('stops when parentId points at a category that is not in the list', () => {
    const orphan: CategoryLike = { id: 'o', name: 'Orphan', parentId: 'ghost' };
    expect(getCategoryPath(orphan, FLAT)).toBe('Orphan');
  });

  it('defaults the categories list to empty, yielding just the name', () => {
    expect(getCategoryPath(DINING)).toBe('Dining Out');
  });

  it('terminates on a two-node parent cycle instead of looping forever', () => {
    const a: CategoryLike = { id: 'a', name: 'A', parentId: 'b' };
    const b: CategoryLike = { id: 'b', name: 'B', parentId: 'a' };
    // Without the `seen` guard this never returns.
    expect(getCategoryPath(a, [a, b])).toBe('B / A');
  });

  it('terminates on a self-referential parent', () => {
    const self: CategoryLike = { id: 's', name: 'Self', parentId: 's' };
    expect(getCategoryPath(self, [self])).toBe('Self');
  });
});

// ─── getCategoryLabel ─────────────────────────────────────────────────────────

describe('getCategoryLabel', () => {
  it('prefixes the icon with a space when present', () => {
    expect(getCategoryLabel({ ...FOOD, icon: '🍔' }, FLAT)).toBe('🍔 Food');
  });

  it('omits the prefix entirely when icon is null', () => {
    expect(getCategoryLabel({ ...FOOD, icon: null }, FLAT)).toBe('Food');
  });

  it('omits the prefix when icon is an empty string', () => {
    expect(getCategoryLabel({ ...FOOD, icon: '' }, FLAT)).toBe('Food');
  });

  it('includes the full ancestor path after the icon', () => {
    expect(getCategoryLabel({ ...COFFEE, icon: '☕' }, FLAT)).toBe('☕ Food / Dining Out / Coffee');
  });
});

// ─── sortCategoriesByPath ─────────────────────────────────────────────────────

describe('sortCategoriesByPath', () => {
  it('groups by type first, then orders by full path', () => {
    const sorted = sortCategoriesByPath(FLAT);
    // EXPENSE sorts before INCOME; within EXPENSE, path order.
    expect(sorted.map((c) => c.id)).toEqual(['food', 'dining', 'coffee', 'salary']);
  });

  it('falls back to path comparison when types are equal', () => {
    const zebra: CategoryLike = { id: 'z', name: 'Zebra', type: 'EXPENSE', parentId: null };
    const apple: CategoryLike = { id: 'a', name: 'Apple', type: 'EXPENSE', parentId: null };
    expect(sortCategoriesByPath([zebra, apple]).map((c) => c.name)).toEqual(['Apple', 'Zebra']);
  });

  it('treats a missing type as an empty string, sorting it first', () => {
    const untyped: CategoryLike = { id: 'u', name: 'Untyped', parentId: null };
    const typed: CategoryLike = { id: 't', name: 'Aaa', type: 'EXPENSE', parentId: null };
    expect(sortCategoriesByPath([typed, untyped]).map((c) => c.id)).toEqual(['u', 't']);
  });

  it('applies the missing-type fallback to either side of the comparison', () => {
    // Both input orders, so the ?? fallback is exercised for `a` and for `b`: V8 picks
    // the comparator's argument order, and a fallback that only worked on one side
    // would sort correctly here and wrongly on a differently-ordered list.
    const untyped: CategoryLike = { id: 'u', name: 'Untyped', parentId: null };
    const typed: CategoryLike = { id: 't', name: 'Aaa', type: 'EXPENSE', parentId: null };
    expect(sortCategoriesByPath([untyped, typed]).map((c) => c.id)).toEqual(['u', 't']);
    expect(sortCategoriesByPath([typed, untyped]).map((c) => c.id)).toEqual(['u', 't']);
  });

  it('sorts a list where several entries lack a type', () => {
    const a: CategoryLike = { id: 'a', name: 'Alpha', parentId: null };
    const b: CategoryLike = { id: 'b', name: 'Beta', parentId: null };
    const c: CategoryLike = { id: 'c', name: 'Gamma', type: 'INCOME', parentId: null };
    expect(sortCategoriesByPath([c, b, a]).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const input = [SALARY, FOOD];
    const before = [...input];
    sortCategoriesByPath(input);
    expect(input).toEqual(before);
  });
});

// ─── sortCategoriesByNameAsc ──────────────────────────────────────────────────

describe('sortCategoriesByNameAsc', () => {
  it('orders by name regardless of type', () => {
    const sorted = sortCategoriesByNameAsc(FLAT);
    expect(sorted.map((c) => c.name)).toEqual(['Coffee', 'Dining Out', 'Food', 'Salary']);
  });

  it('compares case-insensitively', () => {
    const lower: CategoryLike = { id: 'l', name: 'apple', parentId: null };
    const upper: CategoryLike = { id: 'u', name: 'Banana', parentId: null };
    expect(sortCategoriesByNameAsc([upper, lower]).map((c) => c.id)).toEqual(['l', 'u']);
  });

  it('breaks a name tie using the full path', () => {
    // Two "Fuel" categories, distinguished only by their parents.
    const car: CategoryLike = { id: 'car', name: 'Car', parentId: null };
    const bike: CategoryLike = { id: 'bike', name: 'Bike', parentId: null };
    const fuelCar: CategoryLike = { id: 'fc', name: 'Fuel', parentId: 'car' };
    const fuelBike: CategoryLike = { id: 'fb', name: 'Fuel', parentId: 'bike' };
    const sorted = sortCategoriesByNameAsc([fuelCar, fuelBike, car, bike]);
    // Bike / Fuel sorts before Car / Fuel.
    expect(sorted.map((c) => c.id)).toEqual(['bike', 'car', 'fb', 'fc']);
  });

  it('does not mutate the input array', () => {
    const input = [SALARY, FOOD];
    const before = [...input];
    sortCategoriesByNameAsc(input);
    expect(input).toEqual(before);
  });
});

// ─── isCategoryDescendant ─────────────────────────────────────────────────────

describe('isCategoryDescendant', () => {
  it('detects a direct child', () => {
    expect(isCategoryDescendant(DINING, 'food', FLAT)).toBe(true);
  });

  it('detects a grandchild by walking the chain', () => {
    expect(isCategoryDescendant(COFFEE, 'food', FLAT)).toBe(true);
  });

  it('returns false for an unrelated category', () => {
    expect(isCategoryDescendant(SALARY, 'food', FLAT)).toBe(false);
  });

  it('returns false for a root category, which has no parentId to walk', () => {
    expect(isCategoryDescendant(FOOD, 'salary', FLAT)).toBe(false);
  });

  it('returns false when the chain breaks before reaching the ancestor', () => {
    const orphan: CategoryLike = { id: 'o', name: 'Orphan', parentId: 'ghost' };
    expect(isCategoryDescendant(orphan, 'food', FLAT)).toBe(false);
  });

  it('returns false rather than hanging on a two-node cycle', () => {
    const a: CategoryLike = { id: 'a', name: 'A', parentId: 'b' };
    const b: CategoryLike = { id: 'b', name: 'B', parentId: 'a' };
    // 'ghost' is not in the cycle, so the walk only ends via the `seen` guard.
    expect(isCategoryDescendant(a, 'ghost', [a, b])).toBe(false);
  });

  it('returns false rather than hanging on a self-referential parent', () => {
    const self: CategoryLike = { id: 's', name: 'Self', parentId: 's' };
    expect(isCategoryDescendant(self, 'ghost', [self])).toBe(false);
  });

  it('still finds the ancestor when a cycle exists further up', () => {
    const a: CategoryLike = { id: 'a', name: 'A', parentId: 'b' };
    const b: CategoryLike = { id: 'b', name: 'B', parentId: 'a' };
    expect(isCategoryDescendant(a, 'b', [a, b])).toBe(true);
  });
});
