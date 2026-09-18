import { AccountType, Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { AppError } from '../utils/AppError';
import { anchorCutoff, getISTDateBoundary } from '../utils/financialYear';

// Prisma's direct-Postgres (non-Data-Proxy) client does not auto-retry a Serializable
// transaction's write-conflict — the caller must. P2034 is the client's error code for
// this (the raw Postgres SQLSTATE 40001 is not observable through the client, which
// re-codes it before the error reaches application code).
const SERIALIZATION_FAILURE_CODE = 'P2034';
const MAX_ANCHOR_RETRIES = 3;

// Serializable isolation alone does NOT protect the anchor invariant: Postgres SSI only
// detects conflicts between transactions that are ALL Serializable, but every other
// balance-mutating transaction in this codebase runs at the connection default (READ
// COMMITTED). Without an explicit lock, a concurrent createTransaction/updateTransaction/
// softDeleteTransaction can read stale anchor state, or applyAnchor's absolute set can
// silently discard a concurrent increment — a real, reachable lost-update, not a
// theoretical one (found by adversarial review, traced end to end).
//
// The fix: every transaction that reads anchor-derived state (openingBalanceDate,
// balanceSupersededByAnchor) to decide a balance write, OR writes currentBalance, must
// take this row lock FIRST — before any such read. Postgres row-level locks are taken
// regardless of isolation level, so this alone serializes every balance-mutating
// transaction against applyAnchor without requiring every caller to also be Serializable.
// Multiple account IDs are locked in sorted order to avoid a deadlock between two
// concurrent transfers that would otherwise lock the same two accounts in opposite order.
export async function lockAccountsForBalanceWrite(
  tx: Prisma.TransactionClient,
  accountIds: Array<string | null | undefined>,
): Promise<void> {
  const ids = Array.from(new Set(accountIds.filter((id): id is string => Boolean(id)))).sort();
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT id FROM "BankAccount" WHERE id = ANY(${ids}) FOR UPDATE`;
}

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
  // Once an anchor is set, currentBalance must only move via applyAnchor (recompute) or
  // reconcileAccount (dated correction transaction) — both preserve the invariant
  // currentBalance == openingBalance + sum(non-superseded deltas). A raw PUT here would
  // silently break that invariant with no correction row and no supersede recompute.
  // Keyed on an actual value change, not mere presence — the account edit form always
  // resends currentBalance unchanged on every save.
  if (
    account.openingBalanceDate
    && data.currentBalance !== undefined
    && !new Prisma.Decimal(data.currentBalance).equals(account.currentBalance)
  ) {
    throw AppError.badRequest(
      'This account has an opening-balance anchor set — use the opening-balance or reconcile endpoint to change its balance, not a direct edit.',
    );
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
  // Ownership/existence check only — the balance itself is read fresh INSIDE the
  // transaction below. Reading it here and reusing that value inside the transaction
  // (the previous implementation) is a TOCTOU: a concurrent transaction landing between
  // this read and the transaction's write would be silently overwritten by an absolute
  // set computed from a stale balance.
  await getAccountById(accountId, requesterId, requesterRole);
  const actualBalanceDecimal = new Prisma.Decimal(actualBalance);

  return prisma.$transaction(async (tx) => {
    // Lock FIRST, before any read that a balance decision depends on — otherwise a
    // concurrent applyAnchor can commit between this read and this transaction's write,
    // and this absolute set would silently discard it (or vice versa).
    await lockAccountsForBalanceWrite(tx, [accountId]);
    const fresh = await tx.bankAccount.findUniqueOrThrow({ where: { id: accountId } });

    // A correction transaction is always dated `new Date()` (today) — but if the
    // account's anchor cutoff is also today (or later), that correction would itself
    // land in the superseded window: inserted as non-superseded (wrong), and silently
    // reverted the next time applyAnchor recomputes. Reconcile and same-day-anchor are
    // fundamentally in tension ("balance right now" vs "everything today is excluded")
    // — reject rather than silently corrupt the invariant; the opening-balance endpoint
    // is the correct tool for "set today's balance."
    const cutoff = anchorCutoff(fresh.openingBalanceDate);
    if (cutoff && new Date() <= cutoff) {
      throw AppError.badRequest(
        'This account has an opening-balance anchor covering today — use the opening-balance endpoint to update today\'s balance instead.',
      );
    }

    const delta = actualBalanceDecimal.minus(fresh.currentBalance);

    // Create a correction transaction only if there's a discrepancy
    if (!delta.isZero()) {
      await tx.transaction.create({
        data: {
          userId: fresh.userId,
          bankAccountId: accountId,
          amount: delta.abs().toNumber(),
          type: delta.isPositive() ? 'INCOME' : 'EXPENSE',
          description: note ?? 'Balance Reconciliation',
          date: new Date(),
          tags: ['reconciliation'],
        },
      });
    }

    // Set balance directly to the confirmed actual value. The guard above guarantees
    // the correction transaction just created (dated today) is always strictly after
    // the anchor's cutoff, so it naturally falls inside the "since anchor" sum and this
    // absolute set stays consistent with applyAnchor's invariant.
    return tx.bankAccount.update({
      where: { id: accountId },
      data: { currentBalance: actualBalance },
    });
  });
}

// The only read-sum-write in the system: recomputes currentBalance from scratch and
// re-flags every Transaction.balanceSupersededByAnchor on the account, for set, edit,
// AND clear alike (openingBalance/openingBalanceDate both null = clear). Running this
// twice with identical inputs is a no-op. Never write openingBalance/openingBalanceDate
// or balanceSupersededByAnchor directly — always go through this function.
export async function applyAnchor(
  accountId: string,
  requesterId: string,
  requesterRole: string,
  openingBalance: number | null,
  openingBalanceDate: string | null,
) {
  // Both-or-neither and future-date are enforced at the route (Zod), but this is the
  // sole sanctioned writer — a direct service call (script, future caller) must not be
  // able to bypass either rule.
  if ((openingBalance === null) !== (openingBalanceDate === null)) {
    throw AppError.badRequest('openingBalance and openingBalanceDate must both be set, or both be null to clear the anchor');
  }
  await getAccountById(accountId, requesterId, requesterRole);

  const anchorDate = openingBalanceDate ? getISTDateBoundary(openingBalanceDate, 'start') : null;
  if (anchorDate && anchorDate > new Date()) {
    throw AppError.badRequest('Opening-balance date cannot be in the future');
  }
  const cutoff = anchorCutoff(anchorDate);

  for (let attempt = 1; attempt <= MAX_ANCHOR_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // Lock first — this is what makes every OTHER balance-mutating transaction in
          // the app (which run at READ COMMITTED, not Serializable) safe against this
          // one: a concurrent create/update/delete that also touches this BankAccount
          // row blocks until this transaction commits, so it never reads a state this
          // recompute is about to invalidate, and never writes into a snapshot this
          // recompute is about to overwrite.
          await lockAccountsForBalanceWrite(tx, [accountId]);

          // Recompute the supersede flag for every row from scratch — this is what
          // makes set/edit/clear a single idempotent code path (DQ5): moving the cutoff
          // later suppresses more rows, moving it earlier or clearing resurrects them.
          await tx.transaction.updateMany({
            where: { bankAccountId: accountId, deletedAt: null },
            data: { balanceSupersededByAnchor: false },
          });
          let supersededTransactionCount = 0;
          if (cutoff) {
            ({ count: supersededTransactionCount } = await tx.transaction.updateMany({
              where: { bankAccountId: accountId, deletedAt: null, date: { lte: cutoff } },
              data: { balanceSupersededByAnchor: true },
            }));
          }

          const sums = await tx.transaction.groupBy({
            by: ['type'],
            where: {
              bankAccountId: accountId,
              deletedAt: null,
              balanceImpactApplied: true,
              balanceSupersededByAnchor: false,
            },
            _sum: { amount: true },
          });

          let currentBalance = new Prisma.Decimal(openingBalance ?? 0);
          for (const row of sums) {
            const rowSum = row._sum.amount ?? new Prisma.Decimal(0);
            // INCOME adds; EXPENSE and single-leg TRANSFER rows both subtract, matching
            // transactionService.ts's balanceDelta() sign convention.
            currentBalance = row.type === 'INCOME' ? currentBalance.plus(rowSum) : currentBalance.minus(rowSum);
          }

          const account = await tx.bankAccount.update({
            where: { id: accountId },
            data: {
              openingBalance: openingBalance === null ? null : new Prisma.Decimal(openingBalance),
              openingBalanceDate: anchorDate,
              currentBalance,
            },
          });

          return { account, supersededTransactionCount };
        },
        // The lock above is the real safety mechanism now; Serializable + retry is a
        // belt-and-braces second layer against genuine Serializable-vs-Serializable
        // conflicts (e.g. two concurrent applyAnchor calls on the same account).
        // Explicit timeout matches statementImportService's precedent (commit b6f0d94)
        // for the only other long-running, potentially-full-table-scoped transaction.
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000, maxWait: 10_000 },
      );
    } catch (error) {
      const isSerializationFailure =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === SERIALIZATION_FAILURE_CODE;
      if (isSerializationFailure && attempt < MAX_ANCHOR_RETRIES) continue;
      if (isSerializationFailure) {
        throw AppError.conflict('This account is being updated concurrently — please retry.');
      }
      throw error;
    }
  }
  /* istanbul ignore next -- unreachable: the loop always returns or throws */
  throw new Error('applyAnchor: retry loop exited without resolving');
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
