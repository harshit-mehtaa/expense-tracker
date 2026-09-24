import crypto from 'crypto';
import { PaymentMode, Prisma, TransactionType } from '@prisma/client';
import prisma from '../config/prisma';
import { AppError } from '../utils/AppError';
import { ensureCashAccount, lockAccountsForBalanceWrite } from './accountService';
import { resolveCategoryForTransaction } from './categoryRuleService';
import { assertCategoryMatchesTransactionType } from './categoryService';
import { anchorCutoff, formatISTDate, getFYRange, getISTDateBoundary } from '../utils/financialYear';
import { buildPaginationArgs, processPaginationResult } from '../utils/pagination';

export interface TransactionFilters {
  userId?: string;
  bankAccountId?: string;
  categoryId?: string;
  categoryIds?: string[];
  type?: string;
  types?: string[];
  paymentMode?: string;
  paymentModes?: string[];
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

type TransferAccountSummary = {
  bankName: string;
  accountNumberLast4: string | null;
  accountType: string;
};

function buildDateFilter(filters: { fy?: string; startDate?: string; endDate?: string }): Prisma.DateTimeFilter | undefined {
  const date: Prisma.DateTimeFilter = {};

  if (filters.fy) {
    const { start, end } = getFYRange(filters.fy);
    date.gte = start;
    date.lte = end;
  }
  if (filters.startDate) {
    const start = getISTDateBoundary(filters.startDate, 'start');
    date.gte = date.gte && date.gte > start ? date.gte : start;
  }
  if (filters.endDate) {
    const end = getISTDateBoundary(filters.endDate, 'end');
    date.lte = date.lte && date.lte < end ? date.lte : end;
  }

  return Object.keys(date).length ? date : undefined;
}

async function attachTransferMetadata<T extends {
  id: string;
  transferPairId?: string | null;
  type?: string;
  bankAccount?: TransferAccountSummary | null;
}>(items: T[]): Promise<Array<T & {
  isCreditCardBillPayment: boolean;
  creditCardAccount: TransferAccountSummary | null;
  transferCounterpartyAccount: TransferAccountSummary | null;
}>> {
  const pairIds = [...new Set(items.map((item) => item.transferPairId).filter((id): id is string => Boolean(id)))];
  if (pairIds.length === 0) {
    return items.map((item) => ({
      ...item,
      isCreditCardBillPayment: false,
      creditCardAccount: null,
      transferCounterpartyAccount: null,
    }));
  }

  const transferLegs = await prisma.transaction.findMany({
    where: { transferPairId: { in: pairIds }, deletedAt: null },
    select: {
      id: true,
      transferPairId: true,
      type: true,
      bankAccount: { select: { bankName: true, accountNumberLast4: true, accountType: true } },
    },
  });
  type TransferLeg = (typeof transferLegs)[number];
  const legsByPair = new Map<string, TransferLeg[]>();
  for (const leg of transferLegs) {
    if (!leg.transferPairId) continue;
    const existing = legsByPair.get(leg.transferPairId) ?? [];
    existing.push(leg);
    legsByPair.set(leg.transferPairId, existing);
  }

  return items.map((item) => {
    const legs = item.transferPairId ? (legsByPair.get(item.transferPairId) ?? []) : [];
    const counterparty = legs.find((leg) => leg.id !== item.id)?.bankAccount ?? null;
    const creditCardPaymentLeg = legs.find((leg) => leg.type === 'INCOME' && leg.bankAccount?.accountType === 'CREDIT_CARD');

    return {
      ...item,
      isCreditCardBillPayment: Boolean(creditCardPaymentLeg),
      creditCardAccount: creditCardPaymentLeg?.bankAccount ?? null,
      transferCounterpartyAccount: counterparty,
    };
  });
}

type TransferCounterpartCandidate = {
  id: string;
  date: Date;
  description: string;
  remark: string | null;
  amount: Prisma.Decimal;
  type: TransactionType;
  balanceImpactApplied: boolean;
  balanceSupersededByAnchor: boolean;
  bankAccount: TransferAccountSummary | null;
};

async function findTransferCounterpartCandidates(
  ptx: Prisma.TransactionClient,
  original: { id: string; userId: string; amount: Prisma.Decimal | number; date: Date },
  data: { bankAccountId: string; type: TransactionType },
) {
  return ptx.transaction.findMany({
    where: {
      id: { not: original.id },
      userId: original.userId,
      deletedAt: null,
      transferPairId: null,
      bankAccountId: data.bankAccountId,
      type: data.type,
      amount: original.amount,
      date: original.date,
      sipId: null,
      sipTransactionId: null,
      insurancePolicyId: null,
      refundForTransactionId: null,
      loanId: null,
    },
    select: {
      id: true,
      date: true,
      description: true,
      remark: true,
      amount: true,
      type: true,
      balanceImpactApplied: true,
      balanceSupersededByAnchor: true,
      bankAccount: { select: { bankName: true, accountNumberLast4: true, accountType: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
}

async function resolveTransferCounterpart(
  ptx: Prisma.TransactionClient,
  original: { id: string; userId: string; amount: Prisma.Decimal | number; date: Date },
  data: { bankAccountId: string; type: TransactionType; counterpartTransactionId?: string },
): Promise<TransferCounterpartCandidate | null> {
  const candidates = await findTransferCounterpartCandidates(ptx, original, data);
  if (data.counterpartTransactionId) {
    const selected = candidates.find((candidate) => candidate.id === data.counterpartTransactionId);
    if (!selected) throw AppError.badRequest('Selected transfer counterpart is not a valid match');
    return selected;
  }
  if (candidates.length > 1) {
    throw AppError.conflict(
      'Multiple matching counterparty transactions found. Select the correct matching transaction instead of creating a new transfer leg.',
      'MULTIPLE_TRANSFER_COUNTERPARTS',
    );
  }
  return candidates[0] ?? null;
}

export async function getTransferCounterpartCandidates(
  transactionId: string,
  requesterId: string,
  requesterRole: string,
  bankAccountId: string,
) {
  const original = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!original || original.deletedAt) throw AppError.notFound('Transaction');
  if (requesterRole !== 'ADMIN' && original.userId !== requesterId) throw AppError.forbidden();
  if (original.transferPairId) throw AppError.badRequest('Transaction is already marked as a transfer');
  if (original.type !== 'EXPENSE' && original.type !== 'INCOME') {
    throw AppError.badRequest('Only income or expense transactions can be converted to transfers');
  }
  if (!original.bankAccountId) throw AppError.badRequest('Bank account is required to find transfer matches');
  if (original.bankAccountId === bankAccountId) throw AppError.badRequest('Counterparty account must be different');

  const account = await prisma.bankAccount.findFirst({ where: { id: bankAccountId, userId: original.userId } });
  if (!account) throw AppError.notFound('Counterparty bank account');

  return findTransferCounterpartCandidates(prisma, original, {
    bankAccountId,
    type: original.type === 'EXPENSE' ? 'INCOME' : 'EXPENSE',
  });
}

export async function getTransactions(
  requesterId: string,
  requesterRole: string,
  filters: TransactionFilters,
) {
  // MEMBER: own data only. ADMIN + userId: specific member. ADMIN + no userId: family-wide.
  const effectiveUserId = requesterRole !== 'ADMIN' ? requesterId : filters.userId;

  const where: Prisma.TransactionWhereInput = {
    ...(effectiveUserId ? { userId: effectiveUserId } : {}),
    deletedAt: null,
  };

  if (filters.bankAccountId) where.bankAccountId = filters.bankAccountId;
  if (filters.categoryIds?.length) {
    where.categoryId = { in: filters.categoryIds };
  } else if (filters.categoryId) {
    where.categoryId = filters.categoryId;
  }
  if (filters.types?.length) {
    where.type = { in: filters.types as TransactionType[] };
  } else if (filters.type) {
    where.type = filters.type as TransactionType;
  }
  if (filters.paymentModes?.length) {
    where.paymentMode = { in: filters.paymentModes as PaymentMode[] };
  } else if (filters.paymentMode) {
    where.paymentMode = filters.paymentMode as PaymentMode;
  }

  if (filters.search) {
    where.OR = [
      { description: { contains: filters.search, mode: 'insensitive' } },
      { remark: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  const dateFilter = buildDateFilter(filters);
  if (dateFilter) where.date = dateFilter;

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
      category: {
        select: {
          id: true,
          name: true,
          color: true,
          icon: true,
          type: true,
          parentId: true,
          parent: { select: { id: true, name: true, icon: true, type: true, parentId: true } },
        },
      },
      bankAccount: { select: { bankName: true, accountNumberLast4: true, accountType: true } },
      sip: { select: { fundName: true, folioNumber: true, monthlyAmount: true, sipDate: true } },
      sipTransaction: {
        select: {
          units: true,
          nav: true,
          amount: true,
          type: true,
          investment: { select: { name: true } },
        },
      },
      insurancePolicy: { select: { id: true, policyName: true, providerName: true, policyNumber: true, policyType: true, premiumAmount: true } },
      refundFor: {
        select: {
          id: true,
          description: true,
          amount: true,
          date: true,
          categoryId: true,
          category: { select: { id: true, name: true, icon: true, type: true, parentId: true, parent: { select: { id: true, name: true, icon: true, type: true, parentId: true } } } },
        },
      },
      refunds: {
        where: { deletedAt: null },
        orderBy: { date: 'desc' },
        select: { id: true, amount: true, date: true, description: true },
      },
      user: { select: { name: true, colorTag: true } },
    },
  });

  const limit = paginationArgs.take - 1;
  const result = processPaginationResult(items, limit, total);
  return { ...result, items: await attachTransferMetadata(result.items) };
}

export async function getTransactionById(
  transactionId: string,
  requesterId: string,
  requesterRole: string,
) {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: {
      category: {
        select: {
          id: true,
          name: true,
          color: true,
          icon: true,
          type: true,
          parentId: true,
          parent: { select: { id: true, name: true, icon: true, type: true, parentId: true } },
        },
      },
      bankAccount: { select: { bankName: true, accountNumberLast4: true, accountType: true } },
      sip: { select: { fundName: true, folioNumber: true, monthlyAmount: true, sipDate: true } },
      sipTransaction: {
        select: {
          units: true,
          nav: true,
          amount: true,
          type: true,
          investment: { select: { name: true } },
        },
      },
      insurancePolicy: { select: { id: true, policyName: true, providerName: true, policyNumber: true, policyType: true, premiumAmount: true } },
      refundFor: {
        select: {
          id: true,
          description: true,
          amount: true,
          date: true,
          categoryId: true,
          category: { select: { id: true, name: true, icon: true, type: true, parentId: true, parent: { select: { id: true, name: true, icon: true, type: true, parentId: true } } } },
        },
      },
      refunds: {
        where: { deletedAt: null },
        orderBy: { date: 'desc' },
        select: { id: true, amount: true, date: true, description: true },
      },
      user: { select: { name: true, colorTag: true } },
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
    remark?: string | null;
    date: string;
    tags?: string[];
    isRecurring?: boolean;
    gstAmount?: number;
    transferToAccountId?: string; // Double-entry: destination account for TRANSFER type
    loanId?: string; // Linked loan — decrements outstandingBalance when type=EXPENSE
    insurancePolicyId?: string; // Linked policy premium payment; remains an EXPENSE
    subscriptionId?: string; // Linked subscription charge; remains an EXPENSE
    refundForTransactionId?: string; // Linked refund income for a previous EXPENSE
  },
) {
  if (data.type === 'TRANSFER' && !data.transferToAccountId) {
    throw AppError.badRequest('transferToAccountId is required for TRANSFER transactions');
  }

  // A caller-chosen category must exist and match the type — and a TRANSFER can't have
  // one (its two legs are an EXPENSE and an INCOME; no category fits both). Checked
  // before any write, so a rejected loan prepayment (loanService) leaves nothing behind.
  if (data.categoryId) await assertCategoryMatchesTransactionType(data.categoryId, data.type);

  // A category the user chose always wins; otherwise the owner's auto-categorization
  // rules may supply one (always type-matched — matchRules filters on it). Resolved
  // OUTSIDE the $transaction: regex rules can take up to SINGLE_TRANSACTION_BUDGET_MS,
  // which must not be spent holding account row locks.
  const categoryId = data.categoryId
    ?? (data.type === 'TRANSFER' ? undefined : await resolveCategoryForTransaction(userId, {
      type: data.type,
      description: data.description,
    }));

  return prisma.$transaction(async (tx) => {
    const txDate = new Date(data.date);

    // Validate source account ownership
    if (data.bankAccountId) {
      const account = await tx.bankAccount.findFirst({ where: { id: data.bankAccountId, userId } });
      if (!account) throw AppError.notFound('Bank account');
    }

    // Auto-resolve to the user's cash account for a cash-paid EXPENSE/INCOME with no
    // explicit account chosen. Without this, a CASH-paymentMode transaction had
    // bankAccountId: null and zero balance effect anywhere. TRANSFER is excluded — its
    // source/destination accounts are always explicit (bankAccountId + transferToAccountId).
    // Self-healing rather than a hard failure: every user-creation path provisions a cash
    // account, but ensureCashAccount is idempotent, so falling back to it here also covers
    // any account created before this feature shipped and never backfilled.
    let cashResolvedBankAccountId = data.bankAccountId;
    if (!cashResolvedBankAccountId && data.paymentMode === PaymentMode.CASH && data.type !== 'TRANSFER') {
      const cashAccount = await ensureCashAccount(tx, userId);
      cashResolvedBankAccountId = cashAccount.id;
    }

    // TRANSFER double-entry: create debit on source + credit on destination
    if (data.type === 'TRANSFER' && data.transferToAccountId) {
      const destAccount = await tx.bankAccount.findFirst({ where: { id: data.transferToAccountId, userId } });
      if (!destAccount) throw AppError.notFound('Destination bank account');
      // Lock before the anchor check — otherwise a concurrent applyAnchor could commit
      // a new anchor between this read and the increments below, letting a now-invalid
      // transaction through.
      await lockAccountsForBalanceWrite(tx, [data.bankAccountId, data.transferToAccountId]);
      await assertNotBeforeAnchor(tx, data.bankAccountId, txDate);
      await assertNotBeforeAnchor(tx, data.transferToAccountId, txDate);

      const pairId = crypto.randomUUID();

      // Debit leg (source account)
      const debitTx = await tx.transaction.create({
        data: {
          userId,
          bankAccountId: data.bankAccountId,
          amount: data.amount,
          type: 'EXPENSE',
          paymentMode: data.paymentMode as PaymentMode | undefined,
          description: data.description,
          remark: data.remark,
          date: new Date(data.date),
          tags: data.tags ?? [],
          isRecurring: data.isRecurring ?? false,
          gstAmount: data.gstAmount,
          balanceImpactApplied: true,
          transferPairId: pairId,
        },
      });

      // Credit leg (destination account)
      await tx.transaction.create({
        data: {
          userId,
          bankAccountId: data.transferToAccountId,
          amount: data.amount,
          type: 'INCOME',
          description: data.description,
          remark: data.remark,
          date: new Date(data.date),
          tags: data.tags ?? [],
          isRecurring: false,
          balanceImpactApplied: true,
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

    // Special linkages are only valid for EXPENSE transactions.
    const effectiveLoanId = data.loanId && data.type === 'EXPENSE' ? data.loanId : undefined;
    const effectiveInsurancePolicyId = data.insurancePolicyId && data.type === 'EXPENSE' ? data.insurancePolicyId : undefined;
    // Attributing a real charge to a subscription is what makes the "charged more than
    // expected" check meaningful: without it, the only rows carrying a subscriptionId are
    // ones generation created at exactly the recorded price, so the check could never
    // fire on the vendor reality it claims to detect.
    const effectiveSubscriptionId = data.subscriptionId && data.type === 'EXPENSE' ? data.subscriptionId : undefined;
    const effectiveRefundForTransactionId = data.refundForTransactionId && data.type === 'INCOME'
      ? data.refundForTransactionId
      : undefined;
    if (effectiveLoanId && effectiveInsurancePolicyId) {
      throw AppError.badRequest('Transaction can be linked to either a loan or an insurance policy, not both');
    }
    if (data.refundForTransactionId && data.type !== 'INCOME') {
      throw AppError.badRequest('Only incoming transactions can be linked as refunds');
    }

    // Validate loan ownership and balance if loanId provided
    if (effectiveLoanId) {
      // Owner-inclusive, matching loanService's visibility rule. Scoping this to
      // `userId` alone would let a co-owner view and edit a loan but not record an EMI
      // payment against it — requirement 4 half-landing as a confusing "Loan not found".
      const loan = await tx.loan.findFirst({
        where: {
          id: effectiveLoanId,
          OR: [{ userId }, { owners: { some: { userId } } }],
        },
      });
      if (!loan) throw AppError.notFound('Loan');
      if (data.amount > Number(loan.outstandingBalance)) {
        throw AppError.badRequest('Payment amount exceeds outstanding loan balance');
      }
    }
    if (effectiveInsurancePolicyId) {
      const policy = await tx.insurancePolicy.findFirst({ where: { id: effectiveInsurancePolicyId, userId } });
      if (!policy) throw AppError.notFound('Insurance policy');
    }
    if (effectiveSubscriptionId) {
      // Same ownership rule as the loan and policy links above: attaching another
      // member's subscription would leak its name and price back through any read that
      // includes it.
      const subscription = await tx.subscription.findFirst({
        where: { id: effectiveSubscriptionId, userId, deletedAt: null },
        select: { id: true },
      });
      if (!subscription) throw AppError.notFound('Subscription');
    }
    if (effectiveRefundForTransactionId) {
      const originalExpense = await tx.transaction.findFirst({
        where: { id: effectiveRefundForTransactionId, userId, deletedAt: null, type: 'EXPENSE' },
        select: { id: true, transferPairId: true },
      });
      if (!originalExpense) throw AppError.notFound('Original expense transaction');
      if (originalExpense.transferPairId) throw AppError.badRequest('Transfer transactions cannot be refunded');
    }

    await lockAccountsForBalanceWrite(tx, [cashResolvedBankAccountId]);
    await assertNotBeforeAnchor(tx, cashResolvedBankAccountId, txDate);

    // Single-leg transaction (INCOME or EXPENSE)
    const created = await tx.transaction.create({
      data: {
        userId,
        bankAccountId: cashResolvedBankAccountId,
        categoryId,
        amount: data.amount,
        type: data.type as TransactionType,
        paymentMode: data.paymentMode as PaymentMode | undefined,
        upiIdUsed: data.upiIdUsed,
        description: data.description,
        remark: data.remark,
        date: new Date(data.date),
        tags: data.tags ?? [],
        isRecurring: data.isRecurring ?? false,
        gstAmount: data.gstAmount,
        loanId: effectiveLoanId,
        insurancePolicyId: effectiveInsurancePolicyId,
        subscriptionId: effectiveSubscriptionId,
        refundForTransactionId: effectiveRefundForTransactionId,
        balanceImpactApplied: true,
        // importHash is null for manual transactions
      },
      include: {
        category: { select: { name: true, color: true } },
        bankAccount: { select: { bankName: true } },
      },
    });

    // Update source account balance (INCOME → +, EXPENSE/TRANSFER → -)
    if (cashResolvedBankAccountId) {
      const delta = data.type === 'INCOME' ? data.amount : -data.amount;
      await tx.bankAccount.update({
        where: { id: cashResolvedBankAccountId },
        data: { currentBalance: { increment: delta } },
      });
    }

    // Decrement loan outstanding balance for linked EXPENSE transactions
    if (effectiveLoanId) {
      await tx.loan.update({
        where: { id: effectiveLoanId },
        data: { outstandingBalance: { decrement: data.amount } },
      });
    }

    return created;
  });
}

/** Returns the balance delta for a transaction type. INCOME → positive, EXPENSE/TRANSFER → negative. */
function balanceDelta(type: string, amount: number): number {
  return type === 'INCOME' ? amount : -amount;
}

// Whether a row's delta is actually reflected in its bankAccount.currentBalance right
// now. False for an unconfirmed transfer counterpart (balanceImpactApplied: false) AND
// for a row dated on/before its account's opening-balance anchor (balanceSupersededByAnchor:
// true) — reversing either on delete/edit would apply a delta that was never counted.
// The single sanctioned check at every balance-reversal site; never inline the two
// conditions separately.
function contributesToBalance(row: { balanceImpactApplied: boolean | null; balanceSupersededByAnchor: boolean }): boolean {
  return row.balanceImpactApplied !== false && !row.balanceSupersededByAnchor;
}

// Throws if `date` falls on/before bankAccountId's opening-balance anchor date. No-op if
// the account has no anchor or bankAccountId is not set. Must be called with the same
// transactional client (tx) the mutation runs in, so the anchor check sees a consistent
// snapshot alongside the write it's guarding.
async function assertNotBeforeAnchor(
  tx: Prisma.TransactionClient,
  bankAccountId: string | null | undefined,
  date: Date,
): Promise<void> {
  if (!bankAccountId) return;
  const account = await tx.bankAccount.findUnique({
    where: { id: bankAccountId },
    select: { openingBalanceDate: true },
  });
  const cutoff = anchorCutoff(account?.openingBalanceDate ?? null);
  if (cutoff && date <= cutoff) {
    throw AppError.badRequest(
      `Transaction is dated on or before this account's opening-balance date (${formatISTDate(account!.openingBalanceDate!)})`,
    );
  }
}

export async function updateTransaction(
  transactionId: string,
  userId: string,
  requesterRole: string,
  data: Partial<{
    categoryId: string | null;
    amount: number;
    type: string;
    paymentMode: string;
    description: string;
    remark: string | null;
    date: string;
    tags: string[];
    gstAmount: number;
  }>,
) {
  return prisma.$transaction(async (ptx) => {
    const original = await ptx.transaction.findUnique({ where: { id: transactionId } });
    if (!original || original.deletedAt) throw AppError.notFound('Transaction');
    if (requesterRole !== 'ADMIN' && original.userId !== userId) throw AppError.forbidden();
    // Whether amount/type are actually CHANGING — not merely present in the request.
    // editTxSchema (Transactions.tsx) always sends both on every edit (they're required
    // fields on that form, unchanged or not), so a presence check here would reject
    // every edit of a transfer leg, including the description-only edits this guard is
    // explicitly meant to keep allowed.
    const amountChanged = data.amount !== undefined && data.amount !== Number(original.amount);
    const typeChanged = data.type !== undefined && data.type !== original.type;

    // TRANSFER transactions are paired double-entry records; editing a paired leg's
    // amount or type would desync the pair's balance impact. Delete and re-create the
    // transfer instead. Other fields (description/date/tags/etc.) are safe to edit on a
    // leg and stay allowed — only an actual amount/type CHANGE is blocked. (A category
    // can't be set on a leg at all — see the category check below.)
    // NOTE: `original.type === 'TRANSFER'` was the previous guard here and never fired
    // for a PAIRED leg — createTransaction/convertTransactionToTransfer always persist
    // paired legs as EXPENSE/INCOME, never type:'TRANSFER'; `transferPairId` is the
    // actual signal. A single-leg type:'TRANSFER' row CAN exist (recurringService.ts,
    // generated from a rule with type 'TRANSFER', no transferPairId) — that shape is not
    // a paired double-entry record, so it's intentionally NOT covered by this guard.
    if (original.transferPairId && (amountChanged || typeChanged)) {
      throw AppError.badRequest('Transfer-paired transactions cannot have amount or type changed. Delete and re-create the transfer instead.');
    }

    // Auto-resolve to the user's cash account when a paymentMode edit turns an unlinked
    // transaction into a CASH one — mirrors createTransaction's create-time behavior.
    // Symmetrically, unlink when a paymentMode edit turns an already-cash-linked
    // transaction into a non-CASH one — otherwise the row is left permanently pointing
    // at the cash account under a paymentMode that no longer says so. This applies
    // whether the link was auto-resolved or the user explicitly chose the cash account
    // at create time (the account picker allows it regardless of paymentMode) — a
    // deliberate product decision: "linked to cash account" + "paymentMode says
    // otherwise" is a contradictory state that should self-correct on a paymentMode
    // edit specifically — not on any edit, and not proactively for a row that already
    // sits in that state untouched (no PUT-time trigger exists to detect that case).
    // Gated on paymentModeChanged (a real value change) — this must fire only when
    // paymentMode is ACTUALLY being edited to something different in this request, not
    // whenever the request merely happens to carry the row's already-stored paymentMode
    // (editTxSchema/EditTransactionModal always resend it, so a bare `!== undefined`
    // presence check — the exact class of bug the item-2 guard above was just fixed for
    // — would fire on every edit of an already-cash-linked row, not just a real change).
    // Excludes transfer-paired legs entirely: unlinking one leg of a double-entry pair
    // (and reversing only its own balance impact) would silently corrupt the pair — a
    // transfer leg's account linkage is only ever changed by deleting/re-creating the
    // transfer, same as amount/type above.
    // Any other already-linked transaction (a real, non-cash account) stays untouched —
    // that case remains the existing cosmetic no-op.
    const paymentModeChanged = data.paymentMode !== undefined && data.paymentMode !== original.paymentMode;
    const effectivePaymentMode = data.paymentMode ?? original.paymentMode;
    const effectiveType = data.type ?? original.type;

    // Category ↔ type. Same "changed, not merely present" rule as amount/type above: the
    // edit form resends the stored categoryId on every save, so a presence check would
    // reject description-only edits of any row whose category was since retyped.
    const categoryChanged = data.categoryId !== undefined && data.categoryId !== original.categoryId;
    // A type change that doesn't pick a new category (omitted, or the stored one resent)
    // makes the old one stale only if its type no longer fits — then clear it rather than
    // reject a request the client got right. If it still fits, it's already verified.
    let categoryPatch = data.categoryId;
    let categoryVerified = false;
    if (typeChanged && !categoryChanged && original.categoryId) {
      const current = await ptx.category.findUnique({
        where: { id: original.categoryId },
        select: { type: true },
      });
      if (current?.type === effectiveType) categoryVerified = true;
      else categoryPatch = null;
    }
    const effectiveCategoryId = categoryPatch === undefined ? original.categoryId : categoryPatch;
    if (effectiveCategoryId && (categoryChanged || typeChanged) && !categoryVerified) {
      // A paired leg is stored as EXPENSE/INCOME but is half of a transfer, which is
      // never categorized (createTransaction and convertTransactionToTransfer agree).
      if (original.transferPairId) throw AppError.badRequest('Transfers cannot be categorized');
      await assertCategoryMatchesTransactionType(effectiveCategoryId, effectiveType, ptx);
    }
    let cashResolvedBankAccountId: string | null = original.bankAccountId;
    let cashAccountNewlyLinked = false;
    let cashAccountUnlinking = false;
    if (!original.bankAccountId && effectivePaymentMode === PaymentMode.CASH && effectiveType !== 'TRANSFER') {
      // original.userId, not the requester's userId — an ADMIN editing a member's
      // transaction must resolve to the MEMBER's cash account, not their own.
      const cashAccount = await ensureCashAccount(ptx, original.userId);
      cashResolvedBankAccountId = cashAccount.id;
      cashAccountNewlyLinked = true;
    } else if (
      original.bankAccountId
      && !original.transferPairId
      && paymentModeChanged
      && effectivePaymentMode !== PaymentMode.CASH
    ) {
      const linkedAccount = await ptx.bankAccount.findUnique({ where: { id: original.bankAccountId } });
      if (linkedAccount?.isCashAccount) {
        cashResolvedBankAccountId = null;
        cashAccountUnlinking = true;
      }
    }

    // Lock before trusting `original`'s balanceSupersededByAnchor/balanceImpactApplied —
    // those were read before this point, and a concurrent applyAnchor could have
    // committed a new anchor state in between. Re-read fresh once the lock is held, so
    // every balance decision below (the date-cross guard and the reversal/net-change
    // block) sees state that can't change out from under it.
    await lockAccountsForBalanceWrite(ptx, [original.bankAccountId, cashResolvedBankAccountId]);
    const freshFlags = await ptx.transaction.findUniqueOrThrow({
      where: { id: transactionId },
      select: { balanceSupersededByAnchor: true, balanceImpactApplied: true },
    });
    original.balanceSupersededByAnchor = freshFlags.balanceSupersededByAnchor;
    original.balanceImpactApplied = freshFlags.balanceImpactApplied;

    // Guard the two ways this edit could cross an opening-balance anchor boundary: (a) a
    // date-only (or date+other) edit moving an already-linked transaction across its
    // account's cutoff in either direction, or (b) a paymentMode edit newly linking this
    // transaction to a cash account whose anchor the transaction's (unchanged) date
    // already falls on/before. Both are rejected — supersession state must never change
    // as a side effect of an edit; delete and re-create instead.
    if (!cashAccountUnlinking && cashResolvedBankAccountId && (data.date !== undefined || cashAccountNewlyLinked)) {
      const targetAccount = await ptx.bankAccount.findUnique({
        where: { id: cashResolvedBankAccountId },
        select: { openingBalanceDate: true },
      });
      const cutoff = anchorCutoff(targetAccount?.openingBalanceDate ?? null);
      if (cutoff) {
        const effectiveDate = data.date !== undefined ? new Date(data.date) : original.date;
        const willBeSuperseded = effectiveDate <= cutoff;
        const violatesNewLink = cashAccountNewlyLinked && willBeSuperseded;
        const violatesDateCross =
          !cashAccountNewlyLinked && data.date !== undefined && willBeSuperseded !== original.balanceSupersededByAnchor;
        if (violatesNewLink || violatesDateCross) {
          throw AppError.badRequest(
            `Transaction date crosses this account's opening-balance date (${formatISTDate(targetAccount!.openingBalanceDate!)}) — delete and re-create it instead.`,
          );
        }
      }
    }

    const updated = await ptx.transaction.update({
      where: { id: transactionId },
      data: {
        ...data,
        categoryId: categoryPatch,
        type: data.type as TransactionType | undefined,
        date: data.date ? new Date(data.date) : undefined,
        insurancePolicyId: data.type && data.type !== 'EXPENSE' ? null : undefined,
        refundForTransactionId: data.type && data.type !== 'INCOME' ? null : undefined,
        bankAccountId: cashAccountNewlyLinked ? cashResolvedBankAccountId : (cashAccountUnlinking ? null : undefined),
        balanceSupersededByAnchor: cashAccountUnlinking ? false : undefined,
        updatedAt: new Date(),
      } as Prisma.TransactionUncheckedUpdateInput,
    });

    // Recalculate balance impact if account or financial fields changed
    // (amountChanged/typeChanged already computed above, ahead of the transferPairId guard)

    if (typeChanged) {
      const activeRefundCount = await ptx.transaction.count({
        where: { refundForTransactionId: original.id, deletedAt: null },
      });
      if (activeRefundCount > 0) {
        throw AppError.badRequest('Transactions with refunds cannot change type');
      }
    }

    if (cashAccountUnlinking && contributesToBalance(original)) {
      // Mutually exclusive with the block below: unlinking always fully reverses the
      // transaction's prior impact against the OLD (cash) account, regardless of
      // whether amount/type ALSO changed in this same request — after unlink, nothing
      // is linked to receive a "new" delta, so a simultaneous amount/type change has
      // zero balance effect anywhere (same as any other unlinked, non-CASH transaction).
      // Guarded via contributesToBalance (mirrors softDeleteTransaction's own reversal
      // guard) — an unapplied-impact leg (e.g. an unconfirmed transfer counterpart) or a
      // pre-anchor-superseded leg never affected the account balance, so there's nothing
      // to reverse.
      const reversal = -balanceDelta(original.type, Number(original.amount));
      if (reversal !== 0) {
        await ptx.bankAccount.update({
          where: { id: original.bankAccountId! },
          data: { currentBalance: { increment: reversal } },
        });
      }
    } else if (!cashAccountUnlinking && (amountChanged || typeChanged || cashAccountNewlyLinked) && (original.bankAccountId || cashAccountNewlyLinked)) {
      // Reverse the original delta, apply the new delta. A newly-linked cash account had
      // zero prior balance impact (it was unlinked), regardless of whether amount/type
      // also changed in the same edit — so the "old" delta is 0, not a real reversal. A
      // pre-anchor-superseded original also contributed 0, same reasoning. The guard
      // above (violatesDateCross/violatesNewLink) already forbids this edit from
      // changing supersession state, so the row's post-edit supersede state always
      // equals its pre-edit state (false when newly linked, since that would have
      // thrown) — newDelta is zeroed on that same basis, not recomputed.
      const oldDelta = cashAccountNewlyLinked || !contributesToBalance(original)
        ? 0
        : balanceDelta(original.type, Number(original.amount));
      const newType = data.type ?? original.type;
      const newAmount = data.amount ?? Number(original.amount);
      const postEditSuperseded = cashAccountNewlyLinked ? false : original.balanceSupersededByAnchor;
      const newDelta = postEditSuperseded ? 0 : balanceDelta(newType, newAmount);
      const netChange = newDelta - oldDelta;

      if (netChange !== 0) {
        await ptx.bankAccount.update({
          // Guard above guarantees this is non-null: either original.bankAccountId was
          // already set, or cashAccountNewlyLinked resolved cashResolvedBankAccountId.
          where: { id: cashResolvedBankAccountId! },
          data: { currentBalance: { increment: netChange } },
        });
      }
    }

    // Recalculate loan outstanding balance if a loan-linked EXPENSE has its amount changed
    if ((amountChanged || typeChanged) && original.loanId) {
      const newType = data.type ?? original.type;
      const newAmount = data.amount ?? Number(original.amount);
      const wasLoanExpense = original.type === 'EXPENSE';
      const isLoanExpense = newType === 'EXPENSE';

      if (wasLoanExpense || isLoanExpense) {
        // Reverse old loan impact, apply new
        const oldLoanDecrement = wasLoanExpense ? Number(original.amount) : 0;
        const newLoanDecrement = isLoanExpense ? newAmount : 0;
        const loanNetChange = oldLoanDecrement - newLoanDecrement; // positive = restore, negative = more decrement

        if (loanNetChange !== 0) {
          await ptx.loan.update({
            where: { id: original.loanId },
            data: { outstandingBalance: { increment: loanNetChange } },
          });
        }
      }
    }

    return updated;
  });
}

export async function convertTransactionToTransfer(
  transactionId: string,
  requesterId: string,
  requesterRole: string,
  data: {
    transferToAccountId?: string;
    transferFromAccountId?: string;
    counterpartTransactionId?: string;
    adjustDestinationBalance?: boolean;
    adjustSourceBalance?: boolean;
  },
) {
  return prisma.$transaction(async (ptx) => {
    const original = await ptx.transaction.findUnique({ where: { id: transactionId } });
    if (!original || original.deletedAt) throw AppError.notFound('Transaction');
    if (requesterRole !== 'ADMIN' && original.userId !== requesterId) throw AppError.forbidden();
    if (original.transferPairId) throw AppError.badRequest('Transaction is already marked as a transfer');
    if (original.sipId) throw AppError.badRequest('SIP transactions cannot be converted to transfers');
    if (original.insurancePolicyId) throw AppError.badRequest('Policy-linked transactions cannot be converted to transfers');
    if (original.refundForTransactionId) throw AppError.badRequest('Refund transactions cannot be converted to transfers');
    if (original.type !== 'EXPENSE' && original.type !== 'INCOME') {
      throw AppError.badRequest('Only income or expense transactions can be converted to transfers');
    }
    const refundCount = await ptx.transaction.count({ where: { refundForTransactionId: original.id, deletedAt: null } });
    if (refundCount > 0) throw AppError.badRequest('Transactions with refunds cannot be converted to transfers');

    if (original.type === 'EXPENSE') {
      if (!data.transferToAccountId) throw AppError.badRequest('Destination account is required');
      if (!original.bankAccountId) throw AppError.badRequest('Source bank account is required to convert a transaction to transfer');
      if (original.bankAccountId === data.transferToAccountId) {
        throw AppError.badRequest('Destination account must be different from source account');
      }

      const destination = await ptx.bankAccount.findFirst({
        where: { id: data.transferToAccountId, userId: original.userId },
      });
      if (!destination) throw AppError.notFound('Destination bank account');
      await lockAccountsForBalanceWrite(ptx, [original.bankAccountId, data.transferToAccountId]);
      await assertNotBeforeAnchor(ptx, data.transferToAccountId, original.date);

      const pairId = crypto.randomUUID();
      const existingDestinationLeg = await resolveTransferCounterpart(ptx, original, {
        bankAccountId: data.transferToAccountId,
        type: 'INCOME',
        counterpartTransactionId: data.counterpartTransactionId,
      });
      const updatedSource = await ptx.transaction.update({
        where: { id: original.id },
        data: {
          transferPairId: pairId,
          categoryId: null,
          loanId: null,
          insurancePolicyId: null,
          balanceImpactApplied: original.balanceImpactApplied ?? true,
          updatedAt: new Date(),
        },
      });

      if (existingDestinationLeg) {
        await ptx.transaction.update({
          where: { id: existingDestinationLeg.id },
          data: {
            transferPairId: pairId,
            categoryId: null,
            loanId: null,
            insurancePolicyId: null,
            refundForTransactionId: null,
            balanceImpactApplied: data.adjustDestinationBalance && !existingDestinationLeg.balanceImpactApplied ? true : undefined,
            updatedAt: new Date(),
          },
        });
      } else {
        await ptx.transaction.create({
          data: {
            userId: original.userId,
            bankAccountId: data.transferToAccountId,
            amount: original.amount,
            type: 'INCOME',
            paymentMode: original.paymentMode,
            upiIdUsed: original.upiIdUsed,
            description: original.description,
            remark: original.remark,
            date: original.date,
            tags: original.tags,
            isRecurring: false,
            gstAmount: original.gstAmount,
            transferPairId: pairId,
            balanceImpactApplied: data.adjustDestinationBalance ?? false,
          },
        });
      }

      if (
        data.adjustDestinationBalance
        && !existingDestinationLeg?.balanceImpactApplied
        && !existingDestinationLeg?.balanceSupersededByAnchor
      ) {
        await ptx.bankAccount.update({
          where: { id: data.transferToAccountId },
          data: { currentBalance: { increment: Number(original.amount) } },
        });
      }

      return updatedSource;
    }

    if (!data.transferFromAccountId) throw AppError.badRequest('Source account is required');
    if (!original.bankAccountId) throw AppError.badRequest('Destination bank account is required to convert a transaction to transfer');
    if (original.bankAccountId === data.transferFromAccountId) {
      throw AppError.badRequest('Source account must be different from destination account');
    }

    const source = await ptx.bankAccount.findFirst({
      where: { id: data.transferFromAccountId, userId: original.userId },
    });
    if (!source) throw AppError.notFound('Source bank account');
    await lockAccountsForBalanceWrite(ptx, [original.bankAccountId, data.transferFromAccountId]);
    await assertNotBeforeAnchor(ptx, data.transferFromAccountId, original.date);

    const pairId = crypto.randomUUID();
    const existingSourceLeg = await resolveTransferCounterpart(ptx, original, {
      bankAccountId: data.transferFromAccountId,
      type: 'EXPENSE',
      counterpartTransactionId: data.counterpartTransactionId,
    });
    const updatedDestination = await ptx.transaction.update({
      where: { id: original.id },
      data: {
        transferPairId: pairId,
        categoryId: null,
        loanId: null,
        insurancePolicyId: null,
        refundForTransactionId: null,
        balanceImpactApplied: original.balanceImpactApplied ?? true,
        updatedAt: new Date(),
      },
    });

    if (existingSourceLeg) {
      await ptx.transaction.update({
        where: { id: existingSourceLeg.id },
        data: {
          transferPairId: pairId,
          categoryId: null,
          loanId: null,
          insurancePolicyId: null,
          refundForTransactionId: null,
          balanceImpactApplied: data.adjustSourceBalance && !existingSourceLeg.balanceImpactApplied ? true : undefined,
          updatedAt: new Date(),
        },
      });
    } else {
      await ptx.transaction.create({
        data: {
          userId: original.userId,
          bankAccountId: data.transferFromAccountId,
          amount: original.amount,
          type: 'EXPENSE',
          paymentMode: original.paymentMode,
          upiIdUsed: original.upiIdUsed,
          description: original.description,
          remark: original.remark,
          date: original.date,
          tags: original.tags,
          isRecurring: false,
          gstAmount: original.gstAmount,
          transferPairId: pairId,
          balanceImpactApplied: data.adjustSourceBalance ?? false,
        },
      });
    }

    if (
      data.adjustSourceBalance
      && !existingSourceLeg?.balanceImpactApplied
      && !existingSourceLeg?.balanceSupersededByAnchor
    ) {
      await ptx.bankAccount.update({
        where: { id: data.transferFromAccountId },
        data: { currentBalance: { decrement: Number(original.amount) } },
      });
    }

    return updatedDestination;
  });
}

export async function convertTransactionToSIP(
  transactionId: string,
  requesterId: string,
  requesterRole: string,
  data: {
    sipId: string;
    units?: number;
    nav?: number;
  },
) {
  return prisma.$transaction(async (ptx) => {
    const original = await ptx.transaction.findUnique({ where: { id: transactionId } });
    if (!original || original.deletedAt) throw AppError.notFound('Transaction');
    if (requesterRole !== 'ADMIN' && original.userId !== requesterId) throw AppError.forbidden();
    if (original.transferPairId) throw AppError.badRequest('Transfer transactions cannot be marked as SIP');
    if (original.sipId || original.sipTransactionId) throw AppError.badRequest('Transaction is already marked as SIP');
    if (original.insurancePolicyId) throw AppError.badRequest('Policy-linked transactions cannot be marked as SIP');
    if (original.refundForTransactionId) throw AppError.badRequest('Refund transactions cannot be marked as SIP');
    if (original.type !== 'EXPENSE') throw AppError.badRequest('Only outgoing expense transactions can be marked as SIP');
    const refundCount = await ptx.transaction.count({ where: { refundForTransactionId: original.id, deletedAt: null } });
    if (refundCount > 0) throw AppError.badRequest('Transactions with refunds cannot be marked as SIP');

    const sip = await ptx.sIP.findFirst({
      where: { id: data.sipId, userId: original.userId },
      select: { id: true, investmentId: true, bankAccountId: true },
    });
    if (!sip) throw AppError.notFound('SIP');
    if (sip.bankAccountId && sip.bankAccountId !== original.bankAccountId) {
      throw AppError.badRequest('Selected SIP is linked to a different bank account');
    }

    let sipTransactionId: string | null = null;
    if (data.units !== undefined && data.nav !== undefined) {
      const sipTransaction = await ptx.sIPTransaction.create({
        data: {
          investmentId: sip.investmentId,
          date: original.date,
          units: data.units,
          nav: data.nav,
          amount: original.amount,
          type: 'BUY',
        },
      });
      sipTransactionId = sipTransaction.id;
    }

    return ptx.transaction.update({
      where: { id: original.id },
      data: {
        sipId: sip.id,
        sipTransactionId,
        categoryId: null,
        loanId: null,
        insurancePolicyId: null,
        updatedAt: new Date(),
      },
    });
  });
}

export async function updateTransactionSIPLink(
  transactionId: string,
  requesterId: string,
  requesterRole: string,
  data: {
    sipId: string;
    units?: number;
    nav?: number;
  },
) {
  return prisma.$transaction(async (ptx) => {
    const original = await ptx.transaction.findUnique({ where: { id: transactionId } });
    if (!original || original.deletedAt) throw AppError.notFound('Transaction');
    if (requesterRole !== 'ADMIN' && original.userId !== requesterId) throw AppError.forbidden();
    if (original.transferPairId) throw AppError.badRequest('Transfer transactions cannot be linked to SIP');
    if (!original.sipId && !original.sipTransactionId) throw AppError.badRequest('Transaction is not marked as SIP');
    if (original.refundForTransactionId) throw AppError.badRequest('Refund transactions cannot be linked to SIP');
    if (original.type !== 'EXPENSE') throw AppError.badRequest('Only outgoing expense transactions can be linked to SIP');

    const sip = await ptx.sIP.findFirst({
      where: { id: data.sipId, userId: original.userId },
      select: { id: true, investmentId: true, bankAccountId: true },
    });
    if (!sip) throw AppError.notFound('SIP');
    if (sip.bankAccountId && sip.bankAccountId !== original.bankAccountId) {
      throw AppError.badRequest('Selected SIP is linked to a different bank account');
    }

    if (original.sipTransactionId) {
      await ptx.sIPTransaction.delete({ where: { id: original.sipTransactionId } });
    }

    let sipTransactionId: string | null = null;
    if (data.units !== undefined && data.nav !== undefined) {
      const sipTransaction = await ptx.sIPTransaction.create({
        data: {
          investmentId: sip.investmentId,
          date: original.date,
          units: data.units,
          nav: data.nav,
          amount: original.amount,
          type: 'BUY',
        },
      });
      sipTransactionId = sipTransaction.id;
    }

    return ptx.transaction.update({
      where: { id: original.id },
      data: {
        sipId: sip.id,
        sipTransactionId,
        categoryId: null,
        loanId: null,
        insurancePolicyId: null,
        updatedAt: new Date(),
      },
    });
  });
}

export async function removeTransactionSIPLink(
  transactionId: string,
  requesterId: string,
  requesterRole: string,
) {
  return prisma.$transaction(async (ptx) => {
    const original = await ptx.transaction.findUnique({ where: { id: transactionId } });
    if (!original || original.deletedAt) throw AppError.notFound('Transaction');
    if (requesterRole !== 'ADMIN' && original.userId !== requesterId) throw AppError.forbidden();
    if (!original.sipId && !original.sipTransactionId) throw AppError.badRequest('Transaction is not marked as SIP');

    if (original.sipTransactionId) {
      await ptx.sIPTransaction.delete({ where: { id: original.sipTransactionId } });
    }

    return ptx.transaction.update({
      where: { id: original.id },
      data: {
        sipId: null,
        sipTransactionId: null,
        updatedAt: new Date(),
      },
    });
  });
}

export async function updateTransactionInsurancePolicyLink(
  transactionId: string,
  requesterId: string,
  requesterRole: string,
  data: { insurancePolicyId: string },
) {
  return prisma.$transaction(async (ptx) => {
    const original = await ptx.transaction.findUnique({ where: { id: transactionId } });
    if (!original || original.deletedAt) throw AppError.notFound('Transaction');
    if (requesterRole !== 'ADMIN' && original.userId !== requesterId) throw AppError.forbidden();
    if (original.transferPairId) throw AppError.badRequest('Transfer transactions cannot be linked to an insurance policy');
    if (original.sipId || original.sipTransactionId) throw AppError.badRequest('SIP transactions cannot be linked to an insurance policy');
    if (original.refundForTransactionId) throw AppError.badRequest('Refund transactions cannot be linked to an insurance policy');
    if (original.type !== 'EXPENSE') throw AppError.badRequest('Only outgoing expense transactions can be linked to an insurance policy');
    const refundCount = await ptx.transaction.count({ where: { refundForTransactionId: original.id, deletedAt: null } });
    if (refundCount > 0) throw AppError.badRequest('Transactions with refunds cannot be linked to an insurance policy');

    const policy = await ptx.insurancePolicy.findFirst({
      where: { id: data.insurancePolicyId, userId: original.userId },
      select: { id: true },
    });
    if (!policy) throw AppError.notFound('Insurance policy');

    return ptx.transaction.update({
      where: { id: original.id },
      data: {
        insurancePolicyId: policy.id,
        loanId: null,
        updatedAt: new Date(),
      },
    });
  });
}

export async function removeTransactionInsurancePolicyLink(
  transactionId: string,
  requesterId: string,
  requesterRole: string,
) {
  return prisma.$transaction(async (ptx) => {
    const original = await ptx.transaction.findUnique({ where: { id: transactionId } });
    if (!original || original.deletedAt) throw AppError.notFound('Transaction');
    if (requesterRole !== 'ADMIN' && original.userId !== requesterId) throw AppError.forbidden();
    if (!original.insurancePolicyId) throw AppError.badRequest('Transaction is not linked to an insurance policy');

    return ptx.transaction.update({
      where: { id: original.id },
      data: {
        insurancePolicyId: null,
        updatedAt: new Date(),
      },
    });
  });
}

export async function updateTransactionRefundLink(
  transactionId: string,
  requesterId: string,
  requesterRole: string,
  data: { refundForTransactionId: string },
) {
  return prisma.$transaction(async (ptx) => {
    const refund = await ptx.transaction.findUnique({ where: { id: transactionId } });
    if (!refund || refund.deletedAt) throw AppError.notFound('Transaction');
    if (requesterRole !== 'ADMIN' && refund.userId !== requesterId) throw AppError.forbidden();
    if (refund.transferPairId) throw AppError.badRequest('Transfer transactions cannot be linked as refunds');
    if (refund.sipId || refund.sipTransactionId) throw AppError.badRequest('SIP transactions cannot be linked as refunds');
    if (refund.insurancePolicyId) throw AppError.badRequest('Policy-linked transactions cannot be linked as refunds');
    if (refund.type !== 'INCOME') throw AppError.badRequest('Only incoming transactions can be linked as refunds');
    if (refund.id === data.refundForTransactionId) throw AppError.badRequest('A transaction cannot refund itself');

    const originalExpense = await ptx.transaction.findFirst({
      where: { id: data.refundForTransactionId, userId: refund.userId, deletedAt: null, type: 'EXPENSE' },
      select: { id: true, transferPairId: true },
    });
    if (!originalExpense) throw AppError.notFound('Original expense transaction');
    if (originalExpense.transferPairId) throw AppError.badRequest('Transfer transactions cannot be refunded');

    return ptx.transaction.update({
      where: { id: refund.id },
      data: {
        refundForTransactionId: originalExpense.id,
        updatedAt: new Date(),
      },
    });
  });
}

export async function removeTransactionRefundLink(
  transactionId: string,
  requesterId: string,
  requesterRole: string,
) {
  return prisma.$transaction(async (ptx) => {
    const refund = await ptx.transaction.findUnique({ where: { id: transactionId } });
    if (!refund || refund.deletedAt) throw AppError.notFound('Transaction');
    if (requesterRole !== 'ADMIN' && refund.userId !== requesterId) throw AppError.forbidden();
    if (!refund.refundForTransactionId) throw AppError.badRequest('Transaction is not linked as a refund');

    return ptx.transaction.update({
      where: { id: refund.id },
      data: {
        refundForTransactionId: null,
        updatedAt: new Date(),
      },
    });
  });
}

export async function softDeleteTransaction(
  transactionId: string,
  userId: string,
  requesterRole: string,
) {
  return prisma.$transaction(async (ptx) => {
    let original = await ptx.transaction.findUnique({ where: { id: transactionId } });
    if (!original || original.deletedAt) throw AppError.notFound('Transaction');
    if (requesterRole !== 'ADMIN' && original.userId !== userId) throw AppError.forbidden();
    const activeRefundCount = await ptx.transaction.count({
      where: { refundForTransactionId: original.id, deletedAt: null },
    });
    if (activeRefundCount > 0) {
      throw AppError.badRequest('Remove refund links before deleting the original expense');
    }

    // Look up the paired leg (if any) for its account id only, then lock every
    // involved BankAccount BEFORE trusting original's balanceSupersededByAnchor — it
    // was read before the lock and a concurrent applyAnchor could have committed in
    // between. Re-read original fresh once the lock is held. (The paired leg's own flag
    // carries the same narrower residual risk — a transfer-pair delete racing a
    // concurrent anchor change on specifically the OTHER leg's account — accepted here
    // rather than adding a second, differently-keyed re-read.)
    const paired = original.transferPairId
      ? await ptx.transaction.findFirst({
          where: { transferPairId: original.transferPairId, id: { not: transactionId }, deletedAt: null },
        })
      : null;
    await lockAccountsForBalanceWrite(ptx, [original.bankAccountId, paired?.bankAccountId]);
    original = await ptx.transaction.findUniqueOrThrow({ where: { id: transactionId } });

    const deleted = await ptx.transaction.update({
      where: { id: transactionId },
      // Free the importHash slot on delete: @@unique([importHash]) is enforced even for
      // soft-deleted rows (Prisma/Postgres only treat NULL as non-conflicting), so
      // without this a re-import of the same statement after deleting this row would
      // hard-fail the whole batch on the unique constraint instead of recreating it.
      data: { deletedAt: new Date(), importHash: original.importHash ? null : undefined },
    });

    // Reverse the balance impact of this transaction
    if (original.bankAccountId && contributesToBalance(original)) {
      const reversal = -balanceDelta(original.type, Number(original.amount));
      await ptx.bankAccount.update({
        where: { id: original.bankAccountId },
        data: { currentBalance: { increment: reversal } },
      });
    }

    // Cascade to paired TRANSFER leg (atomically in the same $transaction)
    if (paired) {
      await ptx.transaction.update({
        where: { id: paired.id },
        data: { deletedAt: new Date(), importHash: paired.importHash ? null : undefined },
      });
      if (paired.bankAccountId && contributesToBalance(paired)) {
        const pairedReversal = -balanceDelta(paired.type, Number(paired.amount));
        await ptx.bankAccount.update({
          where: { id: paired.bankAccountId },
          data: { currentBalance: { increment: pairedReversal } },
        });
      }
    }

    if (original.sipTransactionId) {
      await ptx.sIPTransaction.delete({ where: { id: original.sipTransactionId } });
    }

    return deleted;
  });
}

export interface ExportFilters {
  userId?: string;
  fy?: string;
  startDate?: string;
  endDate?: string;
  type?: string;
  types?: string[];
  categoryId?: string;
  categoryIds?: string[];
  paymentMode?: string;
  paymentModes?: string[];
  bankAccountId?: string;
}

export async function getAllTransactionsForExport(
  requesterId: string,
  requesterRole: string,
  filters: ExportFilters,
) {
  const userId = requesterRole === 'ADMIN' ? filters.userId : requesterId;
  const where: Prisma.TransactionWhereInput = {
    ...(userId ? { userId } : {}),
    deletedAt: null,
  };

  if (filters.bankAccountId) where.bankAccountId = filters.bankAccountId;
  if (filters.categoryIds?.length) {
    where.categoryId = { in: filters.categoryIds };
  } else if (filters.categoryId) {
    where.categoryId = filters.categoryId;
  }
  if (filters.types?.length) {
    where.type = { in: filters.types as TransactionType[] };
  } else if (filters.type) {
    where.type = filters.type as TransactionType;
  }
  if (filters.paymentModes?.length) {
    where.paymentMode = { in: filters.paymentModes as PaymentMode[] };
  } else if (filters.paymentMode) {
    where.paymentMode = filters.paymentMode as PaymentMode;
  }

  const dateFilter = buildDateFilter(filters);
  if (dateFilter) where.date = dateFilter;

  return prisma.transaction.findMany({
    where,
    orderBy: { date: 'desc' },
    take: 10_000, // safety cap
    include: {
      category: { select: { name: true } },
      bankAccount: { select: { bankName: true, accountNumberLast4: true } },
      sip: { select: { fundName: true } },
      insurancePolicy: { select: { policyName: true, providerName: true, policyNumber: true } },
      refundFor: { select: { description: true, amount: true, date: true } },
    },
  });
}

export function buildCsv(rows: Awaited<ReturnType<typeof getAllTransactionsForExport>>): string {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const headers = ['Date', 'Description', 'Remark', 'Type', 'Amount', 'Category', 'SIP', 'Policy', 'RefundFor', 'Account', 'PaymentMode', 'Tags'];
  const lines: string[] = [headers.join(',')];
  for (const r of rows) {
    lines.push([
      r.date.toISOString().slice(0, 10),
      escape(r.description),
      escape(r.remark ?? ''),
      r.type,
      Number(r.amount).toFixed(2),
      escape(r.category?.name ?? ''),
      escape(r.sip?.fundName ?? ''),
      escape(r.insurancePolicy ? `${r.insurancePolicy.providerName} · ${r.insurancePolicy.policyName}` : ''),
      escape(r.refundFor ? `${r.refundFor.description} (${r.refundFor.date.toISOString().slice(0, 10)}, ₹${Number(r.refundFor.amount).toFixed(2)})` : ''),
      escape(r.bankAccount ? `${r.bankAccount.bankName} ····${r.bankAccount.accountNumberLast4 ?? ''}` : ''),
      escape(r.paymentMode ?? ''),
      escape(r.tags.join(';')),
    ].join(','));
  }
  return lines.join('\r\n');
}
