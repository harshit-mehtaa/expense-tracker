import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { normalizeOwnerShares, assertPrimaryOwnerRetained } from '../utils/ownerShares';
import { computeEmi } from '../utils/loanMath';
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
