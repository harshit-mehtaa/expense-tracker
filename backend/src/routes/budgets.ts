import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/response';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { getFYRange, getCurrentFY } from '../utils/financialYear';
import { recordAuditLog } from '../services/auditService';
import { ownerScopedWhere, resolveTargetUserId, resolveWriteUserId } from '../utils/resolveTargetUserId';
import { getNetExpenseByUserCategory } from '../utils/refundReporting';

const router = Router();
router.use(requireAuth);

// userName is non-optional: both callers below build it as `user?.name ?? ''` after the
// spread, so it is always a string by the time it reaches here. Typing it as optional
// would invite a `?? ''` fallback that can never run.
function compareBudgetCategoryNames(
  a: { category?: { name?: string | null } | null; userName: string },
  b: { category?: { name?: string | null } | null; userName: string },
) {
  const categoryCompare = (a.category?.name ?? 'Unknown').localeCompare(b.category?.name ?? 'Unknown', undefined, {
    sensitivity: 'base',
  });
  if (categoryCompare !== 0) return categoryCompare;
  return a.userName.localeCompare(b.userName, undefined, { sensitivity: 'base' });
}

const budgetSchema = z.object({
  categoryId: z.string(),
  amount: z.number().positive(),
  period: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY', 'FY']),
  fyYear: z.string().optional(),
  startDate: z.string().transform((s) => new Date(s)).optional(),
  endDate: z.string().transform((s) => new Date(s)).optional(),
});

router.get('/', asyncHandler(async (req, res) => {
  const targetUserId = await resolveTargetUserId(req);
  const effectiveUserId = req.user!.role === 'ADMIN' ? targetUserId : req.user!.userId;
  const budgets = await prisma.budget.findMany({
    where: effectiveUserId ? { userId: effectiveUserId } : {},
    include: { category: { include: { parent: true } }, user: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const result = budgets
    .map(({ user, ...budget }) => ({ ...budget, userName: user?.name ?? '' }))
    .sort(compareBudgetCategoryNames);
  sendSuccess(res, result);
}));

const CUID_RE = /^[a-z0-9]{20,30}$/i;

router.get('/vs-actuals', asyncHandler(async (req, res) => {
  const fyRaw = req.query.fy;
  const fy = (typeof fyRaw === 'string' && /^\d{4}-\d{2}$/.test(fyRaw)) ? fyRaw : getCurrentFY();
  const { start, end } = getFYRange(fy);

  let effectiveUserId: string | undefined;
  if (req.user!.role === 'ADMIN') {
    if (req.query.targetUserId) {
      const raw = req.query.targetUserId as string;
      if (!CUID_RE.test(raw)) throw AppError.badRequest('Invalid targetUserId format');
      const target = await prisma.user.findFirst({ where: { id: raw, deletedAt: null } });
      if (!target) throw AppError.notFound('User');
      effectiveUserId = raw;
    }
    // else family-wide: effectiveUserId stays undefined
  } else {
    effectiveUserId = req.user!.userId;
  }

  const budgets = await prisma.budget.findMany({
    where: effectiveUserId ? { userId: effectiveUserId } : {},
    include: { category: { include: { parent: true } }, user: { select: { name: true } } },
  });

  const actualsMap = await getNetExpenseByUserCategory(
    effectiveUserId ? { userId: effectiveUserId } : {},
    { gte: start, lt: end },
    budgets.map((b) => b.categoryId),
  );

  const result = budgets
    .map(({ user, ...b }) => {
      const actual = actualsMap.get(`${b.userId}:${b.categoryId}`) ?? 0;
      return {
        ...b,
        userName: user?.name ?? '',
        actual,
        remaining: Math.max(Number(b.amount) - actual, 0),
        pctUsed: Number(b.amount) > 0 ? (actual / Number(b.amount)) * 100 : 0,
      };
    })
    .sort(compareBudgetCategoryNames);

  sendSuccess(res, result);
}));

router.post('/', asyncHandler(async (req, res) => {
  const data = budgetSchema.parse(req.body);
  const ownerUserId = await resolveWriteUserId(req);
  const budget = await prisma.budget.create({ data: { ...data, userId: ownerUserId } });
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: 'CREATE',
    entityType: 'Budget',
    entityId: budget.id,
    newValue: budget,
  });
  sendCreated(res, budget);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const b = await prisma.budget.findFirst({ where: ownerScopedWhere(req.params.id, req.user!.userId, req.user!.role) });
  if (!b) throw AppError.notFound('Budget');
  const data = budgetSchema.partial().parse(req.body);
  const updated = await prisma.budget.update({ where: { id: req.params.id }, data });
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: 'UPDATE',
    entityType: 'Budget',
    entityId: updated.id,
    oldValue: b,
    newValue: updated,
  });
  sendSuccess(res, updated);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const b = await prisma.budget.findFirst({ where: ownerScopedWhere(req.params.id, req.user!.userId, req.user!.role) });
  if (!b) throw AppError.notFound('Budget');
  await prisma.budget.delete({ where: { id: req.params.id } });
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: 'DELETE',
    entityType: 'Budget',
    entityId: b.id,
    oldValue: b,
  });
  sendNoContent(res);
}));

export default router;
