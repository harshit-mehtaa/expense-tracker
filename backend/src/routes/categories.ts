import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/response';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const categories = await prisma.category.findMany({
    where: { OR: [{ userId: null }, { userId: req.user!.userId }] },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
  });
  sendSuccess(res, categories);
}));

const categorySchema = z.object({
  name: z.string().min(1).max(50),
  type: z.enum(['INCOME', 'EXPENSE']),
  icon: z.string().optional(),
  color: z.string().optional(),
});

router.post('/', asyncHandler(async (req, res) => {
  const data = categorySchema.parse(req.body);
  const category = await prisma.category.create({
    data: { ...data, userId: req.user!.userId },
  });
  sendCreated(res, category);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const cat = await prisma.category.findFirst({ where: { id: req.params.id, userId: req.user!.userId } });
  if (!cat) throw AppError.notFound('Category not found or not editable');
  const data = categorySchema.partial().parse(req.body);
  const updated = await prisma.category.update({ where: { id: req.params.id }, data });
  sendSuccess(res, updated);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const cat = await prisma.category.findFirst({ where: { id: req.params.id, userId: req.user!.userId } });
  if (!cat) throw AppError.notFound('Category not found or not deletable');
  await prisma.category.delete({ where: { id: req.params.id } });
  sendNoContent(res);
}));

export default router;
