import { prisma } from '../config/prisma';
import { getFYRange, getCurrentFY } from '../utils/financialYear';
import { buildAmortizationSchedule } from './loanService';
import type { Prisma } from '@prisma/client';

// ─── Indian Tax Slabs (FY 2024-25) ───────────────────────────────────────────

function calcOldRegimeTax(taxableIncome: number): number {
  if (taxableIncome <= 250000) return 0;
  if (taxableIncome <= 500000) return (taxableIncome - 250000) * 0.05;
  if (taxableIncome <= 1000000) return 12500 + (taxableIncome - 500000) * 0.20;
  return 12500 + 100000 + (taxableIncome - 1000000) * 0.30;
}

function calcNewRegimeTax(taxableIncome: number): number {
  // FY 2024-25 new regime slabs
  if (taxableIncome <= 300000) return 0;
  if (taxableIncome <= 700000) return (taxableIncome - 300000) * 0.05;
  if (taxableIncome <= 1000000) return 20000 + (taxableIncome - 700000) * 0.10;
  if (taxableIncome <= 1200000) return 50000 + (taxableIncome - 1000000) * 0.15;
  if (taxableIncome <= 1500000) return 80000 + (taxableIncome - 1200000) * 0.20;
  return 140000 + (taxableIncome - 1500000) * 0.30;
}

function addSurchargeAndCess(tax: number, income: number): number {
  let surcharge = 0;
  if (income > 5000000 && income <= 10000000) surcharge = tax * 0.10;
  else if (income > 10000000 && income <= 20000000) surcharge = tax * 0.15;
  else if (income > 20000000 && income <= 50000000) surcharge = tax * 0.25;
  else if (income > 50000000) surcharge = tax * 0.37;
  return (tax + surcharge) * 1.04; // 4% health + education cess
}

// ─── HRA Calculator ──────────────────────────────────────────────────────────

export function calcHRAExemption(
  basicSalary: number,
  hraReceived: number,
  rentPaid: number,
  isMetro: boolean,
): number {
  const hraAllowance = hraReceived;
  const rentExcess = Math.max(rentPaid - basicSalary * 0.1, 0);
  const metroLimit = basicSalary * (isMetro ? 0.5 : 0.4);
  return Math.min(hraAllowance, rentExcess, metroLimit);
}

// ─── Tax Profile ──────────────────────────────────────────────────────────────

export async function getTaxProfile(userId: string, fy?: string) {
  const fyYear = fy ?? getCurrentFY();
  return prisma.taxProfile.findUnique({ where: { userId_fyYear: { userId, fyYear } } });
}

export async function upsertTaxProfile(userId: string, fy: string, data: Partial<Prisma.TaxProfileUncheckedCreateInput>) {
  return prisma.taxProfile.upsert({
    where: { userId_fyYear: { userId, fyYear: fy } },
    create: { userId, fyYear: fy, ...data },
    update: data,
  });
}

// ─── Tax Summary (auto-computed from all entities) ────────────────────────────

export async function getTaxSummary(userId: string, fy: string) {
  const { start, end } = getFYRange(fy);
  const profile = await prisma.taxProfile.findUnique({ where: { userId_fyYear: { userId, fyYear: fy } } });

  const grossSalary = Number(profile?.grossSalary ?? 0);
  const standardDeduction = Math.min(50000, grossSalary); // Standard deduction ₹50K

  // Auto-aggregate 80C from investments + FDs + insurance
  const [investments, fds, insurance80C, insurance80D, loans] = await Promise.all([
    prisma.investment.findMany({ where: { userId, isTaxSaving: true, purchaseDate: { gte: start, lt: end } } }),
    prisma.fixedDeposit.findMany({ where: { userId, isTaxSaver: true, startDate: { gte: start, lt: end } } }),
    prisma.insurancePolicy.findMany({ where: { userId, is80cEligible: true } }),
    prisma.insurancePolicy.findMany({ where: { userId, is80dEligible: true } }),
    prisma.loan.findMany({ where: { userId, section24bEligible: true } }),
  ]);

  const invAmount = investments.reduce((s, i) => s + Number(i.unitsOrQuantity) * Number(i.purchasePricePerUnit), 0);
  const fdAmount = fds.reduce((s, f) => s + Number(f.principalAmount), 0);
  const ins80cAmount = insurance80C.reduce((s, p) => s + getAnnualPremium(p), 0);

  const auto80C = Math.min(invAmount + fdAmount + ins80cAmount, 150000);
  const manual80C = Number(profile?.deduction80C ?? 0);
  const total80C = Math.min(Math.max(auto80C, manual80C), 150000);

  // 80D: use explicit isForParents flag (not freetext note heuristic)
  const ins80dSelf = insurance80D
    .filter((p) => ['HEALTH', 'SUPER_TOP_UP', 'CRITICAL_ILLNESS'].includes(p.policyType) && !p.isForParents)
    .reduce((s, p) => s + getAnnualPremium(p), 0);
  const ins80dParents = insurance80D
    .filter((p) => ['HEALTH', 'SUPER_TOP_UP', 'CRITICAL_ILLNESS'].includes(p.policyType) && p.isForParents)
    .reduce((s, p) => s + getAnnualPremium(p), 0);
  const total80D = Math.min(ins80dSelf, 25000) + Math.min(ins80dParents, 25000);

  // Section 24(b): use amortization schedule for accurate annual interest (not outstanding * rate)
  const total24B = loans.reduce((s, l) => {
    const schedule = buildAmortizationSchedule(
      Number(l.outstandingBalance),
      Number(l.interestRate),
      Number(l.emiAmount),
      l.emiDate,
      new Date(),
    );
    const annualInterest = schedule.slice(0, 12).reduce((sum, r) => sum + r.interest, 0);
    return s + Math.min(annualInterest, 200000);
  }, 0);

  const nps80Ccd1b = Math.min(Number(profile?.nps80Ccd1B ?? 0), 50000);
  const other = Number(profile?.otherDeductions ?? 0);

  // Old Regime
  const hraExempt = profile ? calcHRAExemption(
    grossSalary * 0.5, // Approximate basic as 50% of gross
    Number(profile.hraReceived ?? 0),
    Number(profile.rentPaidMonthly ?? 0) * 12,
    profile.cityType === 'METRO',
  ) : 0;

  const oldTaxableIncome = Math.max(grossSalary - standardDeduction - hraExempt - total80C - total80D - total24B - nps80Ccd1b - other, 0);
  const oldTax = addSurchargeAndCess(calcOldRegimeTax(oldTaxableIncome), oldTaxableIncome);

  // New Regime (fewer deductions; standard deduction ₹75K for FY24-25)
  const newStdDeduction = 75000;
  const newTaxableIncome = Math.max(grossSalary - newStdDeduction, 0);
  const newTax = addSurchargeAndCess(calcNewRegimeTax(newTaxableIncome), newTaxableIncome);

  const taxPaid = Number(profile?.taxPaidAdvance ?? 0) + Number(profile?.taxPaidTds ?? 0) + Number(profile?.taxPaidSelfAssessment ?? 0);

  return {
    fy,
    grossSalary,
    deductions: {
      standardDeduction,
      hraExempt,
      s80C: total80C,
      s80D: total80D,
      s80E: Number(profile?.deduction80E ?? 0),
      s80G: Number(profile?.deduction80G ?? 0),
      section24B: total24B,
      nps80Ccd1b,
      other,
    },
    oldRegime: {
      taxableIncome: oldTaxableIncome,
      tax: oldTax,
      taxAfterPaid: Math.max(oldTax - taxPaid, 0),
      refund: Math.max(taxPaid - oldTax, 0),
    },
    newRegime: {
      taxableIncome: newTaxableIncome,
      tax: newTax,
      taxAfterPaid: Math.max(newTax - taxPaid, 0),
      refund: Math.max(taxPaid - newTax, 0),
    },
    taxPaid,
    recommendedRegime: oldTax <= newTax ? 'OLD' : 'NEW',
    savings: Math.abs(oldTax - newTax),
  };
}

function getAnnualPremium(p: { premiumAmount: unknown; premiumFrequency: string }): number {
  const amt = Number(p.premiumAmount);
  switch (p.premiumFrequency) {
    case 'MONTHLY': return amt * 12;
    case 'QUARTERLY': return amt * 4;
    case 'HALF_YEARLY': return amt * 2;
    default: return amt;
  }
}

// ─── Advance Tax Calendar ─────────────────────────────────────────────────────

export async function getAdvanceTaxCalendar(fy: string) {
  return prisma.advanceTaxEvent.findMany({
    where: { fyYear: fy },
    orderBy: { dueDate: 'asc' },
  });
}

// ─── 80C Tracker ─────────────────────────────────────────────────────────────

export async function get80CTracker(userId: string, fy: string) {
  const { start, end } = getFYRange(fy);

  const [investments, fds, insurance] = await Promise.all([
    prisma.investment.findMany({ where: { userId, isTaxSaving: true, purchaseDate: { gte: start, lt: end } } }),
    prisma.fixedDeposit.findMany({ where: { userId, isTaxSaver: true, startDate: { gte: start, lt: end } } }),
    prisma.insurancePolicy.findMany({ where: { userId, is80cEligible: true } }),
  ]);

  const elss = investments.filter((i) => i.type === 'ELSS').reduce((s, i) => s + Number(i.unitsOrQuantity) * Number(i.purchasePricePerUnit), 0);
  const ppf = investments.filter((i) => i.type === 'PPF').reduce((s, i) => s + Number(i.unitsOrQuantity) * Number(i.purchasePricePerUnit), 0);
  const nps = investments.filter((i) => i.type === 'NPS').reduce((s, i) => s + Number(i.unitsOrQuantity) * Number(i.purchasePricePerUnit), 0);
  const epf = investments.filter((i) => i.type === 'EPF').reduce((s, i) => s + Number(i.unitsOrQuantity) * Number(i.purchasePricePerUnit), 0);
  const fdTaxSaver = fds.reduce((s, f) => s + Number(f.principalAmount), 0);
  const licPremiums = insurance.reduce((s, p) => s + getAnnualPremium(p), 0);
  const others = investments
    .filter((i) => !['ELSS', 'PPF', 'NPS', 'EPF'].includes(i.type))
    .reduce((s, i) => s + Number(i.unitsOrQuantity) * Number(i.purchasePricePerUnit), 0);

  const total = elss + ppf + nps + epf + fdTaxSaver + licPremiums + others;
  const limit = 150000;
  const utilized = Math.min(total, limit);
  const remaining = Math.max(limit - total, 0);

  return {
    breakdown: { elss, ppf, nps, epf, fdTaxSaver, licPremiums, others },
    total,
    utilized,
    remaining,
    limit,
    pctUtilized: (utilized / limit) * 100,
  };
}
