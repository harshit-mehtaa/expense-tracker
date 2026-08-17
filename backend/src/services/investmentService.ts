import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { normalizeOwnerShares, assertPrimaryOwnerRetained } from '../utils/ownerShares';
import { getFYRange } from '../utils/financialYear';
import { ownerScopedWhere } from '../utils/resolveTargetUserId';
import type { Prisma, InvestmentType, FDStatus, RDStatus, SIPStatus } from '@prisma/client';

// ─── XIRR (Newton-Raphson) ────────────────────────────────────────────────────

function xirr(cashflows: { amount: number; date: Date }[]): number | null {
  if (cashflows.length < 2) return null;
  const hasPositive = cashflows.some((c) => c.amount > 0);
  const hasNegative = cashflows.some((c) => c.amount < 0);
  if (!hasPositive || !hasNegative) return null;

  const baseDate = cashflows[0].date;
  const years = cashflows.map((c) => (c.date.getTime() - baseDate.getTime()) / (365.25 * 24 * 3600 * 1000));

  function npv(rate: number): number {
    return cashflows.reduce((sum, c, i) => sum + c.amount / Math.pow(1 + rate, years[i]), 0);
  }
  function dnpv(rate: number): number {
    return cashflows.reduce((sum, c, i) => sum - (years[i] * c.amount) / Math.pow(1 + rate, years[i] + 1), 0);
  }

  let rate = 0.1;
  for (let iter = 0; iter < 100; iter++) {
    /* c8 ignore next -- defensive: rate never goes below -1 for normal investment cashflows */
    if (rate <= -1) return null; // Avoid Math.pow domain error
    const f = npv(rate);
    const df = dnpv(rate);
    /* c8 ignore next -- defensive: f and df are always finite for normal investment cashflows */
    if (!isFinite(f) || !isFinite(df) || Math.abs(df) < 1e-12) return null;
    const delta = f / df;
    rate -= delta;
    if (Math.abs(delta) < 1e-7) return rate;
    /* c8 ignore next -- for-loop exhaustion branch (100 iters without convergence) is unreachable for normal cashflows */
  }
  /* c8 ignore next 2 -- Newton-Raphson non-convergence in 100 iterations is unreachable for normal cashflows */
  return null;
}

// ─── FD helpers ──────────────────────────────────────────────────────────────

export function calcFDMaturity(
  principal: number,
  annualRatePercent: number,
  tenureMonths: number,
  payoutType: string,
): number {
  const r = annualRatePercent / 100;
  if (payoutType === 'CUMULATIVE') {
    // Quarterly compounding
    return principal * Math.pow(1 + r / 4, (tenureMonths / 12) * 4);
  }
  // Simple interest for monthly/quarterly payout
  return principal + principal * r * (tenureMonths / 12);
}

export function calcRDMaturity(monthly: number, annualRatePercent: number, tenureMonths: number): number {
  const r = annualRatePercent / (4 * 100);
  const n = tenureMonths / 3; // quarters
  return monthly * (Math.pow(1 + r, n * 3) - 1) / (Math.pow(1 + r, 3) - 1) * Math.pow(1 + r, 3);
}

// ─── Portfolio Summary ────────────────────────────────────────────────────────

export async function getPortfolioSummary(userId: string | undefined, requesterId = userId ?? '', requesterRole = 'MEMBER') {
  const where = (
    requesterRole === 'ADMIN' && !userId
      ? { user: { isActive: true, deletedAt: null } }
      : { userId: userId ?? requesterId }
  ) as Prisma.InvestmentWhereInput;

  const investments = await prisma.investment.findMany({
    where,
    include: { sipTransactions: true },
  });

  const exchangeRates = await prisma.exchangeRate.findMany({ where: { toCurrency: 'INR' } });
  const rateMap: Record<string, number> = {};
  exchangeRates.forEach((r) => { rateMap[r.fromCurrency] = Number(r.rate); });

  let totalInvested = 0;
  let totalCurrentValue = 0;

  const byType: Record<string, { invested: number; current: number }> = {};

  for (const inv of investments) {
    const fxRate = inv.currency === 'INR' ? 1 : (rateMap[inv.currency] ?? 1);
    const units = Number(inv.unitsOrQuantity);
    const buyPrice = Number(inv.purchasePricePerUnit);
    const currPrice = Number(inv.currentPricePerUnit);
    const buyFx = inv.purchaseExchangeRate ? Number(inv.purchaseExchangeRate) : fxRate;

    const invested = units * buyPrice * buyFx;
    const current = units * currPrice * fxRate;

    totalInvested += invested;
    totalCurrentValue += current;

    if (!byType[inv.type]) byType[inv.type] = { invested: 0, current: 0 };
    byType[inv.type].invested += invested;
    byType[inv.type].current += current;
  }

  const absoluteGain = totalCurrentValue - totalInvested;
  const absoluteReturnPct = totalInvested > 0 ? (absoluteGain / totalInvested) * 100 : 0;

  // Portfolio-level XIRR using SIP transactions + current value
  const allCashflows: { amount: number; date: Date }[] = [];
  for (const inv of investments) {
    for (const tx of inv.sipTransactions) {
      allCashflows.push({ amount: -Number(tx.amount), date: tx.date });
    }
    // If no SIP transactions, use purchase date as outflow
    if (inv.sipTransactions.length === 0) {
      const fxRate = inv.currency === 'INR' ? 1 : (rateMap[inv.currency] ?? 1);
      const buyFx = inv.purchaseExchangeRate ? Number(inv.purchaseExchangeRate) : fxRate;
      allCashflows.push({
        amount: -(Number(inv.unitsOrQuantity) * Number(inv.purchasePricePerUnit) * buyFx),
        date: inv.purchaseDate,
      });
    }
  }
  if (totalCurrentValue > 0) allCashflows.push({ amount: totalCurrentValue, date: new Date() });

  const portfolioXirr = xirr(allCashflows.sort((a, b) => a.date.getTime() - b.date.getTime()));

  return {
    totalInvested,
    totalCurrentValue,
    absoluteGain,
    absoluteReturnPct,
    xirr: portfolioXirr,
    byType,
  };
}

// ─── 80C Summary ─────────────────────────────────────────────────────────────

export async function get80CSummary(userId: string | undefined, fy: string, requesterId?: string, requesterRole = 'MEMBER') {
  const { start, end } = getFYRange(fy);
  const requester = requesterId ?? userId;
  const userScope = (
    requesterRole === 'ADMIN' && !userId
      ? { user: { isActive: true, deletedAt: null } }
      : { userId: userId ?? requester! }
  );

  const [investments, fds, insurance] = await Promise.all([
    prisma.investment.findMany({
      where: { ...userScope, isTaxSaving: true, purchaseDate: { gte: start, lt: end } },
    }),
    prisma.fixedDeposit.findMany({
      where: { ...userScope, isTaxSaver: true, startDate: { gte: start, lt: end } },
    }),
    prisma.insurancePolicy.findMany({
      where: { ...userScope, is80cEligible: true },
    }),
  ]);

  const invTotal = investments.reduce((s, i) => s + Number(i.unitsOrQuantity) * Number(i.purchasePricePerUnit), 0);
  const fdTotal = fds.reduce((s, f) => s + Number(f.principalAmount), 0);
  const insuranceTotal = insurance.reduce((s, p) => {
    const annualPremium =
      p.premiumFrequency === 'MONTHLY' ? Number(p.premiumAmount) * 12
      : p.premiumFrequency === 'QUARTERLY' ? Number(p.premiumAmount) * 4
      : p.premiumFrequency === 'HALF_YEARLY' ? Number(p.premiumAmount) * 2
      : Number(p.premiumAmount);
    return s + annualPremium;
  }, 0);

  const total = invTotal + fdTotal + insuranceTotal;
  const limit = 150000;

  return {
    total: Math.min(total, limit),
    limit,
    breakdown: {
      investments: invTotal,
      fixedDeposits: fdTotal,
      insurance: insuranceTotal,
    },
    utilized: Math.min((total / limit) * 100, 100),
  };
}

// ─── CRUD: Investments ────────────────────────────────────────────────────────

export async function getInvestments(
  userId: string | undefined,
  type?: InvestmentType,
  page = 1,
  pageSize = 25,
  requesterRole = 'MEMBER',
) {
  const where = {
    ...(requesterRole === 'ADMIN' && !userId ? { user: { isActive: true, deletedAt: null } } : { userId: userId! }),
    ...(type ? { type } : {}),
  } as Prisma.InvestmentWhereInput;
  const skip = (page - 1) * pageSize;

  const [exchangeRates, total, investments] = await Promise.all([
    prisma.exchangeRate.findMany({ where: { toCurrency: 'INR' } }),
    prisma.investment.count({ where }),
    prisma.investment.findMany({
      where,
      include: { sipTransactions: { orderBy: { date: 'asc' } }, user: { select: { name: true } } },
      orderBy: { purchaseDate: 'desc' },
      skip,
      take: pageSize,
    }),
  ]);

  const rateMap: Record<string, number> = {};
  exchangeRates.forEach((r) => { rateMap[r.fromCurrency] = Number(r.rate); });

  const items = investments.map(({ user, ...inv }) => {
    const fxRate = inv.currency === 'INR' ? 1 : (rateMap[inv.currency] ?? 1);
    const buyFx = inv.purchaseExchangeRate ? Number(inv.purchaseExchangeRate) : fxRate;
    const units = Number(inv.unitsOrQuantity);
    const invested = units * Number(inv.purchasePricePerUnit) * buyFx;
    const current = units * Number(inv.currentPricePerUnit) * fxRate;
    const gain = current - invested;
    const gainPct = invested > 0 ? (gain / invested) * 100 : 0;

    // XIRR for this investment
    const cashflows: { amount: number; date: Date }[] = [];
    if (inv.sipTransactions.length > 0) {
      inv.sipTransactions.forEach((t) => cashflows.push({ amount: -Number(t.amount), date: t.date }));
    } else {
      cashflows.push({ amount: -invested, date: inv.purchaseDate });
    }
    cashflows.push({ amount: current, date: new Date() });
    const invXirr = xirr(cashflows);

    return { ...inv, userName: user?.name ?? '', investedINR: invested, currentValueINR: current, gainINR: gain, gainPct, xirr: invXirr };
  });

  return {
    items,
    pagination: { total, limit: pageSize, hasMore: page * pageSize < total },
  };
}

export async function createInvestment(userId: string, data: Prisma.InvestmentCreateWithoutUserInput) {
  return prisma.investment.create({ data: { ...data, userId } });
}

export async function updateInvestment(requesterId: string, id: string, data: Prisma.InvestmentUpdateInput, requesterRole = 'MEMBER') {
  const inv = await prisma.investment.findFirst({ where: ownerScopedWhere(id, requesterId, requesterRole) });
  if (!inv) throw AppError.notFound('Investment');
  return prisma.investment.update({ where: { id }, data });
}

export async function deleteInvestment(requesterId: string, id: string, requesterRole = 'MEMBER') {
  const inv = await prisma.investment.findFirst({ where: ownerScopedWhere(id, requesterId, requesterRole) });
  if (!inv) throw AppError.notFound('Investment');
  return prisma.investment.delete({ where: { id } });
}

export async function getInvestmentForAudit(requesterId: string, id: string, requesterRole = 'MEMBER') {
  return prisma.investment.findFirst({ where: ownerScopedWhere(id, requesterId, requesterRole) });
}

// ─── CRUD: FDs ────────────────────────────────────────────────────────────────

export async function getFDs(userId: string | undefined, requesterId: string, requesterRole: string, status?: FDStatus) {
  // MEMBER: always own FDs only (ignore any passed userId)
  if (requesterRole !== 'ADMIN') {
    return prisma.fixedDeposit.findMany({
      where: { userId: requesterId, ...(status ? { status } : {}) },
      orderBy: { maturityDate: 'asc' },
    });
  }

  // ADMIN viewing a specific member
  if (userId) {
    return prisma.fixedDeposit.findMany({
      where: { userId, ...(status ? { status } : {}) },
      orderBy: { maturityDate: 'asc' },
    });
  }

  // ADMIN family-wide: all FDs for active users, include owner name
  const fds = await prisma.fixedDeposit.findMany({
    where: { ...(status ? { status } : {}), user: { isActive: true, deletedAt: null } },
    include: { user: { select: { name: true } } },
    orderBy: [{ user: { name: 'asc' } }, { maturityDate: 'asc' }],
  });

  return fds.map(({ user, ...rest }) => ({ ...rest, userName: user?.name ?? '' }));
}

export async function getFDsMaturing(userId: string, days: number) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);
  return prisma.fixedDeposit.findMany({
    where: { userId, status: 'ACTIVE', maturityDate: { lte: cutoff } },
    orderBy: { maturityDate: 'asc' },
  });
}

export async function createFD(userId: string, data: Omit<Prisma.FixedDepositCreateInput, 'user'>) {
  const maturityAmount = calcFDMaturity(
    Number(data.principalAmount),
    Number(data.interestRate),
    data.tenureMonths as number,
    (data.interestPayoutType as string) ?? 'CUMULATIVE',
  );
  return prisma.fixedDeposit.create({
    data: { ...data, userId, maturityAmount } as Prisma.FixedDepositUncheckedCreateInput,
  });
}

export async function updateFD(requesterId: string, id: string, data: Prisma.FixedDepositUpdateInput, requesterRole = 'MEMBER') {
  const fd = await prisma.fixedDeposit.findFirst({ where: ownerScopedWhere(id, requesterId, requesterRole) });
  if (!fd) throw AppError.notFound('Fixed deposit');
  const updateData: Prisma.FixedDepositUpdateInput = { ...data };
  const shouldRecalculate = (
    data.principalAmount !== undefined
    || data.interestRate !== undefined
    || data.tenureMonths !== undefined
    || data.interestPayoutType !== undefined
  );

  if (shouldRecalculate) {
    updateData.maturityAmount = calcFDMaturity(
      Number(data.principalAmount ?? fd.principalAmount),
      Number(data.interestRate ?? fd.interestRate),
      Number(data.tenureMonths ?? fd.tenureMonths),
      String(data.interestPayoutType ?? fd.interestPayoutType),
    );
  }

  return prisma.fixedDeposit.update({ where: { id }, data: updateData });
}

export async function deleteFD(requesterId: string, id: string, requesterRole = 'MEMBER') {
  const fd = await prisma.fixedDeposit.findFirst({ where: ownerScopedWhere(id, requesterId, requesterRole) });
  if (!fd) throw AppError.notFound('Fixed deposit');
  return prisma.fixedDeposit.delete({ where: { id } });
}

export async function getFDForAudit(requesterId: string, id: string, requesterRole = 'MEMBER') {
  return prisma.fixedDeposit.findFirst({ where: ownerScopedWhere(id, requesterId, requesterRole) });
}

// ─── CRUD: RDs ────────────────────────────────────────────────────────────────

export async function getRDs(userId: string | undefined, requesterId: string, requesterRole: string, status?: RDStatus) {
  // MEMBER: always own RDs only (ignore any passed userId)
  if (requesterRole !== 'ADMIN') {
    return prisma.recurringDeposit.findMany({
      where: { userId: requesterId, ...(status ? { status } : {}) },
      orderBy: { maturityDate: 'asc' },
    });
  }

  // ADMIN viewing a specific member
  if (userId) {
    return prisma.recurringDeposit.findMany({
      where: { userId, ...(status ? { status } : {}) },
      orderBy: { maturityDate: 'asc' },
    });
  }

  // ADMIN family-wide: all RDs for active users, include owner name
  const rds = await prisma.recurringDeposit.findMany({
    where: { ...(status ? { status } : {}), user: { isActive: true, deletedAt: null } },
    include: { user: { select: { name: true } } },
    orderBy: [{ user: { name: 'asc' } }, { maturityDate: 'asc' }],
  });

  return rds.map(({ user, ...rest }) => ({ ...rest, userName: user?.name ?? '' }));
}

export async function createRD(userId: string, data: Omit<Prisma.RecurringDepositCreateInput, 'user'>) {
  const maturityAmount = calcRDMaturity(
    Number(data.monthlyInstallment),
    Number(data.interestRate),
    data.tenureMonths as number,
  );
  return prisma.recurringDeposit.create({
    data: { ...data, userId, maturityAmount } as Prisma.RecurringDepositUncheckedCreateInput,
  });
}

export async function updateRD(requesterId: string, id: string, data: Prisma.RecurringDepositUpdateInput, requesterRole = 'MEMBER') {
  const rd = await prisma.recurringDeposit.findFirst({ where: ownerScopedWhere(id, requesterId, requesterRole) });
  if (!rd) throw AppError.notFound('Recurring deposit');
  const updateData: Prisma.RecurringDepositUpdateInput = { ...data };
  const shouldRecalculate = (
    data.monthlyInstallment !== undefined
    || data.interestRate !== undefined
    || data.tenureMonths !== undefined
  );

  if (shouldRecalculate) {
    updateData.maturityAmount = calcRDMaturity(
      Number(data.monthlyInstallment ?? rd.monthlyInstallment),
      Number(data.interestRate ?? rd.interestRate),
      Number(data.tenureMonths ?? rd.tenureMonths),
    );
  }

  return prisma.recurringDeposit.update({ where: { id }, data: updateData });
}

export async function deleteRD(requesterId: string, id: string, requesterRole = 'MEMBER') {
  const rd = await prisma.recurringDeposit.findFirst({ where: ownerScopedWhere(id, requesterId, requesterRole) });
  if (!rd) throw AppError.notFound('Recurring deposit');
  return prisma.recurringDeposit.delete({ where: { id } });
}

export async function getRDForAudit(requesterId: string, id: string, requesterRole = 'MEMBER') {
  return prisma.recurringDeposit.findFirst({ where: ownerScopedWhere(id, requesterId, requesterRole) });
}

// ─── CRUD: SIPs ───────────────────────────────────────────────────────────────

export async function getSIPs(userId: string | undefined, status?: SIPStatus, requesterRole = 'MEMBER') {
  const sips = await prisma.sIP.findMany({
    where: {
      ...(requesterRole === 'ADMIN' && !userId ? { user: { isActive: true, deletedAt: null } } : { userId: userId! }),
      ...(status ? { status } : {}),
    },
    include: { investment: true, bankAccount: true, user: { select: { name: true } } },
    orderBy: { startDate: 'desc' },
  });

  return sips.map(({ user, ...rest }) => ({ ...rest, userName: user?.name ?? '' }));
}

export async function getSIPsUpcoming(userId: string, days: number) {
  const today = new Date();
  const todayDay = today.getDate();
  const cutoffDay = todayDay + days;

  const sips = await prisma.sIP.findMany({
    where: { userId, status: 'ACTIVE' },
    include: { investment: true },
  });

  return sips
    .filter((s) => {
      const d = s.sipDate;
      if (cutoffDay <= 28) return d >= todayDay && d <= cutoffDay;
      return d >= todayDay || d <= cutoffDay - 28;
    })
    .map((s) => {
      const nextDate = new Date(today.getFullYear(), today.getMonth(), s.sipDate);
      if (nextDate < today) nextDate.setMonth(nextDate.getMonth() + 1);
      return { ...s, nextDate };
    });
}

type CreateSIPInput = Omit<Prisma.SIPUncheckedCreateInput, 'id' | 'userId' | 'investmentId'> & {
  investmentId?: string;
};

export async function createSIP(userId: string, data: CreateSIPInput) {
  const { investmentId, ...rest } = data;
  let resolvedInvestmentId = investmentId;

  if (resolvedInvestmentId) {
    const investment = await prisma.investment.findFirst({
      where: { id: resolvedInvestmentId, userId },
      select: { id: true },
    });
    if (!investment) throw AppError.notFound('Investment');
  } else {
    const investment = await prisma.investment.create({
      data: {
        userId,
        type: 'MUTUAL_FUND',
        name: rest.fundName,
        currency: 'INR',
        unitsOrQuantity: 0,
        purchasePricePerUnit: 0,
        currentPricePerUnit: 0,
        purchaseDate: rest.startDate instanceof Date ? rest.startDate : new Date(),
        folioNumber: rest.folioNumber,
        notes: 'Auto-created from SIP setup',
      },
    });
    resolvedInvestmentId = investment.id;
  }

  return prisma.sIP.create({
    data: { ...rest, userId, investmentId: resolvedInvestmentId } as Prisma.SIPUncheckedCreateInput,
    include: { investment: true, bankAccount: true },
  });
}

export async function updateSIP(requesterId: string, id: string, data: Prisma.SIPUncheckedUpdateInput, requesterRole = 'MEMBER') {
  const sip = await prisma.sIP.findFirst({ where: ownerScopedWhere(id, requesterId, requesterRole) });
  if (!sip) throw AppError.notFound('SIP');

  if (data.investmentId !== undefined) {
    const investmentId = String(data.investmentId);
    const investment = await prisma.investment.findFirst({
      where: { id: investmentId, userId: sip.userId },
      select: { id: true },
    });
    if (!investment) throw AppError.notFound('Investment');
  }

  return prisma.sIP.update({ where: { id }, data, include: { investment: true, bankAccount: true } });
}

export async function deleteSIP(requesterId: string, id: string, requesterRole = 'MEMBER') {
  const sip = await prisma.sIP.findFirst({ where: ownerScopedWhere(id, requesterId, requesterRole) });
  if (!sip) throw AppError.notFound('SIP');
  return prisma.sIP.delete({ where: { id } });
}

export async function getSIPForAudit(requesterId: string, id: string, requesterRole = 'MEMBER') {
  return prisma.sIP.findFirst({ where: ownerScopedWhere(id, requesterId, requesterRole) });
}

export async function addSIPTransaction(
  requesterId: string,
  sipId: string,
  data: { date: Date; units: number; nav: number; amount: number; type?: 'BUY' | 'SELL' | 'DIVIDEND' },
  requesterRole = 'MEMBER',
) {
  const sip = await prisma.sIP.findFirst({ where: ownerScopedWhere(sipId, requesterId, requesterRole) });
  if (!sip) throw AppError.notFound('SIP');
  return prisma.sIPTransaction.create({
    data: { investmentId: sip.investmentId, date: data.date, units: data.units, nav: data.nav, amount: data.amount, type: data.type ?? 'BUY' },
  });
}

// ─── CRUD: Gold ───────────────────────────────────────────────────────────────

export async function getGoldHoldings(userId: string | undefined, requesterId: string, requesterRole: string) {
  let rawHoldings: any[];

  if (requesterRole !== 'ADMIN') {
    rawHoldings = await prisma.goldHolding.findMany({ where: { userId: requesterId }, orderBy: { purchaseDate: 'desc' } });
  } else if (userId) {
    rawHoldings = await prisma.goldHolding.findMany({ where: { userId }, orderBy: { purchaseDate: 'desc' } });
  } else {
    const rows = await prisma.goldHolding.findMany({
      where: { user: { isActive: true, deletedAt: null } },
      include: { user: { select: { name: true } } },
      orderBy: [{ user: { name: 'asc' } }, { purchaseDate: 'desc' }],
    });
    rawHoldings = rows.map(({ user, ...rest }) => ({ ...rest, userName: user?.name ?? '' }));
  }

  const holdings = rawHoldings;
  const totalGrams = holdings.reduce((s: number, h: any) => s + Number(h.quantityGrams), 0);
  const totalPurchaseValue = holdings.reduce((s: number, h: any) => s + Number(h.quantityGrams) * Number(h.purchasePricePerGram), 0);
  const totalCurrentValue = holdings.reduce((s: number, h: any) => s + Number(h.quantityGrams) * Number(h.currentPricePerGram), 0);
  const gain = totalCurrentValue - totalPurchaseValue;
  const gainPct = totalPurchaseValue > 0 ? (gain / totalPurchaseValue) * 100 : 0;
  return { holdings, summary: { totalGrams, totalPurchaseValue, totalCurrentValue, gain, gainPct } };
}

export async function createGoldHolding(userId: string, data: Omit<Prisma.GoldHoldingCreateInput, 'user'>) {
  return prisma.goldHolding.create({ data: { ...data, userId } });
}

export async function updateGoldHolding(requesterId: string, id: string, data: Prisma.GoldHoldingUpdateInput, requesterRole = 'MEMBER') {
  const g = await prisma.goldHolding.findFirst({ where: ownerScopedWhere(id, requesterId, requesterRole) });
  if (!g) throw AppError.notFound('Gold holding');
  return prisma.goldHolding.update({ where: { id }, data });
}

export async function deleteGoldHolding(requesterId: string, id: string, requesterRole = 'MEMBER') {
  const g = await prisma.goldHolding.findFirst({ where: ownerScopedWhere(id, requesterId, requesterRole) });
  if (!g) throw AppError.notFound('Gold holding');
  return prisma.goldHolding.delete({ where: { id } });
}

export async function getGoldHoldingForAudit(requesterId: string, id: string, requesterRole = 'MEMBER') {
  return prisma.goldHolding.findFirst({ where: ownerScopedWhere(id, requesterId, requesterRole) });
}

// ─── CRUD: Real Estate ────────────────────────────────────────────────────────

type RealEstateOwnerInput = {
  userId: string;
  sharePercent: number;
};

type RealEstateWriteInput = Omit<Prisma.RealEstateUncheckedCreateInput, 'id' | 'userId' | 'createdAt' | 'updatedAt'> & {
  owners?: RealEstateOwnerInput[];
};

type RealEstateUpdateInput = Prisma.RealEstateUncheckedUpdateInput & {
  owners?: RealEstateOwnerInput[];
};

const realEstateInclude = {
  // NOT `loan: true`. A property is visible to its co-owners, and the loan is not — that
  // has its own owner set. Returning the whole row handed a property co-owner the
  // lender, balance, rate, EMI and every field added to Loan since. Only what the
  // property view actually renders.
  loan: {
    select: {
      id: true, lenderName: true, loanType: true,
      outstandingBalance: true, emiAmount: true, emiDate: true,
    },
  },
  owners: {
    include: {
      user: { select: { id: true, name: true, email: true, colorTag: true } },
    },
  },
} as const;

function normalizeRealEstateOwners(defaultUserId: string, owners?: RealEstateOwnerInput[]) {
  return normalizeOwnerShares(defaultUserId, owners, 'Property owner');
}

async function assertActiveRealEstateOwners(owners: RealEstateOwnerInput[]) {
  const ownerIds = owners.map((owner) => owner.userId);
  const activeUsers = await prisma.user.findMany({
    where: { id: { in: ownerIds }, isActive: true, deletedAt: null },
    select: { id: true },
  });
  const activeIds = new Set(activeUsers.map((user) => user.id));
  const missing = ownerIds.find((ownerId) => !activeIds.has(ownerId));
  if (missing) throw AppError.validationError('All property owners must be active family members');
}

function decorateRealEstateProperty(row: any, scopedUserId?: string) {
  const { user, ...property } = row;
  const owners = (property.owners ?? [])
    .map((owner: any) => ({
      id: owner.id,
      userId: owner.userId,
      name: owner.user?.name ?? '',
      email: owner.user?.email ?? '',
      colorTag: owner.user?.colorTag ?? null,
      sharePercent: Number(owner.sharePercent),
    }))
    .sort((a: any, b: any) => a.name.localeCompare(b.name));

  const purchasePrice = Number(property.purchasePrice);
  const currentValue = Number(property.currentValue);
  const rentalIncomeMonthly = property.rentalIncomeMonthly == null ? null : Number(property.rentalIncomeMonthly);
  const scopedOwner = scopedUserId ? owners.find((owner: any) => owner.userId === scopedUserId) : undefined;
  // No `property.userId === scopedUserId` fallback: see ownerShareMultiplier. A record
  // whose owner rows omit the primary would otherwise report the primary at 100% while
  // every co-owner also reported their share — the same property counted twice across
  // the family, in net worth and in any relief derived from it.
  const sharePercent = scopedUserId
    ? scopedOwner?.sharePercent ?? (owners.length === 0 ? 100 : 0)
    : 100;
  const shareMultiplier = sharePercent / 100;

  return {
    ...property,
    owners,
    userName: user?.name ?? property.userName ?? '',
    purchasePrice,
    currentValue,
    rentalIncomeMonthly,
    sharePercent: scopedUserId ? sharePercent : undefined,
    purchasePriceShare: purchasePrice * shareMultiplier,
    currentValueShare: currentValue * shareMultiplier,
    rentalIncomeMonthlyShare: (rentalIncomeMonthly ?? 0) * shareMultiplier,
  };
}

function userRealEstateWhere(userId: string): Prisma.RealEstateWhereInput {
  return {
    OR: [
      { userId },
      { owners: { some: { userId } } },
    ],
  };
}

function userRealEstateWriteWhere(id: string, requesterId: string, requesterRole: string): Prisma.RealEstateWhereInput {
  if (requesterRole === 'ADMIN') return { id };
  return {
    id,
    OR: [
      { userId: requesterId },
      { owners: { some: { userId: requesterId } } },
    ],
  };
}

export async function getRealEstate(userId: string | undefined, requesterId: string, requesterRole: string) {
  let properties: any[];
  let scopedUserId: string | undefined;

  if (requesterRole !== 'ADMIN') {
    scopedUserId = requesterId;
    const rows = await prisma.realEstate.findMany({
      where: userRealEstateWhere(requesterId),
      include: realEstateInclude,
      orderBy: { purchaseDate: 'desc' },
    });
    properties = rows.map((row) => decorateRealEstateProperty(row, scopedUserId));
  } else if (userId) {
    scopedUserId = userId;
    const rows = await prisma.realEstate.findMany({
      where: userRealEstateWhere(userId),
      include: realEstateInclude,
      orderBy: { purchaseDate: 'desc' },
    });
    properties = rows.map((row) => decorateRealEstateProperty(row, scopedUserId));
  } else {
    const rows = await prisma.realEstate.findMany({
      where: { user: { isActive: true, deletedAt: null } },
      include: { ...realEstateInclude, user: { select: { name: true } } },
      orderBy: [{ user: { name: 'asc' } }, { purchaseDate: 'desc' }],
    });
    properties = rows.map((row) => decorateRealEstateProperty(row));
  }

  const totalPurchase = properties.reduce((s: number, p: any) => s + (scopedUserId ? Number(p.purchasePriceShare) : Number(p.purchasePrice)), 0);
  const totalCurrent = properties.reduce((s: number, p: any) => s + (scopedUserId ? Number(p.currentValueShare) : Number(p.currentValue)), 0);
  const totalRental = properties.reduce((s: number, p: any) => s + (scopedUserId ? Number(p.rentalIncomeMonthlyShare) : Number(p.rentalIncomeMonthly ?? 0)), 0);
  return { properties, summary: { totalPurchase, totalCurrent, unrealisedGain: totalCurrent - totalPurchase, totalMonthlyRental: totalRental } };
}

export async function createRealEstate(userId: string, data: RealEstateWriteInput) {
  const { owners, ...propertyData } = data as any;
  const ownerRows = normalizeRealEstateOwners(userId, owners);
  await assertActiveRealEstateOwners(ownerRows);

  const property = await prisma.realEstate.create({
    data: {
      ...propertyData,
      userId,
      owners: { create: ownerRows.map((owner) => ({ userId: owner.userId, sharePercent: owner.sharePercent })) },
    } as any,
    include: realEstateInclude,
  });
  return decorateRealEstateProperty(property);
}

export async function updateRealEstate(requesterId: string, id: string, data: RealEstateUpdateInput, requesterRole = 'MEMBER') {
  const r = await prisma.realEstate.findFirst({ where: userRealEstateWriteWhere(id, requesterId, requesterRole) });
  if (!r) throw AppError.notFound('Property');

  const { owners, ...propertyData } = data as any;
  let ownerRows: ReturnType<typeof normalizeRealEstateOwners> | undefined;
  if (owners !== undefined) {
    assertPrimaryOwnerRetained(owners, r.userId, requesterId, requesterRole, 'Property owner');
    ownerRows = normalizeRealEstateOwners(r.userId, owners);
    await assertActiveRealEstateOwners(ownerRows);
  }

  const property = await prisma.realEstate.update({
    where: { id },
    data: {
      ...propertyData,
      ...(ownerRows ? { owners: { deleteMany: {}, create: ownerRows.map((owner) => ({ userId: owner.userId, sharePercent: owner.sharePercent })) } } : {}),
    } as any,
    include: realEstateInclude,
  });
  return decorateRealEstateProperty(property);
}

export async function deleteRealEstate(requesterId: string, id: string, requesterRole = 'MEMBER') {
  const r = await prisma.realEstate.findFirst({ where: userRealEstateWriteWhere(id, requesterId, requesterRole) });
  if (!r) throw AppError.notFound('Property');
  return prisma.realEstate.delete({ where: { id } });
}

/**
 * Audit-snapshot fetch. Scoped with the same predicate updateRealEstate/deleteRealEstate
 * evaluate one line later, so a non-owner's snapshot is never read into memory. Behaviour
 * at both call sites is unchanged: those mutations throw notFound for a non-owner before
 * recordAuditLog runs, so the snapshot was always discarded anyway — this just removes the
 * trap for the next caller, and keeps it consistent with every other *ForAudit getter.
 */
export async function getRealEstateForAudit(requesterId: string, id: string, requesterRole = 'MEMBER') {
  return prisma.realEstate.findFirst({ where: userRealEstateWriteWhere(id, requesterId, requesterRole) });
}

// ─── Exchange Rates ───────────────────────────────────────────────────────────

export async function getExchangeRates() {
  return prisma.exchangeRate.findMany({ where: { toCurrency: 'INR' }, orderBy: { fromCurrency: 'asc' } });
}

export async function upsertExchangeRate(fromCurrency: string, rate: number, updatedBy: string) {
  return prisma.exchangeRate.upsert({
    where: { fromCurrency_toCurrency: { fromCurrency, toCurrency: 'INR' } },
    create: { fromCurrency, toCurrency: 'INR', rate, updatedBy },
    update: { rate, updatedBy },
  });
}

/** Exchange rates are global, not per-user — no requesterId/role param needed. */
export async function getExchangeRateForAudit(fromCurrency: string) {
  return prisma.exchangeRate.findUnique({ where: { fromCurrency_toCurrency: { fromCurrency, toCurrency: 'INR' } } });
}
