import { Router, Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/response';
import { requireAuth } from '../middleware/auth';
import { computeNetWorthStatement, getProfitAndLoss } from '../services/dashboardService';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { getFYRange, validateFY } from '../utils/financialYear';

const router = Router();
router.use(requireAuth);

const CUID_RE = /^[a-z0-9]{20,30}$/i;

async function resolveTargetUserId(req: Request): Promise<string | undefined> {
  if (req.user!.role !== 'ADMIN' || !req.query.targetUserId) return undefined;
  const raw = req.query.targetUserId as string;
  if (!CUID_RE.test(raw)) throw AppError.badRequest('Invalid targetUserId format');
  const target = await prisma.user.findFirst({ where: { id: raw, deletedAt: null } });
  if (!target) throw AppError.notFound('User');
  return raw;
}

router.get(
  '/spending-by-category',
  asyncHandler(async (req: Request, res: Response) => {
    const fy = validateFY(req.query.fy);
    const { start, end } = getFYRange(fy);
    const { userId, role } = req.user!;
    const targetUserId = await resolveTargetUserId(req);
    const effectiveUserId = role === 'ADMIN' ? targetUserId : userId;
    const userFilter = effectiveUserId ? { userId: effectiveUserId } : {};

    const data = await prisma.transaction.groupBy({
      by: ['categoryId'],
      where: { ...userFilter, deletedAt: null, type: 'EXPENSE', date: { gte: start, lt: end } },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
    });

    const categories = await prisma.category.findMany({
      where: { id: { in: data.map((d) => d.categoryId!).filter(Boolean) } },
    });
    const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));

    const result = data.map((d) => ({
      categoryId: d.categoryId,
      category: d.categoryId ? catMap[d.categoryId] : null,
      total: Number(d._sum.amount ?? 0),
    }));

    sendSuccess(res, result);
  }),
);

router.get(
  '/net-worth-statement',
  asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = req.user!;
    const targetUserId = await resolveTargetUserId(req);
    const effectiveUserId = role === 'ADMIN' ? targetUserId : userId;
    const statement = await computeNetWorthStatement(effectiveUserId);
    sendSuccess(res, statement);
  }),
);

router.get(
  '/profit-and-loss',
  asyncHandler(async (req: Request, res: Response) => {
    const fy = validateFY(req.query.fy);
    const { userId, role } = req.user!;
    const targetUserId = await resolveTargetUserId(req);
    const data = await getProfitAndLoss(userId, role, fy, targetUserId);
    sendSuccess(res, data);
  }),
);

export default router;
