import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/response';
import { requireAuth } from '../middleware/auth';
import { resolveTargetUserId, resolveWriteUserId } from '../utils/resolveTargetUserId';
import * as accountService from '../services/accountService';
import { recordAuditLog } from '../services/auditService';

const router = Router();
router.use(requireAuth);

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalTrimmedString = z.preprocess(emptyStringToUndefined, z.string().trim().optional());

const optionalIfscPrefix = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toUpperCase() || undefined : value),
  z.string().length(4).regex(/^[A-Z]{4}$/).optional(),
);

const optionalIfscCode = z.preprocess(
  (value) => (typeof value === 'string' ? value.replace(/\s/g, '').toUpperCase() || undefined : value),
  z.string()
    .length(11, 'IFSC code must be 11 characters')
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC code')
    .optional(),
);

const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? undefined : value),
    schema.optional(),
  );

const optionalBillingDay = optionalNumber(z.coerce.number().int().min(1).max(31));

const optionalAccountNumber = z.preprocess(
  emptyStringToUndefined,
  z.string()
    .trim()
    .min(4, 'Account number must be at least 4 characters')
    .max(34, 'Account number is too long')
    .regex(/^[A-Za-z0-9 -]+$/, 'Account number can contain only letters, numbers, spaces, and hyphens')
    .optional(),
);

const bankNameSchema = z.string()
  .trim()
  .min(1, 'Bank name is required')
  .refine((value) => value.toLowerCase() !== 'other', 'Enter the bank name when choosing Other');

const createAccountSchema = z.object({
  bankName: bankNameSchema,
  ifscPrefix: optionalIfscPrefix,
  ifscCode: optionalIfscCode,
  accountNumber: optionalAccountNumber,
  accountNumberLast4: z.preprocess(emptyStringToUndefined, z.string().length(4).regex(/^\d{4}$/).optional()),
  accountType: z.enum(['SAVINGS', 'CURRENT', 'SALARY', 'CREDIT_CARD', 'DEBIT_CARD', 'PREPAID_CARD', 'NRE', 'NRO', 'PPF', 'EPF', 'DEMAT']),
  currentBalance: z.coerce.number().default(0),
  currency: z.string().trim().default('INR'),
  interestRate: optionalNumber(z.coerce.number().min(0).max(100)),
  creditLimit: optionalNumber(z.coerce.number().min(0)),
  billingCycleStartDay: optionalBillingDay,
  billingCycleEndDay: optionalBillingDay,
  paymentDueDay: optionalBillingDay,
  maturityDate: optionalTrimmedString,
  upiId: optionalTrimmedString,
});

const updateAccountSchema = createAccountSchema.partial().extend({
  isActive: z.boolean().optional(),
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
    const ownerUserId = await resolveWriteUserId(req);
    const account = await accountService.createAccount(ownerUserId, body);
    await recordAuditLog({
      performedByUserId: req.user!.userId,
      action: 'CREATE',
      entityType: 'BankAccount',
      entityId: account.id,
      newValue: account,
    });
    sendCreated(res, account, 'Account created');
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const body = updateAccountSchema.parse(req.body);
    const oldAccount = await accountService.getAccountById(req.params.id, req.user!.userId, req.user!.role);
    const account = await accountService.updateAccount(
      req.params.id,
      req.user!.userId,
      req.user!.role,
      body,
    );
    await recordAuditLog({
      performedByUserId: req.user!.userId,
      action: 'UPDATE',
      entityType: 'BankAccount',
      entityId: account.id,
      oldValue: oldAccount,
      newValue: account,
    });
    sendSuccess(res, account, 'Account updated');
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const oldAccount = await accountService.getAccountById(req.params.id, req.user!.userId, req.user!.role);
    const account = await accountService.deleteAccount(req.params.id, req.user!.userId, req.user!.role);
    await recordAuditLog({
      performedByUserId: req.user!.userId,
      action: 'DELETE',
      entityType: 'BankAccount',
      entityId: account?.id ?? req.params.id,
      oldValue: oldAccount,
      newValue: account,
    });
    sendNoContent(res);
  }),
);

const reconcileSchema = z.object({
  actualBalance: z.number(),
  note: z.string().optional(),
});

router.post(
  '/:id/reconcile',
  asyncHandler(async (req: Request, res: Response) => {
    const { actualBalance, note } = reconcileSchema.parse(req.body);
    const oldAccount = await accountService.getAccountById(req.params.id, req.user!.userId, req.user!.role);
    const account = await accountService.reconcileAccount(
      req.params.id,
      req.user!.userId,
      req.user!.role,
      actualBalance,
      note,
    );
    await recordAuditLog({
      performedByUserId: req.user!.userId,
      action: 'RECONCILE',
      entityType: 'BankAccount',
      entityId: account.id,
      oldValue: oldAccount,
      newValue: account,
    });
    sendSuccess(res, account, 'Account reconciled');
  }),
);

export default router;
