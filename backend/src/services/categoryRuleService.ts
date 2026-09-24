import { CategoryRuleMatchType, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { ownerScopedWhere } from '../utils/resolveTargetUserId';
import { compileStoredPattern, compileUserPattern, testAllWithTimeout } from '../utils/safeRegex';
import type { ParsedTransaction } from './importService';

// Bounds the per-request cost of rule evaluation: at most MAX_RULES_PER_USER rules, and
// regex rules share one wall-clock budget per call. A statement import gets more room
// than a single create because it evaluates thousands of rows in one request.
export const MAX_RULES_PER_USER = 100;
export const SINGLE_TRANSACTION_BUDGET_MS = 500;
export const IMPORT_BUDGET_MS = 2000;
// Per-vm-call row count and timeout. Chunking keeps one slow-but-legitimate regex over a
// 50k-row import from being judged by a single 250ms call over every row.
export const REGEX_CHUNK_SIZE = 2000;
export const REGEX_CHUNK_TIMEOUT_MS = 250;

// Rules whose regex hit the vm timeout. Per-request budgets alone don't bound the total
// cost: a catastrophic rule would burn its full timeout (blocking the event loop) on
// EVERY create and import. Remembering it makes that a one-time cost per process.
// Keyed by id alone — patterns are immutable (no update endpoint); delete forgets it.
const timedOutRuleIds = new Set<string>();

const categoryInclude = {
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
} as const;

function normalizePattern(matchType: CategoryRuleMatchType, pattern: string): string {
  const trimmed = pattern.trim();
  // Lowercasing a regex changes its meaning (\D → \d, \S → \s), so only keywords are folded.
  return matchType === CategoryRuleMatchType.KEYWORD ? trimmed.toLowerCase() : trimmed;
}

/**
 * The user's rules in EVALUATION order — the UI lists them in this order too, so what a
 * user sees is what runs: regex rules first, oldest-first, then keyword rules
 * alphabetically (the pre-regex behavior). Regexes go first because they are the precise,
 * opt-in rules — otherwise a broad keyword like `upi` would permanently shadow
 * `^upi/p2m/.*swiggy`. They are not sorted by pattern: collation would rank `^upi` /
 * `\w` / `Zomato` ahead of `swiggy` for reasons no user could predict.
 */
export async function listCategoryRules(userId: string) {
  const rules = await prisma.categoryRule.findMany({
    where: { userId },
    include: categoryInclude,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const regexRules = rules.filter((r) => r.matchType === CategoryRuleMatchType.REGEX);
  const keywordRules = rules
    .filter((r) => r.matchType === CategoryRuleMatchType.KEYWORD)
    // Never equal: (userId, matchType, pattern) is unique.
    .sort((a, b) => (a.pattern < b.pattern ? -1 : 1));
  return [...regexRules, ...keywordRules];
}

export async function createCategoryRule(
  userId: string,
  data: { matchType?: CategoryRuleMatchType; pattern: string; categoryId: string },
) {
  const matchType = data.matchType ?? CategoryRuleMatchType.KEYWORD;
  const pattern = normalizePattern(matchType, data.pattern);
  if (!pattern) throw AppError.badRequest('Pattern is required');
  if (matchType === CategoryRuleMatchType.REGEX) compileUserPattern(pattern);

  // A soft cap: concurrent creates can overshoot it slightly, which is harmless — it exists
  // to bound per-request evaluation cost, not as an invariant.
  const existingCount = await prisma.categoryRule.count({ where: { userId } });
  if (existingCount >= MAX_RULES_PER_USER) {
    throw AppError.badRequest(`You can have at most ${MAX_RULES_PER_USER} auto-categorization rules`);
  }

  const category = await prisma.category.findFirst({
    where: { id: data.categoryId, type: { in: ['INCOME', 'EXPENSE'] } },
  });
  if (!category) throw AppError.notFound('Category');

  try {
    return await prisma.categoryRule.create({
      data: { userId, matchType, pattern, categoryId: data.categoryId },
      include: categoryInclude,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw AppError.conflict(`A ${matchType.toLowerCase()} rule for "${pattern}" already exists`);
    }
    throw err;
  }
}

export async function deleteCategoryRule(userId: string, ruleId: string, requesterRole = 'MEMBER') {
  const rule = await prisma.categoryRule.findFirst({ where: ownerScopedWhere(ruleId, userId, requesterRole) });
  if (!rule) throw AppError.notFound('Category rule');
  const deleted = await prisma.categoryRule.delete({ where: { id: ruleId } });
  timedOutRuleIds.delete(ruleId);
  return deleted;
}

interface MatchableRule {
  id: string;
  matchType: CategoryRuleMatchType;
  pattern: string;
  categoryId: string;
  category: { type: string };
}

interface MatchableRow {
  description: string;
  type: string;
}

const SKIP_REASONS = {
  invalid: 'was skipped: it is not a valid regular expression',
  timeout: 'was skipped: it takes too long to evaluate — simplify or delete it',
  budget: 'was not evaluated: earlier rules used up the time budget',
  error: 'was skipped: it could not be evaluated',
} as const;

function skippedWarning(rule: MatchableRule, reason: keyof typeof SKIP_REASONS): string {
  return `Auto-categorization rule /${rule.pattern}/ ${SKIP_REASONS[reason]}.`;
}

/**
 * Indices of `candidates` whose description matches the regex rule, or a warning if the
 * rule had to be skipped. Never throws — a bad rule must not fail the transaction.
 */
function regexMatches(
  rule: MatchableRule,
  rows: MatchableRow[],
  candidates: number[],
  deadline: number,
): number[] | string {
  if (timedOutRuleIds.has(rule.id)) return skippedWarning(rule, 'timeout');
  const re = compileStoredPattern(rule.pattern);
  if (!re) return skippedWarning(rule, 'invalid');

  const matched: number[] = [];
  for (let start = 0; start < candidates.length; start += REGEX_CHUNK_SIZE) {
    const chunk = candidates.slice(start, start + REGEX_CHUNK_SIZE);
    const remaining = deadline - Date.now();
    // Out of budget is not this rule's fault — skip it now, but don't remember it.
    if (remaining <= 0) return skippedWarning(rule, 'budget');
    const results = testAllWithTimeout(
      re,
      chunk.map((i) => rows[i].description),
      Math.min(REGEX_CHUNK_TIMEOUT_MS, remaining),
    );
    // A partial match set would categorize an arbitrary prefix of the import, so a
    // failure in any chunk discards the whole rule.
    if (results === 'timeout') {
      timedOutRuleIds.add(rule.id);
      // Once per rule (it's never re-run), by id only — descriptions are financial PII.
      console.warn('[categoryRules] regex rule timed out; skipping it until deleted or restart', { ruleId: rule.id });
      return skippedWarning(rule, 'timeout');
    }
    if (results === 'error') return skippedWarning(rule, 'error');
    chunk.forEach((rowIndex, j) => {
      if (results[j]) matched.push(rowIndex);
    });
  }
  return matched;
}

/**
 * THE matcher — every auto-categorization path goes through here. Rules are tried in
 * order; each row takes the category of the first rule that matches it, and only rules
 * whose category type equals the row's type (INCOME/EXPENSE) are considered.
 */
export function matchRules(
  rules: MatchableRule[],
  rows: MatchableRow[],
  budgetMs: number,
): { categoryIds: Array<string | undefined>; appliedCount: number; warnings: string[] } {
  const categoryIds: Array<string | undefined> = rows.map(() => undefined);
  const warnings: string[] = [];
  const deadline = Date.now() + budgetMs;
  let appliedCount = 0;

  for (const rule of rules) {
    const candidates = rows.flatMap((row, i) => (
      categoryIds[i] === undefined && row.type === rule.category.type ? [i] : []
    ));
    if (candidates.length === 0) continue;

    let matched: number[] | string;
    if (rule.matchType === CategoryRuleMatchType.KEYWORD) {
      matched = candidates.filter((i) => rows[i].description.toLowerCase().includes(rule.pattern));
    } else {
      matched = regexMatches(rule, rows, candidates, deadline);
    }

    if (typeof matched === 'string') {
      warnings.push(matched);
      continue;
    }
    for (const i of matched) categoryIds[i] = rule.categoryId;
    appliedCount += matched.length;
  }

  return { categoryIds, appliedCount, warnings };
}

/** Statement import: categorize parsed rows that don't already carry a category. */
export async function applyCategoryRules(
  userId: string,
  transactions: ParsedTransaction[],
): Promise<{
  transactions: Array<ParsedTransaction & { categoryId?: string }>;
  appliedCount: number;
  warnings: string[];
}> {
  const rules = await listCategoryRules(userId);
  const uncategorized = transactions.flatMap((tx, i) => (tx.categoryId ? [] : [i]));
  const { categoryIds, appliedCount, warnings } = matchRules(
    rules,
    uncategorized.map((i) => transactions[i]),
    IMPORT_BUDGET_MS,
  );

  const categorized = [...transactions];
  uncategorized.forEach((txIndex, j) => {
    const categoryId = categoryIds[j];
    if (categoryId) categorized[txIndex] = { ...transactions[txIndex], categoryId };
  });

  return { transactions: categorized, appliedCount, warnings };
}

/**
 * Single transaction created without a category: the owner's first matching rule, if any.
 * TRANSFERs are never categorized.
 */
export async function resolveCategoryForTransaction(
  userId: string,
  tx: { type: string; description: string },
): Promise<string | undefined> {
  if (tx.type !== 'INCOME' && tx.type !== 'EXPENSE') return undefined;
  const rules = await listCategoryRules(userId);
  // Skip warnings are dropped here (a single create has nowhere to show them); a timeout
  // is logged once at its source in regexMatches.
  const { categoryIds } = matchRules(rules, [tx], SINGLE_TRANSACTION_BUDGET_MS);
  return categoryIds[0];
}
