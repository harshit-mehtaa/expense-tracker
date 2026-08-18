import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { normalizeOwnerShares, assertPrimaryOwnerRetained } from '../utils/ownerShares';
import { computeEmi, deriveEndDate } from '../utils/loanMath';
import { createTransaction } from './transactionService';
import type { Prisma, LoanType } from '@prisma/client';

export interface LoanOwnerInput {
  userId: string;
  sharePercent: number;
}

/** Loan types secured against collateral — these must name the asset they're against. */
const SECURED_LOAN_TYPES: LoanType[] = ['HOME', 'AUTO', 'LAP', 'GOLD'];

// ─── Visibility ───────────────────────────────────────────────────────────────
//
// These are file-local ON PURPOSE, exactly as investmentService keeps
// userRealEstateWhere/userRealEstateWriteWhere private rather than promoting them into
// resolveTargetUserId. The shared `ownerScopedWhere` has ~52 call sites across 11
// entities and a flat `{ id, userId? }` shape with no OR; adding a co-owner clause there
// would silently widen visibility for budgets, insurance, capital gains and eight others.
// A loan-shaped predicate belongs to loans.

function userLoanWhere(userId: string): Prisma.LoanWhereInput {
  return {
    OR: [
      { userId },
      { owners: { some: { userId } } },
    ],
  };
}

function userLoanWriteWhere(id: string, requesterId: string, requesterRole: string): Prisma.LoanWhereInput {
  if (requesterRole === 'ADMIN') return { id };
  return {
    id,
    OR: [
      { userId: requesterId },
      { owners: { some: { userId: requesterId } } },
    ],
  };
}

// ─── Owners ───────────────────────────────────────────────────────────────────

function normalizeLoanOwners(defaultUserId: string, owners?: LoanOwnerInput[]) {
  return normalizeOwnerShares(defaultUserId, owners, 'Loan owner');
}

async function assertActiveLoanOwners(owners: LoanOwnerInput[]) {
  const ownerIds = owners.map((owner) => owner.userId);
  const activeUsers = await prisma.user.findMany({
    where: { id: { in: ownerIds }, isActive: true, deletedAt: null },
    select: { id: true },
  });
  const activeIds = new Set(activeUsers.map((user) => user.id));
  const missing = ownerIds.find((ownerId) => !activeIds.has(ownerId));
  if (missing) throw AppError.validationError('All loan owners must be active family members');
}

/**
 * Secured loans must name their collateral.
 *
 * Enforced here rather than only in the route's Zod schema because the update route
 * parses with `.partial()`, so a PUT body of `{ loanType: 'HOME' }` carries no assetId
 * for a refinement to inspect — the check has to see the MERGED state, which only the
 * service has.
 */
/**
 * The linked asset must belong to the loan's owner.
 *
 * Presence alone is not enough: `loanInclude` returns the asset, so accepting an
 * arbitrary id would let one family member attach another's asset to their loan and
 * read its name, value and notes straight back out. It would also block the real owner
 * from deleting their own asset, since deleteAsset refuses while a loan is attached.
 * Mirrors the bankAccount ownership check in transactionService.
 */
async function assertAssetOwned(userId: string, assetId: string | null | undefined) {
  if (!assetId) return;
  const asset = await prisma.asset.findFirst({ where: { id: assetId, userId }, select: { id: true } });
  if (!asset) throw AppError.notFound('Asset');
}

export function assertAssetRequired(loanType: LoanType, assetId: string | null | undefined) {
  if (SECURED_LOAN_TYPES.includes(loanType) && !assetId) {
    throw AppError.validationError(
      `A ${loanType} loan is secured and must be linked to an asset`,
    );
  }
}

/** Attaches the requesting user's share, plus their proportion of the money figures. */
function decorateLoan(row: any, scopedUserId?: string) {
  const { user, owners = [], ...loan } = row;
  const ownerRows = owners.map((o: any) => ({
    userId: o.userId,
    sharePercent: Number(o.sharePercent),
    userName: o.user?.name ?? '',
  }));

  // When owner rows exist they ARE the source of truth — do NOT also fall back to 100%
  // for the primary. A loan can legitimately have owners:[{B:100}] while Loan.userId is
  // A (A created it, then assigned the whole share to B); crediting A 100% as well made
  // BOTH report the full balance and BOTH claim the full section 24B interest.
  // ownerRows.length === 0 covers loans predating the owners table.
  const sharePercent = scopedUserId
    ? ownerRows.find((o: any) => o.userId === scopedUserId)?.sharePercent
      ?? (ownerRows.length === 0 ? 100 : 0)
    : 100;
  const multiplier = sharePercent / 100;

  return {
    ...loan,
    userName: user?.name ?? '',
    owners: ownerRows,
    sharePercent,
    // Rounded to the paisa so the API never emits 1499999.9999999998.
    outstandingBalanceShare: Math.round(Number(loan.outstandingBalance) * multiplier * 100) / 100,
    emiAmountShare: Math.round(Number(loan.emiAmount) * multiplier * 100) / 100,
  };
}

const loanInclude = {
  user: { select: { name: true } },
  owners: { include: { user: { select: { name: true } } } },
  asset: true,
} as const;

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function getLoans(userId?: string) {
  const rows = await prisma.loan.findMany({
    where: userId ? userLoanWhere(userId) : {},
    include: loanInclude,
    orderBy: { emiDate: 'asc' },
  });
  return rows.map((row) => decorateLoan(row, userId));
}

export async function createLoan(
  userId: string,
  data: Omit<Prisma.LoanCreateInput, 'user'>,
  owners?: LoanOwnerInput[],
) {
  assertAssetRequired(data.loanType as LoanType, (data as any).assetId);
  await assertAssetOwned(userId, (data as any).assetId);
  const ownerRows = normalizeLoanOwners(userId, owners);
  await assertActiveLoanOwners(ownerRows);

  const loan = await prisma.loan.create({
    data: {
      ...data,
      userId,
      owners: { create: ownerRows.map((o) => ({ userId: o.userId, sharePercent: o.sharePercent })) },
    } as Prisma.LoanUncheckedCreateInput,
    include: loanInclude,
  });
  return decorateLoan(loan, userId);
}

export async function updateLoan(
  requesterId: string,
  id: string,
  data: Prisma.LoanUpdateInput,
  requesterRole = 'MEMBER',
  owners?: LoanOwnerInput[],
) {
  const loan = await prisma.loan.findFirst({ where: userLoanWriteWhere(id, requesterId, requesterRole) });
  if (!loan) throw AppError.notFound('Loan');

  // Validate against the MERGED state: a partial update changing only loanType must
  // still be checked against the asset already on the row.
  const nextLoanType = (data.loanType as LoanType | undefined) ?? loan.loanType;
  const nextAssetId = 'assetId' in data ? (data as any).assetId : loan.assetId;
  assertAssetRequired(nextLoanType, nextAssetId);
  // Scoped to the loan's owner, not the requester — a co-owner attaching an asset must
  // attach one the loan's owner holds, not one of their own.
  if ('assetId' in data) await assertAssetOwned(loan.userId, nextAssetId);

  let ownerRows: ReturnType<typeof normalizeLoanOwners> | undefined;
  if (owners !== undefined) {
    assertPrimaryOwnerRetained(owners, loan.userId, requesterId, requesterRole, 'Loan owner');
    // Default from the ROW's owner, never the requester — otherwise a co-owner could
    // reassign the loan to themselves by sending an empty owners array.
    ownerRows = normalizeLoanOwners(loan.userId, owners);
    await assertActiveLoanOwners(ownerRows);
  }

  const updated = await prisma.loan.update({
    where: { id },
    data: {
      ...data,
      ...(ownerRows
        ? { owners: { deleteMany: {}, create: ownerRows.map((o) => ({ userId: o.userId, sharePercent: o.sharePercent })) } }
        : {}),
    },
    include: loanInclude,
  });
  // undefined for an ADMIN, matching the GET path: an admin is not an owner, and
  // decorating with their id would write sharePercent 0 into the audit newValue.
  return decorateLoan(updated, requesterRole === 'ADMIN' ? undefined : requesterId);
}

export async function deleteLoan(requesterId: string, id: string, requesterRole = 'MEMBER') {
  const loan = await prisma.loan.findFirst({ where: userLoanWriteWhere(id, requesterId, requesterRole) });
  if (!loan) throw AppError.notFound('Loan');
  return prisma.loan.delete({ where: { id } });
}

/**
 * Snapshot fetch for audit logging — not an authorization check. updateLoan/deleteLoan
 * still enforce access via their own userLoanWriteWhere lookup; this only captures the
 * pre-mutation state for `recordAuditLog`.
 */
export async function getLoanForAudit(requesterId: string, id: string, requesterRole = 'MEMBER') {
  return prisma.loan.findFirst({ where: userLoanWriteWhere(id, requesterId, requesterRole) });
}

// ─── Amortization Schedule ────────────────────────────────────────────────────

export interface AmortizationRow {
  month: number;
  date: Date;
  openingBalance: number;
  emi: number;
  principal: number;
  interest: number;
  closingBalance: number;
  totalInterestPaid: number;
}

export function buildAmortizationSchedule(
  outstanding: number,
  annualRatePct: number,
  emiAmount: number,
  emiDate: number,
  startDate: Date,
): AmortizationRow[] {
  const monthlyRate = annualRatePct / 100 / 12;

  // Guard: EMI must exceed first month's interest, otherwise balance would grow infinitely
  if (outstanding > 0 && emiAmount <= outstanding * monthlyRate) {
    throw AppError.badRequest(
      `EMI (₹${emiAmount.toFixed(2)}) must be greater than first month's interest (₹${(outstanding * monthlyRate).toFixed(2)})`,
    );
  }

  const rows: AmortizationRow[] = [];
  let balance = outstanding;
  let totalInterest = 0;
  let month = 0;

  const date = new Date(startDate);

  while (balance > 0.5 && rows.length < 360) {
    month++;
    const interest = balance * monthlyRate;
    const principal = Math.min(emiAmount - interest, balance);
    const closingBalance = Math.max(balance - principal, 0);
    totalInterest += interest;

    rows.push({
      month,
      date: new Date(date),
      openingBalance: balance,
      emi: emiAmount,
      principal,
      interest,
      closingBalance,
      totalInterestPaid: totalInterest,
    });

    balance = closingBalance;
    date.setMonth(date.getMonth() + 1);
  }

  return rows;
}

export async function getLoanAmortization(userId: string | undefined, id: string) {
  // Owner-inclusive: a co-owner must be able to see the schedule for a loan they
  // partly hold. `undefined` userId is the ADMIN family-wide path.
  const loan = await prisma.loan.findFirst({ where: userId ? { id, ...userLoanWhere(userId) } : { id } });
  if (!loan) throw AppError.notFound('Loan');

  const schedule = buildAmortizationSchedule(
    Number(loan.outstandingBalance),
    Number(loan.interestRate),
    Number(loan.emiAmount),
    loan.emiDate,
    new Date(),
  );

  const totalInterest = schedule.reduce((s, r) => s + r.interest, 0);
  const remainingMonths = schedule.length;

  return { loan, schedule, summary: { totalInterest, remainingMonths } };
}

// ─── Prepayment Simulation ────────────────────────────────────────────────────

export async function simulatePrepayment(
  userId: string | undefined,
  id: string,
  prepaymentAmount: number,
  mode: 'reduce_tenure' | 'reduce_emi',
) {
  // Owner-inclusive: a co-owner must be able to see the schedule for a loan they
  // partly hold. `undefined` userId is the ADMIN family-wide path.
  const loan = await prisma.loan.findFirst({ where: userId ? { id, ...userLoanWhere(userId) } : { id } });
  if (!loan) throw AppError.notFound('Loan');

  const outstanding = Number(loan.outstandingBalance);
  const rate = Number(loan.interestRate);
  const emi = Number(loan.emiAmount);

  // Current schedule
  const current = buildAmortizationSchedule(outstanding, rate, emi, loan.emiDate, new Date());
  const currentTotalInterest = current.reduce((s, r) => s + r.interest, 0);

  const newOutstanding = Math.max(outstanding - prepaymentAmount, 0);

  let afterSchedule: AmortizationRow[];
  if (mode === 'reduce_emi') {
    // Recalculate EMI for remaining tenure
    const remainingMonths = current.length;
    // Same formula the loan form derives from — shared so the two can never disagree.
    // Falls back to the existing EMI when the prepayment clears the balance entirely
    // (newOutstanding === 0), where there is nothing left to amortise.
    const newEmi = computeEmi(newOutstanding, rate, remainingMonths) ?? Number(loan.emiAmount);
    afterSchedule = buildAmortizationSchedule(newOutstanding, rate, newEmi, loan.emiDate, new Date());
  } else {
    afterSchedule = buildAmortizationSchedule(newOutstanding, rate, emi, loan.emiDate, new Date());
  }

  const newTotalInterest = afterSchedule.reduce((s, r) => s + r.interest, 0);

  return {
    current: { months: current.length, totalInterest: currentTotalInterest },
    after: { months: afterSchedule.length, totalInterest: newTotalInterest },
    savings: {
      interestSaved: currentTotalInterest - newTotalInterest,
      monthsSaved: current.length - afterSchedule.length,
    },
    // A flat fee now, not a percentage of the prepayment — so it no longer scales
    // with how much is being repaid.
    prepaymentCharges: Number(loan.prepaymentChargesAmount ?? 0),
  };
}

// ─── Prepayment Recording ──────────────────────────────────────────────────────

export interface RecordPrepaymentInput {
  amount: number;
  date: string;
  mode: 'reduce_tenure' | 'reduce_emi';
  notes?: string | null;
  bankAccountId?: string | null;
  categoryId?: string | null;
}

/**
 * Records a prepayment that actually happened, as opposed to `simulatePrepayment`'s
 * what-if. Two things must both be true afterward, or the feature is worse than not
 * having it: (1) the loan's numbers reflect it, and (2) net worth still balances — a
 * liability that drops with no matching drop in an asset silently inflates net worth by
 * the prepayment amount (the same class of bug credit card double-counting produced
 * earlier: liabilities/assets must move together, not just one side).
 *
 * Reuses the EXACT primitives `simulatePrepayment` uses (`buildAmortizationSchedule`,
 * `computeEmi`) rather than re-deriving the numbers, so what gets applied can never
 * silently differ from what the user was shown before confirming.
 *
 * Money movement goes through `createTransaction` — an ordinary EXPENSE linked via
 * `loanId`, the SAME mechanism a normal EMI payment already uses — rather than writing
 * `outstandingBalance` here directly. That decrement is the single most drift-prone
 * field in this codebase (this project's own tech debt log already carries two other
 * "two writers, one field" bugs); routing through the one existing writer keeps it a
 * writer, not two.
 *
 * `createTransaction` opens its own `prisma.$transaction` and cannot join an outer one,
 * so this is NOT a single atomic unit — it is two: money movement (transaction + balance
 * decrement) always succeeds or fully rolls back on its own, and the LoanPrepayment
 * audit row + EMI/tenure update run as a second unit immediately after. A failure in the
 * second unit leaves a correctly-decremented loan and a real ledger entry with no
 * schedule-metadata explaining it — recoverable by retrying, not by the money being
 * wrong.
 */
export async function recordLoanPrepayment(
  requesterId: string,
  requesterRole: string,
  loanId: string,
  input: RecordPrepaymentInput,
) {
  const loan = await prisma.loan.findFirst({ where: userLoanWriteWhere(loanId, requesterId, requesterRole) });
  if (!loan) throw AppError.notFound('Loan');

  const outstanding = Number(loan.outstandingBalance);
  const rate = Number(loan.interestRate);
  const emi = Number(loan.emiAmount);

  // Same shape as simulatePrepayment: schedule from today, at today's balance and EMI.
  const current = buildAmortizationSchedule(outstanding, rate, emi, loan.emiDate, new Date());
  const newOutstanding = Math.max(outstanding - input.amount, 0);

  let newEmi = emi;
  let afterSchedule: AmortizationRow[];
  if (input.mode === 'reduce_emi') {
    const remainingMonths = current.length;
    newEmi = computeEmi(newOutstanding, rate, remainingMonths) ?? emi;
    afterSchedule = buildAmortizationSchedule(newOutstanding, rate, newEmi, loan.emiDate, new Date());
  } else {
    afterSchedule = buildAmortizationSchedule(newOutstanding, rate, emi, loan.emiDate, new Date());
  }
  const monthsSaved = current.length - afterSchedule.length;

  // The money movement. This is what actually validates `amount <= outstandingBalance`
  // (createTransaction's own check) and decrements outstandingBalance — the ONLY write
  // to that field anywhere in this flow. Attributed to the loan's primary owner, not the
  // requester: a co-owner recording a prepayment does not have their own account checked
  // against — the loan's balance and ledger belong to one owning user, same as every
  // other loan mutation in this codebase.
  const transaction = await createTransaction(loan.userId, {
    bankAccountId: input.bankAccountId ?? undefined,
    categoryId: input.categoryId ?? undefined,
    amount: input.amount,
    type: 'EXPENSE',
    description: `Loan prepayment — ${loan.lenderName}`,
    date: input.date,
    loanId,
  });

  // tenureMonths is TOTAL tenure from firstEmiDate/disbursementDate, not months
  // remaining — deriveEndDate (the same util loan creation uses) counts forward from
  // the start, so the two must agree. `current.length` is remaining months as of today,
  // so `loan.tenureMonths - current.length` is how much has already elapsed.
  const loanUpdate: Prisma.LoanUpdateInput = input.mode === 'reduce_emi'
    ? { emiAmount: newEmi }
    : (() => {
        const elapsedMonths = loan.tenureMonths - current.length;
        const newTenureMonths = elapsedMonths + afterSchedule.length;
        return {
          tenureMonths: newTenureMonths,
          endDate: deriveEndDate(loan.disbursementDate, newTenureMonths, loan.firstEmiDate) ?? loan.endDate,
        };
      })();

  const [prepayment, updatedLoan] = await prisma.$transaction([
    prisma.loanPrepayment.create({
      data: {
        loanId,
        amount: input.amount,
        date: new Date(input.date),
        notes: input.notes ?? null,
        reducedEmi: input.mode === 'reduce_emi' ? newEmi : null,
        tenureReduced: input.mode === 'reduce_tenure' ? monthsSaved : null,
      },
    }),
    prisma.loan.update({ where: { id: loanId }, data: loanUpdate }),
  ]);

  return { transaction, prepayment, loan: updatedLoan };
}

/**
 * Prepayment history. Visibility mirrors `getLoanAmortization` — same read-scope, not
 * the write-scope `recordLoanPrepayment` uses. A writer with no reader anywhere is the
 * exact defect this whole feature exists to fix (see DQ1); this exists so recording one
 * is not itself the same mistake in miniature.
 */
export async function listLoanPrepayments(userId: string | undefined, id: string) {
  const loan = await prisma.loan.findFirst({ where: userId ? { id, ...userLoanWhere(userId) } : { id } });
  if (!loan) throw AppError.notFound('Loan');
  return prisma.loanPrepayment.findMany({ where: { loanId: id }, orderBy: { date: 'desc' } });
}
