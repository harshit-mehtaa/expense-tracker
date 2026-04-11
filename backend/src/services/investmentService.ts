import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { getFYRange } from '../utils/financialYear';
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
    if (rate <= -1) return null; // Avoid Math.pow domain error
    const f = npv(rate);
    const df = dnpv(rate);
    if (!isFinite(f) || !isFinite(df) || Math.abs(df) < 1e-12) return null;
    const delta = f / df;
    rate -= delta;
    if (Math.abs(delta) < 1e-7) return rate;
  }
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

export async function getPortfolioSummary(userId: string) {
  const investments = await prisma.investment.findMany({
    where: { userId },
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

export async function get80CSummary(userId: string, fy: string) {
  const { start, end } = getFYRange(fy);

  const [investments, fds, insurance] = await Promise.all([
    prisma.investment.findMany({
      where: { userId, isTaxSaving: true, purchaseDate: { gte: start, lt: end } },
    }),
    prisma.fixedDeposit.findMany({
      where: { userId, isTaxSaver: true, startDate: { gte: start, lt: end } },
    }),
    prisma.insurancePolicy.findMany({
      where: { userId, is80cEligible: true },
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

export async function getInvestments(userId: string, type?: InvestmentType, page = 1, pageSize = 25) {
  const where = { userId, ...(type ? { type } : {}) };
  const skip = (page - 1) * pageSize;

  const [exchangeRates, total, investments] = await Promise.all([
    prisma.exchangeRate.findMany({ where: { toCurrency: 'INR' } }),
    prisma.investment.count({ where }),
    prisma.investment.findMany({
      where,
      include: { sipTransactions: { orderBy: { date: 'asc' } } },
      orderBy: { purchaseDate: 'desc' },
      skip,
      take: pageSize,
    }),
  ]);

  const rateMap: Record<string, number> = {};
  exchangeRates.forEach((r) => { rateMap[r.fromCurrency] = Number(r.rate); });

  const items = investments.map((inv) => {
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

    return { ...inv, investedINR: invested, currentValueINR: current, gainINR: gain, gainPct, xirr: invXirr };
  });

  return {
    items,
    pagination: { total, limit: pageSize, hasMore: page * pageSize < total },
  };
}

export async function createInvestment(userId: string, data: Prisma.InvestmentCreateWithoutUserInput) {
  return prisma.investment.create({ data: { ...data, userId } });
}

export async function updateInvestment(userId: string, id: string, data: Prisma.InvestmentUpdateInput) {
  const inv = await prisma.investment.findFirst({ where: { id, userId } });
  if (!inv) throw AppError.notFound('Investment');
  return prisma.investment.update({ where: { id }, data });
}

export async function deleteInvestment(userId: string, id: string) {
  const inv = await prisma.investment.findFirst({ where: { id, userId } });
  if (!inv) throw AppError.notFound('Investment');
  return prisma.investment.delete({ where: { id } });
}

// ─── CRUD: FDs ────────────────────────────────────────────────────────────────

export async function getFDs(userId: string, status?: FDStatus) {
  return prisma.fixedDeposit.findMany({
    where: { userId, ...(status ? { status } : {}) },
    orderBy: { maturityDate: 'asc' },
  });
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
    data: { ...data, userId, maturityAmount },
  });
}

export async function updateFD(userId: string, id: string, data: Prisma.FixedDepositUpdateInput) {
  const fd = await prisma.fixedDeposit.findFirst({ where: { id, userId } });
  if (!fd) throw AppError.notFound('Fixed deposit');
  return prisma.fixedDeposit.update({ where: { id }, data });
}

export async function deleteFD(userId: string, id: string) {
  const fd = await prisma.fixedDeposit.findFirst({ where: { id, userId } });
  if (!fd) throw AppError.notFound('Fixed deposit');
  return prisma.fixedDeposit.delete({ where: { id } });
}

// ─── CRUD: RDs ────────────────────────────────────────────────────────────────

export async function getRDs(userId: string, status?: RDStatus) {
  return prisma.recurringDeposit.findMany({
    where: { userId, ...(status ? { status } : {}) },
    orderBy: { maturityDate: 'asc' },
  });
}

export async function createRD(userId: string, data: Omit<Prisma.RecurringDepositCreateInput, 'user'>) {
  const maturityAmount = calcRDMaturity(
    Number(data.monthlyInstallment),
    Number(data.interestRate),
    data.tenureMonths as number,
  );
  return prisma.recurringDeposit.create({
    data: { ...data, userId, maturityAmount },
  });
}

export async function updateRD(userId: string, id: string, data: Prisma.RecurringDepositUpdateInput) {
  const rd = await prisma.recurringDeposit.findFirst({ where: { id, userId } });
  if (!rd) throw AppError.notFound('Recurring deposit');
  return prisma.recurringDeposit.update({ where: { id }, data });
}

export async function deleteRD(userId: string, id: string) {
  const rd = await prisma.recurringDeposit.findFirst({ where: { id, userId } });
  if (!rd) throw AppError.notFound('Recurring deposit');
  return prisma.recurringDeposit.delete({ where: { id } });
}

// ─── CRUD: SIPs ───────────────────────────────────────────────────────────────

export async function getSIPs(userId: string, status?: SIPStatus) {
  return prisma.sIP.findMany({
    where: { userId, ...(status ? { status } : {}) },
    include: { investment: true, bankAccount: true },
    orderBy: { startDate: 'desc' },
  });
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

export async function createSIP(userId: string, data: Omit<Prisma.SIPCreateInput, 'user' | 'investment'> & { investmentId: string }) {
  const { investmentId, ...rest } = data;
  return prisma.sIP.create({
    data: { ...rest, userId, investment: { connect: { id: investmentId } } },
    include: { investment: true },
  });
}

export async function updateSIP(userId: string, id: string, data: Prisma.SIPUpdateInput) {
  const sip = await prisma.sIP.findFirst({ where: { id, userId } });
  if (!sip) throw AppError.notFound('SIP');
  return prisma.sIP.update({ where: { id }, data });
}

export async function deleteSIP(userId: string, id: string) {
  const sip = await prisma.sIP.findFirst({ where: { id, userId } });
  if (!sip) throw AppError.notFound('SIP');
  return prisma.sIP.delete({ where: { id } });
}

export async function addSIPTransaction(userId: string, sipId: string, data: { date: Date; units: number; nav: number; amount: number; type?: 'BUY' | 'SELL' | 'DIVIDEND' }) {
  const sip = await prisma.sIP.findFirst({ where: { id: sipId, userId } });
  if (!sip) throw AppError.notFound('SIP');
  return prisma.sIPTransaction.create({
    data: { investmentId: sip.investmentId, date: data.date, units: data.units, nav: data.nav, amount: data.amount, type: data.type ?? 'BUY' },
  });
}

// ─── CRUD: Gold ───────────────────────────────────────────────────────────────

export async function getGoldHoldings(userId: string) {
  const holdings = await prisma.goldHolding.findMany({ where: { userId }, orderBy: { purchaseDate: 'desc' } });
  const totalGrams = holdings.reduce((s, h) => s + Number(h.quantityGrams), 0);
  const totalPurchaseValue = holdings.reduce((s, h) => s + Number(h.quantityGrams) * Number(h.purchasePricePerGram), 0);
  const totalCurrentValue = holdings.reduce((s, h) => s + Number(h.quantityGrams) * Number(h.currentPricePerGram), 0);
  const gain = totalCurrentValue - totalPurchaseValue;
  const gainPct = totalPurchaseValue > 0 ? (gain / totalPurchaseValue) * 100 : 0;
  return { holdings, summary: { totalGrams, totalPurchaseValue, totalCurrentValue, gain, gainPct } };
}

export async function createGoldHolding(userId: string, data: Omit<Prisma.GoldHoldingCreateInput, 'user'>) {
  return prisma.goldHolding.create({ data: { ...data, userId } });
}

export async function updateGoldHolding(userId: string, id: string, data: Prisma.GoldHoldingUpdateInput) {
  const g = await prisma.goldHolding.findFirst({ where: { id, userId } });
  if (!g) throw AppError.notFound('Gold holding');
  return prisma.goldHolding.update({ where: { id }, data });
}

export async function deleteGoldHolding(userId: string, id: string) {
  const g = await prisma.goldHolding.findFirst({ where: { id, userId } });
  if (!g) throw AppError.notFound('Gold holding');
  return prisma.goldHolding.delete({ where: { id } });
}

// ─── CRUD: Real Estate ────────────────────────────────────────────────────────

export async function getRealEstate(userId: string) {
  const properties = await prisma.realEstate.findMany({
    where: { userId },
    include: { loan: true },
    orderBy: { purchaseDate: 'desc' },
  });
  const totalPurchase = properties.reduce((s, p) => s + Number(p.purchasePrice), 0);
  const totalCurrent = properties.reduce((s, p) => s + Number(p.currentValue), 0);
  const totalRental = properties.reduce((s, p) => s + (p.rentalIncomeMonthly ? Number(p.rentalIncomeMonthly) : 0), 0);
  return { properties, summary: { totalPurchase, totalCurrent, unrealisedGain: totalCurrent - totalPurchase, totalMonthlyRental: totalRental } };
}

export async function createRealEstate(userId: string, data: Omit<Prisma.RealEstateCreateInput, 'user'>) {
  return prisma.realEstate.create({ data: { ...data, userId } });
}

export async function updateRealEstate(userId: string, id: string, data: Prisma.RealEstateUpdateInput) {
  const r = await prisma.realEstate.findFirst({ where: { id, userId } });
  if (!r) throw AppError.notFound('Property');
  return prisma.realEstate.update({ where: { id }, data });
}

export async function deleteRealEstate(userId: string, id: string) {
  const r = await prisma.realEstate.findFirst({ where: { id, userId } });
  if (!r) throw AppError.notFound('Property');
  return prisma.realEstate.delete({ where: { id } });
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
