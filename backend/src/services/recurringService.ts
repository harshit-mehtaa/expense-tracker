import dayjs from 'dayjs';
import { PaymentMode, Prisma, RecurringFrequency, TransactionType } from '@prisma/client';
import prisma from '../config/prisma';
import { AppError } from '../utils/AppError';
import { ownerScopedWhere } from '../utils/resolveTargetUserId';

const MAX_CATCH_UP_PER_RULE = 366;
type DueRecurringRule = Prisma.RecurringRuleGetPayload<{ include: { templateTransaction: true } }>;

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

  return prisma.$transaction(async (tx) => {
    const template = await tx.transaction.create({
      data: {
        userId,
        bankAccountId: data.bankAccountId,
        categoryId: data.categoryId,
        amount: data.amount,
        type: data.type as TransactionType,
        paymentMode: data.paymentMode as PaymentMode | undefined,
        description: data.description,
        date: nextRunDate,
        tags: data.tags ?? [],
        isRecurring: true,
        gstAmount: data.gstAmount,
      },
    });

    const rule = await tx.recurringRule.create({
      data: {
        userId,
        templateTransactionId: template.id,
        frequency: data.frequency,
        nextRunDate,
        isActive: true,
      },
      include: {
        templateTransaction: {
          include: { category: { select: { id: true, name: true, color: true, icon: true, parentId: true, parent: { select: { id: true, name: true, icon: true, parentId: true } } } } },
        },
      },
    });

    return rule;
  });
}

export async function listRecurringRules(userId: string) {
  return prisma.recurringRule.findMany({
    where: { userId },
    include: {
      templateTransaction: {
        include: {
          category: { select: { id: true, name: true, color: true, icon: true, parentId: true, parent: { select: { id: true, name: true, icon: true, parentId: true } } } },
          bankAccount: { select: { bankName: true, accountNumberLast4: true } },
        },
      },
    },
    orderBy: { nextRunDate: 'asc' },
  });
}

export async function updateRecurringRule(
  ruleId: string,
  requesterId: string,
  data: Partial<{ frequency: RecurringFrequency; nextRunDate: string; isActive: boolean }>,
  requesterRole = 'MEMBER',
) {
  const rule = await prisma.recurringRule.findFirst({ where: ownerScopedWhere(ruleId, requesterId, requesterRole) });
  if (!rule) throw AppError.notFound('Recurring rule');

  return prisma.recurringRule.update({
    where: { id: ruleId },
    data: {
      ...(data.frequency !== undefined && { frequency: data.frequency }),
      ...(data.nextRunDate !== undefined && { nextRunDate: new Date(data.nextRunDate) }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
    },
    include: {
      templateTransaction: {
        include: { category: { select: { id: true, name: true, color: true, icon: true, parentId: true, parent: { select: { id: true, name: true, icon: true, parentId: true } } } } },
      },
    },
  });
}

export async function deleteRecurringRule(ruleId: string, requesterId: string, requesterRole = 'MEMBER') {
  const rule = await prisma.recurringRule.findFirst({ where: ownerScopedWhere(ruleId, requesterId, requesterRole) });
  if (!rule) throw AppError.notFound('Recurring rule');

  await prisma.$transaction(async (tx) => {
    // Delete rule first (FK constraint: rule references template transaction)
    await tx.recurringRule.delete({ where: { id: ruleId } });
    // Soft-delete the template transaction and clear the recurring flag
    await tx.transaction.update({
      where: { id: rule.templateTransactionId },
      data: { deletedAt: new Date(), isRecurring: false },
    });
  });
}

function transactionBalanceDelta(type: string, amount: Prisma.Decimal | number): number {
  const value = Number(amount);
  return type === 'INCOME' ? value : -value;
}

async function generateRuleCatchUp(rule: DueRecurringRule, now: Date): Promise<number> {
  const template = rule.templateTransaction;
  if (template.deletedAt) return 0;

  let generated = 0;
  let runDate = rule.nextRunDate;

  while (runDate <= now && generated < MAX_CATCH_UP_PER_RULE) {
    const dueDate = runDate;
    const nextRunDate = advanceDate(dueDate, rule.frequency);

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
          userId: template.userId,
          bankAccountId: template.bankAccountId,
          categoryId: template.categoryId,
          amount: template.amount,
          type: template.type,
          paymentMode: template.paymentMode,
          description: template.description,
          date: dueDate,
          tags: template.tags,
          isRecurring: false,
          gstAmount: template.gstAmount,
        },
      });

      if (template.bankAccountId) {
        await tx.bankAccount.update({
          where: { id: template.bankAccountId },
          data: { currentBalance: { increment: transactionBalanceDelta(template.type, template.amount) } },
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
    include: { templateTransaction: true },
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
