import { prisma } from '../config/prisma';
import type { Prisma } from '@prisma/client';

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function listHouseProperties(userId: string, fy: string) {
  return prisma.housePropertyDetail.findMany({
    where: { userId, fyYear: fy, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getHouseProperty(userId: string, id: string) {
  return prisma.housePropertyDetail.findFirst({
    where: { id, userId, deletedAt: null },
  });
}

export async function createHouseProperty(
  userId: string,
  data: Omit<Prisma.HousePropertyDetailUncheckedCreateInput, 'userId'>,
) {
  return prisma.housePropertyDetail.create({ data: { ...data, userId } });
}

export async function updateHouseProperty(
  userId: string,
  id: string,
  data: Partial<Prisma.HousePropertyDetailUncheckedUpdateInput>,
) {
  const result = await prisma.housePropertyDetail.updateMany({
    where: { id, userId, deletedAt: null },
    data,
  });
  if (result.count === 0) return null;
  return prisma.housePropertyDetail.findUnique({ where: { id } });
}

export async function deleteHouseProperty(userId: string, id: string) {
  const result = await prisma.housePropertyDetail.updateMany({
    where: { id, userId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return result.count > 0 ? { deleted: true } : null;
}

// ─── Computation ──────────────────────────────────────────────────────────────

export interface HousePropertyIncomeSummary {
  properties: Array<{
    id: string;
    propertyName: string;
    usage: string;
    grossAnnualValue: number;
    municipalTaxes: number;
    netAnnualValue: number;
    standardDeduction30Pct: number;  // only for let-out/deemed-let-out
    interestOnLoan: number;          // Sec 24(b)
    incomeFromHP: number;            // can be negative (loss)
  }>;
  totalHPIncome: number;       // sum across all properties (can be negative)
  hpLossSetOff: number;        // loss set-off against salary, capped at ₹2L (only old regime)
  taxableHPIncome: number;     // max(total, 0) or 0 if loss, with regime-aware cap
}

const STANDARD_DEDUCTION_RATE = 0.30;
const SELF_OCCUPIED_INTEREST_CAP = 200000; // ₹2L max for self-occupied (new regime: 0)
const HP_LOSS_SETOFF_CAP = 200000;         // ₹2L max loss set-off against other heads

export async function calcHousePropertyIncome(
  userId: string,
  fy: string,
  regime: 'OLD' | 'NEW',
): Promise<HousePropertyIncomeSummary> {
  const properties = await prisma.housePropertyDetail.findMany({
    where: { userId, fyYear: fy, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });

  let totalHP = 0;

  const details = properties.map((p) => {
    const gar = Number(p.grossAnnualRent ?? 0);
    const municipal = Number(p.municipalTaxesPaid ?? 0);
    // isPreConstruction: user must manually compute 1/5th of pre-construction interest and enter
    // the current-year portion in homeLoanInterest. The flag is stored for user reference only.
    const loanInterest = Number(p.homeLoanInterest ?? 0);

    let grossAnnualValue = 0;
    let netAnnualValue = 0;
    let stdDed = 0;
    let effectiveInterest = loanInterest;

    if (p.usage === 'SELF_OCCUPIED') {
      // Self-occupied: GAV = 0, NAV = 0, no standard deduction
      // Interest deductible up to ₹2L (old regime); ₹0 for new regime
      grossAnnualValue = 0;
      netAnnualValue = 0;
      stdDed = 0;
      effectiveInterest = regime === 'NEW' ? 0 : Math.min(loanInterest, SELF_OCCUPIED_INTEREST_CAP);
    } else {
      // Let-out or deemed let-out
      grossAnnualValue = gar;
      netAnnualValue = grossAnnualValue - municipal;
      stdDed = netAnnualValue * STANDARD_DEDUCTION_RATE; // 30% of NAV
      // For let-out: full interest is deductible (no cap in old regime)
      // New regime: Sec 24(b) interest deduction not allowed
      effectiveInterest = regime === 'NEW' ? 0 : loanInterest;
    }

    const incomeFromHP = netAnnualValue - stdDed - effectiveInterest;
    totalHP += incomeFromHP;

    return {
      id: p.id,
      propertyName: p.propertyName,
      usage: p.usage,
      grossAnnualValue,
      municipalTaxes: municipal,
      netAnnualValue,
      standardDeduction30Pct: stdDed,
      interestOnLoan: effectiveInterest,
      incomeFromHP,
    };
  });

  // HP loss can be set off against salary income, capped at ₹2L (only old regime)
  // Under new regime, HP loss set-off against other heads is not permitted
  const hpLossSetOff = regime === 'OLD' && totalHP < 0
    ? Math.min(Math.abs(totalHP), HP_LOSS_SETOFF_CAP)
    : 0;

  // Taxable HP income: if positive, it adds to income; if loss, set-off is captured above
  const taxableHPIncome = totalHP > 0 ? totalHP : 0;

  return {
    properties: details,
    totalHPIncome: totalHP,
    hpLossSetOff,
    taxableHPIncome,
  };
}
