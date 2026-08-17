import { Prisma, LoanType, TransactionType } from '@prisma/client';
import prisma from '../config/prisma';
import { getFYRange, getCurrentFY, getPreviousFY, getMonthStart } from '../utils/financialYear';
import { generateDueRecurringTransactions } from './recurringService';
import { computeMonthlyPreEmi } from '../utils/loanMath';
import { priceAsOf } from '../utils/subscriptionPricing';
import { ownerShareMultiplier } from '../utils/ownerShares';
import {
  getNetExpenseByUserCategory,
  getNetExpenseTotal,
  reportingIncomeWhere,
} from '../utils/refundReporting';

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
      SUM(CASE WHEN type = 'INCOME' AND "refundForTransactionId" IS NULL THEN amount ELSE 0 END)::float AS income,
      SUM(CASE
        WHEN type = 'EXPENSE' THEN amount
        WHEN type = 'INCOME' AND "refundForTransactionId" IS NOT NULL THEN -amount
        ELSE 0
      END)::float AS expense
    FROM "Transaction"
    WHERE
      date >= ${start}
      AND date <= ${end}
      AND "deletedAt" IS NULL
      AND "transferPairId" IS NULL
      AND "sipId" IS NULL
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

  // Alerts look 7 days ahead; the maturity queries above use 30. Named so the two are
  // not confused, and so the bound is stated once.
  const sevenDaysOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [
    fdsMaturingSoon, sipdueThisMonth, insurancePremiumsDue, loansWithEmi, advanceTax,
    subscriptions, rdsMaturing,
  ] = await Promise.all([
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
          transactions: {
            where: {
              deletedAt: null,
              type: TransactionType.EXPENSE,
            },
            orderBy: { date: 'desc' },
            take: 1,
            select: { id: true, date: true },
          },
        },
      }),
      // Loan EMIs. Its own predicate rather than the shared `userFilter`, because a
      // co-owner needs to see the EMI on a loan they part-hold, and widening userFilter
      // would widen the five sibling queries in this Promise.all too.
      prisma.loan.findMany({
        where: { ...loanVisibilityWhere(effectiveUserId), endDate: { gte: now } },
        select: {
          id: true, lenderName: true, emiAmount: true, emiDate: true, loanType: true,
          userId: true, preEmiAmount: true, firstEmiDate: true,
          outstandingBalance: true, interestRate: true,
          owners: { select: { userId: true, sharePercent: true } },
        },
      }),
      // Advance tax due dates (scoped to user where applicable)
      prisma.advanceTaxEvent.findMany({
        where: { dueDate: { gte: now, lte: thirtyDaysOut } },
        orderBy: { dueDate: 'asc' },
      }),
      // Subscriptions: trials about to convert, and renewals about to bill.
      // Bounded to the alert window rather than loading every active subscription and
      // filtering in app code, matching the sibling queries. `...userFilter` is used
      // rather than a bare `userId` so the family-wide (ADMIN, no target) case is
      // explicit instead of relying on `userId: undefined` meaning "unfiltered".
      prisma.subscription.findMany({
        where: {
          ...userFilter,
          deletedAt: null,
          status: { in: ['TRIALING', 'ACTIVE'] },
          OR: [
            { trialEndDate: { gte: now, lte: sevenDaysOut } },
            { recurringRule: { is: { isActive: true, nextRunDate: { gte: now, lte: sevenDaysOut } } } },
          ],
        },
        include: {
          // Full history, not `take: 1` — the amount shown must be the price in effect on
          // the date it will actually be charged, which a single newest row cannot give.
          prices: true,
          recurringRule: { select: { nextRunDate: true, isActive: true, frequency: true } },
        },
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
    // Reachable: on Jan 31 a dueDate of 31 rolls to "Feb 31", which Date normalizes to
    // Mar 3 — past the Mar 2 cutoff. Short months push the next occurrence beyond 30 days.
    if (nextOccurrence > thirtyDaysOut) continue;
    if (isInsurancePremiumPaidForOccurrence(policy, nextOccurrence)) continue;
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
      // During the pre-EMI period only interest is payable, so alerting with the full
      // EMI would overstate what actually leaves the account.
      // `preEmiAmount` is the TOTAL across the whole gap (computePreEmi returns
      // monthly x months), but this row is a single month's due. Using it directly
      // overstated the alert by the length of the moratorium — a 6-month pre-EMI period
      // showed 6x the actual outgo. Derive the monthly figure instead.
      const inPreEmiPeriod = loan.firstEmiDate != null && now < loan.firstEmiDate;
      const monthlyPreEmi = inPreEmiPeriod
        ? computeMonthlyPreEmi(Number(loan.outstandingBalance), Number(loan.interestRate))
        : null;
      const monthlyDue = monthlyPreEmi ?? Number(loan.emiAmount);

      // Share-weighted, so a 40% co-owner is alerted for their 40%.
      const share = loanShareMultiplier(loan, effectiveUserId);

      alerts.push({
        type: 'EMI' as const,
        title: inPreEmiPeriod
          ? `Pre-EMI: ${loan.lenderName} (${loan.loanType})`
          : `EMI: ${loan.lenderName} (${loan.loanType})`,
        amount: monthlyDue * share,
        dueDate: new Date(now.getFullYear(), now.getMonth(), loan.emiDate).toISOString(),
        daysUntilDue: daysUntil,
        entityId: loan.id,
      });
    }
  }

  // Subscriptions: a converting trial and an upcoming renewal.
  //
  // The trial alert is the point of the feature — a trial costs you nothing until you
  // forget it, so the warning has to arrive before the first charge, not with it.
  for (const subscription of subscriptions) {
    const priceHistory = subscription.prices.map((p) => ({
      amount: Number(p.amount), effectiveFrom: p.effectiveFrom,
    }));

    if (subscription.status === 'TRIALING' && subscription.trialEndDate) {
      const daysUntil = Math.ceil(
        (subscription.trialEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysUntil >= 0 && daysUntil <= 7) {
        alerts.push({
          type: 'SUBSCRIPTION_TRIAL' as const,
          title: `Trial ending: ${subscription.name}`,
          // What the FIRST charge will be, resolved on the date it lands.
          amount: priceAsOf(priceHistory, subscription.trialEndDate) ?? undefined,
          dueDate: subscription.trialEndDate.toISOString(),
          daysUntilDue: daysUntil,
          entityId: subscription.id,
        });
      }
      // A converting trial is the more urgent of the two; do not also alert the renewal.
      continue;
    }

    const rule = subscription.recurringRule;
    if (!rule?.isActive) continue;
    const daysUntil = Math.ceil((rule.nextRunDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntil >= 0 && daysUntil <= 7) {
      alerts.push({
        type: 'SUBSCRIPTION_RENEWAL' as const,
        title: `Renews: ${subscription.name}`,
        amount: priceAsOf(priceHistory, rule.nextRunDate) ?? undefined,
        dueDate: rule.nextRunDate.toISOString(),
        daysUntilDue: daysUntil,
        entityId: subscription.id,
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
          const rows = await getNetExpenseByUserCategory(
            { userId },
            { gte: bucket.start, lte: bucket.end },
            bucket.categoryIds,
          );
          rows.forEach((total, key) => {
            const [, categoryId] = key.split(':');
            if (categoryId) actualsMap[categoryId] = (actualsMap[categoryId] ?? 0) + total;
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

function getPremiumCycleMonths(frequency?: string | null): number | null {
  switch (frequency) {
    case 'MONTHLY':
      return 1;
    case 'QUARTERLY':
      return 3;
    case 'HALF_YEARLY':
      return 6;
    case 'ANNUALLY':
      return 12;
    case 'SINGLE':
      return null;
    default:
      return 1;
  }
}

function subtractMonths(date: Date, months: number): Date {
  const copy = new Date(date);
  copy.setMonth(copy.getMonth() - months);
  return copy;
}

function isInsurancePremiumPaidForOccurrence(
  policy: { premiumFrequency?: string | null; transactions?: { date: Date }[] },
  dueDate: Date,
) {
  const lastPayment = policy.transactions?.[0];
  if (!lastPayment) return false;

  const cycleMonths = getPremiumCycleMonths(policy.premiumFrequency);
  if (cycleMonths == null) return true;

  const cycleStart = subtractMonths(dueDate, cycleMonths);
  const dueEnd = new Date(dueDate);
  dueEnd.setHours(23, 59, 59, 999);
  return lastPayment.date > cycleStart && lastPayment.date <= dueEnd;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function compareCategoryNames(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

async function getIncomeForPeriod(
  userFilter: Prisma.TransactionWhereInput,
  range: { start: Date; end: Date },
): Promise<number> {
  const result = await prisma.transaction.aggregate({
    where: reportingIncomeWhere(userFilter, { gte: range.start, lte: range.end }),
    _sum: { amount: true },
  });
  return Number(result._sum.amount ?? 0);
}

async function getExpenseForPeriod(
  userFilter: Prisma.TransactionWhereInput,
  range: { start: Date; end: Date },
): Promise<number> {
  return getNetExpenseTotal(userFilter, { gte: range.start, lte: range.end });
}

async function fetchAssetBreakdown(userId?: string) {
  const where = userId ? { userId } : {};
  const realEstateWhere: Prisma.RealEstateWhereInput = userId
    ? { OR: [{ userId }, { owners: { some: { userId } } }] }
    : {};

  const [accounts, fds, rds, investments, gold, otherAssets, realestate] = await Promise.all([
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
    // Assets that nothing else already represents.
    //
    // An Asset records what secures a loan, so a property asset usually points at the
    // RealEstate row that tracks it properly — and RealEstate is already counted here,
    // and share-weighted besides. Counting both would report the same flat twice. Same
    // for gold against a GoldHolding. Only assets with neither link are unrepresented,
    // and those are exactly the ones a car loan leaves with no offset today.
    prisma.asset.findMany({
      where: { ...where, realEstateId: null, goldHoldingId: null },
      select: { name: true, assetType: true, value: true },
      orderBy: { value: 'desc' },
    }),
    prisma.realEstate.findMany({
      where: realEstateWhere,
      select: {
        userId: true,
        propertyName: true,
        propertyType: true,
        purchasePrice: true,
        currentValue: true,
        owners: { select: { userId: true, sharePercent: true } },
      },
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
    .map((p) => {
      // Same rule as investmentService, via the shared helper. The `p.userId === userId`
      // fallback that used to be here double-counted a property across the family: the
      // primary reported 100% while every co-owner also reported their share, and this
      // figure feeds net worth directly.
      const shareMultiplier = ownerShareMultiplier(p.owners, userId);
      const sharePercent = shareMultiplier * 100;
      return {
        propertyName: p.propertyName,
        propertyType: p.propertyType,
        amount: Number(p.purchasePrice) * shareMultiplier,
        currentValue: Number(p.currentValue) * shareMultiplier,
        sharePercent: userId ? sharePercent : undefined,
      };
    })
    .sort((a, b) => b.amount - a.amount);
  const realEstate = realEstateItems.reduce((s, p) => s + p.currentValue, 0);

  // Vehicles and anything else recorded only as loan collateral. Without these, taking a
  // car loan dropped net worth by the whole loan with nothing on the other side.
  const otherAssetItems = otherAssets.map((a) => ({
    name: a.name,
    assetType: a.assetType,
    currentValue: Number(a.value),
  }));
  const otherAssetsTotal = otherAssetItems.reduce((sum, a) => sum + a.currentValue, 0);

  return {
    bankAccounts,
    fdItems,
    rdItems,
    investmentItems,
    goldItems,
    realEstateItems,
    otherAssetItems,
    bankBalances,
    fixedDeposits,
    recurringDeposits,
    investments: investments_,
    gold: gold_,
    realEstate,
    otherAssets: otherAssetsTotal,
    total: bankBalances + fixedDeposits + recurringDeposits + investments_ + gold_ + realEstate + otherAssetsTotal,
  };
}

export async function computeNetWorthAssets(userId?: string): Promise<number> {
  const breakdown = await fetchAssetBreakdown(userId);
  return breakdown.total;
}


/**
 * A loan's share for one user, mirroring how RealEstate apportions co-owned property.
 *
 * Falls back to 100% for the primary owner, or when a loan predates the owners table.
 * A user with no stake gets 0 — which is what stops a co-owned loan being counted in
 * full for every owner and inflating each of their net-worth figures.
 */
function loanShareMultiplier(
  loan: { userId: string; owners?: { userId: string; sharePercent: unknown }[] },
  userId?: string,
): number {
  if (!userId) return 1;
  const owners = loan.owners ?? [];
  // Owner rows win outright — see decorateLoan in loanService for why crediting the
  // primary 100% alongside them double-counts the liability.
  const sharePercent = Number(
    owners.find((o) => o.userId === userId)?.sharePercent
      ?? (owners.length === 0 ? 100 : 0),
  );
  return sharePercent / 100;
}

/** Loans a user owns outright or holds a share of. */
function loanVisibilityWhere(userId?: string): Prisma.LoanWhereInput {
  return userId ? { OR: [{ userId }, { owners: { some: { userId } } }] } : {};
}

export async function computeNetWorthStatement(userId?: string) {
  // findMany + JS weighting rather than groupBy: Prisma has no weighted-sum expression,
  // and a raw SUM would count a co-owned loan in full for each owner.
  const [assetBreakdown, loans] = await Promise.all([
    fetchAssetBreakdown(userId),
    prisma.loan.findMany({
      where: { ...loanVisibilityWhere(userId), endDate: { gte: new Date() } },
      select: {
        loanType: true,
        outstandingBalance: true,
        userId: true,
        owners: { select: { userId: true, sharePercent: true } },
      },
    }),
  ]);

  const loanBreakdown = Object.entries(
    loans.reduce<Record<string, number>>((acc, loan) => {
      const share = Number(loan.outstandingBalance) * loanShareMultiplier(loan, userId);
      acc[loan.loanType] = (acc[loan.loanType] ?? 0) + share;
      return acc;
    }, {}),
  ).map(([loanType, sum]) => ({ loanType: loanType as LoanType, _sum: { outstandingBalance: sum } }));
  const liabilities: Partial<Record<LoanType, number>> = {};
  let totalLiabilities = 0;
  for (const entry of loanBreakdown) {
    const amt = Number(entry._sum.outstandingBalance);
    if (amt > 0) {
      liabilities[entry.loanType] = amt;
      totalLiabilities += amt;
    }
  }
  const {
    total: totalAssets, bankAccounts, fdItems, rdItems, investmentItems, goldItems,
    realEstateItems, otherAssetItems, ...assets
  } = assetBreakdown;
  return {
    assets,
    bankAccounts,
    fdItems,
    rdItems,
    investmentItems,
    goldItems,
    realEstateItems,
    otherAssetItems,
    liabilities,
    totalAssets,
    totalLiabilities,
    netWorth: totalAssets - totalLiabilities,
  };
}

export async function computeTotalLiabilities(userId?: string): Promise<number> {
  // Same reason as above: aggregate() would sum a co-owned loan at 100% for each owner.
  const loans = await prisma.loan.findMany({
    where: { ...loanVisibilityWhere(userId), endDate: { gte: new Date() } },
    select: {
      outstandingBalance: true,
      userId: true,
      owners: { select: { userId: true, sharePercent: true } },
    },
  });
  return loans.reduce(
    (sum, loan) => sum + Number(loan.outstandingBalance) * loanShareMultiplier(loan, userId),
    0,
  );
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
        SUM(CASE
          WHEN type = 'EXPENSE' THEN amount
          WHEN type = 'INCOME' AND "refundForTransactionId" IS NOT NULL THEN -amount
          ELSE 0
        END)::float AS expense
      FROM "Transaction"
      WHERE date >= ${start}
        AND date <= ${end}
        AND "deletedAt" IS NULL
        AND "transferPairId" IS NULL
        AND "sipId" IS NULL
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
  const [totalIncome, totalExpense, monthlyResults, expenseCategoryMap, incomeCategoryRows] =
    await Promise.all([
      getIncomeForPeriod(userFilter, { start, end }),
      getExpenseForPeriod(userFilter, { start, end }),
      // Monthly series — same raw SQL pattern as getCashflow, with safe Prisma.sql userFilter
      prisma.$queryRaw<Array<{ month: number; year: number; income: number; expense: number }>>`
        SELECT
          EXTRACT(MONTH FROM date AT TIME ZONE 'Asia/Kolkata')::int AS month,
          EXTRACT(YEAR FROM date AT TIME ZONE 'Asia/Kolkata')::int AS year,
          SUM(CASE WHEN type = 'INCOME' AND "refundForTransactionId" IS NULL THEN amount ELSE 0 END)::float AS income,
          SUM(CASE
            WHEN type = 'EXPENSE' THEN amount
            WHEN type = 'INCOME' AND "refundForTransactionId" IS NOT NULL THEN -amount
            ELSE 0
          END)::float AS expense
        FROM "Transaction"
        WHERE
          date >= ${start}
          AND date <= ${end}
          AND "deletedAt" IS NULL
          AND "transferPairId" IS NULL
          AND "sipId" IS NULL
          ${effectiveUserId ? Prisma.sql`AND "userId" = ${effectiveUserId}` : Prisma.empty}
        GROUP BY month, year
        ORDER BY year, month
      `,
      // Expense categories
      getNetExpenseByUserCategory(userFilter, { gte: start, lte: end }),
      // Income categories
      prisma.transaction.groupBy({
        by: ['categoryId'],
        where: reportingIncomeWhere(userFilter, { gte: start, lte: end }),
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 15,
      }),
    ]);

  // Resolve category names for both sets
  const expenseCategoryRows = [...expenseCategoryMap.entries()]
    .map(([key, total]) => ({ categoryId: key.split(':')[1] || null, total }))
    .reduce((acc, row) => {
      const existing = acc.find((item) => item.categoryId === row.categoryId);
      if (existing) existing.total += row.total;
      else acc.push(row);
      return acc;
    }, [] as { categoryId: string | null; total: number }[])
    .sort((a, b) => b.total - a.total)
    .slice(0, 15);

  const allCategoryIds = [
    ...expenseCategoryRows.map((r) => r.categoryId),
    ...incomeCategoryRows.map((r) => r.categoryId),
  ].filter((id): id is string => id !== null);

  const categories = await prisma.category.findMany({ where: { id: { in: allCategoryIds } } });
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));

  const mapExpenseCategories = (rows: typeof expenseCategoryRows) =>
    rows
      .map((r) => ({
        categoryId: r.categoryId,
        categoryName: r.categoryId ? (catMap[r.categoryId]?.name ?? 'Uncategorized') : 'Uncategorized',
        total: r.total,
      }))
      .sort((a, b) => compareCategoryNames(a.categoryName, b.categoryName));
  const mapIncomeCategories = (rows: typeof incomeCategoryRows) =>
    rows
      .map((r) => ({
        categoryId: r.categoryId,
        categoryName: r.categoryId ? (catMap[r.categoryId]?.name ?? 'Uncategorized') : 'Uncategorized',
        total: Number(r._sum.amount ?? 0),
      }))
      .sort((a, b) => compareCategoryNames(a.categoryName, b.categoryName));

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
    expenseCategories: mapExpenseCategories(expenseCategoryRows),
    incomeCategories: mapIncomeCategories(incomeCategoryRows),
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
  const [expenseMap, incomeRows] = await Promise.all([
    getNetExpenseByUserCategory(userFilter, dateFilter.date),
    prisma.transaction.groupBy({
      by: ['categoryId'],
      where: reportingIncomeWhere(userFilter, dateFilter.date),
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
    }),
  ]);

  const expenseRows = [...expenseMap.entries()]
    .map(([key, total]) => ({ categoryId: key.split(':')[1] || null, total }))
    .reduce((acc, row) => {
      const existing = acc.find((item) => item.categoryId === row.categoryId);
      if (existing) existing.total += row.total;
      else acc.push(row);
      return acc;
    }, [] as { categoryId: string | null; total: number }[])
    .sort((a, b) => b.total - a.total);

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
      debit: r.total,
      credit: 0,
    })),
    ...incomeRows.map((r) => ({
      accountName: resolveName(r.categoryId),
      type: 'CREDIT' as const,
      debit: 0,
      credit: Number(r._sum.amount ?? 0),
    })),
  ].sort((a, b) => compareCategoryNames(a.accountName, b.accountName));

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
