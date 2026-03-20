import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/response';
import { getCurrentFY } from '../utils/financialYear';
import * as svc from '../services/taxService';

/** Validate and return a safe FY string; falls back to current FY on bad input */
function parseFY(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  return /^\d{4}-\d{2}$/.test(s) ? s : getCurrentFY();
}

const router = Router();
router.use(requireAuth);

router.get('/profile', asyncHandler(async (req, res) => {
  const fy = parseFY(req.query.fy);
  const profile = await svc.getTaxProfile(req.user!.userId, fy);
  sendSuccess(res, profile);
}));

router.post('/profile', asyncHandler(async (req, res) => {
  const fy = parseFY(req.query.fy);
  const data = z.object({
    regime: z.enum(['OLD', 'NEW']).optional(),
    grossSalary: z.number().optional(),
    hraReceived: z.number().optional(),
    rentPaidMonthly: z.number().optional(),
    cityType: z.enum(['METRO', 'NON_METRO']).optional(),
    deduction80C: z.number().optional(),
    deduction80D: z.number().optional(),
    deduction80E: z.number().optional(),
    deduction80G: z.number().optional(),
    deduction24B: z.number().optional(),
    nps80Ccd1B: z.number().optional(),
    otherDeductions: z.number().optional(),
    taxPaidAdvance: z.number().optional(),
    taxPaidTds: z.number().optional(),
    taxPaidSelfAssessment: z.number().optional(),
  }).parse(req.body);
  const profile = await svc.upsertTaxProfile(req.user!.userId, fy, data as any);
  sendSuccess(res, profile);
}));

router.get('/summary', asyncHandler(async (req, res) => {
  const fy = parseFY(req.query.fy);
  const summary = await svc.getTaxSummary(req.user!.userId, fy);
  sendSuccess(res, summary);
}));

router.get('/80c-tracker', asyncHandler(async (req, res) => {
  const fy = parseFY(req.query.fy);
  const tracker = await svc.get80CTracker(req.user!.userId, fy);
  sendSuccess(res, tracker);
}));

router.get('/advance-tax-calendar', asyncHandler(async (req, res) => {
  const fy = parseFY(req.query.fy);
  const calendar = await svc.getAdvanceTaxCalendar(fy);
  sendSuccess(res, calendar);
}));

router.get('/hra-calculator', asyncHandler(async (req, res) => {
  const { basicSalary, hraReceived, rentPaid, city } = z.object({
    basicSalary: z.coerce.number(),
    hraReceived: z.coerce.number(),
    rentPaid: z.coerce.number(),
    city: z.enum(['METRO', 'NON_METRO']).default('METRO'),
  }).parse(req.query);

  const exempt = svc.calcHRAExemption(basicSalary, hraReceived, rentPaid * 12, city === 'METRO');
  sendSuccess(res, { exempt, taxable: hraReceived - exempt });
}));

export default router;
