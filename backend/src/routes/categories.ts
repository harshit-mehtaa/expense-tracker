import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/response';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';

const router = Router();
router.use(requireAuth);

// ── GET /categories — list all family-shared categories ───────────────────────
router.get('/', asyncHandler(async (_req, res) => {
  const categories = await prisma.category.findMany({
    where: { userId: null },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
  });
  sendSuccess(res, categories);
}));

const categorySchema = z.object({
  name: z.string().min(1).max(50),
  type: z.enum(['INCOME', 'EXPENSE', 'ASSET', 'LIABILITY']),
  icon: z.string().max(10).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex color (e.g. #22c55e)')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? undefined : v)),
});

// ── POST /categories — create a new family-shared category ───────────────────
router.post('/', asyncHandler(async (req, res) => {
  const data = categorySchema.parse(req.body);
  try {
    const category = await prisma.category.create({
      data: { ...data, userId: null, isDefault: false },
    });
    sendCreated(res, category);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw AppError.conflict(`A ${data.type} category named "${data.name}" already exists`);
    }
    throw err;
  }
}));

// ── PUT /categories/:id — update a non-default family category ────────────────
router.put('/:id', asyncHandler(async (req, res) => {
  const cat = await prisma.category.findFirst({ where: { id: req.params.id } });
  if (!cat) throw AppError.notFound('Category');
  if (cat.isDefault) throw AppError.forbidden('Default categories cannot be edited');
  const data = categorySchema.partial().parse(req.body);
  try {
    const updated = await prisma.category.update({ where: { id: req.params.id }, data });
    sendSuccess(res, updated);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw AppError.conflict('A category with that name and type already exists');
    }
    throw err;
  }
}));

// ── DELETE /categories/:id — delete a non-default family category ─────────────
router.delete('/:id', asyncHandler(async (req, res) => {
  const cat = await prisma.category.findFirst({ where: { id: req.params.id } });
  if (!cat) throw AppError.notFound('Category');
  if (cat.isDefault) throw AppError.forbidden('Default categories cannot be deleted');
  const budgetCount = await prisma.budget.count({ where: { categoryId: req.params.id } });
  if (budgetCount > 0) {
    throw AppError.conflict(
      `This category is used by ${budgetCount} budget${budgetCount > 1 ? 's' : ''}. Remove those budgets first.`,
    );
  }
  await prisma.category.delete({ where: { id: req.params.id } });
  sendNoContent(res);
}));

export default router;
