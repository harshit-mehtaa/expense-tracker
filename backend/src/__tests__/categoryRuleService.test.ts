/**
 * Unit tests for categoryRuleService.ts.
 *
 * Key test focus:
 * - listCategoryRules: query shape (userId, orderBy keyword asc, category include)
 * - createCategoryRule: keyword normalization, empty-keyword rejection, category
 *   type validation (INCOME/EXPENSE only), P2002 → conflict, non-P2002 rethrow
 * - deleteCategoryRule: ownerScopedWhere lookup, not-found → 404
 * - applyCategoryRules: type + substring match, no-match passthrough, appliedCount
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/prisma', () => {
  const mockPrisma = {
    categoryRule: {
      findMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
    category: {
      findFirst: vi.fn(),
    },
  };
  return { default: mockPrisma, prisma: mockPrisma };
});

import { prisma } from '../config/prisma';
import {
  listCategoryRules,
  createCategoryRule,
  deleteCategoryRule,
  applyCategoryRules,
} from '../services/categoryRuleService';

const ruleMock = (prisma as any).categoryRule;
const catMock = (prisma as any).category;

const MOCK_CATEGORY = { id: 'cat-1', name: 'Groceries', type: 'EXPENSE', parentId: null };
const MOCK_RULE = {
  id: 'rule-1',
  userId: 'u1',
  keyword: 'swiggy',
  categoryId: 'cat-1',
  category: MOCK_CATEGORY,
};

beforeEach(() => {
  vi.clearAllMocks();
  ruleMock.findMany.mockResolvedValue([]);
  ruleMock.create.mockResolvedValue(MOCK_RULE);
  ruleMock.findFirst.mockResolvedValue(MOCK_RULE);
  ruleMock.delete.mockResolvedValue(MOCK_RULE);
  catMock.findFirst.mockResolvedValue(MOCK_CATEGORY);
});

describe('listCategoryRules', () => {
  it('queries by userId, ordered by keyword asc, with category include', async () => {
    ruleMock.findMany.mockResolvedValue([MOCK_RULE]);
    const result = await listCategoryRules('u1');
    expect(ruleMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1' },
        orderBy: { keyword: 'asc' },
      }),
    );
    expect(result).toEqual([MOCK_RULE]);
  });
});

describe('createCategoryRule', () => {
  it('normalizes the keyword to lowercase and trims it', async () => {
    await createCategoryRule('u1', { keyword: '  SWIGGY  ', categoryId: 'cat-1' });
    expect(ruleMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'u1', keyword: 'swiggy', categoryId: 'cat-1' }),
      }),
    );
  });

  it('rejects an empty (whitespace-only) keyword', async () => {
    await expect(createCategoryRule('u1', { keyword: '   ', categoryId: 'cat-1' }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(ruleMock.create).not.toHaveBeenCalled();
  });

  it('rejects when the category does not exist or is not INCOME/EXPENSE', async () => {
    catMock.findFirst.mockResolvedValue(null);
    await expect(createCategoryRule('u1', { keyword: 'swiggy', categoryId: 'cat-x' }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(catMock.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cat-x', type: { in: ['INCOME', 'EXPENSE'] } } }),
    );
    expect(ruleMock.create).not.toHaveBeenCalled();
  });

  it('returns 409 conflict on a P2002 duplicate-keyword violation', async () => {
    const { Prisma } = await import('@prisma/client');
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.x',
    });
    ruleMock.create.mockRejectedValue(p2002);
    await expect(createCategoryRule('u1', { keyword: 'swiggy', categoryId: 'cat-1' }))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('rethrows a non-P2002 error unchanged', async () => {
    ruleMock.create.mockRejectedValue(new Error('DB connection lost'));
    await expect(createCategoryRule('u1', { keyword: 'swiggy', categoryId: 'cat-1' }))
      .rejects.toThrow('DB connection lost');
  });
});

describe('deleteCategoryRule', () => {
  it('deletes the rule when it belongs to the requester', async () => {
    const result = await deleteCategoryRule('u1', 'rule-1', 'MEMBER');
    expect(ruleMock.findFirst).toHaveBeenCalledWith({ where: { id: 'rule-1', userId: 'u1' } });
    expect(ruleMock.delete).toHaveBeenCalledWith({ where: { id: 'rule-1' } });
    expect(result).toBe(MOCK_RULE);
  });

  it('scopes to all users for an ADMIN requester', async () => {
    await deleteCategoryRule('admin-1', 'rule-1', 'ADMIN');
    expect(ruleMock.findFirst).toHaveBeenCalledWith({ where: { id: 'rule-1' } });
  });

  it('throws 404 when the rule is not found or not owned', async () => {
    ruleMock.findFirst.mockResolvedValue(null);
    await expect(deleteCategoryRule('u1', 'rule-x', 'MEMBER'))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(ruleMock.delete).not.toHaveBeenCalled();
  });

  it('defaults requesterRole to MEMBER when omitted', async () => {
    await deleteCategoryRule('u1', 'rule-1');
    expect(ruleMock.findFirst).toHaveBeenCalledWith({ where: { id: 'rule-1', userId: 'u1' } });
  });
});

describe('applyCategoryRules', () => {
  const TX = (overrides: Partial<{ description: string; type: string }> = {}) => ({
    description: 'Swiggy order #4471',
    type: 'EXPENSE',
    amount: 500,
    date: new Date('2025-06-01'),
    ...overrides,
  });

  it('applies a matching rule by type + case-insensitive substring', async () => {
    ruleMock.findMany.mockResolvedValue([MOCK_RULE]);
    const { transactions, appliedCount } = await applyCategoryRules('u1', [TX()]);
    expect(appliedCount).toBe(1);
    expect(transactions[0].categoryId).toBe('cat-1');
  });

  it('does not apply a rule when the type does not match', async () => {
    ruleMock.findMany.mockResolvedValue([MOCK_RULE]);
    const { transactions, appliedCount } = await applyCategoryRules('u1', [TX({ type: 'INCOME' })]);
    expect(appliedCount).toBe(0);
    expect(transactions[0].categoryId).toBeUndefined();
  });

  it('leaves the transaction unchanged when no keyword matches', async () => {
    ruleMock.findMany.mockResolvedValue([MOCK_RULE]);
    const { transactions, appliedCount } = await applyCategoryRules('u1', [TX({ description: 'Rent payment' })]);
    expect(appliedCount).toBe(0);
    expect(transactions[0]).not.toHaveProperty('categoryId');
  });

  it('returns appliedCount 0 with no rules', async () => {
    const { appliedCount } = await applyCategoryRules('u1', [TX()]);
    expect(appliedCount).toBe(0);
  });
});
