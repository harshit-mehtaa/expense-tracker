import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { ownerScopedWhere } from '../utils/resolveTargetUserId';
import { TransactionType, type Prisma } from '@prisma/client';

const policyPaymentInclude = {
  transactions: {
    where: {
      deletedAt: null,
      type: TransactionType.EXPENSE,
    },
    orderBy: { date: 'desc' as const },
    take: 1,
    select: {
      id: true,
      amount: true,
      date: true,
      description: true,
    },
  },
};

function withPaymentStatus<T extends Record<string, any>>(rows: T[]) {
  return rows.map((row) => {
    const { transactions = [], user, ...policy } = row;
    const lastPayment = transactions[0];

    return {
      ...policy,
      ...(user !== undefined ? { userName: user?.name ?? '' } : {}),
      isPaid: Boolean(lastPayment),
      lastPaidTransactionId: lastPayment?.id ?? null,
      lastPaidDate: lastPayment?.date ?? null,
      lastPaidAmount: lastPayment ? Number(lastPayment.amount) : null,
      lastPaidDescription: lastPayment?.description ?? null,
    };
  });
}

export async function getInsurancePolicies(userId: string | undefined, requesterId: string, requesterRole: string) {
  if (requesterRole !== 'ADMIN') {
    const rows = await prisma.insurancePolicy.findMany({
      where: { userId: requesterId },
      include: policyPaymentInclude,
      orderBy: { premiumDueDate: 'asc' },
    });
    return withPaymentStatus(rows);
  }
  if (userId) {
    const rows = await prisma.insurancePolicy.findMany({
      where: { userId },
      include: policyPaymentInclude,
      orderBy: { premiumDueDate: 'asc' },
    });
    return withPaymentStatus(rows);
  }
  const rows = await prisma.insurancePolicy.findMany({
    where: { user: { isActive: true, deletedAt: null } },
    include: { user: { select: { name: true } }, ...policyPaymentInclude },
    orderBy: [{ user: { name: 'asc' } }, { premiumDueDate: 'asc' }],
  });
  return withPaymentStatus(rows);
}

export async function getPremiumCalendar(userId: string) {
  const policies = await prisma.insurancePolicy.findMany({ where: { userId } });
  const calendar: Record<string, typeof policies> = {};

  for (const p of policies) {
    if (!p.premiumDueDate) continue;
    // premiumDueDate is stored as Int (day of month 1–31)
    const dayOfMonth = Number(p.premiumDueDate);
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) continue;
    const key = String(dayOfMonth).padStart(2, '0');
    if (!calendar[key]) calendar[key] = [];
    calendar[key].push(p);
  }
  return calendar;
}

export async function createInsurancePolicy(userId: string, data: Omit<Prisma.InsurancePolicyCreateInput, 'user'>) {
  return prisma.insurancePolicy.create({ data: { ...data, userId } });
}

export async function updateInsurancePolicy(
  requesterId: string,
  id: string,
  data: Prisma.InsurancePolicyUpdateInput,
  requesterRole = 'MEMBER',
) {
  const policy = await prisma.insurancePolicy.findFirst({ where: ownerScopedWhere(id, requesterId, requesterRole) });
  if (!policy) throw AppError.notFound('Insurance policy');
  return prisma.insurancePolicy.update({ where: { id }, data });
}

export async function deleteInsurancePolicy(requesterId: string, id: string, requesterRole = 'MEMBER') {
  const policy = await prisma.insurancePolicy.findFirst({ where: ownerScopedWhere(id, requesterId, requesterRole) });
  if (!policy) throw AppError.notFound('Insurance policy');
  return prisma.insurancePolicy.delete({ where: { id } });
}

export async function get80DSummary(userId: string, requesterId: string, requesterRole: string) {
  const effectiveUserId = requesterRole === 'ADMIN' && userId ? userId : requesterId;
  const policies = await prisma.insurancePolicy.findMany({ where: { userId: effectiveUserId, is80dEligible: true } });

  let selfFamilyPremium = 0;
  let parentsPremium = 0; // Simplified: user flags which policies are for parents via notes

  for (const p of policies) {
    const annual =
      p.premiumFrequency === 'MONTHLY' ? Number(p.premiumAmount) * 12
      : p.premiumFrequency === 'QUARTERLY' ? Number(p.premiumAmount) * 4
      : p.premiumFrequency === 'HALF_YEARLY' ? Number(p.premiumAmount) * 2
      : Number(p.premiumAmount);

    if (['HEALTH', 'SUPER_TOP_UP', 'CRITICAL_ILLNESS'].includes(p.policyType)) {
      if (p.isForParents) {
        parentsPremium += annual;
      } else {
        selfFamilyPremium += annual;
      }
    }
  }

  const selfLimit = 25000;
  const parentsLimit = 25000;

  return {
    selfFamily: { paid: selfFamilyPremium, limit: selfLimit, deductible: Math.min(selfFamilyPremium, selfLimit) },
    parents: { paid: parentsPremium, limit: parentsLimit, deductible: Math.min(parentsPremium, parentsLimit) },
    total: Math.min(selfFamilyPremium, selfLimit) + Math.min(parentsPremium, parentsLimit),
    policies,
  };
}
