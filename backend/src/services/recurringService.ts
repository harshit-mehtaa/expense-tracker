import dayjs from 'dayjs';
import { PaymentMode, Prisma, RecurringFrequency, TransactionType } from '@prisma/client';
import prisma from '../config/prisma';
import { AppError } from '../utils/AppError';
import { ensureCashAccount } from './accountService';
import { ownerScopedWhere } from '../utils/resolveTargetUserId';
import { priceAsOf } from '../utils/subscriptionPricing';
import { anchorCutoff } from '../utils/financialYear';

const MAX_CATCH_UP_PER_RULE = 366;

const ruleInclude = {
  category: { select: { id: true, name: true, color: true, icon: true, parentId: true, parent: { select: { id: true, name: true, icon: true, parentId: true } } } },
  bankAccount: { select: { bankName: true, accountNumberLast4: true } },
} as const;
type DueRecurringRule = Prisma.RecurringRuleGetPayload<{
  include: { subscription: { include: { prices: true } } };
}>;

function advanceDate(date: Date, frequency: RecurringFrequency): Date {
  const d = dayjs(date);
  switch (frequency) {
    case 'DAILY':     return d.add(1, 'day').toDate();
    case 'WEEKLY':    return d.add(7, 'day').toDate();
    case 'MONTHLY':   return d.add(1, 'month').toDate();
    case 'QUARTERLY': return d.add(3, 'month').toDate();
    case 'YEARLY':    return d.add(1, 'year').toDate();
  }
}

export interface CreateRecurringRuleInput {
  bankAccountId?: string;
  categoryId?: string;
  amount: number;
  type: string;
  paymentMode?: string;
  description: string;
  tags?: string[];
  gstAmount?: number;
  frequency: RecurringFrequency;
  nextRunDate?: string; // ISO date; defaults to today
}

export async function createRecurringRule(userId: string, data: CreateRecurringRuleInput) {
  const nextRunDate = data.nextRunDate ? new Date(data.nextRunDate) : new Date();

  // One row. The spec used to be written as a Transaction as well, which put a charge
  // that never happened into the ledger and every aggregate built on it.
  return prisma.recurringRule.create({
    data: {
      userId,
      frequency: data.frequency,
      nextRunDate,
      isActive: true,
      amount: data.amount,
      type: data.type as TransactionType,
      description: data.description,
      categoryId: data.categoryId ?? null,
      bankAccountId: data.bankAccountId ?? null,
      paymentMode: (data.paymentMode as PaymentMode | undefined) ?? null,
      tags: data.tags ?? [],
      gstAmount: data.gstAmount ?? null,
    },
    include: ruleInclude,
  });
}

export async function listRecurringRules(userId: string) {
  return prisma.recurringRule.findMany({
    where: { userId },
    include: ruleInclude,
    orderBy: { nextRunDate: 'asc' },
  });
}

/**
 * A rule owned by a Subscription must only be changed through subscriptionService.
 *
 * This is what stops the same charge having two sources of truth. Editing the rule
 * directly would move the money without touching the subscription's price history, so
 * the recorded price and the amount actually charged would silently diverge — and
 * deleting the rule would leave the subscription pointing at nothing while still
 * displaying a renewal date.
 */
function assertNotSubscriptionOwned(rule: { subscriptionId: string | null }) {
  if (rule.subscriptionId) {
    throw AppError.conflict(
      'This rule belongs to a subscription. Edit or cancel the subscription instead.',
    );
  }
}

export async function updateRecurringRule(
  ruleId: string,
  requesterId: string,
  data: Partial<{ frequency: RecurringFrequency; nextRunDate: string; isActive: boolean }>,
  requesterRole = 'MEMBER',
) {
  const rule = await prisma.recurringRule.findFirst({ where: ownerScopedWhere(ruleId, requesterId, requesterRole) });
  if (!rule) throw AppError.notFound('Recurring rule');
  assertNotSubscriptionOwned(rule);

  return prisma.recurringRule.update({
    where: { id: ruleId },
    data: {
      ...(data.frequency !== undefined && { frequency: data.frequency }),
      ...(data.nextRunDate !== undefined && { nextRunDate: new Date(data.nextRunDate) }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
    },
    include: ruleInclude,
  });
}

export async function deleteRecurringRule(ruleId: string, requesterId: string, requesterRole = 'MEMBER') {
  const rule = await prisma.recurringRule.findFirst({ where: ownerScopedWhere(ruleId, requesterId, requesterRole) });
  if (!rule) throw AppError.notFound('Recurring rule');
  assertNotSubscriptionOwned(rule);

  // A single row now — there is no ledger-visible template to clean up, and no
  // transaction wrapper needed to keep the two consistent.
  await prisma.recurringRule.delete({ where: { id: ruleId } });
}

function transactionBalanceDelta(type: string, amount: Prisma.Decimal | number): number {
  const value = Number(amount);
  return type === 'INCOME' ? value : -value;
}

async function generateRuleCatchUp(rule: DueRecurringRule, now: Date): Promise<number> {
  const subscription = rule.subscription;
  const prices = subscription
    ? subscription.prices.map((p) => ({ amount: Number(p.amount), effectiveFrom: p.effectiveFrom }))
    : [];

  let generated = 0;
  let runDate = rule.nextRunDate;
  // Cached across iterations — the resolved account (and its anchor, if any) doesn't
  // change mid-run. `undefined` = not yet resolved, `null` = resolved and has no anchor.
  let cachedAnchorCutoff: Date | null | undefined;

  while (runDate <= now && generated < MAX_CATCH_UP_PER_RULE) {
    const dueDate = runDate;
    const nextRunDate = advanceDate(dueDate, rule.frequency);

    // A subscription is billed at the price in effect on the DUE DATE, not today's
    // price. Without this, catching up across a price rise would repost months that
    // already happened at an amount that was never charged.
    //
    // Resolution is a pure lookup over the already-loaded history, so nothing is added
    // inside the atomic block below.
    let amount = rule.amount;
    if (subscription) {
      const resolved = priceAsOf(prices, dueDate);
      // Stop rather than guess. A subscription with no price covering this date is bad
      // data, and inventing an amount would write it silently into the ledger.
      //
      // Log rather than throw: throwing here would abort the whole run and stop every
      // OTHER rule this user has from generating. But it must not be silent either — a
      // subscription that quietly stops billing looks identical to one that is simply
      // not due, and nobody would notice for months.
      if (resolved === null) {
        console.error(
          '[recurring] subscription has no price covering its due date; billing stopped',
          { subscriptionId: rule.subscriptionId, ruleId: rule.id, dueDate: dueDate.toISOString() },
        );
        break;
      }
      amount = new Prisma.Decimal(resolved);
    }

    // Same gap createTransaction closes for manual entries: a CASH-paymentMode rule with
    // no linked account otherwise moves no money. Resolved outside the $transaction, like
    // the price lookup above — self-healing (provisions the cash account if missing,
    // e.g. a pre-feature user never backfilled) rather than a permanent stall.
    //
    // Log rather than throw, for the same reason as the missing-price case above: throwing
    // would abort the whole run and stop every OTHER rule this user has from generating.
    let resolvedBankAccountId = rule.bankAccountId;
    if (!resolvedBankAccountId && rule.paymentMode === PaymentMode.CASH) {
      try {
        const cashAccount = await ensureCashAccount(prisma, rule.userId);
        resolvedBankAccountId = cashAccount.id;
      } catch (err) {
        console.error(
          '[recurring] failed to resolve a cash account for a CASH-paymentMode rule; billing stopped',
          { ruleId: rule.id, userId: rule.userId, dueDate: dueDate.toISOString(), error: err instanceof Error ? err.message : err },
        );
        break;
      }
    }

    if (cachedAnchorCutoff === undefined) {
      cachedAnchorCutoff = null;
      if (resolvedBankAccountId) {
        const acct = await prisma.bankAccount.findUnique({
          where: { id: resolvedBankAccountId },
          select: { openingBalanceDate: true },
        });
        cachedAnchorCutoff = anchorCutoff(acct?.openingBalanceDate ?? null);
      }
    }
    // Same reasoning as the missing-price and cash-resolve-failure breaks above: a due
    // date on/before the account's opening-balance anchor can't be generated (the anchor
    // asserts everything before it is superseded), and throwing would abort every OTHER
    // rule this user has, so this rule's catch-up stops here rather than skipping ahead.
    if (cachedAnchorCutoff && dueDate <= cachedAnchorCutoff) {
      console.error(
        '[recurring] due date is on/before the account\'s opening-balance anchor; billing stopped',
        { ruleId: rule.id, userId: rule.userId, dueDate: dueDate.toISOString() },
      );
      break;
    }

    const created = await prisma.$transaction(async (tx) => {
      const { count } = await tx.recurringRule.updateMany({
        where: {
          id: rule.id,
          isActive: true,
          nextRunDate: dueDate,
        },
        data: { nextRunDate },
      });
      if (count === 0) return false;

      await tx.transaction.create({
        data: {
          userId: rule.userId,
          bankAccountId: resolvedBankAccountId,
          categoryId: rule.categoryId,
          amount,
          type: rule.type,
          paymentMode: rule.paymentMode,
          description: rule.description,
          date: dueDate,
          tags: rule.tags,
          isRecurring: false,
          gstAmount: rule.gstAmount,
          subscriptionId: rule.subscriptionId,
        },
      });

      // The first real charge means the trial converted. Doing it here, inside the same
      // transaction as the charge, keeps status and money from disagreeing.
      if (subscription && subscription.status === 'TRIALING') {
        await tx.subscription.update({
          where: { id: subscription.id },
          data: { status: 'ACTIVE' },
        });
        // Update the in-memory snapshot too, or a multi-month catch-up repeats this
        // identical write once per occurrence.
        subscription.status = 'ACTIVE';
      }

      if (resolvedBankAccountId) {
        await tx.bankAccount.update({
          where: { id: resolvedBankAccountId },
          data: { currentBalance: { increment: transactionBalanceDelta(rule.type, amount) } },
        });
      }

      return true;
    });

    if (!created) break;
    generated++;
    runDate = nextRunDate;
  }

  return generated;
}

/**
 * Generates all missed recurring transactions for a user.
 * Race-condition safe: each occurrence advances nextRunDate with an atomic
 * guard before the transaction is created, so concurrent jobs cannot duplicate.
 */
export async function generateDueRecurringTransactions(userId: string): Promise<{ generated: number }> {
  const now = new Date();

  // Find all potentially due rules (pre-filter; final guard is in the atomic update below)
  const dueRules = await prisma.recurringRule.findMany({
    where: { userId, isActive: true, nextRunDate: { lte: now } },
    include: { subscription: { include: { prices: true } } },
  });

  let generated = 0;
  for (const rule of dueRules) generated += await generateRuleCatchUp(rule, now);

  return { generated };
}

export async function generateDueRecurringTransactionsForAllUsers(): Promise<{ generated: number; usersProcessed: number }> {
  const users = await prisma.user.findMany({
    where: { isActive: true, deletedAt: null },
    select: { id: true },
  });

  let generated = 0;
  for (const user of users) {
    const result = await generateDueRecurringTransactions(user.id);
    generated += result.generated;
  }

  return { generated, usersProcessed: users.length };
}
