import dayjs from 'dayjs';
import { PaymentMode, Prisma, RecurringFrequency, TransactionType } from '@prisma/client';
import prisma from '../config/prisma';
import { AppError } from '../utils/AppError';
import { ownerScopedWhere } from '../utils/resolveTargetUserId';
import { priceAsOf } from '../utils/subscriptionPricing';

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
          bankAccountId: rule.bankAccountId,
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

      if (rule.bankAccountId) {
        await tx.bankAccount.update({
          where: { id: rule.bankAccountId },
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
