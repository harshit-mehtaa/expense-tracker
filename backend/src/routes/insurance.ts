import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/response';
import { ownerScopedWhere, resolveTargetUserId, resolveWriteUserId } from '../utils/resolveTargetUserId';
import * as svc from '../services/insuranceService';
import { prisma } from '../config/prisma';
import { recordAuditLog } from '../services/auditService';
import { isTest } from '../config/env';

const router = Router();
router.use(requireAuth);

const policySchema = z.object({
  policyType: z.enum(['TERM_LIFE', 'ENDOWMENT', 'ULIP', 'WHOLE_LIFE', 'HEALTH', 'SUPER_TOP_UP', 'CRITICAL_ILLNESS', 'PERSONAL_ACCIDENT', 'VEHICLE', 'HOME', 'TRAVEL']),
  providerName: z.string().min(1),
  policyNumber: z.string().min(1),
  policyName: z.string().min(1),
  sumAssured: z.number().positive(),
  premiumAmount: z.number().positive(),
  premiumFrequency: z.enum(['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUALLY', 'SINGLE']),
  premiumDueDate: z.number().int().min(1).max(31).optional(),
  startDate: z.string().transform((s) => new Date(s)),
  endDate: z.string().transform((s) => new Date(s)).optional(),
  maturityDate: z.string().transform((s) => new Date(s)).optional(),
  nomineeName: z.string().optional(),
  agentName: z.string().optional(),
  agentContact: z.string().optional(),
  is80cEligible: z.boolean().default(false),
  is80dEligible: z.boolean().default(false),
  isForParents: z.boolean().default(false),
  notes: z.string().optional(),
});

router.get('/', asyncHandler(async (req, res) => {
  const targetUserId = await resolveTargetUserId(req, { paramName: 'userId' });
  const policies = await svc.getInsurancePolicies(targetUserId, req.user!.userId, req.user!.role);
  sendSuccess(res, policies);
}));

router.get('/premium-calendar', asyncHandler(async (req, res) => {
  const calendar = await svc.getPremiumCalendar(req.user!.userId);
  sendSuccess(res, calendar);
}));

router.get('/80d-summary', asyncHandler(async (req, res) => {
  const targetUserId = await resolveTargetUserId(req, { paramName: 'userId' });
  const summary = await svc.get80DSummary(targetUserId ?? req.user!.userId, req.user!.userId, req.user!.role);
  sendSuccess(res, summary);
}));

router.post('/', asyncHandler(async (req, res) => {
  const data = policySchema.parse(req.body);
  const ownerUserId = await resolveWriteUserId(req);
  const policy = await svc.createInsurancePolicy(ownerUserId, data as any);
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: 'CREATE',
    entityType: 'InsurancePolicy',
    entityId: policy.id,
    newValue: policy,
  });
  sendCreated(res, policy);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const data = policySchema.partial().parse(req.body);
  const oldPolicy = isTest ? null : await prisma.insurancePolicy.findFirst({ where: ownerScopedWhere(req.params.id, req.user!.userId, req.user!.role) });
  const policy = await svc.updateInsurancePolicy(req.user!.userId, req.params.id, data as any, req.user!.role);
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: 'UPDATE',
    entityType: 'InsurancePolicy',
    entityId: policy.id,
    oldValue: oldPolicy,
    newValue: policy,
  });
  sendSuccess(res, policy);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const oldPolicy = isTest ? null : await prisma.insurancePolicy.findFirst({ where: ownerScopedWhere(req.params.id, req.user!.userId, req.user!.role) });
  const policy = await svc.deleteInsurancePolicy(req.user!.userId, req.params.id, req.user!.role);
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: 'DELETE',
    entityType: 'InsurancePolicy',
    entityId: policy?.id ?? req.params.id,
    oldValue: oldPolicy,
  });
  sendNoContent(res);
}));

export default router;
