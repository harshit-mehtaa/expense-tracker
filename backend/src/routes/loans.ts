import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/response';
import { AppError } from '../utils/AppError';
import { prisma } from '../config/prisma';
import * as svc from '../services/loanService';

const router = Router();
router.use(requireAuth);

const CUID_RE = /^[a-z0-9]{20,30}$/i;

const loanSchema = z.object({
  lenderName: z.string().min(1),
  loanAccountNumber: z.string().optional(),
  loanType: z.enum(['HOME', 'AUTO', 'PERSONAL', 'EDUCATION', 'GOLD', 'LAP', 'BUSINESS', 'OTHER']),
  principalAmount: z.number().positive(),
  outstandingBalance: z.number().min(0),
  interestRate: z.number().positive(),
  emiAmount: z.number().positive(),
  emiDate: z.number().int().min(1).max(28),
  tenureMonths: z.number().int().positive(),
  disbursementDate: z.string().transform((s) => new Date(s)),
  endDate: z.string().transform((s) => new Date(s)),
  isTaxDeductible: z.boolean().default(false),
  section24bEligible: z.boolean().default(false),
  prepaymentChargesPct: z.number().min(0).default(0),
  bankAccountId: z.string().optional(),
});

router.get('/', asyncHandler(async (req, res) => {
  let effectiveUserId: string | undefined = req.user!.userId;
  if (req.user!.role === 'ADMIN' && req.query.targetUserId) {
    const raw = req.query.targetUserId as string;
    if (!CUID_RE.test(raw)) throw AppError.badRequest('Invalid targetUserId format');
    const target = await prisma.user.findFirst({ where: { id: raw, deletedAt: null } });
    if (!target) throw AppError.notFound('User');
    effectiveUserId = raw;
  } else if (req.user!.role === 'ADMIN' && !req.query.targetUserId) {
    effectiveUserId = undefined; // family-wide
  }
  const loans = await svc.getLoans(effectiveUserId);
  sendSuccess(res, loans);
}));

router.get('/:id/amortization-schedule', asyncHandler(async (req, res) => {
  // ADMIN can view any loan in the family; MEMBER is scoped to their own
  const ownerFilter = req.user!.role === 'ADMIN' ? undefined : req.user!.userId;
  const data = await svc.getLoanAmortization(ownerFilter, req.params.id);
  sendSuccess(res, data);
}));

router.post('/:id/prepayment-simulation', asyncHandler(async (req, res) => {
  const { prepaymentAmount, mode } = z.object({
    prepaymentAmount: z.number().positive(),
    mode: z.enum(['reduce_tenure', 'reduce_emi']).default('reduce_tenure'),
  }).parse(req.body);
  const ownerFilter = req.user!.role === 'ADMIN' ? undefined : req.user!.userId;
  const result = await svc.simulatePrepayment(ownerFilter, req.params.id, prepaymentAmount, mode);
  sendSuccess(res, result);
}));

router.post('/', asyncHandler(async (req, res) => {
  const data = loanSchema.parse(req.body);
  const loan = await svc.createLoan(req.user!.userId, data as any);
  sendCreated(res, loan);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const data = loanSchema.partial().parse(req.body);
  const loan = await svc.updateLoan(req.user!.userId, req.params.id, data as any);
  sendSuccess(res, loan);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await svc.deleteLoan(req.user!.userId, req.params.id);
  sendNoContent(res);
}));

export default router;
