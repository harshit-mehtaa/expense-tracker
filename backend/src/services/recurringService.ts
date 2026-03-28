import dayjs from 'dayjs';
import { Prisma, RecurringFrequency } from '@prisma/client';
import prisma from '../config/prisma';
import { AppError } from '../utils/AppError';

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
        type: data.type as Prisma.EnumTransactionTypeFilter['equals'],
        paymentMode: data.paymentMode as Prisma.EnumPaymentModeFilter['equals'] | undefined,
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
          include: { category: { select: { name: true, color: true } } },
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
          category: { select: { id: true, name: true, color: true, icon: true } },
          bankAccount: { select: { bankName: true, accountNumberLast4: true } },
        },
      },
    },
    orderBy: { nextRunDate: 'asc' },
  });
}

export async function updateRecurringRule(
  ruleId: string,
  userId: string,
  data: Partial<{ frequency: RecurringFrequency; nextRunDate: string; isActive: boolean }>,
) {
  const rule = await prisma.recurringRule.findFirst({ where: { id: ruleId, userId } });
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
        include: { category: { select: { name: true, color: true } } },
      },
    },
  });
}

export async function deleteRecurringRule(ruleId: string, userId: string) {
  const rule = await prisma.recurringRule.findFirst({ where: { id: ruleId, userId } });
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

/**
 * Generates transactions for all due recurring rules for a user.
 * Race-condition safe: uses an atomic updateMany with a nextRunDate guard
 * so concurrent calls (e.g. two dashboard loads) cannot generate duplicates.
 */
export async function generateDueRecurringTransactions(userId: string): Promise<{ generated: number }> {
  const now = new Date();

  // Find all potentially due rules (pre-filter; final guard is in the atomic update below)
  const dueRules = await prisma.recurringRule.findMany({
    where: { userId, isActive: true, nextRunDate: { lte: now } },
    include: { templateTransaction: true },
  });

  let generated = 0;

  for (const rule of dueRules) {
    const template = rule.templateTransaction;
    if (template.deletedAt) continue; // Template was deleted; skip silently

    const nextNextRunDate = advanceDate(rule.nextRunDate, rule.frequency);

    // Atomic guard: only advance nextRunDate if it hasn't been changed by a concurrent request
    const { count } = await prisma.recurringRule.updateMany({
      where: {
        id: rule.id,
        isActive: true,
        nextRunDate: rule.nextRunDate, // Must still match — prevents duplicate generation
      },
      data: { nextRunDate: nextNextRunDate },
    });

    if (count === 0) continue; // Another request already ran this rule — skip

    // Create the generated transaction (copy of template, not itself a template)
    await prisma.transaction.create({
      data: {
        userId: template.userId,
        bankAccountId: template.bankAccountId,
        categoryId: template.categoryId,
        amount: template.amount,
        type: template.type,
        paymentMode: template.paymentMode,
        description: template.description,
        date: rule.nextRunDate, // Use the original due date, not "now"
        tags: template.tags,
        isRecurring: false,
        gstAmount: template.gstAmount,
      },
    });

    generated++;
  }

  return { generated };
}
