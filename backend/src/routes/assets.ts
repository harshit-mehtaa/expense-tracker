import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { sendCreated, sendNoContent, sendSuccess } from '../utils/response';
import * as svc from '../services/assetService';
import { recordAuditLog } from '../services/auditService';
import { resolveTargetUserId, resolveWriteUserId } from '../utils/resolveTargetUserId';

const router = Router();
router.use(requireAuth);

const assetSchema = z.object({
  assetType: z.enum(['PROPERTY', 'VEHICLE', 'GOLD', 'OTHER']),
  name: z.string().min(1).max(120),
  value: z.number().nonnegative(),
  realEstateId: z.string().optional(),
  notes: z.string().max(1000).optional(),
});

router.get('/', asyncHandler(async (req, res) => {
  const targetUserId = await resolveTargetUserId(req);
  const effectiveUserId = req.user!.role === 'ADMIN' ? targetUserId : req.user!.userId;
  const data = await svc.listAssets(effectiveUserId);
  sendSuccess(res, data);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const asset = await svc.getAsset(req.user!.userId, req.params.id, req.user!.role);
  if (!asset) throw AppError.notFound('Asset');
  sendSuccess(res, asset);
}));

router.post('/', asyncHandler(async (req, res) => {
  const data = assetSchema.parse(req.body);
  const ownerUserId = await resolveWriteUserId(req);
  const asset = await svc.createAsset(ownerUserId, data as never);
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: 'CREATE',
    entityType: 'Asset',
    entityId: asset.id,
    newValue: asset,
  });
  sendCreated(res, asset);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const data = assetSchema.partial().parse(req.body);
  const oldAsset = await svc.getAssetForAudit(req.user!.userId, req.params.id, req.user!.role);
  const asset = await svc.updateAsset(req.user!.userId, req.params.id, data as never, req.user!.role);
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: 'UPDATE',
    entityType: 'Asset',
    entityId: asset.id,
    oldValue: oldAsset,
    newValue: asset,
  });
  sendSuccess(res, asset);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const oldAsset = await svc.getAssetForAudit(req.user!.userId, req.params.id, req.user!.role);
  await svc.deleteAsset(req.user!.userId, req.params.id, req.user!.role);
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: 'DELETE',
    entityType: 'Asset',
    entityId: req.params.id,
    oldValue: oldAsset,
  });
  sendNoContent(res);
}));

export default router;
