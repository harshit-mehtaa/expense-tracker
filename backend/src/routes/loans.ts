import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/response';
import * as svc from '../services/loanService';

const router = Router();
router.use(requireAuth);

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
  const loans = await svc.getLoans(req.user!.userId);
  sendSuccess(res, loans);
}));

router.get('/:id/amortization-schedule', asyncHandler(async (req, res) => {
  const data = await svc.getLoanAmortization(req.user!.userId, req.params.id);
  sendSuccess(res, data);
}));

router.post('/:id/prepayment-simulation', asyncHandler(async (req, res) => {
  const { prepaymentAmount, mode } = z.object({
    prepaymentAmount: z.number().positive(),
    mode: z.enum(['reduce_tenure', 'reduce_emi']).default('reduce_tenure'),
  }).parse(req.body);
  const result = await svc.simulatePrepayment(req.user!.userId, req.params.id, prepaymentAmount, mode);
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
