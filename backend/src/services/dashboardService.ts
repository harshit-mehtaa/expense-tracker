import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { getFYRange, getCurrentFY, getPreviousFY } from '../utils/financialYear';
import { generateDueRecurringTransactions } from './recurringService';

export async function getDashboardSummary(userId: string, requesterRole: string, fy?: string) {
  // Lazy trigger: generate any due recurring transactions before computing the summary.
  // Non-fatal — a generation failure must never break the dashboard.
  // Skip for ADMIN role (admin dashboard is family-wide; generation is per-member).
  if (requesterRole !== 'ADMIN') {
    await generateDueRecurringTransactions(userId).catch((err) => {
      console.warn('[dashboard] Recurring generation failed for user', userId, err instanceof Error ? err.message : err);
    });
  }

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

  const scopedUserId = requesterRole === 'ADMIN' ? undefined : userId;
  const [totalAssets, totalLiabilities] = await Promise.all([
    computeNetWorthAssets(scopedUserId),
    computeTotalLiabilities(scopedUserId),
  ]);
  const netWorth = totalAssets - totalLiabilities;
  // prevNetWorth: approximate via prior-FY income/expense delta since we don't snapshot balances historically
  const prevNetWorth = netWorth - ((currentIncome - currentExpense) - (prevIncome - prevExpense));

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
    totalAssets,
    totalLiabilities,
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
    FROM "Transaction"
    WHERE
      date >= ${start}
      AND date <= ${end}
      AND "deletedAt" IS NULL
      ${requesterRole !== 'ADMIN' ? Prisma.sql`AND "userId" = ${userId}` : Prisma.empty}
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
      // Insurance premiums due in the next 30 days
      // premiumDueDate is stored as Int (day of month 1–31), not a DateTime — filter in app code
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
      // Advance tax due dates (scoped to user where applicable)
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

  for (const policy of insurancePremiumsDue) {
    if (!policy.premiumDueDate) continue;
    const dayOfMonth = Number(policy.premiumDueDate);
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) continue;
    // Compute next occurrence of this day-of-month (if today's date is past it, use next month)
    const nextOccurrence = new Date(now.getFullYear(), now.getMonth(), dayOfMonth);
    if (nextOccurrence < now) nextOccurrence.setMonth(nextOccurrence.getMonth() + 1);
    if (nextOccurrence > thirtyDaysOut) continue;
    const daysUntil = Math.ceil((nextOccurrence.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    alerts.push({
      type: 'INSURANCE_PREMIUM' as const,
      title: `${policy.policyName} premium due`,
      amount: Number(policy.premiumAmount),
      dueDate: nextOccurrence.toISOString(),
      daysUntilDue: daysUntil,
      entityId: policy.id,
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

async function fetchAssetBreakdown(userId?: string) {
  const where = userId ? { userId } : {};

  const [accounts, fds, rds, investments, gold, realestate] = await Promise.all([
    prisma.bankAccount.findMany({ where: { ...where, isActive: true }, select: { currentBalance: true } }),
    prisma.fixedDeposit.findMany({ where: { ...where, status: 'ACTIVE' }, select: { maturityAmount: true } }),
    prisma.recurringDeposit.findMany({ where: { ...where, status: 'ACTIVE' }, select: { totalDeposited: true } }),
    prisma.investment.findMany({ where, select: { unitsOrQuantity: true, currentPricePerUnit: true, currency: true } }),
    prisma.goldHolding.findMany({ where, select: { quantityGrams: true, currentPricePerGram: true } }),
    prisma.realEstate.findMany({ where, select: { currentValue: true } }),
  ]);

  const exchangeRates = await prisma.exchangeRate.findMany({ where: { toCurrency: 'INR' } });
  const rateMap: Record<string, number> = {};
  exchangeRates.forEach((r) => { rateMap[r.fromCurrency] = Number(r.rate); });

  const bankBalances = accounts.reduce((s, a) => s + Number(a.currentBalance), 0);
  const fixedDeposits = fds.reduce((s, f) => s + Number(f.maturityAmount), 0);
  const recurringDeposits = rds.reduce((s, r) => s + Number(r.totalDeposited), 0);
  const investments_ = investments.reduce((s, i) => {
    const fx = i.currency === 'INR' ? 1 : (rateMap[i.currency] ?? 1);
    return s + Number(i.unitsOrQuantity) * Number(i.currentPricePerUnit) * fx;
  }, 0);
  const gold_ = gold.reduce((s, g) => s + Number(g.quantityGrams) * Number(g.currentPricePerGram), 0);
  const realEstate = realestate.reduce((s, p) => s + Number(p.currentValue), 0);

  return {
    bankBalances,
    fixedDeposits,
    recurringDeposits,
    investments: investments_,
    gold: gold_,
    realEstate,
    total: bankBalances + fixedDeposits + recurringDeposits + investments_ + gold_ + realEstate,
  };
}

export async function computeNetWorthAssets(userId?: string): Promise<number> {
  const breakdown = await fetchAssetBreakdown(userId);
  return breakdown.total;
}

export async function computeNetWorthStatement(userId?: string) {
  const [assetBreakdown, loans] = await Promise.all([
    fetchAssetBreakdown(userId),
    computeTotalLiabilities(userId),
  ]);
  const { total: totalAssets, ...assets } = assetBreakdown;
  return {
    assets,
    liabilities: { loans },
    totalAssets,
    totalLiabilities: loans,
    netWorth: totalAssets - loans,
  };
}

export async function computeTotalLiabilities(userId?: string): Promise<number> {
  const where = userId ? { userId } : {};
  const result = await prisma.loan.aggregate({
    where: { ...where, endDate: { gte: new Date() } },
    _sum: { outstandingBalance: true },
  });
  return Number(result._sum.outstandingBalance ?? 0);
}

async function getNetWorth(userId?: string): Promise<number> {
  const assets = await computeNetWorthAssets(userId);
  const liabilities = await computeTotalLiabilities(userId);
  return assets - liabilities;
}
