import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { ownerScopedWhere } from '../utils/resolveTargetUserId';
import type { ParsedTransaction } from './importService';

export interface CategoryRuleMatch {
  categoryId: string;
  keyword: string;
  category: { id: string; name: string; type: string; parentId?: string | null };
}

function normalizeKeyword(keyword: string): string {
  return keyword.trim().toLowerCase();
}

export async function listCategoryRules(userId: string) {
  return prisma.categoryRule.findMany({
    where: { userId },
    include: {
      category: {
        select: {
          id: true,
          name: true,
          type: true,
          color: true,
          icon: true,
          parentId: true,
          parent: { select: { id: true, name: true, type: true, icon: true, parentId: true } },
        },
      },
    },
    orderBy: { keyword: 'asc' },
  });
}

export async function createCategoryRule(userId: string, data: { keyword: string; categoryId: string }) {
  const keyword = normalizeKeyword(data.keyword);
  if (!keyword) throw AppError.badRequest('Keyword is required');

  const category = await prisma.category.findFirst({
    where: { id: data.categoryId, type: { in: ['INCOME', 'EXPENSE'] } },
  });
  if (!category) throw AppError.notFound('Category');

  try {
    return await prisma.categoryRule.create({
      data: { userId, keyword, categoryId: data.categoryId },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            type: true,
            color: true,
            icon: true,
            parentId: true,
            parent: { select: { id: true, name: true, type: true, icon: true, parentId: true } },
          },
        },
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw AppError.conflict(`A rule for "${keyword}" already exists`);
    }
    throw err;
  }
}

export async function deleteCategoryRule(userId: string, ruleId: string, requesterRole = 'MEMBER') {
  const rule = await prisma.categoryRule.findFirst({ where: ownerScopedWhere(ruleId, userId, requesterRole) });
  if (!rule) throw AppError.notFound('Category rule');
  return prisma.categoryRule.delete({ where: { id: ruleId } });
}

export async function applyCategoryRules(
  userId: string,
  transactions: ParsedTransaction[],
): Promise<{ transactions: Array<ParsedTransaction & { categoryId?: string }>; appliedCount: number }> {
  const rules = await listCategoryRules(userId);
  let appliedCount = 0;

  const categorized = transactions.map((tx) => {
    const description = tx.description.toLowerCase();
    const match = rules.find((rule) => (
      rule.category.type === tx.type && description.includes(rule.keyword)
    ));
    if (!match) return tx;
    appliedCount++;
    return { ...tx, categoryId: match.categoryId };
  });

  return { transactions: categorized, appliedCount };
}
