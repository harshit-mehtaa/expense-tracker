import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/response';
import { requireAuth } from '../middleware/auth';
import * as recurringService from '../services/recurringService';
import { RecurringFrequency } from '@prisma/client';
import { resolveTargetUserId } from '../utils/resolveTargetUserId';

const router = Router();
router.use(requireAuth);

const createRuleSchema = z.object({
  bankAccountId: z.string().cuid().optional(),
  categoryId: z.string().cuid().optional(),
  amount: z.number().positive('Amount must be positive'),
  type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']),
  paymentMode: z.enum(['UPI', 'NEFT', 'RTGS', 'IMPS', 'CASH', 'CHEQUE', 'CARD', 'EMI', 'AUTO_DEBIT']).optional(),
  description: z.string().min(1).max(500),
  tags: z.array(z.string()).default([]),
  gstAmount: z.number().nonnegative().optional(),
  frequency: z.nativeEnum(RecurringFrequency),
  nextRunDate: z.string().optional(),
});

const updateRuleSchema = z.object({
  frequency: z.nativeEnum(RecurringFrequency).optional(),
  nextRunDate: z.string().optional(),
  isActive: z.boolean().optional(),
});

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const { userId, role } = req.user!;
    const targetUserId = await resolveTargetUserId(req);
    const effectiveUserId = role === 'ADMIN' ? (targetUserId ?? userId) : userId;
    const rules = await recurringService.listRecurringRules(effectiveUserId);
    sendSuccess(res, rules);
  }),
);

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const body = createRuleSchema.parse(req.body);
    const rule = await recurringService.createRecurringRule(req.user!.userId, body);
    sendCreated(res, rule, 'Recurring rule created');
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const body = updateRuleSchema.parse(req.body);
    const rule = await recurringService.updateRecurringRule(req.params.id, req.user!.userId, body);
    sendSuccess(res, rule, 'Recurring rule updated');
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    await recurringService.deleteRecurringRule(req.params.id, req.user!.userId);
    sendNoContent(res);
  }),
);

// Manual trigger — generates any due transactions now (useful for testing / catch-up)
router.post(
  '/generate',
  asyncHandler(async (req: Request, res: Response) => {
    const result = await recurringService.generateDueRecurringTransactions(req.user!.userId);
    sendSuccess(res, result, `Generated ${result.generated} transaction(s)`);
  }),
);

export default router;
