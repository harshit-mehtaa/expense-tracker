import { AccountType } from '@prisma/client';
import prisma from '../config/prisma';
import { AppError } from '../utils/AppError';

function normalizeAccountNumber(value: string | undefined): string | undefined {
  const normalized = value?.replace(/[\s-]/g, '').trim();
  return normalized || undefined;
}

function normalizeIfscCode(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s/g, '').trim().toUpperCase();
  return normalized || undefined;
}

function normalizeIfscPrefix(value: string | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase();
  return normalized || undefined;
}

function getIfscPrefix(value: string | undefined): string | undefined {
  return value ? value.slice(0, 4) : undefined;
}

function getLast4(value: string | undefined): string | undefined {
  return value ? value.slice(-4) : undefined;
}

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
    include: { user: { select: { name: true, colorTag: true } } },
    orderBy: [{ user: { name: 'asc' } }, { bankName: 'asc' }],
  });

  return accounts.map(({ user, ...rest }) => ({
    ...rest,
    userName: user?.name ?? '',
    userColorTag: user?.colorTag ?? null,
  }));
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
    ifscCode?: string;
    accountNumber?: string;
    accountNumberLast4?: string;
    accountType: string;
    currentBalance?: number;
    currency?: string;
    interestRate?: number;
    creditLimit?: number;
    billingCycleStartDay?: number;
    billingCycleEndDay?: number;
    paymentDueDay?: number;
    maturityDate?: string;
    upiId?: string;
  },
) {
  const accountNumber = normalizeAccountNumber(data.accountNumber);
  const ifscCode = normalizeIfscCode(data.ifscCode);
  return prisma.bankAccount.create({
    data: {
      userId,
      bankName: data.bankName,
      ifscPrefix: getIfscPrefix(ifscCode) ?? normalizeIfscPrefix(data.ifscPrefix),
      ifscCode,
      accountNumber,
      accountNumberLast4: getLast4(accountNumber) ?? data.accountNumberLast4,
      accountType: data.accountType as AccountType,
      currentBalance: data.currentBalance ?? 0,
      currency: data.currency ?? 'INR',
      interestRate: data.interestRate,
      creditLimit: data.creditLimit,
      billingCycleStartDay: data.billingCycleStartDay,
      billingCycleEndDay: data.billingCycleEndDay,
      paymentDueDay: data.paymentDueDay,
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
    ifscPrefix: string;
    ifscCode: string;
    accountNumber: string;
    accountNumberLast4: string;
    currentBalance: number;
    upiId: string;
    isActive: boolean;
    interestRate: number;
    creditLimit: number;
    billingCycleStartDay: number;
    billingCycleEndDay: number;
    paymentDueDay: number;
    maturityDate: string;
  }>,
) {
  await getAccountById(accountId, requesterId, requesterRole);
  const accountNumber = data.accountNumber !== undefined ? normalizeAccountNumber(data.accountNumber) : undefined;
  const ifscCode = data.ifscCode !== undefined ? normalizeIfscCode(data.ifscCode) : undefined;

  return prisma.bankAccount.update({
    where: { id: accountId },
    data: {
      ...data,
      ...(data.ifscCode !== undefined && {
        ifscCode,
        ifscPrefix: getIfscPrefix(ifscCode),
      }),
      ...(data.accountNumber !== undefined && {
        accountNumber,
        accountNumberLast4: getLast4(accountNumber),
      }),
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
