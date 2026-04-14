import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import type { Prisma } from '@prisma/client';

export async function getInsurancePolicies(userId: string | undefined, requesterId: string, requesterRole: string) {
  if (requesterRole !== 'ADMIN') {
    return prisma.insurancePolicy.findMany({ where: { userId: requesterId }, orderBy: { premiumDueDate: 'asc' } });
  }
  if (userId) {
    return prisma.insurancePolicy.findMany({ where: { userId }, orderBy: { premiumDueDate: 'asc' } });
  }
  const rows = await prisma.insurancePolicy.findMany({
    where: { user: { isActive: true, deletedAt: null } },
    include: { user: { select: { name: true } } },
    orderBy: [{ user: { name: 'asc' } }, { premiumDueDate: 'asc' }],
  });
  return rows.map(({ user, ...rest }) => ({ ...rest, userName: user?.name ?? '' }));
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

export async function updateInsurancePolicy(userId: string, id: string, data: Prisma.InsurancePolicyUpdateInput) {
  const policy = await prisma.insurancePolicy.findFirst({ where: { id, userId } });
  if (!policy) throw AppError.notFound('Insurance policy');
  return prisma.insurancePolicy.update({ where: { id }, data });
}

export async function deleteInsurancePolicy(userId: string, id: string) {
  const policy = await prisma.insurancePolicy.findFirst({ where: { id, userId } });
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
