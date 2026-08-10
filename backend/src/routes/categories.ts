import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/response';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { recordAuditLog } from '../services/auditService';
import { getDefaultCategoryStyle } from '../utils/categoryStyle';

const router = Router();
router.use(requireAuth);

// ── GET /categories — list all family-shared categories ───────────────────────
router.get('/', asyncHandler(async (_req, res) => {
  const categories = await prisma.category.findMany({
    where: { userId: null },
    include: {
      parent: { select: { id: true, name: true, type: true, icon: true, color: true, parentId: true } },
      _count: { select: { children: true } },
    },
    orderBy: [{ name: 'asc' }],
  });
  sendSuccess(res, categories);
}));

const categorySchema = z.object({
  name: z.string().min(1).max(50),
  type: z.enum(['INCOME', 'EXPENSE', 'ASSET', 'LIABILITY']),
  icon: z
    .string()
    .trim()
    .max(30)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v)),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex color (e.g. #22c55e)')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? undefined : v)),
  parentId: z
    .string()
    .cuid()
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? null : v)),
});

async function validateParentCategory(
  parentId: string | null | undefined,
  type: 'INCOME' | 'EXPENSE' | 'ASSET' | 'LIABILITY',
  currentCategoryId?: string,
) {
  if (parentId === undefined || parentId === null) return;
  if (parentId === currentCategoryId) {
    throw AppError.badRequest('A category cannot be its own parent');
  }

  let parent = await prisma.category.findFirst({
    where: { id: parentId, userId: null },
    select: { id: true, type: true, parentId: true },
  });
  if (!parent) throw AppError.badRequest('Parent category not found');
  if (parent.type !== type) throw AppError.badRequest('Parent category must have the same type');

  while (currentCategoryId && parent?.parentId) {
    if (parent.parentId === currentCategoryId) {
      throw AppError.badRequest('A category cannot be moved under its own sub-category');
    }
    parent = await prisma.category.findFirst({
      where: { id: parent.parentId, userId: null },
      select: { id: true, type: true, parentId: true },
    });
  }
}

// ── POST /categories — create a new family-shared category ───────────────────
router.post('/', asyncHandler(async (req, res) => {
  const data = categorySchema.parse(req.body);
  await validateParentCategory(data.parentId, data.type);
  try {
    const defaultStyle = getDefaultCategoryStyle(data.name, data.type);
    const category = await prisma.category.create({
      data: {
        ...data,
        icon: data.icon?.trim() ? data.icon : defaultStyle.icon,
        color: data.color ?? defaultStyle.color,
        userId: null,
        isDefault: false,
      },
    });
    await recordAuditLog({
      performedByUserId: req.user!.userId,
      action: 'CREATE',
      entityType: 'Category',
      entityId: category.id,
      newValue: category,
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
  if (cat.isDefault && req.body.type !== undefined && req.body.type !== cat.type) {
    throw AppError.badRequest('The type of a default category cannot be changed');
  }
  const parsed = categorySchema.partial().parse(req.body);
  const effectiveType = parsed.type ?? cat.type;
  if (parsed.type !== undefined && parsed.type !== cat.type) {
    const childCount = await prisma.category.count({ where: { parentId: cat.id } });
    if (childCount > 0) {
      throw AppError.badRequest('Category type cannot be changed while it has sub-categories');
    }
  }
  await validateParentCategory(parsed.parentId, effectiveType, cat.id);
  // Belt-and-suspenders: strip type for default categories even if the guard above passed
  const { type: _stripped, ...dataWithoutType } = parsed;
  const data = cat.isDefault ? dataWithoutType : parsed;
  try {
    const updated = await prisma.category.update({ where: { id: req.params.id }, data });
    await recordAuditLog({
      performedByUserId: req.user!.userId,
      action: 'UPDATE',
      entityType: 'Category',
      entityId: updated.id,
      oldValue: cat,
      newValue: updated,
    });
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
  const childCount = await prisma.category.count({ where: { parentId: req.params.id } });
  if (childCount > 0) {
    throw AppError.conflict(
      `This category has ${childCount} sub-categor${childCount > 1 ? 'ies' : 'y'}. Delete or move them first.`,
    );
  }
  const budgetCount = await prisma.budget.count({ where: { categoryId: req.params.id } });
  if (budgetCount > 0) {
    throw AppError.conflict(
      `This category is used by ${budgetCount} budget${budgetCount > 1 ? 's' : ''}. Remove those budgets first.`,
    );
  }
  const deleted = await prisma.category.delete({ where: { id: req.params.id } });
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: 'DELETE',
    entityType: 'Category',
    entityId: deleted.id,
    oldValue: deleted,
  });
  sendNoContent(res);
}));

export default router;
