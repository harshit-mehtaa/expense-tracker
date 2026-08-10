import { TransactionType, type Prisma } from '@prisma/client';
import prisma from '../config/prisma';

export function reportingTransactionWhere(
  userFilter: Prisma.TransactionWhereInput = {},
  date?: Prisma.DateTimeFilter,
): Prisma.TransactionWhereInput {
  return {
    ...userFilter,
    deletedAt: null,
    transferPairId: null,
    sipId: null,
    ...(date ? { date } : {}),
  };
}

export function reportingIncomeWhere(
  userFilter: Prisma.TransactionWhereInput = {},
  date?: Prisma.DateTimeFilter,
): Prisma.TransactionWhereInput {
  return {
    ...reportingTransactionWhere(userFilter, date),
    type: TransactionType.INCOME,
    refundForTransactionId: null,
  };
}

export function reportingExpenseWhere(
  userFilter: Prisma.TransactionWhereInput = {},
  date?: Prisma.DateTimeFilter,
): Prisma.TransactionWhereInput {
  return {
    ...reportingTransactionWhere(userFilter, date),
    type: TransactionType.EXPENSE,
  };
}

export function reportingRefundWhere(
  userFilter: Prisma.TransactionWhereInput = {},
  date?: Prisma.DateTimeFilter,
): Prisma.TransactionWhereInput {
  return {
    ...reportingTransactionWhere(userFilter, date),
    type: TransactionType.INCOME,
    refundForTransactionId: { not: null },
  };
}

export async function getNetExpenseTotal(
  userFilter: Prisma.TransactionWhereInput,
  date: Prisma.DateTimeFilter,
): Promise<number> {
  const [expenses, refunds] = await Promise.all([
    prisma.transaction.aggregate({
      where: reportingExpenseWhere(userFilter, date),
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: reportingRefundWhere(userFilter, date),
      _sum: { amount: true },
    }),
  ]);

  return Number(expenses._sum.amount ?? 0) - Number(refunds._sum.amount ?? 0);
}

export async function getNetExpenseByUserCategory(
  userFilter: Prisma.TransactionWhereInput,
  date: Prisma.DateTimeFilter,
  categoryIds?: string[],
): Promise<Map<string, number>> {
  const categoryFilter = categoryIds?.length ? { categoryId: { in: categoryIds } } : {};
  const [expenses, refunds] = await Promise.all([
    prisma.transaction.groupBy({
      by: ['userId', 'categoryId'],
      where: {
        ...reportingExpenseWhere(userFilter, date),
        ...categoryFilter,
      },
      _sum: { amount: true },
    }),
    prisma.transaction.findMany({
      where: {
        ...reportingRefundWhere(userFilter, date),
        ...(categoryIds?.length
          ? { refundFor: { is: { categoryId: { in: categoryIds } } } }
          : {}),
      },
      select: {
        amount: true,
        userId: true,
        refundFor: { select: { userId: true, categoryId: true } },
      },
    }),
  ]);

  const totals = new Map<string, number>();
  const keyFor = (userId: string, categoryId: string | null) => `${userId}:${categoryId ?? ''}`;

  for (const row of expenses) {
    const key = keyFor(row.userId, row.categoryId);
    totals.set(key, (totals.get(key) ?? 0) + Number(row._sum.amount ?? 0));
  }

  for (const refund of refunds) {
    const ownerId = refund.refundFor?.userId ?? refund.userId;
    const key = keyFor(ownerId, refund.refundFor?.categoryId ?? null);
    totals.set(key, (totals.get(key) ?? 0) - Number(refund.amount));
  }

  return totals;
}
