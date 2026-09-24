import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess, sendCreated, sendNoContent, sendPaginated } from '../utils/response';
import { requireAuth } from '../middleware/auth';
import { getCurrentFY } from '../utils/financialYear';
import * as transactionService from '../services/transactionService';
import { AppError } from '../utils/AppError';
import { prisma } from '../config/prisma';
import { recordAuditLog } from '../services/auditService';
import { resolveTargetUserId, resolveWriteUserId } from '../utils/resolveTargetUserId';
import { PAYMENT_MODE } from '../constants/paymentModes';
import {
  commaList, optionalQuery, optionalQueryCuid, optionalQueryDate, optionalQueryFY, optionalQueryInt,
  optionalQueryNumber, optionalQueryString,
} from '../utils/querySchemas';

const CUID_RE = /^[a-z0-9]{20,30}$/i;

const router = Router();
router.use(requireAuth);

const createTransactionSchema = z.object({
  bankAccountId: z.string().cuid().optional(),
  categoryId: z.string().cuid().optional(),
  amount: z.number().positive('Amount must be positive'),
  type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']),
  paymentMode: PAYMENT_MODE.optional(),
  upiIdUsed: z.string().optional(),
  description: z.string().min(1).max(500),
  remark: z.string().max(1000).optional().nullable(),
  date: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  tags: z.array(z.string()).default([]),
  isRecurring: z.boolean().default(false),
  gstAmount: z.number().nonnegative().optional(),
  transferToAccountId: z.string().cuid().optional(), // Double-entry destination for TRANSFER type
  loanId: z.string().cuid().optional(), // Linked loan for EMI/payment tracking
  insurancePolicyId: z.string().cuid().optional(), // Linked insurance premium payment
  subscriptionId: z.string().cuid().optional(), // Linked subscription charge
  refundForTransactionId: z.string().cuid().optional(), // Linked refund for original expense
}).refine(
  (d) => d.type !== 'TRANSFER' || !!d.transferToAccountId,
  { message: 'transferToAccountId is required for TRANSFER transactions', path: ['transferToAccountId'] },
);

const TRANSACTION_TYPE = z.enum(['INCOME', 'EXPENSE', 'TRANSFER']);

/** Filters shared by the list and the CSV export. */
const transactionFilterQuery = z.object({
  fy: optionalQueryFY(),
  bankAccountId: optionalQueryCuid(),
  categoryId: commaList(z.string().cuid()),
  type: commaList(TRANSACTION_TYPE),
  paymentMode: commaList(PAYMENT_MODE),
  startDate: optionalQueryDate(),
  endDate: optionalQueryDate(),
});

const listTransactionsQuery = transactionFilterQuery.extend({
  search: optionalQueryString(), // free text: the command palette does not bound it
  minAmount: optionalQueryNumber(),
  maxAmount: optionalQueryNumber(),
  cursor: optionalQueryCuid(),
  // No max: pagination.ts caps at 100 by contract, and the refund pickers send 500.
  limit: optionalQueryInt(1),
  sort: optionalQuery(z.string().regex(/^(date|amount):(asc|desc)$/, 'Expected date|amount:asc|desc')),
});

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

    const q = listTransactionsQuery.parse(req.query);
    const { items, meta } = await transactionService.getTransactions(
      req.user!.userId,
      req.user!.role,
      {
        userId: effectiveUserId,
        bankAccountId: q.bankAccountId,
        categoryIds: q.categoryId,
        types: q.type,
        paymentModes: q.paymentMode,
        startDate: q.startDate,
        endDate: q.endDate,
        fy: q.fy,
        search: q.search,
        minAmount: q.minAmount,
        maxAmount: q.maxAmount,
        cursor: q.cursor,
        limit: q.limit,
        sort: q.sort,
      },
    );
    sendPaginated(res, items, meta);
  }),
);

// GET /export must be declared before GET /:id — "export" is not a valid CUID cursor value
router.get(
  '/export',
  asyncHandler(async (req: Request, res: Response) => {
    const q = transactionFilterQuery.parse(req.query);
    const fy = q.fy ?? getCurrentFY();
    const targetUserId = await resolveTargetUserId(req);
    const effectiveUserId = req.user!.role === 'ADMIN' ? targetUserId : req.user!.userId;
    const rows = await transactionService.getAllTransactionsForExport(
      req.user!.userId,
      req.user!.role,
      {
        userId: effectiveUserId,
        fy: q.fy,
        startDate: q.startDate,
        endDate: q.endDate,
        types: q.type,
        categoryIds: q.categoryId,
        paymentModes: q.paymentMode,
        bankAccountId: q.bankAccountId,
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
    const ownerUserId = await resolveWriteUserId(req);
    const tx = await transactionService.createTransaction(ownerUserId, body);
    await recordAuditLog({
      performedByUserId: req.user!.userId,
      action: 'CREATE',
      entityType: 'Transaction',
      entityId: tx.id,
      newValue: tx,
    });
    sendCreated(res, tx, 'Transaction created');
  }),
);

const updateTransactionSchema = z.object({
  description: z.string().min(1).max(500).optional(),
  remark: z.string().max(1000).optional().nullable(),
  amount: z.number().positive().optional(),
  type: z.enum(['INCOME', 'EXPENSE']).optional(), // TRANSFER edits are not supported
  date: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  paymentMode: PAYMENT_MODE.optional(),
  categoryId: z.string().cuid().optional().nullable(),
  tags: z.array(z.string()).optional(),
  gstAmount: z.number().nonnegative().optional(),
});

const convertToTransferSchema = z.object({
  transferToAccountId: z.string().cuid().optional(),
  transferFromAccountId: z.string().cuid().optional(),
  counterpartTransactionId: z.string().cuid().optional(),
  adjustDestinationBalance: z.boolean().default(false),
  adjustSourceBalance: z.boolean().default(false),
});

const convertToSIPSchema = z.object({
  sipId: z.string().cuid(),
  units: z.number().positive().optional(),
  nav: z.number().positive().optional(),
}).refine(
  (d) => (d.units === undefined && d.nav === undefined) || (d.units !== undefined && d.nav !== undefined),
  { message: 'units and nav must be provided together', path: ['units'] },
);

const policyLinkSchema = z.object({
  insurancePolicyId: z.string().cuid(),
});

const refundLinkSchema = z.object({
  refundForTransactionId: z.string().cuid(),
});

router.put(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const body = updateTransactionSchema.parse(req.body);
    const oldTx = await transactionService.getTransactionById(
      req.params.id,
      req.user!.userId,
      req.user!.role,
    );
    const tx = await transactionService.updateTransaction(
      req.params.id,
      req.user!.userId,
      req.user!.role,
      body,
    );
    await recordAuditLog({
      performedByUserId: req.user!.userId,
      action: 'UPDATE',
      entityType: 'Transaction',
      entityId: tx.id,
      oldValue: oldTx,
      newValue: tx,
    });
    sendSuccess(res, tx, 'Transaction updated');
  }),
);

router.post(
  '/:id/convert-to-transfer',
  asyncHandler(async (req: Request, res: Response) => {
    const body = convertToTransferSchema.parse(req.body);
    const oldTx = await transactionService.getTransactionById(
      req.params.id,
      req.user!.userId,
      req.user!.role,
    );
    const tx = await transactionService.convertTransactionToTransfer(
      req.params.id,
      req.user!.userId,
      req.user!.role,
      body,
    );
    await recordAuditLog({
      performedByUserId: req.user!.userId,
      action: 'UPDATE',
      entityType: 'Transaction',
      entityId: tx.id,
      oldValue: oldTx,
      newValue: tx,
    });
    sendSuccess(res, tx, 'Transaction marked as transfer');
  }),
);

router.get(
  '/:id/transfer-counterpart-candidates',
  asyncHandler(async (req: Request, res: Response) => {
    const bankAccountId = z.string().cuid().parse(req.query.bankAccountId);
    const candidates = await transactionService.getTransferCounterpartCandidates(
      req.params.id,
      req.user!.userId,
      req.user!.role,
      bankAccountId,
    );
    sendSuccess(res, candidates);
  }),
);

router.post(
  '/:id/convert-to-sip',
  asyncHandler(async (req: Request, res: Response) => {
    const body = convertToSIPSchema.parse(req.body);
    const oldTx = await transactionService.getTransactionById(
      req.params.id,
      req.user!.userId,
      req.user!.role,
    );
    const tx = await transactionService.convertTransactionToSIP(
      req.params.id,
      req.user!.userId,
      req.user!.role,
      body,
    );
    await recordAuditLog({
      performedByUserId: req.user!.userId,
      action: 'UPDATE',
      entityType: 'Transaction',
      entityId: tx.id,
      oldValue: oldTx,
      newValue: tx,
    });
    sendSuccess(res, tx, 'Transaction marked as SIP');
  }),
);

router.put(
  '/:id/sip-link',
  asyncHandler(async (req: Request, res: Response) => {
    const body = convertToSIPSchema.parse(req.body);
    const oldTx = await transactionService.getTransactionById(
      req.params.id,
      req.user!.userId,
      req.user!.role,
    );
    const tx = await transactionService.updateTransactionSIPLink(
      req.params.id,
      req.user!.userId,
      req.user!.role,
      body,
    );
    await recordAuditLog({
      performedByUserId: req.user!.userId,
      action: 'UPDATE',
      entityType: 'Transaction',
      entityId: tx.id,
      oldValue: oldTx,
      newValue: tx,
    });
    sendSuccess(res, tx, 'SIP link updated');
  }),
);

router.delete(
  '/:id/sip-link',
  asyncHandler(async (req: Request, res: Response) => {
    const oldTx = await transactionService.getTransactionById(
      req.params.id,
      req.user!.userId,
      req.user!.role,
    );
    const tx = await transactionService.removeTransactionSIPLink(
      req.params.id,
      req.user!.userId,
      req.user!.role,
    );
    await recordAuditLog({
      performedByUserId: req.user!.userId,
      action: 'UPDATE',
      entityType: 'Transaction',
      entityId: tx.id,
      oldValue: oldTx,
      newValue: tx,
    });
    sendSuccess(res, tx, 'SIP link removed');
  }),
);

router.put(
  '/:id/policy-link',
  asyncHandler(async (req: Request, res: Response) => {
    const body = policyLinkSchema.parse(req.body);
    const oldTx = await transactionService.getTransactionById(
      req.params.id,
      req.user!.userId,
      req.user!.role,
    );
    const tx = await transactionService.updateTransactionInsurancePolicyLink(
      req.params.id,
      req.user!.userId,
      req.user!.role,
      body,
    );
    await recordAuditLog({
      performedByUserId: req.user!.userId,
      action: 'UPDATE',
      entityType: 'Transaction',
      entityId: tx.id,
      oldValue: oldTx,
      newValue: tx,
    });
    sendSuccess(res, tx, 'Policy link updated');
  }),
);

router.delete(
  '/:id/policy-link',
  asyncHandler(async (req: Request, res: Response) => {
    const oldTx = await transactionService.getTransactionById(
      req.params.id,
      req.user!.userId,
      req.user!.role,
    );
    const tx = await transactionService.removeTransactionInsurancePolicyLink(
      req.params.id,
      req.user!.userId,
      req.user!.role,
    );
    await recordAuditLog({
      performedByUserId: req.user!.userId,
      action: 'UPDATE',
      entityType: 'Transaction',
      entityId: tx.id,
      oldValue: oldTx,
      newValue: tx,
    });
    sendSuccess(res, tx, 'Policy link removed');
  }),
);

router.put(
  '/:id/refund-link',
  asyncHandler(async (req: Request, res: Response) => {
    const body = refundLinkSchema.parse(req.body);
    const oldTx = await transactionService.getTransactionById(
      req.params.id,
      req.user!.userId,
      req.user!.role,
    );
    const tx = await transactionService.updateTransactionRefundLink(
      req.params.id,
      req.user!.userId,
      req.user!.role,
      body,
    );
    await recordAuditLog({
      performedByUserId: req.user!.userId,
      action: 'UPDATE',
      entityType: 'Transaction',
      entityId: tx.id,
      oldValue: oldTx,
      newValue: tx,
    });
    sendSuccess(res, tx, 'Refund link updated');
  }),
);

router.delete(
  '/:id/refund-link',
  asyncHandler(async (req: Request, res: Response) => {
    const oldTx = await transactionService.getTransactionById(
      req.params.id,
      req.user!.userId,
      req.user!.role,
    );
    const tx = await transactionService.removeTransactionRefundLink(
      req.params.id,
      req.user!.userId,
      req.user!.role,
    );
    await recordAuditLog({
      performedByUserId: req.user!.userId,
      action: 'UPDATE',
      entityType: 'Transaction',
      entityId: tx.id,
      oldValue: oldTx,
      newValue: tx,
    });
    sendSuccess(res, tx, 'Refund link removed');
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const oldTx = await transactionService.getTransactionById(
      req.params.id,
      req.user!.userId,
      req.user!.role,
    );
    const tx = await transactionService.softDeleteTransaction(
      req.params.id,
      req.user!.userId,
      req.user!.role,
    );
    await recordAuditLog({
      performedByUserId: req.user!.userId,
      action: 'DELETE',
      entityType: 'Transaction',
      entityId: tx?.id ?? req.params.id,
      oldValue: oldTx,
      newValue: tx,
    });
    sendNoContent(res);
  }),
);

export default router;
