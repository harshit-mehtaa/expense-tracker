import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess, sendCreated, sendNoContent, sendPaginated } from '../utils/response';
import { requireAuth } from '../middleware/auth';
import * as transactionService from '../services/transactionService';

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
}).refine(
  (d) => d.type !== 'TRANSFER' || !!d.transferToAccountId,
  { message: 'transferToAccountId is required for TRANSFER transactions', path: ['transferToAccountId'] },
);

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const { items, meta } = await transactionService.getTransactions(
      req.user!.userId,
      req.user!.role,
      {
        userId: req.query.userId as string,
        bankAccountId: req.query.bankAccountId as string,
        categoryId: req.query.categoryId as string,
        type: req.query.type as string,
        paymentMode: req.query.paymentMode as string,
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

router.put(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const tx = await transactionService.updateTransaction(
      req.params.id,
      req.user!.userId,
      req.user!.role,
      req.body,
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
