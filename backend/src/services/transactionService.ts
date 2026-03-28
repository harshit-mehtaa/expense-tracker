import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { AppError } from '../utils/AppError';
import { getFYRange } from '../utils/financialYear';
import { buildPaginationArgs, processPaginationResult } from '../utils/pagination';

export interface TransactionFilters {
  userId?: string;
  bankAccountId?: string;
  categoryId?: string;
  type?: string;
  paymentMode?: string;
  startDate?: string;
  endDate?: string;
  fy?: string;
  search?: string;
  minAmount?: number;
  maxAmount?: number;
  cursor?: string;
  limit?: number;
  sort?: string;
}

export function buildImportHash(
  date: string,
  amount: number,
  description: string,
  accountId: string,
): string {
  const normalized = `${date}|${Math.abs(amount).toFixed(2)}|${description.trim().toLowerCase()}|${accountId}`;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export async function getTransactions(
  requesterId: string,
  requesterRole: string,
  filters: TransactionFilters,
) {
  // Members can only see their own transactions
  const userId = requesterRole === 'ADMIN' && filters.userId ? filters.userId : requesterId;

  const where: Prisma.TransactionWhereInput = {
    userId,
    deletedAt: null,
  };

  if (filters.bankAccountId) where.bankAccountId = filters.bankAccountId;
  if (filters.categoryId) where.categoryId = filters.categoryId;
  if (filters.type) where.type = filters.type as Prisma.EnumTransactionTypeFilter['equals'];
  if (filters.paymentMode) where.paymentMode = filters.paymentMode as Prisma.EnumPaymentModeFilter['equals'];

  if (filters.search) {
    where.description = { contains: filters.search, mode: 'insensitive' };
  }

  // Date range — FY takes precedence over explicit dates
  if (filters.fy) {
    const { start, end } = getFYRange(filters.fy);
    where.date = { gte: start, lte: end };
  } else if (filters.startDate || filters.endDate) {
    where.date = {};
    if (filters.startDate) where.date.gte = new Date(filters.startDate);
    if (filters.endDate) where.date.lte = new Date(filters.endDate);
  }

  if (filters.minAmount !== undefined || filters.maxAmount !== undefined) {
    where.amount = {};
    if (filters.minAmount !== undefined) where.amount.gte = filters.minAmount;
    if (filters.maxAmount !== undefined) where.amount.lte = filters.maxAmount;
  }

  const paginationArgs = buildPaginationArgs({
    cursor: filters.cursor,
    limit: filters.limit,
    sort: filters.sort ?? 'date:desc',
  });

  const total = await prisma.transaction.count({ where });
  const items = await prisma.transaction.findMany({
    where,
    ...paginationArgs,
    include: {
      category: { select: { name: true, color: true, icon: true } },
      bankAccount: { select: { bankName: true, accountNumberLast4: true } },
    },
  });

  const limit = paginationArgs.take - 1;
  return processPaginationResult(items, limit, total);
}

export async function getTransactionById(
  transactionId: string,
  requesterId: string,
  requesterRole: string,
) {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: {
      category: { select: { name: true, color: true, icon: true } },
      bankAccount: { select: { bankName: true, accountNumberLast4: true } },
    },
  });
  if (!tx || tx.deletedAt) throw AppError.notFound('Transaction');
  if (requesterRole !== 'ADMIN' && tx.userId !== requesterId) throw AppError.forbidden();
  return tx;
}

export async function createTransaction(
  userId: string,
  data: {
    bankAccountId?: string;
    categoryId?: string;
    amount: number;
    type: string;
    paymentMode?: string;
    upiIdUsed?: string;
    description: string;
    date: string;
    tags?: string[];
    isRecurring?: boolean;
    gstAmount?: number;
  },
) {
  if (data.bankAccountId) {
    const account = await prisma.bankAccount.findFirst({
      where: { id: data.bankAccountId, userId },
    });
    if (!account) throw AppError.notFound('Bank account');
  }

  return prisma.transaction.create({
    data: {
      userId,
      bankAccountId: data.bankAccountId,
      categoryId: data.categoryId,
      amount: data.amount,
      type: data.type as Prisma.EnumTransactionTypeFilter['equals'],
      paymentMode: data.paymentMode as Prisma.EnumPaymentModeFilter['equals'] | undefined,
      upiIdUsed: data.upiIdUsed,
      description: data.description,
      date: new Date(data.date),
      tags: data.tags ?? [],
      isRecurring: data.isRecurring ?? false,
      gstAmount: data.gstAmount,
      // importHash is null for manual transactions
    },
    include: {
      category: { select: { name: true, color: true } },
      bankAccount: { select: { bankName: true } },
    },
  });
}

export async function updateTransaction(
  transactionId: string,
  userId: string,
  requesterRole: string,
  data: Partial<{
    categoryId: string;
    amount: number;
    type: string;
    paymentMode: string;
    description: string;
    date: string;
    tags: string[];
    gstAmount: number;
  }>,
) {
  const tx = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!tx || tx.deletedAt) throw AppError.notFound('Transaction');
  if (requesterRole !== 'ADMIN' && tx.userId !== userId) throw AppError.forbidden();

  return prisma.transaction.update({
    where: { id: transactionId },
    data: {
      ...data,
      type: data.type as Prisma.EnumTransactionTypeFilter['equals'] | undefined,
      date: data.date ? new Date(data.date) : undefined,
      updatedAt: new Date(),
    },
  });
}

export async function softDeleteTransaction(
  transactionId: string,
  userId: string,
  requesterRole: string,
) {
  const tx = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!tx || tx.deletedAt) throw AppError.notFound('Transaction');
  if (requesterRole !== 'ADMIN' && tx.userId !== userId) throw AppError.forbidden();

  return prisma.transaction.update({
    where: { id: transactionId },
    data: { deletedAt: new Date() },
  });
}

export interface BulkImportRow {
  date: string;
  amount: number;
  type: 'INCOME' | 'EXPENSE';
  description: string;
  categoryId?: string;
  paymentMode?: string;
}

export async function bulkImportTransactions(
  userId: string,
  accountId: string,
  rows: BulkImportRow[],
  bankName: string,
  filename: string,
) {
  const hashed = rows.map((row) => ({
    userId,
    bankAccountId: accountId,
    amount: row.amount,
    type: row.type,
    description: row.description,
    date: new Date(row.date),
    categoryId: row.categoryId,
    paymentMode: row.paymentMode,
    tags: [] as string[],
    importHash: buildImportHash(row.date, row.amount, row.description, accountId),
  }));

  const result = await prisma.transaction.createMany({
    data: hashed,
    skipDuplicates: true, // DB-level dedup on importHash unique constraint
  });

  const skipped = rows.length - result.count;

  await prisma.bankStatementImport.create({
    data: {
      userId,
      bankAccountId: accountId,
      bankName,
      rowCount: rows.length,
      importedCount: result.count,
      duplicatesSkipped: skipped,
      errorsCount: 0,
      filename,
    },
  });

  return {
    importedCount: result.count,
    duplicatesSkipped: skipped,
    errorsCount: 0,
  };
}
