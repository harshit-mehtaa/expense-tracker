import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess, sendCreated, sendNoContent, sendPaginated } from '../utils/response';
import { requireAuth } from '../middleware/auth';
import { validateFY, getCurrentFY } from '../utils/financialYear';
import * as transactionService from '../services/transactionService';
import { AppError } from '../utils/AppError';
import { prisma } from '../config/prisma';

const CUID_RE = /^[a-z0-9]{20,30}$/i;

function parseMultiParam(param: unknown): string[] | undefined {
  const s = param as string | undefined;
  if (!s) return undefined;
  const vals = s.split(',').filter(Boolean);
  return vals.length ? vals : undefined;
}

const router = Router();
router.use(requireAuth);

const createTransactionSchema = z.object({
  bankAccountId: z.string().cuid().optional(),
  categoryId: z.string().cuid().optional(),
  amount: z.number().positive('Amount must be positive'),
  type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']),
  paymentMode: z.enum(['UPI', 'NEFT', 'RTGS', 'IMPS', 'CASH', 'CHEQUE', 'CARD', 'EMI', 'AUTO_DEBIT']).optional(),
  upiIdUsed: z.string().optional(),
  description: z.string().min(1).max(500),
  date: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  tags: z.array(z.string()).default([]),
  isRecurring: z.boolean().default(false),
  gstAmount: z.number().nonnegative().optional(),
  transferToAccountId: z.string().cuid().optional(), // Double-entry destination for TRANSFER type
  loanId: z.string().cuid().optional(), // Linked loan for EMI/payment tracking
}).refine(
  (d) => d.type !== 'TRANSFER' || !!d.transferToAccountId,
  { message: 'transferToAccountId is required for TRANSFER transactions', path: ['transferToAccountId'] },
);

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    // Resolve effective user filter — ADMIN can view per-member or family-wide
    let effectiveUserId: string | undefined;
    if (req.user!.role === 'ADMIN') {
      const rawTarget = (req.query.targetUserId as string) || (req.query.userId as string);
      if (rawTarget) {
        if (!CUID_RE.test(rawTarget)) throw AppError.badRequest('Invalid targetUserId format');
        const target = await prisma.user.findFirst({ where: { id: rawTarget, deletedAt: null } });
        if (!target) throw AppError.notFound('User');
        effectiveUserId = rawTarget;
      }
      // else family-wide: effectiveUserId stays undefined
    } else {
      effectiveUserId = req.user!.userId;
    }

    const { items, meta } = await transactionService.getTransactions(
      req.user!.userId,
      req.user!.role,
      {
        userId: effectiveUserId,
        bankAccountId: req.query.bankAccountId as string,
        categoryIds: parseMultiParam(req.query.categoryId),
        types: parseMultiParam(req.query.type),
        paymentModes: parseMultiParam(req.query.paymentMode),
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        fy: req.query.fy as string,
        search: req.query.search as string,
        minAmount: req.query.minAmount ? Number(req.query.minAmount) : undefined,
        maxAmount: req.query.maxAmount ? Number(req.query.maxAmount) : undefined,
        cursor: req.query.cursor as string,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        sort: req.query.sort as string,
      },
    );
    sendPaginated(res, items, meta);
  }),
);

// GET /export must be declared before GET /:id — "export" is not a valid CUID cursor value
router.get(
  '/export',
  asyncHandler(async (req: Request, res: Response) => {
    const fy = validateFY(req.query.fy);
    const rows = await transactionService.getAllTransactionsForExport(
      req.user!.userId,
      req.user!.role,
      {
        fy: req.query.fy ? fy : undefined,
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
        types: parseMultiParam(req.query.type),
        categoryIds: parseMultiParam(req.query.categoryId),
        paymentModes: parseMultiParam(req.query.paymentMode),
        bankAccountId: req.query.bankAccountId as string | undefined,
      },
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="transactions-${fy}.csv"`);
    res.send(transactionService.buildCsv(rows));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const tx = await transactionService.getTransactionById(
      req.params.id,
      req.user!.userId,
      req.user!.role,
    );
    sendSuccess(res, tx);
  }),
);

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const body = createTransactionSchema.parse(req.body);
    const tx = await transactionService.createTransaction(req.user!.userId, body);
    sendCreated(res, tx, 'Transaction created');
  }),
);

const updateTransactionSchema = z.object({
  description: z.string().min(1).max(500).optional(),
  amount: z.number().positive().optional(),
  type: z.enum(['INCOME', 'EXPENSE']).optional(), // TRANSFER edits are not supported
  date: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  paymentMode: z.enum(['UPI', 'NEFT', 'RTGS', 'IMPS', 'CASH', 'CHEQUE', 'CARD', 'EMI', 'AUTO_DEBIT']).optional(),
  categoryId: z.string().cuid().optional().nullable(),
  tags: z.array(z.string()).optional(),
  gstAmount: z.number().nonnegative().optional(),
});

router.put(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const body = updateTransactionSchema.parse(req.body);
    const tx = await transactionService.updateTransaction(
      req.params.id,
      req.user!.userId,
      req.user!.role,
      body,
    );
    sendSuccess(res, tx, 'Transaction updated');
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    await transactionService.softDeleteTransaction(
      req.params.id,
      req.user!.userId,
      req.user!.role,
    );
    sendNoContent(res);
  }),
);

export default router;
