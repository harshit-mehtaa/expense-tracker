import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { getFYRange, getCurrentFY, getPreviousFY } from '../utils/financialYear';

export async function getDashboardSummary(userId: string, requesterRole: string, fy?: string) {
  const currentFY = fy ?? getCurrentFY();
  const previousFY = getPreviousFY(currentFY);

  const currentRange = getFYRange(currentFY);
  const previousRange = getFYRange(previousFY);

  // Use admin-scoped or user-scoped query
  const userFilter = requesterRole === 'ADMIN' ? {} : { userId };

  const [currentIncome, currentExpense, prevIncome, prevExpense] = await Promise.all([
    getIncomeForPeriod(userFilter, currentRange),
    getExpenseForPeriod(userFilter, currentRange),
    getIncomeForPeriod(userFilter, previousRange),
    getExpenseForPeriod(userFilter, previousRange),
  ]);

  const netWorth = await getNetWorth(requesterRole === 'ADMIN' ? undefined : userId);
  const prevNetWorth = await getNetWorth(requesterRole === 'ADMIN' ? undefined : userId, previousRange.end);

  const savingsRate =
    currentIncome > 0 ? ((currentIncome - currentExpense) / currentIncome) * 100 : 0;

  return {
    fyYear: currentFY,
    netWorth,
    netWorthChange: netWorth - prevNetWorth,
    netWorthChangePct: prevNetWorth !== 0 ? ((netWorth - prevNetWorth) / prevNetWorth) * 100 : 0,
    totalIncome: currentIncome,
    totalExpense: currentExpense,
    savingsRate: Math.round(savingsRate * 100) / 100,
    totalAssets: await getTotalAssets(requesterRole === 'ADMIN' ? undefined : userId),
    totalLiabilities: await getTotalLiabilities(requesterRole === 'ADMIN' ? undefined : userId),
  };
}

export async function getCashflow(userId: string, requesterRole: string, fy?: string) {
  const currentFY = fy ?? getCurrentFY();
  const { start, end } = getFYRange(currentFY);

  const userFilter: Prisma.TransactionWhereInput =
    requesterRole === 'ADMIN' ? {} : { userId };

  // Get monthly aggregates for the FY (Apr = month 4 through Mar = month 3)
  const results = await prisma.$queryRaw<
    Array<{ month: number; year: number; income: number; expense: number }>
  >`
    SELECT
      EXTRACT(MONTH FROM date AT TIME ZONE 'Asia/Kolkata')::int AS month,
      EXTRACT(YEAR FROM date AT TIME ZONE 'Asia/Kolkata')::int AS year,
      SUM(CASE WHEN type = 'INCOME' THEN amount ELSE 0 END)::float AS income,
      SUM(CASE WHEN type = 'EXPENSE' THEN amount ELSE 0 END)::float AS expense
    FROM transactions
    WHERE
      date >= ${start}
      AND date <= ${end}
      AND deleted_at IS NULL
      ${requesterRole !== 'ADMIN' ? Prisma.sql`AND user_id = ${userId}` : Prisma.empty}
    GROUP BY month, year
    ORDER BY year, month
  `;

  // Build a full 12-month series (Apr to Mar) filling zeros for empty months
  const monthNames = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
  const startYear = parseInt(currentFY.split('-')[0]);

  return monthNames.map((name, idx) => {
    const month = idx < 9 ? idx + 4 : idx - 8; // Apr=4...Dec=12, Jan=1...Mar=3
    const year = month >= 4 ? startYear : startYear + 1;
    const data = results.find((r) => r.month === month && r.year === year);

    return {
      month: name,
      monthIndex: month,
      year,
      income: data?.income ?? 0,
      expense: data?.expense ?? 0,
      net: (data?.income ?? 0) - (data?.expense ?? 0),
    };
  });
}

export async function getUpcomingAlerts(userId: string, requesterRole: string) {
  const now = new Date();
  const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const userFilter = requesterRole === 'ADMIN' ? {} : { userId };

  const [fdsMaturingSoon, sipdueThisMonth, insurancePremiumsDue, loansWithEmi, advanceTax] =
    await Promise.all([
      // FDs maturing in 30 days
      prisma.fixedDeposit.findMany({
        where: {
          ...userFilter,
          status: 'ACTIVE',
          maturityDate: { gte: now, lte: thirtyDaysOut },
        },
        select: { id: true, bankName: true, maturityDate: true, maturityAmount: true },
      }),
      // SIPs due this month
      prisma.sIP.findMany({
        where: { ...userFilter, status: 'ACTIVE' },
        select: { id: true, fundName: true, monthlyAmount: true, sipDate: true },
      }),
      // Insurance premiums due in 30 days
      prisma.insurancePolicy.findMany({
        where: {
          ...userFilter,
          endDate: { gte: now },
          premiumDueDate: { not: null },
        },
        select: {
          id: true,
          policyName: true,
          providerName: true,
          premiumAmount: true,
          premiumDueDate: true,
          premiumFrequency: true,
        },
      }),
      // Loan EMIs
      prisma.loan.findMany({
        where: { ...userFilter, endDate: { gte: now } },
        select: { id: true, lenderName: true, emiAmount: true, emiDate: true, loanType: true },
      }),
      // Advance tax due dates
      prisma.advanceTaxEvent.findMany({
        where: { dueDate: { gte: now, lte: thirtyDaysOut } },
        orderBy: { dueDate: 'asc' },
      }),
    ]);

  const alerts = [];

  for (const fd of fdsMaturingSoon) {
    const daysUntil = Math.ceil((fd.maturityDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    alerts.push({
      type: 'FD_MATURITY' as const,
      title: `FD with ${fd.bankName} matures`,
      amount: Number(fd.maturityAmount),
      dueDate: fd.maturityDate.toISOString(),
      daysUntilDue: daysUntil,
      entityId: fd.id,
    });
  }

  for (const sip of sipdueThisMonth) {
    const today = now.getDate();
    const daysUntil = sip.sipDate >= today ? sip.sipDate - today : 30 - today + sip.sipDate;
    alerts.push({
      type: 'SIP' as const,
      title: `SIP: ${sip.fundName}`,
      amount: Number(sip.monthlyAmount),
      dueDate: new Date(now.getFullYear(), now.getMonth(), sip.sipDate).toISOString(),
      daysUntilDue: daysUntil,
      entityId: sip.id,
    });
  }

  for (const loan of loansWithEmi) {
    const today = now.getDate();
    const daysUntil = loan.emiDate >= today ? loan.emiDate - today : 30 - today + loan.emiDate;
    if (daysUntil <= 7) {
      alerts.push({
        type: 'EMI' as const,
        title: `EMI: ${loan.lenderName} (${loan.loanType})`,
        amount: Number(loan.emiAmount),
        dueDate: new Date(now.getFullYear(), now.getMonth(), loan.emiDate).toISOString(),
        daysUntilDue: daysUntil,
        entityId: loan.id,
      });
    }
  }

  for (const tax of advanceTax) {
    const daysUntil = Math.ceil((tax.dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    alerts.push({
      type: 'ADVANCE_TAX' as const,
      title: tax.description,
      dueDate: tax.dueDate.toISOString(),
      daysUntilDue: daysUntil,
      entityId: tax.id,
    });
  }

  return alerts.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function getIncomeForPeriod(
  userFilter: Prisma.TransactionWhereInput,
  range: { start: Date; end: Date },
): Promise<number> {
  const result = await prisma.transaction.aggregate({
    where: {
      ...userFilter,
      type: 'INCOME',
      date: { gte: range.start, lte: range.end },
      deletedAt: null,
    },
    _sum: { amount: true },
  });
  return Number(result._sum.amount ?? 0);
}

async function getExpenseForPeriod(
  userFilter: Prisma.TransactionWhereInput,
  range: { start: Date; end: Date },
): Promise<number> {
  const result = await prisma.transaction.aggregate({
    where: {
      ...userFilter,
      type: 'EXPENSE',
      date: { gte: range.start, lte: range.end },
      deletedAt: null,
    },
    _sum: { amount: true },
  });
  return Number(result._sum.amount ?? 0);
}

async function getTotalAssets(userId?: string): Promise<number> {
  const where = userId ? { userId } : {};

  const [bankBalances, fdTotal, investmentTotal] = await Promise.all([
    prisma.bankAccount.aggregate({
      where: { ...where, isActive: true },
      _sum: { currentBalance: true },
    }),
    prisma.fixedDeposit.aggregate({
      where: { ...where, status: 'ACTIVE' },
      _sum: { principalAmount: true },
    }),
    // Simplified — full investment calculation done in investment service
    prisma.investment.aggregate({
      where,
      _sum: { currentPricePerUnit: true }, // Approximation only
    }),
  ]);

  return (
    Number(bankBalances._sum.currentBalance ?? 0) +
    Number(fdTotal._sum.principalAmount ?? 0)
  );
}

async function getTotalLiabilities(userId?: string): Promise<number> {
  const where = userId ? { userId } : {};
  const result = await prisma.loan.aggregate({
    where: { ...where, endDate: { gte: new Date() } },
    _sum: { outstandingBalance: true },
  });
  return Number(result._sum.outstandingBalance ?? 0);
}

async function getNetWorth(userId?: string, asOf?: Date): Promise<number> {
  const assets = await getTotalAssets(userId);
  const liabilities = await getTotalLiabilities(userId);
  return assets - liabilities;
}
