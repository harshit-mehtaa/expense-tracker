import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import type { Prisma } from '@prisma/client';

export async function getLoans(userId: string) {
  return prisma.loan.findMany({
    where: { userId },
    orderBy: { emiDate: 'asc' },
  });
}

export async function createLoan(userId: string, data: Omit<Prisma.LoanCreateInput, 'user'>) {
  return prisma.loan.create({ data: { ...data, userId } });
}

export async function updateLoan(userId: string, id: string, data: Prisma.LoanUpdateInput) {
  const loan = await prisma.loan.findFirst({ where: { id, userId } });
  if (!loan) throw AppError.notFound('Loan');
  return prisma.loan.update({ where: { id }, data });
}

export async function deleteLoan(userId: string, id: string) {
  const loan = await prisma.loan.findFirst({ where: { id, userId } });
  if (!loan) throw AppError.notFound('Loan');
  return prisma.loan.delete({ where: { id } });
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

export async function getLoanAmortization(userId: string, id: string) {
  const loan = await prisma.loan.findFirst({ where: { id, userId } });
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
  userId: string,
  id: string,
  prepaymentAmount: number,
  mode: 'reduce_tenure' | 'reduce_emi',
) {
  const loan = await prisma.loan.findFirst({ where: { id, userId } });
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
    const monthlyRate = rate / 100 / 12;
    const newEmi = (newOutstanding * monthlyRate * Math.pow(1 + monthlyRate, remainingMonths))
      / (Math.pow(1 + monthlyRate, remainingMonths) - 1);
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
    prepaymentCharges: Number(loan.prepaymentChargesPct ?? 0) * prepaymentAmount / 100,
  };
}
