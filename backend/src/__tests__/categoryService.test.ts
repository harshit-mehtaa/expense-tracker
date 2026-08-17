/**
 * Unit tests for categoryService.
 *
 * Focus: the usage rollup, the safe-delete path that replaced silent orphaning, and the
 * merge, which moves data across four tables and re-parents children.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/prisma', () => {
  const mock = {
    category: {
      findMany: vi.fn(), findFirst: vi.fn(), findFirstOrThrow: vi.fn(),
      create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), count: vi.fn(),
    },
    transaction: { groupBy: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
    budget: { count: vi.fn(), updateMany: vi.fn() },
    categoryRule: { count: vi.fn(), updateMany: vi.fn() },
    recurringRule: { count: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return { default: mock, prisma: mock };
});

import { prisma } from '../config/prisma';
import {
  getCategoryUsage, listCategories, deleteCategory, mergeCategories, getCategoryDependencies,
} from '../services/categoryService';

const catMock = (prisma as any).category;
const txnMock = (prisma as any).transaction;
const budgetMock = (prisma as any).budget;
const ruleMock = (prisma as any).categoryRule;
const recurringMock = (prisma as any).recurringRule;

beforeEach(() => {
  vi.clearAllMocks();
  (prisma as any).$transaction.mockImplementation(async (fn: any) => fn(prisma));
  txnMock.groupBy.mockResolvedValue([]);
  txnMock.count.mockResolvedValue(0);
  budgetMock.count.mockResolvedValue(0);
  ruleMock.count.mockResolvedValue(0);
  recurringMock.count.mockResolvedValue(0);
  catMock.count.mockResolvedValue(0);
  catMock.findMany.mockResolvedValue([]);
});

describe('getCategoryUsage', () => {
  /** Food › Groceries, plus a standalone Fuel. */
  const TREE = [
    { id: 'food', parentId: null },
    { id: 'groceries', parentId: 'food' },
    { id: 'fuel', parentId: null },
  ];

  it("rolls a child's spend up into its parent", async () => {
    // A parent used purely as a grouping has no transactions of its own and would read
    // as dead without this.
    catMock.findMany.mockResolvedValue(TREE);
    txnMock.groupBy
      .mockResolvedValueOnce([
        { categoryId: 'groceries', _count: { _all: 4 }, _sum: { amount: 4000 }, _max: { date: new Date('2026-08-01') } },
      ])
      .mockResolvedValueOnce([{ categoryId: 'groceries', _sum: { amount: 4000 } }]);

    const usage = await getCategoryUsage();

    expect(usage.get('groceries')!.directTotal).toBe(4000);
    expect(usage.get('food')!.directTotal).toBe(0);
    expect(usage.get('food')!.rollupTotal).toBe(4000);
    expect(usage.get('food')!.rollupCount).toBe(4);
  });

  it("takes the parent's last-used date from its most recent child", async () => {
    catMock.findMany.mockResolvedValue(TREE);
    txnMock.groupBy
      .mockResolvedValueOnce([
        { categoryId: 'groceries', _count: { _all: 1 }, _sum: { amount: 100 }, _max: { date: new Date('2026-08-01') } },
      ])
      .mockResolvedValueOnce([{ categoryId: 'groceries', _sum: { amount: 100 } }]);

    const usage = await getCategoryUsage();
    expect(usage.get('food')!.lastUsed).toEqual(new Date('2026-08-01'));
  });

  it('reports a genuinely unused category as zero, not undefined', async () => {
    catMock.findMany.mockResolvedValue(TREE);

    const usage = await getCategoryUsage();
    expect(usage.get('fuel')).toEqual({
      directCount: 0, directTotal: 0, rollupCount: 0, rollupTotal: 0, lastUsed: null,
    });
  });

  it('counts non-EXPENSE transactions but does not add them to the total', async () => {
    // Summing an INCOME category's amounts and calling it "spent" would mislead.
    catMock.findMany.mockResolvedValue([{ id: 'salary', parentId: null }]);
    txnMock.groupBy
      .mockResolvedValueOnce([
        { categoryId: 'salary', _count: { _all: 12 }, _sum: { amount: 1200000 }, _max: { date: new Date('2026-08-01') } },
      ])
      .mockResolvedValueOnce([]); // no EXPENSE rows

    const usage = await getCategoryUsage();
    expect(usage.get('salary')!.directCount).toBe(12);
    expect(usage.get('salary')!.directTotal).toBe(0);
  });

  it('ignores a transaction whose category no longer exists', async () => {
    catMock.findMany.mockResolvedValue([{ id: 'fuel', parentId: null }]);
    txnMock.groupBy
      .mockResolvedValueOnce([
        { categoryId: 'ghost', _count: { _all: 3 }, _sum: { amount: 300 }, _max: { date: new Date() } },
      ])
      .mockResolvedValueOnce([{ categoryId: 'ghost', _sum: { amount: 300 } }]);

    const usage = await getCategoryUsage();
    expect(usage.has('ghost')).toBe(false);
    expect(usage.get('fuel')!.rollupTotal).toBe(0);
  });

  it('copes with null sums and null dates from the database', async () => {
    // groupBy returns null for _sum/_max when nothing aggregates.
    catMock.findMany.mockResolvedValue([{ id: 'fuel', parentId: null }]);
    txnMock.groupBy
      .mockResolvedValueOnce([
        { categoryId: 'fuel', _count: { _all: 1 }, _sum: { amount: null }, _max: { date: null } },
      ])
      .mockResolvedValueOnce([{ categoryId: 'fuel', _sum: { amount: null } }]);

    const usage = await getCategoryUsage();
    expect(usage.get('fuel')!.directTotal).toBe(0);
    expect(usage.get('fuel')!.lastUsed).toBeNull();
  });

  it('keeps the LATER of two children as the parent last-used date', async () => {
    catMock.findMany.mockResolvedValue([
      { id: 'food', parentId: null },
      { id: 'a', parentId: 'food' },
      { id: 'b', parentId: 'food' },
    ]);
    txnMock.groupBy
      .mockResolvedValueOnce([
        { categoryId: 'a', _count: { _all: 1 }, _sum: { amount: 10 }, _max: { date: new Date('2026-08-01') } },
        { categoryId: 'b', _count: { _all: 1 }, _sum: { amount: 20 }, _max: { date: new Date('2026-06-01') } },
      ])
      .mockResolvedValueOnce([
        { categoryId: 'a', _sum: { amount: 10 } },
        { categoryId: 'b', _sum: { amount: 20 } },
      ]);

    const usage = await getCategoryUsage();
    expect(usage.get('food')!.lastUsed).toEqual(new Date('2026-08-01'));
    expect(usage.get('food')!.rollupTotal).toBe(30);
  });

  it('stops rolling up at a parent that is not in the category set', async () => {
    catMock.findMany.mockResolvedValue([{ id: 'orphan', parentId: 'missing' }]);
    txnMock.groupBy
      .mockResolvedValueOnce([
        { categoryId: 'orphan', _count: { _all: 1 }, _sum: { amount: 5 }, _max: { date: new Date() } },
      ])
      .mockResolvedValueOnce([{ categoryId: 'orphan', _sum: { amount: 5 } }]);

    const usage = await getCategoryUsage();
    expect(usage.get('orphan')!.rollupTotal).toBe(5);
  });

  it('terminates on a cyclic parent chain instead of hanging', async () => {
    // Cycles are rejected on write, but a row that got one another way must not spin the
    // rollup forever.
    catMock.findMany.mockResolvedValue([
      { id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' },
    ]);
    txnMock.groupBy
      .mockResolvedValueOnce([
        { categoryId: 'a', _count: { _all: 1 }, _sum: { amount: 10 }, _max: { date: new Date() } },
      ])
      .mockResolvedValueOnce([{ categoryId: 'a', _sum: { amount: 10 } }]);

    const usage = await getCategoryUsage();
    expect(usage.get('b')!.rollupTotal).toBe(10);
  });
});

describe('deleteCategory', () => {
  const CAT = { id: 'c1', type: 'EXPENSE', isDefault: false, userId: null };

  beforeEach(() => catMock.findFirst.mockResolvedValue(CAT));

  it('refuses to silently orphan transactions', async () => {
    // Transaction.categoryId is onDelete: SetNull, so deleting used to strip the category
    // from every transaction filed under it, permanently and without warning.
    txnMock.count.mockResolvedValue(37);

    await expect(deleteCategory('c1')).rejects.toThrow(/37 transactions/i);
    expect(catMock.delete).not.toHaveBeenCalled();
  });

  it('moves the transactions across when a target is given', async () => {
    txnMock.count.mockResolvedValue(37);
    catMock.findFirst
      .mockResolvedValueOnce(CAT)
      .mockResolvedValueOnce({ id: 'c2', type: 'EXPENSE', isDefault: false, userId: null });

    await deleteCategory('c1', 'c2');

    expect(txnMock.updateMany).toHaveBeenCalledWith({
      where: { categoryId: 'c1' }, data: { categoryId: 'c2' },
    });
    // Rules point at it too, and would break just as silently.
    expect(ruleMock.updateMany).toHaveBeenCalled();
    expect(recurringMock.updateMany).toHaveBeenCalled();
    expect(catMock.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
  });

  it('deletes an unused category with no target needed', async () => {
    await deleteCategory('c1');
    expect(catMock.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
  });

  it('refuses to move transactions to a different type', async () => {
    txnMock.count.mockResolvedValue(1);
    catMock.findFirst
      .mockResolvedValueOnce(CAT)
      .mockResolvedValueOnce({ id: 'c2', type: 'INCOME', isDefault: false, userId: null });

    await expect(deleteCategory('c1', 'c2')).rejects.toThrow(/same type/i);
  });

  it('still refuses when sub-categories or budgets depend on it', async () => {
    catMock.count.mockResolvedValue(2);
    await expect(deleteCategory('c1')).rejects.toThrow(/sub-categor/i);

    catMock.count.mockResolvedValue(0);
    budgetMock.count.mockResolvedValue(1);
    await expect(deleteCategory('c1')).rejects.toThrow(/budget/i);
  });

  it('refuses to delete a default category', async () => {
    catMock.findFirst.mockResolvedValue({ ...CAT, isDefault: true });
    await expect(deleteCategory('c1')).rejects.toThrow(/default/i);
  });

  it('says "1 transaction", not "1 transactions"', async () => {
    txnMock.count.mockResolvedValue(1);
    await expect(deleteCategory('c1')).rejects.toThrow(/1 transaction\./i);
  });

  it('says "1 sub-category", not "1 sub-categories"', async () => {
    catMock.count.mockResolvedValue(1);
    await expect(deleteCategory('c1')).rejects.toThrow(/1 sub-category\./i);
  });

  it('says "1 budget", not "1 budgets"', async () => {
    budgetMock.count.mockResolvedValue(1);
    await expect(deleteCategory('c1')).rejects.toThrow(/1 budget\./i);
  });

  it('rejects a reassignment target that does not exist', async () => {
    txnMock.count.mockResolvedValue(1);
    catMock.findFirst.mockResolvedValueOnce(CAT).mockResolvedValueOnce(null);
    await expect(deleteCategory('c1', 'ghost')).rejects.toThrow(/target category not found/i);
  });

  it('refuses to reassign a category to itself', async () => {
    txnMock.count.mockResolvedValue(1);
    await expect(deleteCategory('c1', 'c1')).rejects.toThrow(/itself/i);
  });
});

describe('mergeCategories', () => {
  const SOURCE = { id: 'dup', type: 'EXPENSE', isDefault: false, userId: null, parentId: null };
  const TARGET = { id: 'keep', type: 'EXPENSE', isDefault: false, userId: null, parentId: null };

  beforeEach(() => {
    catMock.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(where.id === 'dup' ? SOURCE : where.id === 'keep' ? TARGET : null));
    catMock.findFirstOrThrow.mockResolvedValue(TARGET);
  });

  it('moves every reference across, not just transactions', async () => {
    // Four tables point at a category. Missing one silently drops the link.
    await mergeCategories('dup', 'keep');

    for (const m of [txnMock, budgetMock, ruleMock, recurringMock]) {
      expect(m.updateMany).toHaveBeenCalledWith({
        where: { categoryId: 'dup' }, data: { categoryId: 'keep' },
      });
    }
  });

  it('re-parents the children rather than orphaning them', async () => {
    await mergeCategories('dup', 'keep');
    expect(catMock.updateMany).toHaveBeenCalledWith({
      where: { parentId: 'dup' }, data: { parentId: 'keep' },
    });
  });

  it('removes the source and returns the survivor', async () => {
    const result = await mergeCategories('dup', 'keep');
    expect(catMock.delete).toHaveBeenCalledWith({ where: { id: 'dup' } });
    expect(result).toBe(TARGET);
  });

  it('does it all in one transaction', async () => {
    await mergeCategories('dup', 'keep');
    expect((prisma as any).$transaction).toHaveBeenCalledTimes(1);
  });

  it('refuses to merge a category into itself', async () => {
    await expect(mergeCategories('dup', 'dup')).rejects.toThrow(/into itself/i);
  });

  it('refuses to merge across types', async () => {
    catMock.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(where.id === 'dup' ? SOURCE : { ...TARGET, type: 'INCOME' }));
    await expect(mergeCategories('dup', 'keep')).rejects.toThrow(/same type/i);
  });

  it('refuses to merge a default category away', async () => {
    // It cannot be deleted either, and removing one leaves a hole in the seeded taxonomy.
    catMock.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(where.id === 'dup' ? { ...SOURCE, isDefault: true } : TARGET));
    await expect(mergeCategories('dup', 'keep')).rejects.toThrow(/default/i);
  });

  it('refuses to merge a parent into its own descendant', async () => {
    // The descendant would end up as its own ancestor once the children move across.
    catMock.findFirst.mockImplementation(({ where }: any) => {
      if (where.id === 'dup') return Promise.resolve(SOURCE);
      if (where.id === 'child') return Promise.resolve({ id: 'child', type: 'EXPENSE', isDefault: false, userId: null, parentId: 'dup' });
      return Promise.resolve(null);
    });
    await expect(mergeCategories('dup', 'child')).rejects.toThrow(/own sub-categor/i);
    expect(catMock.delete).not.toHaveBeenCalled();
  });

  it('refuses to merge into a deeper descendant, not just a direct child', async () => {
    // Walks the whole ancestor chain: merging A into its own grandchild is as circular
    // as merging it into its child.
    catMock.findFirst.mockImplementation(({ where }: any) => {
      if (where.id === 'dup') return Promise.resolve(SOURCE);
      if (where.id === 'grandchild') return Promise.resolve({ id: 'grandchild', type: 'EXPENSE', isDefault: false, userId: null, parentId: 'child' });
      if (where.id === 'child') return Promise.resolve({ id: 'child', parentId: 'dup' });
      return Promise.resolve(null);
    });

    await expect(mergeCategories('dup', 'grandchild')).rejects.toThrow(/own sub-categor/i);
    expect(catMock.delete).not.toHaveBeenCalled();
  });

  it('404s an unknown source', async () => {
    catMock.findFirst.mockResolvedValue(null);
    await expect(mergeCategories('nope', 'keep')).rejects.toThrow(/not found/i);
  });

  it('400s an unknown target', async () => {
    catMock.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(where.id === 'dup' ? SOURCE : null));
    await expect(mergeCategories('dup', 'ghost')).rejects.toThrow(/target category not found/i);
  });
});

describe('getCategoryDependencies', () => {
  it('reports everything that points at the category', async () => {
    catMock.count.mockResolvedValue(1);
    txnMock.count.mockResolvedValue(2);
    budgetMock.count.mockResolvedValue(3);
    ruleMock.count.mockResolvedValue(4);
    recurringMock.count.mockResolvedValue(5);

    expect(await getCategoryDependencies('c1')).toEqual({
      children: 1, transactions: 2, budgets: 3, rules: 4, recurringRules: 5,
    });
  });
});

describe('listCategories', () => {
  it('does not crash on a category that appeared between the two queries', async () => {
    // listCategories and getCategoryUsage each run their own findMany, so a category
    // created in between exists in one result and not the other.
    catMock.findMany
      .mockResolvedValueOnce([
        { id: 'fuel', name: 'Fuel', parentId: null },
        { id: 'brand-new', name: 'Brand New', parentId: null },
      ])
      .mockResolvedValueOnce([{ id: 'fuel', parentId: null }]);

    const rows = await listCategories();
    expect(rows.find((r: any) => r.id === 'brand-new')!.usage).toEqual({
      directCount: 0, directTotal: 0, rollupCount: 0, rollupTotal: 0, lastUsed: null,
    });
  });

  it('attaches usage to every category, including unused ones', async () => {
    catMock.findMany
      .mockResolvedValueOnce([{ id: 'fuel', name: 'Fuel', parentId: null }])
      .mockResolvedValueOnce([{ id: 'fuel', parentId: null }]);

    const [row] = await listCategories();
    expect(row.usage).toEqual({
      directCount: 0, directTotal: 0, rollupCount: 0, rollupTotal: 0, lastUsed: null,
    });
  });
});
