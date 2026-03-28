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
    transferToAccountId?: string; // Double-entry: destination account for TRANSFER type
  },
) {
  if (data.type === 'TRANSFER' && !data.transferToAccountId) {
    throw AppError.badRequest('transferToAccountId is required for TRANSFER transactions');
  }

  return prisma.$transaction(async (tx) => {
    // Validate source account ownership
    if (data.bankAccountId) {
      const account = await tx.bankAccount.findFirst({ where: { id: data.bankAccountId, userId } });
      if (!account) throw AppError.notFound('Bank account');
    }

    // TRANSFER double-entry: create debit on source + credit on destination
    if (data.type === 'TRANSFER' && data.transferToAccountId) {
      const destAccount = await tx.bankAccount.findFirst({ where: { id: data.transferToAccountId, userId } });
      if (!destAccount) throw AppError.notFound('Destination bank account');

      const pairId = crypto.randomUUID();

      // Debit leg (source account)
      const debitTx = await tx.transaction.create({
        data: {
          userId,
          bankAccountId: data.bankAccountId,
          categoryId: data.categoryId,
          amount: data.amount,
          type: 'EXPENSE',
          paymentMode: data.paymentMode as Prisma.EnumPaymentModeFilter['equals'] | undefined,
          description: data.description,
          date: new Date(data.date),
          tags: data.tags ?? [],
          isRecurring: data.isRecurring ?? false,
          gstAmount: data.gstAmount,
          transferPairId: pairId,
        },
      });

      // Credit leg (destination account)
      await tx.transaction.create({
        data: {
          userId,
          bankAccountId: data.transferToAccountId,
          categoryId: data.categoryId,
          amount: data.amount,
          type: 'INCOME',
          description: data.description,
          date: new Date(data.date),
          tags: data.tags ?? [],
          isRecurring: false,
          transferPairId: pairId,
        },
      });

      // Update balances atomically
      if (data.bankAccountId) {
        await tx.bankAccount.update({
          where: { id: data.bankAccountId },
          data: { currentBalance: { decrement: data.amount } },
        });
      }
      await tx.bankAccount.update({
        where: { id: data.transferToAccountId },
        data: { currentBalance: { increment: data.amount } },
      });

      return debitTx;
    }

    // Single-leg transaction (INCOME or EXPENSE)
    const created = await tx.transaction.create({
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

    // Update source account balance (INCOME → +, EXPENSE/TRANSFER → -)
    if (data.bankAccountId) {
      const delta = data.type === 'INCOME' ? data.amount : -data.amount;
      await tx.bankAccount.update({
        where: { id: data.bankAccountId },
        data: { currentBalance: { increment: delta } },
      });
    }

    return created;
  });
}

/** Returns the balance delta for a transaction type. INCOME → positive, EXPENSE/TRANSFER → negative. */
function balanceDelta(type: string, amount: number): number {
  return type === 'INCOME' ? amount : -amount;
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
  return prisma.$transaction(async (ptx) => {
    const original = await ptx.transaction.findUnique({ where: { id: transactionId } });
    if (!original || original.deletedAt) throw AppError.notFound('Transaction');
    if (requesterRole !== 'ADMIN' && original.userId !== userId) throw AppError.forbidden();

    const updated = await ptx.transaction.update({
      where: { id: transactionId },
      data: {
        ...data,
        type: data.type as Prisma.EnumTransactionTypeFilter['equals'] | undefined,
        date: data.date ? new Date(data.date) : undefined,
        updatedAt: new Date(),
      },
    });

    // Recalculate balance impact if account or financial fields changed
    const amountChanged = data.amount !== undefined && data.amount !== Number(original.amount);
    const typeChanged = data.type !== undefined && data.type !== original.type;
    const accountChanged = false; // updateTransaction does not support changing bankAccountId

    if ((amountChanged || typeChanged) && original.bankAccountId) {
      // Reverse the original delta, apply the new delta
      const oldDelta = balanceDelta(original.type, Number(original.amount));
      const newType = data.type ?? original.type;
      const newAmount = data.amount ?? Number(original.amount);
      const newDelta = balanceDelta(newType, newAmount);
      const netChange = newDelta - oldDelta;

      if (netChange !== 0) {
        await ptx.bankAccount.update({
          where: { id: original.bankAccountId },
          data: { currentBalance: { increment: netChange } },
        });
      }
    }

    return updated;
  });
}

export async function softDeleteTransaction(
  transactionId: string,
  userId: string,
  requesterRole: string,
) {
  return prisma.$transaction(async (ptx) => {
    const original = await ptx.transaction.findUnique({ where: { id: transactionId } });
    if (!original || original.deletedAt) throw AppError.notFound('Transaction');
    if (requesterRole !== 'ADMIN' && original.userId !== userId) throw AppError.forbidden();

    const deleted = await ptx.transaction.update({
      where: { id: transactionId },
      data: { deletedAt: new Date() },
    });

    // Reverse the balance impact of this transaction
    if (original.bankAccountId) {
      const reversal = -balanceDelta(original.type, Number(original.amount));
      await ptx.bankAccount.update({
        where: { id: original.bankAccountId },
        data: { currentBalance: { increment: reversal } },
      });
    }

    // Cascade to paired TRANSFER leg (atomically in the same $transaction)
    if (original.transferPairId) {
      const paired = await ptx.transaction.findFirst({
        where: { transferPairId: original.transferPairId, id: { not: transactionId }, deletedAt: null },
      });
      if (paired) {
        await ptx.transaction.update({ where: { id: paired.id }, data: { deletedAt: new Date() } });
        if (paired.bankAccountId) {
          const pairedReversal = -balanceDelta(paired.type, Number(paired.amount));
          await ptx.bankAccount.update({
            where: { id: paired.bankAccountId },
            data: { currentBalance: { increment: pairedReversal } },
          });
        }
      }
    }

    return deleted;
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

export interface ExportFilters {
  fy?: string;
  startDate?: string;
  endDate?: string;
  type?: string;
  categoryId?: string;
  bankAccountId?: string;
}

export async function getAllTransactionsForExport(
  requesterId: string,
  requesterRole: string,
  filters: ExportFilters,
) {
  const userId = requesterRole === 'ADMIN' ? undefined : requesterId;
  const where: Prisma.TransactionWhereInput = {
    ...(userId ? { userId } : {}),
    deletedAt: null,
  };

  if (filters.bankAccountId) where.bankAccountId = filters.bankAccountId;
  if (filters.categoryId) where.categoryId = filters.categoryId;
  if (filters.type) where.type = filters.type as Prisma.EnumTransactionTypeFilter['equals'];

  if (filters.fy) {
    const { start, end } = getFYRange(filters.fy);
    where.date = { gte: start, lte: end };
  } else if (filters.startDate || filters.endDate) {
    where.date = {};
    if (filters.startDate) (where.date as Prisma.DateTimeFilter).gte = new Date(filters.startDate);
    if (filters.endDate) (where.date as Prisma.DateTimeFilter).lte = new Date(filters.endDate);
  }

  return prisma.transaction.findMany({
    where,
    orderBy: { date: 'desc' },
    take: 10_000, // safety cap
    include: {
      category: { select: { name: true } },
      bankAccount: { select: { bankName: true, accountNumberLast4: true } },
    },
  });
}

export function buildCsv(rows: Awaited<ReturnType<typeof getAllTransactionsForExport>>): string {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const headers = ['Date', 'Description', 'Type', 'Amount', 'Category', 'Account', 'PaymentMode', 'Tags'];
  const lines: string[] = [headers.join(',')];
  for (const r of rows) {
    lines.push([
      r.date.toISOString().slice(0, 10),
      escape(r.description),
      r.type,
      Number(r.amount).toFixed(2),
      escape(r.category?.name ?? ''),
      escape(r.bankAccount ? `${r.bankAccount.bankName} ····${r.bankAccount.accountNumberLast4 ?? ''}` : ''),
      escape(r.paymentMode ?? ''),
      escape(r.tags.join(';')),
    ].join(','));
  }
  return lines.join('\r\n');
}
