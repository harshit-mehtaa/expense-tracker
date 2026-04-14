import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/response';
import { requireAuth } from '../middleware/auth';
import { resolveTargetUserId } from '../utils/resolveTargetUserId';
import * as accountService from '../services/accountService';

const router = Router();
router.use(requireAuth);

const createAccountSchema = z.object({
  bankName: z.string().min(1),
  ifscPrefix: z.string().length(4).optional(),
  accountNumberLast4: z.string().length(4).regex(/^\d{4}$/).optional(),
  accountType: z.enum(['SAVINGS', 'CURRENT', 'SALARY', 'NRE', 'NRO', 'PPF', 'EPF', 'DEMAT']),
  currentBalance: z.number().default(0),
  currency: z.string().default('INR'),
  interestRate: z.number().min(0).max(100).optional(),
  maturityDate: z.string().optional(),
  upiId: z.string().optional(),
});

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = await resolveTargetUserId(req, { paramName: 'userId' });
    const accounts = await accountService.getAccounts(userId, req.user!.userId, req.user!.role);
    sendSuccess(res, accounts);
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const account = await accountService.getAccountById(req.params.id, req.user!.userId, req.user!.role);
    sendSuccess(res, account);
  }),
);

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const body = createAccountSchema.parse(req.body);
    const account = await accountService.createAccount(req.user!.userId, body);
    sendCreated(res, account, 'Account created');
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const account = await accountService.updateAccount(
      req.params.id,
      req.user!.userId,
      req.user!.role,
      req.body,
    );
    sendSuccess(res, account, 'Account updated');
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    await accountService.deleteAccount(req.params.id, req.user!.userId, req.user!.role);
    sendNoContent(res);
  }),
);

const reconcileSchema = z.object({
  actualBalance: z.number().min(0, 'Balance cannot be negative'),
  note: z.string().optional(),
});

router.post(
  '/:id/reconcile',
  asyncHandler(async (req: Request, res: Response) => {
    const { actualBalance, note } = reconcileSchema.parse(req.body);
    const account = await accountService.reconcileAccount(
      req.params.id,
      req.user!.userId,
      req.user!.role,
      actualBalance,
      note,
    );
    sendSuccess(res, account, 'Account reconciled');
  }),
);

export default router;
