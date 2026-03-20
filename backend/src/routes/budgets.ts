import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/response';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { getFYRange, getCurrentFY } from '../utils/financialYear';

const router = Router();
router.use(requireAuth);

const budgetSchema = z.object({
  categoryId: z.string(),
  amount: z.number().positive(),
  period: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY', 'FY']),
  fyYear: z.string().optional(),
  startDate: z.string().transform((s) => new Date(s)).optional(),
  endDate: z.string().transform((s) => new Date(s)).optional(),
});

router.get('/', asyncHandler(async (req, res) => {
  const budgets = await prisma.budget.findMany({
    where: { userId: req.user!.userId },
    include: { category: true },
    orderBy: { createdAt: 'desc' },
  });
  sendSuccess(res, budgets);
}));

router.get('/vs-actuals', asyncHandler(async (req, res) => {
  const fyRaw = req.query.fy;
  const fy = (typeof fyRaw === 'string' && /^\d{4}-\d{2}$/.test(fyRaw)) ? fyRaw : getCurrentFY();
  const { start, end } = getFYRange(fy);

  const budgets = await prisma.budget.findMany({
    where: { userId: req.user!.userId },
    include: { category: true },
  });

  const actuals = await prisma.transaction.groupBy({
    by: ['categoryId'],
    where: {
      userId: req.user!.userId,
      deletedAt: null,
      type: 'EXPENSE',
      date: { gte: start, lt: end },
    },
    _sum: { amount: true },
  });

  const actualsMap: Record<string, number> = {};
  actuals.forEach((a) => {
    if (a.categoryId) actualsMap[a.categoryId] = Number(a._sum.amount ?? 0);
  });

  const result = budgets.map((b) => ({
    ...b,
    actual: actualsMap[b.categoryId] ?? 0,
    remaining: Math.max(Number(b.amount) - (actualsMap[b.categoryId] ?? 0), 0),
    pctUsed: Number(b.amount) > 0 ? ((actualsMap[b.categoryId] ?? 0) / Number(b.amount)) * 100 : 0,
  }));

  sendSuccess(res, result);
}));

router.post('/', asyncHandler(async (req, res) => {
  const data = budgetSchema.parse(req.body);
  const budget = await prisma.budget.create({ data: { ...data, userId: req.user!.userId } });
  sendCreated(res, budget);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const b = await prisma.budget.findFirst({ where: { id: req.params.id, userId: req.user!.userId } });
  if (!b) throw AppError.notFound('Budget not found');
  const data = budgetSchema.partial().parse(req.body);
  const updated = await prisma.budget.update({ where: { id: req.params.id }, data });
  sendSuccess(res, updated);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const b = await prisma.budget.findFirst({ where: { id: req.params.id, userId: req.user!.userId } });
  if (!b) throw AppError.notFound('Budget not found');
  await prisma.budget.delete({ where: { id: req.params.id } });
  sendNoContent(res);
}));

export default router;
