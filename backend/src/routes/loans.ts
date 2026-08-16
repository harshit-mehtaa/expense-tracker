import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/response';
import { AppError } from '../utils/AppError';
import { prisma } from '../config/prisma';
import * as svc from '../services/loanService';
import { recordAuditLog } from '../services/auditService';
import { resolveWriteUserId } from '../utils/resolveTargetUserId';
import { computeEmi, computePreEmi, computeMonthlyPreEmi, deriveEndDate } from '../utils/loanMath';

const router = Router();
router.use(requireAuth);

const CUID_RE = /^[a-z0-9]{20,30}$/i;

const SECURED_TYPES = ['HOME', 'AUTO', 'LAP', 'GOLD'] as const;

const loanOwnerSchema = z.object({
  userId: z.string().min(1),
  sharePercent: z.number().positive().max(100),
});

/**
 * An HTML form serializes a cleared field as `""`, not as an absent key. Zod's
 * `.optional()` only skips `undefined`, so `""` sailed through: the date transform
 * produced an `Invalid Date` and the id stayed `""`, and BOTH reached Prisma — one as
 * an invalid Date argument, the other as an FK matching no row. Neither throws a
 * ZodError or an AppError, so both surfaced as a bare HTTP 500 and made every
 * pre-existing loan uneditable.
 *
 * Normalizing at the API boundary fixes it for every client, not just this form.
 */
const optionalDate = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (v === '' || v == null ? null : new Date(v)))
  .refine((d) => d === null || !Number.isNaN(d.getTime()), { message: 'Invalid date' });

const optionalId = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (v === '' || v == null ? null : v));

const optionalAmount = z
  .union([z.number(), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' || v == null ? null : v))
  .refine((n) => n === null || n >= 0, { message: 'Must be at least 0' });

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
  firstEmiDate: optionalDate,
  preEmiAmount: optionalAmount,
  isTaxDeductible: z.boolean().default(false),
  section24bEligible: z.boolean().default(false),
  prepaymentChargesAmount: z.number().min(0).default(0),
  bankAccountId: optionalId,
  assetId: optionalId,
  owners: z.array(loanOwnerSchema).min(1).optional(),
});

// Separate create/update schemas rather than one refined schema.
// `.superRefine()` returns a ZodEffects, which has no `.partial()` at all — chaining
// them would throw at module load. And a partial body may omit `loanType` entirely, so
// the refinement cannot see enough to judge; loanService re-checks against the merged
// row, which is where the rule is actually enforced.
const loanCreateSchema = loanSchema.superRefine((val, ctx) => {
  if ((SECURED_TYPES as readonly string[]).includes(val.loanType) && !val.assetId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['assetId'],
      message: `A ${val.loanType} loan is secured and must be linked to an asset`,
    });
  }
});

const loanUpdateSchema = loanSchema.partial();

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

/**
 * Derive the fields a user shouldn't have to compute. The frontend calls this rather
 * than carrying its own copy of the formulas — `backend/tsconfig.json` sets
 * rootDir to ./src, so a shared module cannot be imported by both sides without a
 * build-system change.
 *
 * Every value is a SUGGESTION. The form pre-fills and leaves them editable: a real
 * lender's EMI rarely matches the textbook figure to the paisa, and a loan entered
 * mid-life has an outstanding balance well below its principal.
 */
const deriveSchema = z.object({
  principalAmount: z.number().positive(),
  interestRate: z.number().positive(),
  tenureMonths: z.number().int().positive(),
  disbursementDate: z.string().optional(),
  firstEmiDate: z.string().optional(),
});

router.post('/derive', asyncHandler(async (req, res) => {
  const input = deriveSchema.parse(req.body);

  const disbursement = input.disbursementDate ? new Date(input.disbursementDate) : null;
  const firstEmi = input.firstEmiDate ? new Date(input.firstEmiDate) : null;

  const emiAmount = computeEmi(input.principalAmount, input.interestRate, input.tenureMonths);
  const endDate = disbursement && !Number.isNaN(disbursement.getTime())
    ? deriveEndDate(disbursement, input.tenureMonths, firstEmi)
    : null;
  const preEmiAmount = disbursement && firstEmi
    && !Number.isNaN(disbursement.getTime()) && !Number.isNaN(firstEmi.getTime())
    ? computePreEmi(input.principalAmount, input.interestRate, disbursement, firstEmi)
    : null;

  sendSuccess(res, {
    emiAmount,
    endDate: endDate ? endDate.toISOString() : null,
    preEmiAmount,
    monthlyPreEmiAmount: computeMonthlyPreEmi(input.principalAmount, input.interestRate),
    // A new loan starts with nothing repaid; editable for loans entered mid-life.
    outstandingBalance: input.principalAmount,
  });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { owners, ...data } = loanCreateSchema.parse(req.body);
  const ownerUserId = await resolveWriteUserId(req);
  const loan = await svc.createLoan(ownerUserId, data as any, owners);
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: 'CREATE',
    entityType: 'Loan',
    entityId: loan.id,
    newValue: loan,
  });
  sendCreated(res, loan);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const { owners, ...data } = loanUpdateSchema.parse(req.body);
  const oldLoan = await svc.getLoanForAudit(req.user!.userId, req.params.id, req.user!.role);
  const loan = await svc.updateLoan(req.user!.userId, req.params.id, data as any, req.user!.role, owners);
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: 'UPDATE',
    entityType: 'Loan',
    entityId: loan.id,
    oldValue: oldLoan,
    newValue: loan,
  });
  sendSuccess(res, loan);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const oldLoan = await svc.getLoanForAudit(req.user!.userId, req.params.id, req.user!.role);
  const loan = await svc.deleteLoan(req.user!.userId, req.params.id, req.user!.role);
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: 'DELETE',
    entityType: 'Loan',
    entityId: loan?.id ?? req.params.id,
    oldValue: oldLoan,
  });
  sendNoContent(res);
}));

export default router;
