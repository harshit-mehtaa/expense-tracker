import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { getFYRange, getCurrentFY, getPreviousFY, getMonthStart } from '../utils/financialYear';
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

  const [fdsMaturingSoon, sipdueThisMonth, insurancePremiumsDue, loansWithEmi, advanceTax, rdsMaturing] =
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
      // RDs maturing in 30 days
      prisma.recurringDeposit.findMany({
        where: {
          ...userFilter,
          status: 'ACTIVE',
          maturityDate: { gte: now, lte: thirtyDaysOut },
        },
        select: { id: true, bankName: true, maturityDate: true, maturityAmount: true },
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

  for (const rd of rdsMaturing) {
    const daysUntil = Math.ceil((rd.maturityDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    alerts.push({
      type: 'RD_MATURITY' as const,
      title: `RD with ${rd.bankName} matures`,
      amount: Number(rd.maturityAmount),
      dueDate: rd.maturityDate.toISOString(),
      daysUntilDue: daysUntil,
      entityId: rd.id,
    });
  }

  for (const sip of sipdueThisMonth) {
    const today = now.getDate();
    const daysUntil = sip.sipDate >= today ? sip.sipDate - today : 30 - today + sip.sipDate;
    if (daysUntil <= 7) {
      alerts.push({
        type: 'SIP' as const,
        title: `SIP: ${sip.fundName}`,
        amount: Number(sip.monthlyAmount),
        dueDate: new Date(now.getFullYear(), now.getMonth(), sip.sipDate).toISOString(),
        daysUntilDue: daysUntil,
        entityId: sip.id,
      });
    }
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

  // Budget overspend alerts — always scoped to individual user (budgets are per-user, not family-wide)
  if (requesterRole !== 'ADMIN') {
    const budgets = await prisma.budget.findMany({
      where: { userId },
      include: { category: { select: { name: true } } },
    });

    if (budgets.length > 0) {
      // Compute date ranges per period type and group budgets by range bucket
      const fyRange = getFYRange(getCurrentFY());
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      // Current quarter within FY (Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar)
      const fyStartYear = parseInt(getCurrentFY().split('-')[0]);
      const currentMonth0 = now.getMonth(); // 0-indexed
      let qStart: Date, qEnd: Date;
      if (currentMonth0 >= 3 && currentMonth0 <= 5) {
        qStart = new Date(fyStartYear, 3, 1); qEnd = new Date(fyStartYear, 5, 30, 23, 59, 59, 999);
      } else if (currentMonth0 >= 6 && currentMonth0 <= 8) {
        qStart = new Date(fyStartYear, 6, 1); qEnd = new Date(fyStartYear, 8, 30, 23, 59, 59, 999);
      } else if (currentMonth0 >= 9 && currentMonth0 <= 11) {
        qStart = new Date(fyStartYear, 9, 1); qEnd = new Date(fyStartYear, 11, 31, 23, 59, 59, 999);
      } else {
        // Jan–Mar: last quarter of the current FY (fyStartYear+1)
        qStart = new Date(fyStartYear + 1, 0, 1); qEnd = new Date(fyStartYear + 1, 2, 31, 23, 59, 59, 999);
      }

      const rangeFor = (period: string): { start: Date; end: Date } => {
        if (period === 'MONTHLY') return { start: monthStart, end: monthEnd };
        if (period === 'QUARTERLY') return { start: qStart, end: qEnd };
        if (period === 'FY' || period === 'YEARLY') return { start: fyRange.start, end: fyRange.end };
        throw new Error(`Unhandled BudgetPeriod in rangeFor: ${period}`);
      };

      // Group budget category IDs by period bucket, run one aggregate per bucket
      const buckets: Record<string, { start: Date; end: Date; categoryIds: string[] }> = {};
      for (const b of budgets) {
        if (!b.categoryId) continue;
        const key = b.period;
        if (!buckets[key]) buckets[key] = { ...rangeFor(b.period), categoryIds: [] };
        buckets[key].categoryIds.push(b.categoryId);
      }

      const actualsMap: Record<string, number> = {};
      await Promise.all(
        Object.values(buckets).map(async (bucket) => {
          const rows = await prisma.transaction.groupBy({
            by: ['categoryId'],
            where: {
              userId,
              deletedAt: null,
              type: 'EXPENSE',
              categoryId: { in: bucket.categoryIds },
              date: { gte: bucket.start, lte: bucket.end },
            },
            _sum: { amount: true },
          });
          rows.forEach((r) => {
            if (r.categoryId) actualsMap[r.categoryId] = (actualsMap[r.categoryId] ?? 0) + Number(r._sum.amount ?? 0);
          });
        }),
      );

      for (const budget of budgets) {
        if (!budget.categoryId) continue;
        const actual = actualsMap[budget.categoryId] ?? 0;
        const limit = Number(budget.amount);
        if (limit <= 0) continue;
        const pctUsed = (actual / limit) * 100;
        if (pctUsed >= 80) {
          alerts.push({
            type: 'BUDGET_ALERT' as const,
            title: `${budget.category?.name ?? 'Budget'} at ${pctUsed.toFixed(0)}% of ${budget.period.toLowerCase()} budget`,
            amount: limit,
            dueDate: now.toISOString(),
            daysUntilDue: 0,
            entityId: budget.id,
            utilized: actual,
          });
        }
      }
    }
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

export async function upsertNetWorthSnapshot(userId: string) {
  const snapshotDate = getMonthStart(); // First of current month in IST — key for @@unique
  const statement = await computeNetWorthStatement(userId);
  return prisma.netWorthSnapshot.upsert({
    where: { userId_snapshotDate: { userId, snapshotDate } },
    update: {
      totalAssets: statement.totalAssets,
      totalLiabilities: statement.totalLiabilities,
      netWorth: statement.netWorth,
      bankBalances: statement.assets.bankBalances,
      fixedDeposits: statement.assets.fixedDeposits,
      recurringDeposits: statement.assets.recurringDeposits,
      investments: statement.assets.investments,
      gold: statement.assets.gold,
      realEstate: statement.assets.realEstate,
      loans: statement.liabilities.loans,
    },
    create: {
      userId,
      snapshotDate,
      totalAssets: statement.totalAssets,
      totalLiabilities: statement.totalLiabilities,
      netWorth: statement.netWorth,
      bankBalances: statement.assets.bankBalances,
      fixedDeposits: statement.assets.fixedDeposits,
      recurringDeposits: statement.assets.recurringDeposits,
      investments: statement.assets.investments,
      gold: statement.assets.gold,
      realEstate: statement.assets.realEstate,
      loans: statement.liabilities.loans,
    },
  });
}

export async function getFamilyOverview(fy: string) {
  const { start, end } = getFYRange(fy);

  const [members, results] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, name: true, colorTag: true },
    }),
    prisma.$queryRaw<Array<{ userId: string; month: number; year: number; expense: number }>>`
      SELECT
        "userId",
        EXTRACT(MONTH FROM date AT TIME ZONE 'Asia/Kolkata')::int AS month,
        EXTRACT(YEAR FROM date AT TIME ZONE 'Asia/Kolkata')::int AS year,
        SUM(amount)::float AS expense
      FROM "Transaction"
      WHERE type = 'EXPENSE'
        AND date >= ${start}
        AND date <= ${end}
        AND "deletedAt" IS NULL
      GROUP BY "userId", month, year
      ORDER BY year, month
    `,
  ]);

  const monthNames = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
  const startYear = parseInt(fy.split('-')[0]);

  const chartData = monthNames.map((name, idx) => {
    const month = idx < 9 ? idx + 4 : idx - 8;
    const year = month >= 4 ? startYear : startYear + 1;
    const row: Record<string, number | string> = { month: name };
    for (const member of members) {
      const data = results.find((r) => r.userId === member.id && r.month === month && r.year === year);
      row[member.id] = data?.expense ?? 0;
    }
    return row;
  });

  return {
    members: members.map((m) => ({ id: m.id, name: m.name, colorTag: m.colorTag ?? '#6366f1' })),
    chartData,
  };
}

export async function getProfitAndLoss(userId: string, requesterRole: string, fy?: string) {
  const currentFY = fy ?? getCurrentFY();
  const { start, end } = getFYRange(currentFY);
  const userFilter: Prisma.TransactionWhereInput = requesterRole === 'ADMIN' ? {} : { userId };

  // Summary + monthly series + expense categories + income categories — all in parallel
  const [totalIncome, totalExpense, monthlyResults, expenseCategoryRows, incomeCategoryRows] =
    await Promise.all([
      getIncomeForPeriod(userFilter, { start, end }),
      getExpenseForPeriod(userFilter, { start, end }),
      // Monthly series — same raw SQL pattern as getCashflow, with safe Prisma.sql userFilter
      prisma.$queryRaw<Array<{ month: number; year: number; income: number; expense: number }>>`
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
      `,
      // Expense categories
      prisma.transaction.groupBy({
        by: ['categoryId'],
        where: { ...userFilter, deletedAt: null, type: 'EXPENSE', date: { gte: start, lte: end } },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 15,
      }),
      // Income categories
      prisma.transaction.groupBy({
        by: ['categoryId'],
        where: { ...userFilter, deletedAt: null, type: 'INCOME', date: { gte: start, lte: end } },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 15,
      }),
    ]);

  // Resolve category names for both sets
  const allCategoryIds = [
    ...expenseCategoryRows.map((r) => r.categoryId),
    ...incomeCategoryRows.map((r) => r.categoryId),
  ].filter((id): id is string => id !== null);

  const categories = await prisma.category.findMany({ where: { id: { in: allCategoryIds } } });
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));

  const mapCategories = (rows: typeof expenseCategoryRows) =>
    rows.map((r) => ({
      categoryId: r.categoryId,
      categoryName: r.categoryId ? (catMap[r.categoryId]?.name ?? 'Uncategorized') : 'Uncategorized',
      total: Number(r._sum.amount ?? 0),
    }));

  // Build zero-padded 12-month series (Apr to Mar)
  const monthNames = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
  const startYear = parseInt(currentFY.split('-')[0]);

  const monthly = monthNames.map((name, idx) => {
    const month = idx < 9 ? idx + 4 : idx - 8; // Apr=4…Dec=12, Jan=1…Mar=3
    const year = month >= 4 ? startYear : startYear + 1;
    const data = monthlyResults.find((r) => r.month === month && r.year === year);
    return {
      month: name,
      monthIndex: month,
      year,
      income: data?.income ?? 0,
      expense: data?.expense ?? 0,
      net: (data?.income ?? 0) - (data?.expense ?? 0),
    };
  });

  const netSavings = totalIncome - totalExpense;
  const savingsRate = totalIncome > 0 ? Math.round(((netSavings / totalIncome) * 100) * 100) / 100 : 0;

  return {
    fy: currentFY,
    summary: { totalIncome, totalExpense, netSavings, savingsRate },
    monthly,
    expenseCategories: mapCategories(expenseCategoryRows),
    incomeCategories: mapCategories(incomeCategoryRows),
  };
}

export async function getNetWorthHistory(userId: string) {
  return prisma.netWorthSnapshot.findMany({
    where: { userId },
    orderBy: { snapshotDate: 'asc' },
    take: 24,
    select: {
      snapshotDate: true,
      totalAssets: true,
      totalLiabilities: true,
      netWorth: true,
      bankBalances: true,
      fixedDeposits: true,
      recurringDeposits: true,
      investments: true,
      gold: true,
      realEstate: true,
      loans: true,
    },
  });
}
