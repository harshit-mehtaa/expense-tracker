import { AccountType, Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { AppError } from '../utils/AppError';

// Idempotent: finds the user's existing cash account or creates it. Must be called with
// a transactional client (tx) so "user created but no cash account" can never happen.
// The findFirst-then-create window is not perfectly race-proof under concurrent calls for
// the same userId — a Postgres partial unique index backs this as defense-in-depth, so at
// most one row is ever committed. On a race, the loser's create throws P2002; we do NOT
// attempt to read back the winner's row here, because Postgres aborts the whole
// transaction block on any error (25P02 on every subsequent statement on that connection,
// including a findFirst against the same `tx`) — so that read could never succeed. The
// caller must retry outside this transaction to observe the winner's row.
export async function ensureCashAccount(tx: Prisma.TransactionClient, userId: string) {
  const existing = await tx.bankAccount.findFirst({ where: { userId, isCashAccount: true } });
  if (existing) return existing;

  try {
    return await tx.bankAccount.create({
      data: {
        userId,
        bankName: 'Cash',
        accountType: AccountType.CASH,
        isCashAccount: true,
        currentBalance: 0,
        currency: 'INR',
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw AppError.conflict('Cash account is being provisioned concurrently — please retry');
    }
    throw error;
  }
}

// Each helper below passes an explicit `null` straight through (an intentional clear —
// see accounts.ts's `.nullable()` comment) rather than collapsing it to `undefined`
// (which Prisma treats as "field not provided, leave unchanged"). Losing this
// distinction here would silently no-op a clear even after the route schema accepts it,
// and — for the two derived-value helpers — leave a stale ifscPrefix/accountNumberLast4
// behind after its source field was cleared.
function normalizeAccountNumber(value: string | null | undefined): string | null | undefined {
  if (value === null) return null;
  const normalized = value?.replace(/[\s-]/g, '').trim();
  return normalized || undefined;
}

function normalizeIfscCode(value: string | null | undefined): string | null | undefined {
  if (value === null) return null;
  const normalized = value?.replace(/\s/g, '').trim().toUpperCase();
  return normalized || undefined;
}

function normalizeIfscPrefix(value: string | null | undefined): string | null | undefined {
  if (value === null) return null;
  const normalized = value?.trim().toUpperCase();
  return normalized || undefined;
}

function getIfscPrefix(value: string | null | undefined): string | null | undefined {
  if (value === null) return null;
  return value ? value.slice(0, 4) : undefined;
}

function getLast4(value: string | null | undefined): string | null | undefined {
  if (value === null) return null;
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
    ifscPrefix?: string | null;
    ifscCode?: string | null;
    accountNumber?: string | null;
    accountNumberLast4?: string | null;
    accountType: string;
    currentBalance?: number;
    currency?: string;
    interestRate?: number | null;
    creditLimit?: number | null;
    billingCycleStartDay?: number | null;
    billingCycleEndDay?: number | null;
    paymentDueDay?: number | null;
    maturityDate?: string | null;
    upiId?: string | null;
  },
) {
  if (data.accountType === AccountType.CASH) {
    throw AppError.badRequest('Cash accounts are system-managed and cannot be created manually');
  }
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
    ifscPrefix: string | null;
    ifscCode: string | null;
    accountNumber: string | null;
    accountNumberLast4: string | null;
    accountType: string;
    currentBalance: number;
    upiId: string | null;
    isActive: boolean;
    interestRate: number | null;
    creditLimit: number | null;
    billingCycleStartDay: number | null;
    billingCycleEndDay: number | null;
    paymentDueDay: number | null;
    maturityDate: string | null;
  }>,
) {
  const account = await getAccountById(accountId, requesterId, requesterRole);
  if (account.isCashAccount && data.isActive === false) {
    throw AppError.badRequest('The cash account cannot be deactivated');
  }
  if (account.isCashAccount && data.accountType !== undefined && data.accountType !== AccountType.CASH) {
    throw AppError.badRequest('The cash account\'s type cannot be changed');
  }
  if (!account.isCashAccount && data.accountType === AccountType.CASH) {
    throw AppError.badRequest('An existing account cannot be converted to the cash account');
  }
  const accountNumber = data.accountNumber !== undefined ? normalizeAccountNumber(data.accountNumber) : undefined;
  const ifscCode = data.ifscCode !== undefined ? normalizeIfscCode(data.ifscCode) : undefined;

  return prisma.bankAccount.update({
    where: { id: accountId },
    data: {
      ...data,
      accountType: data.accountType as AccountType | undefined,
      ...(data.ifscCode !== undefined && {
        ifscCode,
        ifscPrefix: getIfscPrefix(ifscCode),
      }),
      ...(data.accountNumber !== undefined && {
        accountNumber,
        accountNumberLast4: getLast4(accountNumber),
      }),
      maturityDate: data.maturityDate === null ? null : data.maturityDate ? new Date(data.maturityDate) : undefined,
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
  const account = await getAccountById(accountId, requesterId, requesterRole);
  if (account.isCashAccount) {
    throw AppError.badRequest('The cash account cannot be deactivated');
  }

  // Soft-delete: set isActive = false
  return prisma.bankAccount.update({
    where: { id: accountId },
    data: { isActive: false },
  });
}
