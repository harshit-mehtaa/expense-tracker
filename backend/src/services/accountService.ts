import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { AppError } from '../utils/AppError';

export async function getAccounts(userId: string | undefined, requesterId: string, requesterRole: string) {
  // MEMBER: always own accounts only
  if (requesterRole !== 'ADMIN') {
    return prisma.bankAccount.findMany({
      where: { userId: requesterId, isActive: true },
      orderBy: { bankName: 'asc' },
    });
  }

  // ADMIN viewing a specific member
  if (userId) {
    return prisma.bankAccount.findMany({
      where: { userId, isActive: true },
      orderBy: { bankName: 'asc' },
    });
  }

  // ADMIN family-wide: all accounts for active users, include owner name
  const accounts = await prisma.bankAccount.findMany({
    where: { isActive: true, user: { isActive: true, deletedAt: null } },
    include: { user: { select: { name: true } } },
    orderBy: [{ user: { name: 'asc' } }, { bankName: 'asc' }],
  });

  return accounts.map(({ user, ...rest }) => ({ ...rest, userName: user?.name ?? '' }));
}

export async function getAccountById(accountId: string, requesterId: string, requesterRole: string) {
  const account = await prisma.bankAccount.findUnique({ where: { id: accountId } });
  if (!account) throw AppError.notFound('Account');
  if (requesterRole !== 'ADMIN' && account.userId !== requesterId) {
    throw AppError.forbidden();
  }
  return account;
}

export async function createAccount(
  userId: string,
  data: {
    bankName: string;
    ifscPrefix?: string;
    accountNumberLast4?: string;
    accountType: string;
    currentBalance?: number;
    currency?: string;
    interestRate?: number;
    maturityDate?: string;
    upiId?: string;
  },
) {
  return prisma.bankAccount.create({
    data: {
      userId,
      bankName: data.bankName,
      ifscPrefix: data.ifscPrefix,
      accountNumberLast4: data.accountNumberLast4,
      accountType: data.accountType as Prisma.EnumAccountTypeFilter['equals'],
      currentBalance: data.currentBalance ?? 0,
      currency: data.currency ?? 'INR',
      interestRate: data.interestRate,
      maturityDate: data.maturityDate ? new Date(data.maturityDate) : undefined,
      upiId: data.upiId,
    },
  });
}

export async function updateAccount(
  accountId: string,
  requesterId: string,
  requesterRole: string,
  data: Partial<{
    bankName: string;
    currentBalance: number;
    upiId: string;
    isActive: boolean;
    interestRate: number;
    maturityDate: string;
  }>,
) {
  await getAccountById(accountId, requesterId, requesterRole);

  return prisma.bankAccount.update({
    where: { id: accountId },
    data: {
      ...data,
      maturityDate: data.maturityDate ? new Date(data.maturityDate) : undefined,
      updatedAt: new Date(),
    },
  });
}

export async function reconcileAccount(
  accountId: string,
  requesterId: string,
  requesterRole: string,
  actualBalance: number,
  note?: string,
) {
  const account = await getAccountById(accountId, requesterId, requesterRole);

  return prisma.$transaction(async (tx) => {
    const currentBalance = Number(account.currentBalance);
    const delta = actualBalance - currentBalance;

    // Create a correction transaction only if there's a discrepancy
    if (delta !== 0) {
      await tx.transaction.create({
        data: {
          userId: account.userId,
          bankAccountId: accountId,
          amount: Math.abs(delta),
          type: delta > 0 ? 'INCOME' : 'EXPENSE',
          description: note ?? 'Balance Reconciliation',
          date: new Date(),
          tags: ['reconciliation'],
        },
      });
    }

    // Set balance directly to the confirmed actual value
    return tx.bankAccount.update({
      where: { id: accountId },
      data: { currentBalance: actualBalance },
    });
  });
}

export async function deleteAccount(accountId: string, requesterId: string, requesterRole: string) {
  await getAccountById(accountId, requesterId, requesterRole);

  // Soft-delete: set isActive = false
  return prisma.bankAccount.update({
    where: { id: accountId },
    data: { isActive: false },
  });
}
