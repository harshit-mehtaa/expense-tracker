import { prisma } from '../config/prisma';
import type { Prisma } from '@prisma/client';

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function listOtherIncome(userId: string, fy: string) {
  return prisma.otherSourceIncome.findMany({
    where: { userId, fyYear: fy, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getOtherIncome(userId: string, id: string) {
  return prisma.otherSourceIncome.findFirst({
    where: { id, userId, deletedAt: null },
  });
}

export async function createOtherIncome(
  userId: string,
  data: Omit<Prisma.OtherSourceIncomeUncheckedCreateInput, 'userId'>,
) {
  return prisma.otherSourceIncome.create({ data: { ...data, userId } });
}

export async function updateOtherIncome(
  userId: string,
  id: string,
  data: Partial<Prisma.OtherSourceIncomeUncheckedUpdateInput>,
) {
  const result = await prisma.otherSourceIncome.updateMany({
    where: { id, userId, deletedAt: null },
    data,
  });
  if (result.count === 0) return null;
  return prisma.otherSourceIncome.findUnique({ where: { id } });
}

export async function deleteOtherIncome(userId: string, id: string) {
  const result = await prisma.otherSourceIncome.updateMany({
    where: { id, userId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return result.count > 0 ? { deleted: true } : null;
}

// ─── Computation ──────────────────────────────────────────────────────────────

export interface OtherIncomeSummary {
  breakdown: {
    fdInterest: number;
    rdInterest: number;
    savingsInterest: number;
    dividend: number;
    gift: number;
    other: number;
  };
  // Foreign dividend is top-level (not in breakdown) to avoid label mismatch in frontend loop
  foreignDividend: number;
  totalForeignWithholdingTax: number; // Sum of tdsDeducted on FOREIGN_DIVIDEND entries (for DTAA credit reference)
  grossTotal: number;
  deduction80TTA: number;    // ₹10K on SAVINGS_INTEREST only (not applicable under New Regime)
  taxableTotal: number;
  totalTdsDeducted: number;  // TDS on domestic entries only
}

export async function calcOtherIncomeSummary(userId: string, fy: string, regime: 'OLD' | 'NEW' = 'OLD'): Promise<OtherIncomeSummary> {
  // Note: FD interest is NOT auto-aggregated here to avoid double-counting with manually entered entries.
  // Users should enter FD/RD interest manually via the Other Sources schedule (FD_INTEREST / RD_INTEREST entries).
  const entries = await prisma.otherSourceIncome.findMany({
    where: {
      userId,
      fyYear: fy,
      deletedAt: null,
    },
  });

  const breakdown = {
    fdInterest: 0,
    rdInterest: 0,
    savingsInterest: 0,
    dividend: 0,
    gift: 0,
    other: 0,
  };

  let totalTds = 0;
  let foreignDividendTotal = 0;
  let foreignWithholdingTotal = 0;

  for (const e of entries) {
    const amt = Number(e.amount);
    const tds = Number(e.tdsDeducted ?? 0);

    switch (e.sourceType) {
      case 'FD_INTEREST':
        breakdown.fdInterest += amt;
        totalTds += tds;
        break;
      case 'RD_INTEREST':
        breakdown.rdInterest += amt;
        totalTds += tds;
        break;
      case 'SAVINGS_INTEREST':
        breakdown.savingsInterest += amt;
        totalTds += tds;
        break;
      case 'DIVIDEND':
        breakdown.dividend += amt;
        totalTds += tds;
        break;
      case 'GIFT':
        breakdown.gift += amt;
        totalTds += tds;
        break;
      case 'FOREIGN_DIVIDEND':
        // Foreign withholding tax tracked separately for DTAA credit reference
        foreignDividendTotal += amt;
        foreignWithholdingTotal += tds;
        break;
      case 'OTHER':
      default:
        breakdown.other += amt;
        totalTds += tds;
        break;
    }
  }

  const domesticGross =
    breakdown.fdInterest +
    breakdown.rdInterest +
    breakdown.savingsInterest +
    breakdown.dividend +
    breakdown.gift +
    breakdown.other;

  const gross = domesticGross + foreignDividendTotal;

  // Sec 80TTA: ₹10K deduction on savings account interest only, old regime only
  const deduction80TTA = regime === 'OLD' ? Math.min(breakdown.savingsInterest, 10000) : 0;

  return {
    breakdown,
    foreignDividend: foreignDividendTotal,
    totalForeignWithholdingTax: foreignWithholdingTotal,
    grossTotal: gross,
    deduction80TTA,
    taxableTotal: regime === 'OLD' ? gross - deduction80TTA : gross,
    totalTdsDeducted: totalTds,
  };
}
