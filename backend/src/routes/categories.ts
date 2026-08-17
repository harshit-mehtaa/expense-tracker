import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/response';
import { recordAuditLog } from '../services/auditService';
import * as svc from '../services/categoryService';

const router = Router();
router.use(requireAuth);

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

// ── GET /categories — every family-shared category, with usage figures ────────
router.get('/', asyncHandler(async (_req, res) => {
  sendSuccess(res, await svc.listCategories());
}));

// ── GET /categories/:id/dependencies — what would break if this went away ─────
router.get('/:id/dependencies', asyncHandler(async (req, res) => {
  sendSuccess(res, await svc.getCategoryDependencies(req.params.id));
}));

router.post('/', asyncHandler(async (req, res) => {
  const data = categorySchema.parse(req.body);
  const category = await svc.createCategory(data as never);
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: 'CREATE',
    entityType: 'Category',
    entityId: category.id,
    newValue: category,
  });
  sendCreated(res, category);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const parsed = categorySchema.partial().parse(req.body);
  const { before, after } = await svc.updateCategory(req.params.id, parsed as never);
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: 'UPDATE',
    entityType: 'Category',
    entityId: after.id,
    oldValue: before,
    newValue: after,
  });
  sendSuccess(res, after);
}));

/**
 * Folds one category into another. Its own endpoint rather than a flag on DELETE: a
 * merge moves data across four tables and re-parents children, which is a different
 * operation from removing something unused.
 */
router.post('/:id/merge', asyncHandler(async (req, res) => {
  const { targetId } = z.object({ targetId: z.string().cuid() }).parse(req.body);
  const oldValue = await svc.getCategoryForAudit(req.params.id);
  const target = await svc.mergeCategories(req.params.id, targetId);
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: 'DELETE',
    entityType: 'Category',
    entityId: req.params.id,
    oldValue,
    newValue: { mergedInto: targetId },
  });
  sendSuccess(res, target);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  // `reassignTo` moves the transactions rather than letting the SetNull FK strip their
  // category silently, which is what used to happen.
  const { reassignTo } = z.object({
    reassignTo: z.string().cuid().optional(),
  }).parse(req.query);

  const oldValue = await svc.getCategoryForAudit(req.params.id);
  const deleted = await svc.deleteCategory(req.params.id, reassignTo);
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: 'DELETE',
    entityType: 'Category',
    entityId: deleted.id,
    oldValue,
    newValue: reassignTo ? { reassignedTo: reassignTo } : undefined,
  });
  sendNoContent(res);
}));

export default router;
