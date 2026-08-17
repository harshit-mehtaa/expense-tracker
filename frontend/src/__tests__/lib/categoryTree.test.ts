/**
 * Tree ordering for category pickers.
 *
 * Pickers used to sort by leaf name, so a sub-category and its parent could sit far
 * apart — "Cab" under C, "Travel" under T — with only the path in the label to say they
 * were related.
 */
import { describe, it, expect } from 'vitest';
import { toCategoryTreeOptions, getCategoryTreeOptionLabel } from '@/lib/categoryUtils';

const cat = (id: string, name: string, parentId: string | null = null, icon?: string) =>
  ({ id, name, parentId, icon, type: 'EXPENSE' });

/** Travel › {Auto, Cab, Flight}, plus Groceries. Deliberately out of order. */
const FLAT = [
  cat('cab', 'Cab', 'travel', '🚕'),
  cat('groceries', 'Groceries', null, '🛒'),
  cat('flight', 'Flight', 'travel', '✈️'),
  cat('travel', 'Travel', null, '🧳'),
  cat('auto', 'Auto', 'travel', '🛺'),
];

describe('toCategoryTreeOptions', () => {
  it('puts each child directly under its own parent', () => {
    expect(toCategoryTreeOptions(FLAT).map((o) => o.category.name))
      .toEqual(['Groceries', 'Travel', 'Auto', 'Cab', 'Flight']);
  });

  it('reports the depth so the label can be indented', () => {
    const byName = new Map(toCategoryTreeOptions(FLAT).map((o) => [o.category.name, o.depth]));
    expect(byName.get('Travel')).toBe(0);
    expect(byName.get('Cab')).toBe(1);
  });

  it('sorts siblings alphabetically at every level', () => {
    const names = toCategoryTreeOptions(FLAT).map((o) => o.category.name);
    expect(names.indexOf('Auto')).toBeLessThan(names.indexOf('Cab'));
    expect(names.indexOf('Cab')).toBeLessThan(names.indexOf('Flight'));
  });

  it('handles a hierarchy deeper than two levels', () => {
    // The backend permits any depth; today's data happens to be two.
    const deep = [
      cat('a', 'A'), cat('b', 'B', 'a'), cat('c', 'C', 'b'), cat('d', 'D', 'c'),
    ];
    expect(toCategoryTreeOptions(deep).map((o) => o.depth)).toEqual([0, 1, 2, 3]);
  });

  it('keeps a child whose parent is filtered out, as a root', () => {
    // Every picker filters by type first, so a child whose parent is a different type
    // would otherwise disappear from the list entirely.
    const orphan = [cat('cab', 'Cab', 'travel', '🚕')];
    expect(toCategoryTreeOptions(orphan).map((o) => o.category.name)).toEqual(['Cab']);
    expect(toCategoryTreeOptions(orphan)[0].depth).toBe(0);
  });

  it('loses nothing from the input', () => {
    expect(toCategoryTreeOptions(FLAT)).toHaveLength(FLAT.length);
  });

  it('returns an empty list for empty input', () => {
    expect(toCategoryTreeOptions([])).toEqual([]);
  });

  it('terminates on a cyclic parent chain instead of hanging', () => {
    const cyclic = [cat('a', 'A', 'b'), cat('b', 'B', 'a')];
    expect(toCategoryTreeOptions(cyclic).length).toBeLessThanOrEqual(2);
  });
});

describe('getCategoryTreeOptionLabel', () => {
  it('shows a top-level category as icon plus name', () => {
    expect(getCategoryTreeOptionLabel(cat('travel', 'Travel', null, '🧳'), 0)).toBe('🧳 Travel');
  });

  it('indents a child and marks it as a branch', () => {
    const label = getCategoryTreeOptionLabel(cat('cab', 'Cab', 'travel', '🚕'), 1);
    expect(label).toContain('└ 🚕 Cab');
    // Non-breaking: browsers collapse ordinary leading spaces inside an <option>.
    expect(label.startsWith(' ')).toBe(true);
  });

  it('indents deeper levels further', () => {
    const one = getCategoryTreeOptionLabel(cat('x', 'X', 'y'), 1);
    const two = getCategoryTreeOptionLabel(cat('x', 'X', 'y'), 2);
    expect(two.length).toBeGreaterThan(one.length);
  });

  it('copes with a category that has no icon', () => {
    expect(getCategoryTreeOptionLabel(cat('x', 'X'), 0)).toBe('X');
  });
});
