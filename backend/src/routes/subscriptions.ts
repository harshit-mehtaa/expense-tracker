import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { sendCreated, sendNoContent, sendSuccess } from '../utils/response';
import * as svc from '../services/subscriptionService';
import { recordAuditLog } from '../services/auditService';
import { resolveTargetUserId, resolveWriteUserId } from '../utils/resolveTargetUserId';
import { PAYMENT_MODE } from '../constants/paymentModes';

const router = Router();
router.use(requireAuth);

/**
 * An HTML form serializes a cleared field as `""`, not as an absent key, and zod's
 * `.optional()` only skips `undefined`. Left alone, `""` reaches Prisma as an Invalid
 * Date or as a foreign key matching no row — neither of which throws a ZodError or an
 * AppError, so both surface as a bare HTTP 500.
 *
 * That exact bug made every pre-existing loan uneditable until it was caught in review.
 * Normalizing here fixes it for every client rather than one form.
 */
// `.transform()` must sit INSIDE `.optional()`, not after it. Chained the other way the
// transform also runs for an ABSENT key, turning `undefined` into `null` — so a partial
// `PUT {name}` would arrive at the service as an explicit null for every other optional
// field and wipe them. Ordered this way, absent stays `undefined` (leave alone) and only
// `''` or an explicit `null` mean "clear it".
const optionalDateString = z
  .union([z.string(), z.null()])
  .transform((v) => (v === '' || v == null ? null : v))
  .refine((v) => v === null || !Number.isNaN(new Date(v).getTime()), { message: 'Invalid date' })
  .optional();

const optionalId = z
  .union([z.string(), z.null()])
  .transform((v) => (v === '' || v == null ? null : v))
  .optional();

const optionalText = z
  .union([z.string(), z.null()])
  .transform((v) => (v === '' || v == null ? null : v))
  .optional();

/**
 * A cancellation link is rendered as an `href`. React only warns on a `javascript:` URL
 * in development — it does not block it — and an ADMIN viewing the family-wide list
 * renders every member's card, so an unvalidated URL is a script that runs in the admin's
 * session. Restricting to http(s) closes that.
 */
const optionalHttpUrl = z
  .union([z.string(), z.null()])
  .transform((v) => (v === '' || v == null ? null : v))
  .refine((v) => v === null || /^https?:\/\//i.test(v), { message: 'Must be an http(s) URL' })
  .refine((v) => {
    if (v === null) return true;
    try { new URL(v); return true; } catch { return false; }
  }, { message: 'Must be a valid URL' })
  .optional();

const FREQUENCY = z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']);


/** Resuming must not backfill the period the subscription was cancelled. The service
 *  comment claimed this; only a guard actually makes it true. */
const notPastDate = (v: string) => {
  const d = new Date(v);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return d >= startOfToday;
};

const createSchema = z.object({
  name: z.string().min(1).max(120),
  vendor: optionalText,
  amount: z.number().positive(),
  frequency: FREQUENCY,
  startDate: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid date'),
  nextRunDate: optionalDateString,
  trialEndDate: optionalDateString,
  cancellationUrl: optionalHttpUrl,
  notes: optionalText,
  bankAccountId: optionalId,
  categoryId: optionalId,
  paymentMode: PAYMENT_MODE.optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  vendor: optionalText,
  cancellationUrl: optionalHttpUrl,
  notes: optionalText,
  trialEndDate: optionalDateString,
  frequency: FREQUENCY.optional(),
  nextRunDate: optionalDateString,
  // Omitted here originally, so the form could set a payment method once and never
  // correct it — a silent read-only field is worse than no field.
  paymentMode: PAYMENT_MODE.nullable().optional(),
  bankAccountId: optionalId,
  categoryId: optionalId,
});

const priceChangeSchema = z.object({
  amount: z.number().positive(),
  effectiveFrom: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid date'),
  note: optionalText,
});

router.get('/', asyncHandler(async (req, res) => {
  const targetUserId = await resolveTargetUserId(req);
  const effectiveUserId = req.user!.role === 'ADMIN' ? targetUserId : req.user!.userId;
  sendSuccess(res, await svc.listSubscriptions(effectiveUserId));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const subscription = await svc.getSubscription(req.user!.userId, req.params.id, req.user!.role);
  if (!subscription) throw AppError.notFound('Subscription');
  sendSuccess(res, subscription);
}));

router.post('/', asyncHandler(async (req, res) => {
  const data = createSchema.parse(req.body);
  const ownerUserId = await resolveWriteUserId(req);
  const subscription = await svc.createSubscription(ownerUserId, data as never);
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: 'CREATE',
    entityType: 'Subscription',
    entityId: subscription.id,
    newValue: subscription,
  });
  sendCreated(res, subscription);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const data = updateSchema.parse(req.body);
  const oldValue = await svc.getSubscriptionForAudit(req.user!.userId, req.params.id, req.user!.role);
  const subscription = await svc.updateSubscription(
    req.user!.userId, req.params.id, data as never, req.user!.role,
  );
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: 'UPDATE',
    entityType: 'Subscription',
    entityId: req.params.id,
    oldValue,
    newValue: subscription,
  });
  sendSuccess(res, subscription);
}));

/** Price changes are their own endpoint: they append history, they do not overwrite. */
router.post('/:id/price', asyncHandler(async (req, res) => {
  const { amount, effectiveFrom, note } = priceChangeSchema.parse(req.body);
  const oldValue = await svc.getSubscriptionForAudit(req.user!.userId, req.params.id, req.user!.role);
  const subscription = await svc.recordPriceChange(
    req.user!.userId, req.params.id, amount, effectiveFrom, note, req.user!.role,
  );
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: 'UPDATE',
    entityType: 'Subscription',
    entityId: req.params.id,
    oldValue,
    newValue: subscription,
  });
  sendSuccess(res, subscription);
}));

router.post('/:id/cancel', asyncHandler(async (req, res) => {
  const { reason } = z.object({ reason: optionalText }).parse(req.body);
  const oldValue = await svc.getSubscriptionForAudit(req.user!.userId, req.params.id, req.user!.role);
  const subscription = await svc.cancelSubscription(
    req.user!.userId, req.params.id, reason, req.user!.role,
  );
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: 'UPDATE',
    entityType: 'Subscription',
    entityId: req.params.id,
    oldValue,
    newValue: subscription,
  });
  sendSuccess(res, subscription);
}));

router.post('/:id/resume', asyncHandler(async (req, res) => {
  const { nextRunDate } = z.object({
    nextRunDate: z.string()
      .refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid date')
      // Without this, POST /resume {"nextRunDate":"2020-01-01"} reactivates the rule in
      // the past and the next run backfills up to MAX_CATCH_UP_PER_RULE (366) charges,
      // moving the account balance 366 times.
      .refine(notPastDate, 'Resume date must not be in the past'),
  }).parse(req.body);
  const oldValue = await svc.getSubscriptionForAudit(req.user!.userId, req.params.id, req.user!.role);
  const subscription = await svc.resumeSubscription(
    req.user!.userId, req.params.id, nextRunDate, req.user!.role,
  );
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: 'UPDATE',
    entityType: 'Subscription',
    entityId: req.params.id,
    oldValue,
    newValue: subscription,
  });
  sendSuccess(res, subscription);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const oldValue = await svc.getSubscriptionForAudit(req.user!.userId, req.params.id, req.user!.role);
  await svc.deleteSubscription(req.user!.userId, req.params.id, req.user!.role);
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: 'DELETE',
    entityType: 'Subscription',
    entityId: req.params.id,
    oldValue,
  });
  sendNoContent(res);
}));

export default router;
