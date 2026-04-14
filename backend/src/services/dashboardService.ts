import { Prisma, LoanType } from '@prisma/client';
import prisma from '../config/prisma';
import { getFYRange, getCurrentFY, getPreviousFY, getMonthStart } from '../utils/financialYear';
import { generateDueRecurringTransactions } from './recurringService';

export async function getDashboardSummary(userId: string, requesterRole: string, fy?: string, targetUserId?: string) {
  // Lazy trigger: generate any due recurring transactions before computing the summary.
  // Non-fatal — a generation failure must never break the dashboard.
  // Skip for ADMIN role (admin dashboard is family-wide or per-member view; generation is per-member).
  if (requesterRole !== 'ADMIN') {
    await generateDueRecurringTransactions(userId).catch((err) => {
      console.warn('[dashboard] Recurring generation failed for user', userId, err instanceof Error ? err.message : err);
    });
  }

  const currentFY = fy ?? getCurrentFY();
  const previousFY = getPreviousFY(currentFY);

  const currentRange = getFYRange(currentFY);
  const previousRange = getFYRange(previousFY);

  // effectiveUserId: undefined = family-wide (ADMIN only), string = scoped to that user
  const effectiveUserId = requesterRole === 'ADMIN' ? targetUserId : userId;
  const userFilter = effectiveUserId ? { userId: effectiveUserId } : {};

  const [currentIncome, currentExpense, prevIncome, prevExpense] = await Promise.all([
    getIncomeForPeriod(userFilter, currentRange),
    getExpenseForPeriod(userFilter, currentRange),
    getIncomeForPeriod(userFilter, previousRange),
    getExpenseForPeriod(userFilter, previousRange),
  ]);

  const scopedUserId = effectiveUserId;
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

export async function getCashflow(userId: string, requesterRole: string, fy?: string, targetUserId?: string) {
  const currentFY = fy ?? getCurrentFY();
  const { start, end } = getFYRange(currentFY);

  const effectiveUserId = requesterRole === 'ADMIN' ? targetUserId : userId;

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
      ${effectiveUserId ? Prisma.sql`AND "userId" = ${effectiveUserId}` : Prisma.empty}
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

export async function getUpcomingAlerts(userId: string, requesterRole: string, targetUserId?: string) {
  const now = new Date();
  const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const effectiveUserId = requesterRole === 'ADMIN' ? targetUserId : userId;
  const userFilter = effectiveUserId ? { userId: effectiveUserId } : {};

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
    prisma.bankAccount.findMany({
      where: { ...where, isActive: true },
      select: { bankName: true, accountNumberLast4: true, accountType: true, currentBalance: true },
      orderBy: { currentBalance: 'desc' },
    }),
    prisma.fixedDeposit.findMany({
      where: { ...where, status: 'ACTIVE' },
      select: { bankName: true, principalAmount: true, maturityAmount: true },
    }),
    prisma.recurringDeposit.findMany({
      where: { ...where, status: 'ACTIVE' },
      select: { bankName: true, totalDeposited: true },
    }),
    prisma.investment.findMany({
      where,
      select: { name: true, type: true, unitsOrQuantity: true, purchasePricePerUnit: true, purchaseExchangeRate: true, currentPricePerUnit: true, currency: true },
    }),
    prisma.goldHolding.findMany({
      where,
      select: { type: true, description: true, quantityGrams: true, purchasePricePerGram: true, currentPricePerGram: true },
    }),
    prisma.realEstate.findMany({
      where,
      select: { propertyName: true, propertyType: true, purchasePrice: true, currentValue: true },
    }),
  ]);

  const exchangeRates = await prisma.exchangeRate.findMany({ where: { toCurrency: 'INR' } });
  const rateMap: Record<string, number> = {};
  exchangeRates.forEach((r) => { rateMap[r.fromCurrency] = Number(r.rate); });

  const bankAccounts = accounts.map((a) => ({
    bankName: a.bankName,
    accountNumberLast4: a.accountNumberLast4 ?? null,
    accountType: a.accountType,
    currentBalance: Number(a.currentBalance),
  }));
  const bankBalances = bankAccounts.reduce((s, a) => s + a.currentBalance, 0);

  const fdItems = fds
    .map((f) => ({ bankName: f.bankName, amount: Number(f.principalAmount) }))
    .sort((a, b) => b.amount - a.amount);
  const fixedDeposits = fds.reduce((s, f) => s + Number(f.maturityAmount), 0);

  const rdItems = rds
    .map((r) => ({ bankName: r.bankName, amount: Number(r.totalDeposited) }))
    .sort((a, b) => b.amount - a.amount);
  const recurringDeposits = rdItems.reduce((s, r) => s + r.amount, 0);

  const investmentItems = investments
    .map((i) => {
      const purchaseFx = i.currency === 'INR' ? 1 : (Number(i.purchaseExchangeRate) || 1);
      const currentFx = i.currency === 'INR' ? 1 : (rateMap[i.currency] ?? 1);
      return {
        name: i.name,
        type: i.type,
        amount: Number(i.unitsOrQuantity) * Number(i.purchasePricePerUnit) * purchaseFx,
        currentValue: Number(i.unitsOrQuantity) * Number(i.currentPricePerUnit) * currentFx,
      };
    })
    .sort((a, b) => b.amount - a.amount);
  const investments_ = investmentItems.reduce((s, i) => s + i.currentValue, 0);

  const goldItems = gold
    .map((g) => ({
      type: g.type,
      description: g.description ?? null,
      amount: Number(g.quantityGrams) * Number(g.purchasePricePerGram),
      currentValue: Number(g.quantityGrams) * Number(g.currentPricePerGram),
    }))
    .sort((a, b) => b.amount - a.amount);
  const gold_ = goldItems.reduce((s, g) => s + g.currentValue, 0);

  const realEstateItems = realestate
    .map((p) => ({ propertyName: p.propertyName, propertyType: p.propertyType, amount: Number(p.purchasePrice), currentValue: Number(p.currentValue) }))
    .sort((a, b) => b.amount - a.amount);
  const realEstate = realEstateItems.reduce((s, p) => s + p.currentValue, 0);

  return {
    bankAccounts,
    fdItems,
    rdItems,
    investmentItems,
    goldItems,
    realEstateItems,
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
  const where = userId ? { userId } : {};
  const [assetBreakdown, loanBreakdown] = await Promise.all([
    fetchAssetBreakdown(userId),
    prisma.loan.groupBy({
      by: ['loanType'],
      where: { ...where, endDate: { gte: new Date() } },
      _sum: { outstandingBalance: true },
    }),
  ]);
  const liabilities: Partial<Record<LoanType, number>> = {};
  let totalLiabilities = 0;
  for (const entry of loanBreakdown) {
    const amt = Number(entry._sum.outstandingBalance ?? 0);
    if (amt > 0) {
      liabilities[entry.loanType] = amt;
      totalLiabilities += amt;
    }
  }
  const { total: totalAssets, bankAccounts, fdItems, rdItems, investmentItems, goldItems, realEstateItems, ...assets } = assetBreakdown;
  return {
    assets,
    bankAccounts,
    fdItems,
    rdItems,
    investmentItems,
    goldItems,
    realEstateItems,
    liabilities,
    totalAssets,
    totalLiabilities,
    netWorth: totalAssets - totalLiabilities,
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
      loans: statement.totalLiabilities,
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
      loans: statement.totalLiabilities,
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

export async function getProfitAndLoss(
  userId: string,
  requesterRole: string,
  fy?: string,
  targetUserId?: string,
) {
  const currentFY = fy ?? getCurrentFY();
  const { start, end } = getFYRange(currentFY);
  // Effective user: MEMBER always sees own data; ADMIN can scope to a specific member or family-wide
  const effectiveUserId = requesterRole === 'ADMIN' ? targetUserId : userId;
  const userFilter: Prisma.TransactionWhereInput = effectiveUserId ? { userId: effectiveUserId } : {};

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
          ${effectiveUserId ? Prisma.sql`AND "userId" = ${effectiveUserId}` : Prisma.empty}
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

export async function getTrialBalance(
  userId: string,
  requesterRole: string,
  fy?: string,
  targetUserId?: string,
) {
  const currentFY = fy ?? getCurrentFY();
  const { start, end } = getFYRange(currentFY);
  const effectiveUserId = requesterRole === 'ADMIN' ? targetUserId : userId;
  const userFilter: Prisma.TransactionWhereInput = effectiveUserId ? { userId: effectiveUserId } : {};

  const dateFilter = { date: { gte: start, lte: end } };

  // Expense categories (debit side) and income categories (credit side) — no take limit (full trial balance)
  const [expenseRows, incomeRows] = await Promise.all([
    prisma.transaction.groupBy({
      by: ['categoryId'],
      where: { ...userFilter, deletedAt: null, type: 'EXPENSE', ...dateFilter },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
    }),
    prisma.transaction.groupBy({
      by: ['categoryId'],
      where: { ...userFilter, deletedAt: null, type: 'INCOME', ...dateFilter },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
    }),
  ]);

  // Resolve category names — deduplicate IDs to avoid duplicate DB rows in the IN query
  const allCategoryIds = [
    ...new Set(
      [...expenseRows.map((r) => r.categoryId), ...incomeRows.map((r) => r.categoryId)].filter(
        (id): id is string => id !== null,
      ),
    ),
  ];

  const categories = await prisma.category.findMany({ where: { id: { in: allCategoryIds } } });
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c.name]));

  const resolveName = (categoryId: string | null) =>
    categoryId ? (catMap[categoryId] ?? 'Uncategorized') : 'Uncategorized';

  // Build entries: EXPENSE rows → debit side, INCOME rows → credit side
  const entries = [
    ...expenseRows.map((r) => ({
      accountName: resolveName(r.categoryId),
      type: 'DEBIT' as const,
      debit: Number(r._sum.amount ?? 0),
      credit: 0,
    })),
    ...incomeRows.map((r) => ({
      accountName: resolveName(r.categoryId),
      type: 'CREDIT' as const,
      debit: 0,
      credit: Number(r._sum.amount ?? 0),
    })),
  ];

  const rawTotalExpenses = entries.filter((e) => e.type === 'DEBIT').reduce((s, e) => s + e.debit, 0);
  const rawTotalIncome = entries.filter((e) => e.type === 'CREDIT').reduce((s, e) => s + e.credit, 0);
  const netSavings = rawTotalIncome - rawTotalExpenses;

  // Add balancing entry so Total Debits === Total Credits (real trial balance property)
  if (netSavings > 0) {
    // Surplus: add Net Savings on the debit side to balance
    entries.push({ accountName: 'Net Savings (Surplus)', type: 'DEBIT' as const, debit: netSavings, credit: 0 });
  } else if (netSavings < 0) {
    // Deficit: add Net Loss on the credit side to balance
    entries.push({ accountName: 'Net Loss (Deficit)', type: 'CREDIT' as const, debit: 0, credit: -netSavings });
  }

  const totalDebits = entries.filter((e) => e.type === 'DEBIT').reduce((s, e) => s + e.debit, 0);
  const totalCredits = entries.filter((e) => e.type === 'CREDIT').reduce((s, e) => s + e.credit, 0);

  return {
    fy: currentFY,
    entries,
    totals: { totalDebits, totalCredits, netSavings, rawTotalIncome, rawTotalExpenses },
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
