/**
 * Unit tests for categoryRuleService.ts.
 *
 * Key test focus:
 * - listCategoryRules: query shape (userId, category include) and EVALUATION order —
 *   REGEX rules oldest-first, then KEYWORD rules alphabetical
 * - createCategoryRule: KEYWORD lowercased, REGEX kept as typed + validated, empty
 *   pattern rejection, per-user rule cap, category type validation, P2002 → conflict
 * - deleteCategoryRule: ownerScopedWhere lookup, not-found → 404
 * - matchRules: first match wins, type filter, keyword vs regex semantics, skip +
 *   distinct warning (never throw) on a bad stored pattern / timeout / exhausted budget /
 *   vm error, chunking, and a timed-out rule is remembered (never re-run) until deleted
 * - applyCategoryRules: import path keeps pre-set categoryIds, returns warnings
 * - resolveCategoryForTransaction: single-row path, TRANSFER short-circuit
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/prisma', () => {
  const mockPrisma = {
    categoryRule: {
      findMany: vi.fn(),
      count: vi.fn(),
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

// Pass-through wrapper so tests can count vm calls; real timeouts still run.
vi.mock('../utils/safeRegex', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/safeRegex')>();
  return { ...actual, testAllWithTimeout: vi.fn(actual.testAllWithTimeout) };
});

import { prisma } from '../config/prisma';
import { testAllWithTimeout } from '../utils/safeRegex';
import {
  listCategoryRules,
  createCategoryRule,
  deleteCategoryRule,
  matchRules,
  applyCategoryRules,
  resolveCategoryForTransaction,
  MAX_RULES_PER_USER,
  REGEX_CHUNK_SIZE,
} from '../services/categoryRuleService';

const ruleMock = (prisma as any).categoryRule;
const catMock = (prisma as any).category;

const EXPENSE_CAT = { id: 'cat-1', name: 'Groceries', type: 'EXPENSE', parentId: null };
const INCOME_CAT = { id: 'cat-2', name: 'Salary', type: 'INCOME', parentId: null };

type Rule = {
  id: string;
  matchType: 'KEYWORD' | 'REGEX';
  pattern: string;
  categoryId: string;
  category: { type: string };
};

let seq = 0;
function rule(matchType: Rule['matchType'], pattern: string, category = EXPENSE_CAT): Rule {
  seq++;
  return { id: `rule-${seq}`, matchType, pattern, categoryId: category.id, category };
}

const MOCK_RULE = { ...rule('KEYWORD', 'swiggy'), userId: 'u1' };

beforeEach(() => {
  vi.clearAllMocks();
  ruleMock.findMany.mockResolvedValue([]);
  ruleMock.count.mockResolvedValue(0);
  ruleMock.create.mockResolvedValue(MOCK_RULE);
  ruleMock.findFirst.mockResolvedValue(MOCK_RULE);
  ruleMock.delete.mockResolvedValue(MOCK_RULE);
  catMock.findFirst.mockResolvedValue(EXPENSE_CAT);
});

describe('listCategoryRules', () => {
  it('queries by userId with a deterministic DB order and category include', async () => {
    await listCategoryRules('u1');
    expect(ruleMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: expect.objectContaining({ category: expect.anything() }),
      }),
    );
  });

  it('returns rules in evaluation order: regexes oldest-first, then keywords alphabetical', async () => {
    // DB order: createdAt asc, interleaved types
    ruleMock.findMany.mockResolvedValue([
      rule('KEYWORD', 'zomato'),
      rule('REGEX', 'swiggy'),
      rule('KEYWORD', 'amazon'),
      rule('REGEX', '^upi'),
      rule('KEYWORD', 'swiggy'),
    ]);
    const result = await listCategoryRules('u1');
    expect(result.map((r) => `${r.matchType}:${r.pattern}`)).toEqual([
      'REGEX:swiggy',
      'REGEX:^upi',
      'KEYWORD:amazon',
      'KEYWORD:swiggy',
      'KEYWORD:zomato',
    ]);
  });
});

describe('createCategoryRule', () => {
  it('defaults to KEYWORD and normalizes the pattern to trimmed lowercase', async () => {
    await createCategoryRule('u1', { pattern: '  SWIGGY  ', categoryId: 'cat-1' });
    expect(ruleMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { userId: 'u1', matchType: 'KEYWORD', pattern: 'swiggy', categoryId: 'cat-1' },
      }),
    );
  });

  it('stores a REGEX pattern trimmed but NOT lowercased (\\D ≠ \\d)', async () => {
    await createCategoryRule('u1', { matchType: 'REGEX', pattern: '  ^UPI/\\D+  ', categoryId: 'cat-1' });
    expect(ruleMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { userId: 'u1', matchType: 'REGEX', pattern: '^UPI/\\D+', categoryId: 'cat-1' },
      }),
    );
  });

  it('rejects an invalid REGEX with a 400 before touching the DB', async () => {
    await expect(createCategoryRule('u1', { matchType: 'REGEX', pattern: '(a+', categoryId: 'cat-1' }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(ruleMock.count).not.toHaveBeenCalled();
    expect(ruleMock.create).not.toHaveBeenCalled();
  });

  it.each(['KEYWORD', 'REGEX'] as const)('rejects an empty (whitespace-only) %s pattern', async (matchType) => {
    await expect(createCategoryRule('u1', { matchType, pattern: '   ', categoryId: 'cat-1' }))
      .rejects.toMatchObject({ statusCode: 400, message: 'Pattern is required' });
    expect(ruleMock.create).not.toHaveBeenCalled();
  });

  it(`rejects once the user already has ${MAX_RULES_PER_USER} rules`, async () => {
    ruleMock.count.mockResolvedValue(MAX_RULES_PER_USER);
    await expect(createCategoryRule('u1', { pattern: 'swiggy', categoryId: 'cat-1' }))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining(`${MAX_RULES_PER_USER}`) });
    expect(ruleMock.count).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(ruleMock.create).not.toHaveBeenCalled();
  });

  it('rejects when the category does not exist or is not INCOME/EXPENSE', async () => {
    catMock.findFirst.mockResolvedValue(null);
    await expect(createCategoryRule('u1', { pattern: 'swiggy', categoryId: 'cat-x' }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(catMock.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cat-x', type: { in: ['INCOME', 'EXPENSE'] } } }),
    );
    expect(ruleMock.create).not.toHaveBeenCalled();
  });

  it.each([
    ['KEYWORD', 'swiggy', 'A keyword rule for "swiggy" already exists'],
    ['REGEX', '^upi', 'A regex rule for "^upi" already exists'],
  ] as const)('returns 409 conflict on a P2002 duplicate %s rule', async (matchType, pattern, message) => {
    const { Prisma } = await import('@prisma/client');
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.x',
    });
    ruleMock.create.mockRejectedValue(p2002);
    await expect(createCategoryRule('u1', { matchType, pattern, categoryId: 'cat-1' }))
      .rejects.toMatchObject({ statusCode: 409, message });
  });

  it('rethrows a non-P2002 error unchanged', async () => {
    ruleMock.create.mockRejectedValue(new Error('DB connection lost'));
    await expect(createCategoryRule('u1', { pattern: 'swiggy', categoryId: 'cat-1' }))
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

describe('matchRules', () => {
  const row = (description: string, type = 'EXPENSE') => ({ description, type });

  it('matches a KEYWORD rule as a case-insensitive substring', () => {
    const { categoryIds, appliedCount } = matchRules([rule('KEYWORD', 'swiggy')], [row('SWIGGY order')], 500);
    expect(categoryIds).toEqual(['cat-1']);
    expect(appliedCount).toBe(1);
  });

  it('matches a REGEX rule case-insensitively', () => {
    const { categoryIds } = matchRules([rule('REGEX', '^upi/.*swiggy')], [row('UPI/P2M/99/Swiggy')], 500);
    expect(categoryIds).toEqual(['cat-1']);
  });

  it('never applies a rule whose category type differs from the transaction type', () => {
    const { categoryIds, appliedCount } = matchRules(
      [rule('KEYWORD', 'swiggy'), rule('REGEX', 'swiggy')],
      [row('Swiggy refund', 'INCOME')],
      500,
    );
    expect(categoryIds).toEqual([undefined]);
    expect(appliedCount).toBe(0);
  });

  it('first matching rule wins — later rules never overwrite', () => {
    const { categoryIds } = matchRules(
      [rule('REGEX', 'amazon', EXPENSE_CAT), rule('KEYWORD', 'amazon', { ...EXPENSE_CAT, id: 'cat-9' })],
      [row('Amazon Pay')],
      500,
    );
    expect(categoryIds).toEqual(['cat-1']);
  });

  it('assigns per row, each to its own first match', () => {
    const { categoryIds, appliedCount } = matchRules(
      [rule('KEYWORD', 'swiggy', EXPENSE_CAT), rule('REGEX', '^salary', INCOME_CAT)],
      [row('Swiggy'), row('SALARY SEP', 'INCOME'), row('Rent')],
      500,
    );
    expect(categoryIds).toEqual(['cat-1', 'cat-2', undefined]);
    expect(appliedCount).toBe(2);
  });

  it('skips (with a warning) a stored pattern that no longer compiles, and keeps evaluating', () => {
    const { categoryIds, warnings } = matchRules(
      [rule('REGEX', '('), rule('KEYWORD', 'swiggy')],
      [row('Swiggy')],
      500,
    );
    expect(categoryIds).toEqual(['cat-1']);
    expect(warnings).toEqual(['Auto-categorization rule /(/ was skipped: it is not a valid regular expression.']);
  });

  const SLOW_WARNING = (pattern: string) =>
    `Auto-categorization rule /${pattern}/ was skipped: it takes too long to evaluate — simplify or delete it.`;

  it('skips (with a warning) a catastrophic regex that times out, without hanging', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const start = Date.now();
    const slow = rule('REGEX', '^(a|aa)+$');
    const { categoryIds, warnings } = matchRules(
      [slow, rule('KEYWORD', 'aaa')],
      [row(`${'a'.repeat(60)}!`)],
      50,
    );
    expect(Date.now() - start).toBeLessThan(2000);
    expect(categoryIds).toEqual(['cat-1']); // the later keyword rule still applied
    expect(warnings).toEqual([SLOW_WARNING('^(a|aa)+$')]);
    // Logged once, by id — never the description (financial PII)
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls[0])).toContain(slow.id);
    expect(JSON.stringify(warn.mock.calls[0])).not.toContain('aaaa');
    warn.mockRestore();
  });

  it('remembers a timed-out rule and never re-runs it (bounds repeated-request cost)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spy = testAllWithTimeout as ReturnType<typeof vi.fn>;
    const slow = rule('REGEX', '^(a|aa)+$');
    matchRules([slow], [row(`${'a'.repeat(60)}!`)], 50);
    spy.mockClear();

    const { warnings } = matchRules([slow], [row('anything at all')], 500);

    expect(spy).not.toHaveBeenCalled();
    expect(warnings).toEqual([SLOW_WARNING('^(a|aa)+$')]);
    expect(warn).toHaveBeenCalledTimes(1); // the first timeout only — no log spam per request
    warn.mockRestore();
  });

  it('forgets a timed-out rule once it is deleted', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spy = testAllWithTimeout as ReturnType<typeof vi.fn>;
    const slow = rule('REGEX', '^(a|aa)+$');
    matchRules([slow], [row(`${'a'.repeat(60)}!`)], 50);
    ruleMock.findFirst.mockResolvedValue({ id: slow.id });
    await deleteCategoryRule('u1', slow.id);
    spy.mockClear();

    // A later rule reusing the id (only possible in tests) is evaluated afresh
    matchRules([{ ...slow, pattern: 'swiggy' }], [row('Swiggy')], 500);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.mocked(console.warn).mockRestore();
  });

  it('does not evaluate regex rules once the time budget is exhausted — and does not blame them', () => {
    const spy = testAllWithTimeout as ReturnType<typeof vi.fn>;
    const cheap = rule('REGEX', 'swiggy');
    const { categoryIds, warnings } = matchRules(
      [rule('KEYWORD', 'rent'), cheap],
      [row('Rent'), row('Swiggy')],
      0,
    );
    expect(categoryIds).toEqual(['cat-1', undefined]);
    expect(warnings).toEqual([
      'Auto-categorization rule /swiggy/ was not evaluated: earlier rules used up the time budget.',
    ]);
    // Not remembered as slow: with budget available it runs normally
    spy.mockClear();
    expect(matchRules([cheap], [row('Swiggy')], 500).categoryIds).toEqual(['cat-1']);
  });

  it('skips (with its own warning) a rule whose evaluation fails for a non-timeout reason', () => {
    (testAllWithTimeout as ReturnType<typeof vi.fn>).mockReturnValueOnce('error');
    const { categoryIds, warnings } = matchRules([rule('REGEX', 'swiggy')], [row('Swiggy')], 500);
    expect(categoryIds).toEqual([undefined]);
    expect(warnings).toEqual(['Auto-categorization rule /swiggy/ was skipped: it could not be evaluated.']);
  });

  it('does not evaluate a rule when no candidate rows remain (no warning, no vm call)', () => {
    const spy = testAllWithTimeout as ReturnType<typeof vi.fn>;
    const { warnings } = matchRules([rule('KEYWORD', 'rent'), rule('REGEX', '(')], [row('Rent')], 500);
    expect(warnings).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it(`evaluates a regex in chunks of ${REGEX_CHUNK_SIZE} rows`, () => {
    const spy = testAllWithTimeout as ReturnType<typeof vi.fn>;
    const rows = Array.from({ length: REGEX_CHUNK_SIZE + 1 }, (_, i) => row(i === REGEX_CHUNK_SIZE ? 'Swiggy' : 'Rent'));
    const { categoryIds, appliedCount } = matchRules([rule('REGEX', 'swiggy')], rows, 2000);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0][1]).toHaveLength(REGEX_CHUNK_SIZE);
    expect(spy.mock.calls[1][1]).toHaveLength(1);
    expect(appliedCount).toBe(1);
    expect(categoryIds[REGEX_CHUNK_SIZE]).toBe('cat-1');
  });
});

describe('applyCategoryRules', () => {
  const TX = (overrides: Partial<{ description: string; type: 'INCOME' | 'EXPENSE'; categoryId: string }> = {}) => ({
    description: 'Swiggy order #4471',
    type: 'EXPENSE' as const,
    amount: 500,
    date: new Date('2025-06-01'),
    ...overrides,
  });

  it('applies a matching rule by type + case-insensitive substring', async () => {
    ruleMock.findMany.mockResolvedValue([MOCK_RULE]);
    const { transactions, appliedCount, warnings } = await applyCategoryRules('u1', [TX()]);
    expect(appliedCount).toBe(1);
    expect(transactions[0].categoryId).toBe(MOCK_RULE.categoryId);
    expect(warnings).toEqual([]);
  });

  it('does not apply a rule when the type does not match', async () => {
    ruleMock.findMany.mockResolvedValue([MOCK_RULE]);
    const { transactions, appliedCount } = await applyCategoryRules('u1', [TX({ type: 'INCOME' })]);
    expect(appliedCount).toBe(0);
    expect(transactions[0].categoryId).toBeUndefined();
  });

  it('leaves the transaction unchanged when no pattern matches', async () => {
    ruleMock.findMany.mockResolvedValue([MOCK_RULE]);
    const { transactions, appliedCount } = await applyCategoryRules('u1', [TX({ description: 'Rent payment' })]);
    expect(appliedCount).toBe(0);
    expect(transactions[0]).not.toHaveProperty('categoryId');
  });

  it('never overrides a row that already carries a categoryId', async () => {
    ruleMock.findMany.mockResolvedValue([MOCK_RULE]);
    const { transactions, appliedCount } = await applyCategoryRules('u1', [TX({ categoryId: 'cat-explicit' })]);
    expect(appliedCount).toBe(0);
    expect(transactions[0].categoryId).toBe('cat-explicit');
  });

  it('surfaces skipped-rule warnings', async () => {
    ruleMock.findMany.mockResolvedValue([rule('REGEX', '(')]);
    const { warnings } = await applyCategoryRules('u1', [TX()]);
    expect(warnings).toHaveLength(1);
  });

  it('returns appliedCount 0 with no rules', async () => {
    const { appliedCount } = await applyCategoryRules('u1', [TX()]);
    expect(appliedCount).toBe(0);
  });
});

describe('resolveCategoryForTransaction', () => {
  it('returns the first matching rule category for the owner', async () => {
    ruleMock.findMany.mockResolvedValue([rule('REGEX', '^upi/.*swiggy')]);
    await expect(resolveCategoryForTransaction('u1', { type: 'EXPENSE', description: 'UPI/1/SWIGGY' }))
      .resolves.toBe('cat-1');
    expect(ruleMock.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1' } }));
  });

  it('returns undefined when nothing matches', async () => {
    ruleMock.findMany.mockResolvedValue([rule('KEYWORD', 'swiggy')]);
    await expect(resolveCategoryForTransaction('u1', { type: 'EXPENSE', description: 'Rent' }))
      .resolves.toBeUndefined();
  });

  it('returns undefined for TRANSFER without querying rules', async () => {
    await expect(resolveCategoryForTransaction('u1', { type: 'TRANSFER', description: 'Swiggy' }))
      .resolves.toBeUndefined();
    expect(ruleMock.findMany).not.toHaveBeenCalled();
  });

  it('still resolves (to the next matching rule) when an earlier rule is skipped', async () => {
    ruleMock.findMany.mockResolvedValue([rule('REGEX', '('), rule('KEYWORD', 'swiggy')]);
    await expect(resolveCategoryForTransaction('u1', { type: 'EXPENSE', description: 'Swiggy' }))
      .resolves.toBe('cat-1');
  });
});
