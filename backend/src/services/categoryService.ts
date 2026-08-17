import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { getDefaultCategoryStyle } from '../utils/categoryStyle';

/**
 * Categories — family-shared and global (`userId` is always null).
 *
 * Moved out of `routes/categories.ts` per the "no Prisma in route handlers" invariant,
 * which vision.md records as debt with the note to push each into its owning service
 * when next touching the file. This is that.
 */

export type CategoryType = 'INCOME' | 'EXPENSE' | 'ASSET' | 'LIABILITY';

const categoryInclude = {
  parent: { select: { id: true, name: true, type: true, icon: true, color: true, parentId: true } },
  _count: { select: { children: true } },
} as const;

/**
 * Rejects a parent that would produce a cycle or cross types.
 *
 * Walks up the ancestor chain rather than checking only the immediate parent: making A
 * the child of its own grandchild is just as circular, and would make the tree
 * unrenderable and the rollup infinite.
 */
export async function validateParentCategory(
  parentId: string | null | undefined,
  type: CategoryType,
  currentCategoryId?: string,
) {
  if (parentId === undefined || parentId === null) return;
  if (parentId === currentCategoryId) {
    throw AppError.badRequest('A category cannot be its own parent');
  }

  let parent = await prisma.category.findFirst({
    where: { id: parentId, userId: null },
    select: { id: true, type: true, parentId: true },
  });
  if (!parent) throw AppError.badRequest('Parent category not found');
  if (parent.type !== type) throw AppError.badRequest('Parent category must have the same type');

  while (currentCategoryId && parent?.parentId) {
    if (parent.parentId === currentCategoryId) {
      throw AppError.badRequest('A category cannot be moved under its own sub-category');
    }
    parent = await prisma.category.findFirst({
      where: { id: parent.parentId, userId: null },
      select: { id: true, type: true, parentId: true },
    });
  }
}

export interface CategoryUsage {
  /** Transactions filed directly against this category. */
  directCount: number;
  directTotal: number;
  /** Including every descendant — what the category costs you as a grouping. */
  rollupCount: number;
  rollupTotal: number;
  lastUsed: Date | null;
}

/**
 * Usage figures for every category, in two queries rather than one per row.
 *
 * Family-wide, because categories are family-shared — scoping to the requester would
 * report a category as unused when a spouse is the one using it.
 *
 * Totals cover EXPENSE transactions only. Summing an INCOME category's amounts and
 * labelling it "spent" would be actively misleading, so the count is still reported and
 * the total is left at zero for those.
 */
export async function getCategoryUsage(): Promise<Map<string, CategoryUsage>> {
  const [grouped, categories] = await Promise.all([
    prisma.transaction.groupBy({
      by: ['categoryId'],
      where: { deletedAt: null, categoryId: { not: null } },
      _count: { _all: true },
      _sum: { amount: true },
      _max: { date: true },
    }),
    prisma.category.findMany({ where: { userId: null }, select: { id: true, parentId: true } }),
  ]);

  // EXPENSE-only totals, fetched separately so the count above stays a true count of
  // everything filed under the category.
  const expenseTotals = await prisma.transaction.groupBy({
    by: ['categoryId'],
    where: { deletedAt: null, categoryId: { not: null }, type: 'EXPENSE' },
    _sum: { amount: true },
  });
  const expenseByCategory = new Map(
    expenseTotals.map((row) => [row.categoryId as string, Number(row._sum.amount ?? 0)]),
  );

  const usage = new Map<string, CategoryUsage>();
  for (const c of categories) {
    usage.set(c.id, {
      directCount: 0, directTotal: 0, rollupCount: 0, rollupTotal: 0, lastUsed: null,
    });
  }

  for (const row of grouped) {
    const id = row.categoryId as string;
    const entry = usage.get(id);
    if (!entry) continue; // a transaction on a category that no longer exists
    entry.directCount = row._count._all;
    entry.directTotal = expenseByCategory.get(id) ?? 0;
    entry.lastUsed = row._max.date ?? null;
    entry.rollupCount = entry.directCount;
    entry.rollupTotal = entry.directTotal;
  }

  // Roll each category's figures up through its ancestors. A parent used purely as a
  // grouping has no transactions of its own and would otherwise read as dead.
  const parentOf = new Map(categories.map((c) => [c.id, c.parentId]));
  for (const c of categories) {
    const own = usage.get(c.id)!;
    if (own.directCount === 0 && own.directTotal === 0) continue;

    const seen = new Set<string>([c.id]);
    let parentId = parentOf.get(c.id) ?? null;
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId); // cycles are rejected on write, but a bad row must not hang this
      const ancestor = usage.get(parentId);
      if (!ancestor) break;
      ancestor.rollupCount += own.directCount;
      ancestor.rollupTotal += own.directTotal;
      if (!ancestor.lastUsed || (own.lastUsed && own.lastUsed > ancestor.lastUsed)) {
        ancestor.lastUsed = own.lastUsed;
      }
      parentId = parentOf.get(parentId) ?? null;
    }
  }

  for (const entry of usage.values()) {
    entry.directTotal = Math.round(entry.directTotal * 100) / 100;
    entry.rollupTotal = Math.round(entry.rollupTotal * 100) / 100;
  }
  return usage;
}

export async function listCategories() {
  const [categories, usage] = await Promise.all([
    prisma.category.findMany({
      where: { userId: null },
      include: categoryInclude,
      orderBy: [{ name: 'asc' }],
    }),
    getCategoryUsage(),
  ]);

  return categories.map((c) => ({
    ...c,
    usage: usage.get(c.id) ?? {
      directCount: 0, directTotal: 0, rollupCount: 0, rollupTotal: 0, lastUsed: null,
    },
  }));
}

export async function createCategory(data: {
  name: string; type: CategoryType; icon?: string | null;
  color?: string; parentId?: string | null;
}) {
  await validateParentCategory(data.parentId, data.type);
  const defaultStyle = getDefaultCategoryStyle(data.name, data.type);
  try {
    return await prisma.category.create({
      data: {
        ...data,
        icon: data.icon?.trim() ? data.icon : defaultStyle.icon,
        color: data.color ?? defaultStyle.color,
        userId: null,
        isDefault: false,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw AppError.conflict(`A ${data.type} category named "${data.name}" already exists`);
    }
    throw err;
  }
}

export async function getCategoryForAudit(id: string) {
  return prisma.category.findFirst({ where: { id } });
}

/**
 * Returns the row as it was AND as it now is, so the caller does not have to re-read it
 * for the audit snapshot — one fetch instead of two.
 */
export async function updateCategory(id: string, parsed: Record<string, unknown>) {
  const cat = await prisma.category.findFirst({ where: { id } });
  if (!cat) throw AppError.notFound('Category');

  const nextType = parsed.type as CategoryType | undefined;
  if (cat.isDefault && nextType !== undefined && nextType !== cat.type) {
    throw AppError.badRequest('The type of a default category cannot be changed');
  }
  if (nextType !== undefined && nextType !== cat.type) {
    const childCount = await prisma.category.count({ where: { parentId: cat.id } });
    if (childCount > 0) {
      throw AppError.badRequest('Category type cannot be changed while it has sub-categories');
    }
  }
  await validateParentCategory(parsed.parentId as string | null | undefined, nextType ?? cat.type, cat.id);

  // Belt-and-suspenders: strip type for default categories even if the guard above passed.
  const { type: _stripped, ...withoutType } = parsed;
  const data = cat.isDefault ? withoutType : parsed;

  try {
    const updated = await prisma.category.update({ where: { id }, data: data as never });
    return { before: cat, after: updated };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw AppError.conflict('A category with that name and type already exists');
    }
    throw err;
  }
}

/** Everything that points at a category, and would be orphaned if it vanished. */
export async function getCategoryDependencies(id: string) {
  const [children, transactions, budgets, rules, recurringRules] = await Promise.all([
    prisma.category.count({ where: { parentId: id } }),
    prisma.transaction.count({ where: { categoryId: id, deletedAt: null } }),
    prisma.budget.count({ where: { categoryId: id } }),
    prisma.categoryRule.count({ where: { categoryId: id } }),
    prisma.recurringRule.count({ where: { categoryId: id } }),
  ]);
  return { children, transactions, budgets, rules, recurringRules };
}

/**
 * Deletes a category, optionally moving its transactions somewhere first.
 *
 * `Transaction.categoryId` is `onDelete: SetNull`, so deleting a category used to
 * silently strip the category from every transaction filed under it — the counts were
 * checked for sub-categories and budgets but never for transactions. That is
 * unrecoverable categorisation loss, and it happened without a warning.
 */
export async function deleteCategory(id: string, reassignToId?: string | null) {
  const cat = await prisma.category.findFirst({ where: { id } });
  if (!cat) throw AppError.notFound('Category');
  if (cat.isDefault) throw AppError.forbidden('Default categories cannot be deleted');

  const deps = await getCategoryDependencies(id);
  if (deps.children > 0) {
    throw AppError.conflict(
      `This category has ${deps.children} sub-categor${deps.children > 1 ? 'ies' : 'y'}. Delete or move them first.`,
    );
  }
  if (deps.budgets > 0) {
    throw AppError.conflict(
      `This category is used by ${deps.budgets} budget${deps.budgets > 1 ? 's' : ''}. Remove those budgets first.`,
    );
  }

  if (deps.transactions > 0 && !reassignToId) {
    throw AppError.conflict(
      `This category is used by ${deps.transactions} transaction${deps.transactions > 1 ? 's' : ''}. `
      + 'Choose a category to move them to, or re-file them first.',
    );
  }

  if (reassignToId) {
    if (reassignToId === id) throw AppError.badRequest('Cannot reassign a category to itself');
    const target = await prisma.category.findFirst({ where: { id: reassignToId, userId: null } });
    if (!target) throw AppError.badRequest('Target category not found');
    if (target.type !== cat.type) {
      throw AppError.badRequest('Transactions can only be moved to a category of the same type');
    }
  }

  return prisma.$transaction(async (tx) => {
    if (reassignToId) {
      // Move everything that would otherwise be orphaned. Budgets are already ruled out
      // above, so only these three can still point here.
      await tx.transaction.updateMany({ where: { categoryId: id }, data: { categoryId: reassignToId } });
      await tx.categoryRule.updateMany({ where: { categoryId: id }, data: { categoryId: reassignToId } });
      await tx.recurringRule.updateMany({ where: { categoryId: id }, data: { categoryId: reassignToId } });
    }
    return tx.category.delete({ where: { id } });
  });
}

/**
 * Folds `sourceId` into `targetId`: everything that referenced the source now references
 * the target, and the source is removed.
 *
 * The remedy for the duplicates that accumulate in any real ledger ("Groceries" and
 * "Grocery"), which otherwise means re-filing every transaction by hand.
 */
export async function mergeCategories(sourceId: string, targetId: string) {
  if (sourceId === targetId) throw AppError.badRequest('Cannot merge a category into itself');

  const [source, target] = await Promise.all([
    prisma.category.findFirst({ where: { id: sourceId, userId: null } }),
    prisma.category.findFirst({ where: { id: targetId, userId: null } }),
  ]);
  if (!source) throw AppError.notFound('Category');
  if (!target) throw AppError.badRequest('Target category not found');

  // A default category can be merged INTO, but not away: it cannot be deleted either,
  // and removing one would leave a hole in the seeded taxonomy the app relies on.
  if (source.isDefault) {
    throw AppError.forbidden('Default categories cannot be merged away. Merge into one instead.');
  }
  if (source.type !== target.type) {
    throw AppError.badRequest('Only categories of the same type can be merged');
  }

  // Merging a parent into its own descendant would leave the descendant as its own
  // ancestor once the source's children are re-parented onto it.
  let ancestor: { id: string; parentId: string | null } | null = { id: target.id, parentId: target.parentId };
  const seen = new Set<string>();
  while (ancestor?.parentId && !seen.has(ancestor.parentId)) {
    if (ancestor.parentId === sourceId) {
      throw AppError.badRequest('Cannot merge a category into one of its own sub-categories');
    }
    seen.add(ancestor.parentId);
    ancestor = await prisma.category.findFirst({
      where: { id: ancestor.parentId },
      select: { id: true, parentId: true },
    });
  }

  return prisma.$transaction(async (tx) => {
    await tx.transaction.updateMany({ where: { categoryId: sourceId }, data: { categoryId: targetId } });
    await tx.budget.updateMany({ where: { categoryId: sourceId }, data: { categoryId: targetId } });
    await tx.categoryRule.updateMany({ where: { categoryId: sourceId }, data: { categoryId: targetId } });
    await tx.recurringRule.updateMany({ where: { categoryId: sourceId }, data: { categoryId: targetId } });
    // Children move across rather than being orphaned by the SetNull FK.
    await tx.category.updateMany({ where: { parentId: sourceId }, data: { parentId: targetId } });

    await tx.category.delete({ where: { id: sourceId } });
    return tx.category.findFirstOrThrow({ where: { id: targetId }, include: categoryInclude });
  });
}
