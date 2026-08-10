import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { sendCreated, sendNoContent, sendSuccess } from '../utils/response';
import * as rules from '../services/categoryRuleService';
import { recordAuditLog } from '../services/auditService';
import { resolveTargetUserId, resolveWriteUserId } from '../utils/resolveTargetUserId';

const router = Router();
router.use(requireAuth);

const ruleSchema = z.object({
  keyword: z.string().min(1).max(80),
  categoryId: z.string().cuid(),
});

router.get('/', asyncHandler(async (req, res) => {
  const targetUserId = await resolveTargetUserId(req);
  const effectiveUserId = req.user!.role === 'ADMIN' ? (targetUserId ?? req.user!.userId) : req.user!.userId;
  const data = await rules.listCategoryRules(effectiveUserId);
  sendSuccess(res, data);
}));

router.post('/', asyncHandler(async (req, res) => {
  const data = ruleSchema.parse(req.body);
  const ownerUserId = await resolveWriteUserId(req);
  const rule = await rules.createCategoryRule(ownerUserId, data);
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: 'CREATE',
    entityType: 'CategoryRule',
    entityId: rule.id,
    newValue: rule,
  });
  sendCreated(res, rule);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const deleted = await rules.deleteCategoryRule(req.user!.userId, req.params.id, req.user!.role);
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: 'DELETE',
    entityType: 'CategoryRule',
    entityId: deleted.id,
    oldValue: deleted,
  });
  sendNoContent(res);
}));

export default router;
