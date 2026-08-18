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

/**
 * An HTML `<input type="date">` serializes a cleared field as `""`, not an absent key,
 * and even a FILLED one is date-only ("2022-05-01") — Prisma's DateTime requires a full
 * ISO-8601 timestamp and rejects both with "premature end of input" if passed as a raw
 * string. `z.string().optional()` only skips `undefined`, so neither case was ever
 * caught: `""` reached Prisma as an invalid Date argument and every filled-in date
 * failed identically. Neither throws an AppError, so both surfaced as a bare HTTP 500.
 * Same bug class, same fix shape as routes/loans.ts's own `optionalDate`.
 */
const optionalDate = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (v === '' || v == null ? null : new Date(v)))
  .refine((d) => d === null || !Number.isNaN(d.getTime()), { message: 'Invalid date' });

// Same empty-string problem as optionalDate, but for an enum: a cleared <select> posts
// `""`, which z.enum(...).optional() rejects outright (only `undefined` is skipped) —
// every edit of a non-VEHICLE asset, and every pre-existing VEHICLE asset (vehicleType
// is null in the DB, the form falls back to `?? ''`), 422'd on save.
const optionalVehicleType = z
  .union([z.enum(['TWO_WHEELER', 'FOUR_WHEELER', 'OTHER']), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' || v == null ? undefined : v));

const assetSchema = z.object({
  assetType: z.enum(['PROPERTY', 'VEHICLE', 'GOLD', 'OTHER']),
  name: z.string().min(1).max(120),
  value: z.number().nonnegative(),
  realEstateId: z.string().optional(),
  // Links a gold asset to the holding that already tracks it, so net worth counts it once.
  goldHoldingId: z.string().optional(),
  notes: z.string().max(1000).optional(),
  // Often approximate or unknown — kept optional for every asset type, unlike
  // vehicleType below (a pick from a small enum, cheap to require).
  purchaseDate: optionalDate,
  vehicleType: optionalVehicleType,
});

// `.superRefine()` returns a ZodEffects, which has no `.partial()` — chaining them would
// throw at module load. And a partial PUT body may omit assetType entirely, so the
// refinement can't see enough to judge; svc.updateAsset re-checks against the merged
// row instead (same split as loanCreateSchema/loanUpdateSchema in routes/loans.ts).
const assetCreateSchema = assetSchema.superRefine((val, ctx) => {
  if (val.assetType === 'VEHICLE' && !val.vehicleType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['vehicleType'],
      message: 'A vehicle asset must have a vehicle type',
    });
  }
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
  const data = assetCreateSchema.parse(req.body);
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

const saleSchema = z.object({
  salePrice: z.number().positive(),
  date: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid date'),
});

router.post('/:id/sell', asyncHandler(async (req, res) => {
  const data = saleSchema.parse(req.body);
  const oldAsset = await svc.getAssetForAudit(req.user!.userId, req.params.id, req.user!.role);
  const asset = await svc.recordAssetSale(req.user!.userId, req.params.id, data, req.user!.role);
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

export default router;
