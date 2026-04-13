import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/response';
import { getCurrentFY } from '../utils/financialYear';
import { resolveTargetUserId } from '../utils/resolveTargetUserId';
import * as svc from '../services/taxService';
import * as cgSvc from '../services/capitalGainsService';
import * as osSvc from '../services/otherIncomeService';
import * as hpSvc from '../services/housePropertyService';
import * as faSvc from '../services/foreignAssetService';

/** Validate and return a safe FY string; falls back to current FY on bad input */
function parseFY(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  return /^\d{4}-\d{2}$/.test(s) ? s : getCurrentFY();
}

const router = Router();
router.use(requireAuth);

// ─── Tax Profile ──────────────────────────────────────────────────────────────

router.get('/profile', asyncHandler(async (req, res) => {
  const fy = parseFY(req.query.fy);
  const { userId, role } = req.user!;
  const targetUserId = await resolveTargetUserId(req);
  const effectiveUserId = role === 'ADMIN' ? (targetUserId ?? userId) : userId;
  const profile = await svc.getTaxProfile(effectiveUserId, fy);
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

// ─── Tax Summary ──────────────────────────────────────────────────────────────

router.get('/summary', asyncHandler(async (req, res) => {
  const fy = parseFY(req.query.fy);
  const { userId, role } = req.user!;
  const targetUserId = await resolveTargetUserId(req);
  const effectiveUserId = role === 'ADMIN' ? (targetUserId ?? userId) : userId;
  const summary = await svc.getTaxSummary(effectiveUserId, fy);
  sendSuccess(res, summary);
}));

// ─── 80C Tracker ─────────────────────────────────────────────────────────────

router.get('/80c-tracker', asyncHandler(async (req, res) => {
  const fy = parseFY(req.query.fy);
  const { userId, role } = req.user!;
  const targetUserId = await resolveTargetUserId(req);
  const effectiveUserId = role === 'ADMIN' ? (targetUserId ?? userId) : userId;
  const tracker = await svc.get80CTracker(effectiveUserId, fy);
  sendSuccess(res, tracker);
}));

// ─── Advance Tax Calendar (not user-scoped — universal data) ─────────────────

router.get('/advance-tax-calendar', asyncHandler(async (req, res) => {
  const fy = parseFY(req.query.fy);
  const calendar = await svc.getAdvanceTaxCalendar(fy);
  sendSuccess(res, calendar);
}));

// ─── HRA Calculator (pure calculation — not user-scoped) ─────────────────────

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

// ─── Schedule CG: Capital Gains ───────────────────────────────────────────────

const cgEntrySchema = z.object({
  fyYear: z.string().regex(/^\d{4}-\d{2}$/),
  assetName: z.string().min(1),
  assetType: z.enum(['EQUITY_LISTED', 'EQUITY_MUTUAL_FUND', 'DEBT_MUTUAL_FUND', 'PROPERTY', 'BONDS', 'GOLD', 'FOREIGN_EQUITY', 'OTHER']),
  purchaseDate: z.string().datetime(),
  saleDate: z.string().datetime(),
  purchasePrice: z.number().positive(),
  salePrice: z.number().positive(),
  indexedCost: z.number().positive().optional(),
  isListed: z.boolean().optional(),
  isSection112AEligible: z.boolean().optional(),
  isPreApril2023Purchase: z.boolean().optional(),
  foreignTaxPaid: z.number().min(0).optional(),
  exchangeRateAtSale: z.number().positive().optional(),
  investmentId: z.string().optional(),
  notes: z.string().optional(),
});

router.get('/capital-gains', asyncHandler(async (req, res) => {
  const fy = parseFY(req.query.fy);
  const { userId, role } = req.user!;
  const targetUserId = await resolveTargetUserId(req);
  const effectiveUserId = role === 'ADMIN' ? (targetUserId ?? userId) : userId;
  const entries = await cgSvc.listCapitalGains(effectiveUserId, fy);
  sendSuccess(res, entries);
}));

router.get('/capital-gains/summary', asyncHandler(async (req, res) => {
  const fy = parseFY(req.query.fy);
  const { userId, role } = req.user!;
  const targetUserId = await resolveTargetUserId(req);
  const effectiveUserId = role === 'ADMIN' ? (targetUserId ?? userId) : userId;
  const summary = await cgSvc.calcCapitalGainsSummary(effectiveUserId, fy);
  sendSuccess(res, summary);
}));

router.post('/capital-gains', asyncHandler(async (req, res) => {
  const data = cgEntrySchema.parse(req.body);
  const entry = await cgSvc.createCapitalGain(req.user!.userId, data as any);
  sendSuccess(res, entry, 201);
}));

router.put('/capital-gains/:id', asyncHandler(async (req, res) => {
  const data = cgEntrySchema.partial().parse(req.body);
  const entry = await cgSvc.updateCapitalGain(req.user!.userId, req.params.id, data as any);
  if (!entry) { res.status(404).json({ error: 'Not found' }); return; }
  sendSuccess(res, entry);
}));

router.delete('/capital-gains/:id', asyncHandler(async (req, res) => {
  const entry = await cgSvc.deleteCapitalGain(req.user!.userId, req.params.id);
  if (!entry) { res.status(404).json({ error: 'Not found' }); return; }
  sendSuccess(res, { deleted: true });
}));

// ─── Schedule OS: Other Sources ───────────────────────────────────────────────

const osEntrySchema = z.object({
  fyYear: z.string().regex(/^\d{4}-\d{2}$/),
  sourceType: z.enum(['FD_INTEREST', 'RD_INTEREST', 'SAVINGS_INTEREST', 'DIVIDEND', 'GIFT', 'FOREIGN_DIVIDEND', 'OTHER']),
  description: z.string().min(1),
  amount: z.number().positive(),
  tdsDeducted: z.number().min(0).optional(),
  notes: z.string().optional(),
});

router.get('/other-income', asyncHandler(async (req, res) => {
  const fy = parseFY(req.query.fy);
  const { userId, role } = req.user!;
  const targetUserId = await resolveTargetUserId(req);
  const effectiveUserId = role === 'ADMIN' ? (targetUserId ?? userId) : userId;
  const entries = await osSvc.listOtherIncome(effectiveUserId, fy);
  sendSuccess(res, entries);
}));

router.get('/other-income/summary', asyncHandler(async (req, res) => {
  const fy = parseFY(req.query.fy);
  const { userId, role } = req.user!;
  const targetUserId = await resolveTargetUserId(req);
  const effectiveUserId = role === 'ADMIN' ? (targetUserId ?? userId) : userId;
  // Use effectiveUserId for profile lookup so regime reflects the target member's election
  const profile = await svc.getTaxProfile(effectiveUserId, fy);
  const regime = (profile?.regime ?? 'OLD') as 'OLD' | 'NEW';
  const summary = await osSvc.calcOtherIncomeSummary(effectiveUserId, fy, regime);
  sendSuccess(res, summary);
}));

router.post('/other-income', asyncHandler(async (req, res) => {
  const data = osEntrySchema.parse(req.body);
  const entry = await osSvc.createOtherIncome(req.user!.userId, data as any);
  sendSuccess(res, entry, 201);
}));

router.put('/other-income/:id', asyncHandler(async (req, res) => {
  const data = osEntrySchema.partial().parse(req.body);
  const entry = await osSvc.updateOtherIncome(req.user!.userId, req.params.id, data as any);
  if (!entry) { res.status(404).json({ error: 'Not found' }); return; }
  sendSuccess(res, entry);
}));

router.delete('/other-income/:id', asyncHandler(async (req, res) => {
  const entry = await osSvc.deleteOtherIncome(req.user!.userId, req.params.id);
  if (!entry) { res.status(404).json({ error: 'Not found' }); return; }
  sendSuccess(res, { deleted: true });
}));

// ─── Schedule HP: House Property ──────────────────────────────────────────────

const hpEntrySchema = z.object({
  fyYear: z.string().regex(/^\d{4}-\d{2}$/),
  propertyName: z.string().min(1),
  usage: z.enum(['SELF_OCCUPIED', 'LET_OUT', 'DEEMED_LET_OUT']),
  grossAnnualRent: z.number().min(0).optional(),
  municipalTaxesPaid: z.number().min(0).optional(),
  homeLoanInterest: z.number().min(0).optional(),
  isPreConstruction: z.boolean().optional(),
  realEstateId: z.string().optional(),
  notes: z.string().optional(),
});

router.get('/house-property', asyncHandler(async (req, res) => {
  const fy = parseFY(req.query.fy);
  const { userId, role } = req.user!;
  const targetUserId = await resolveTargetUserId(req);
  const effectiveUserId = role === 'ADMIN' ? (targetUserId ?? userId) : userId;
  const entries = await hpSvc.listHouseProperties(effectiveUserId, fy);
  sendSuccess(res, entries);
}));

router.get('/house-property/summary', asyncHandler(async (req, res) => {
  const fy = parseFY(req.query.fy);
  const { userId, role } = req.user!;
  const targetUserId = await resolveTargetUserId(req);
  const effectiveUserId = role === 'ADMIN' ? (targetUserId ?? userId) : userId;
  // Use effectiveUserId for profile lookup so regime reflects the target member's election
  const profile = await svc.getTaxProfile(effectiveUserId, fy);
  const regime = (profile?.regime ?? 'OLD') as 'OLD' | 'NEW';
  const summary = await hpSvc.calcHousePropertyIncome(effectiveUserId, fy, regime);
  sendSuccess(res, summary);
}));

router.post('/house-property', asyncHandler(async (req, res) => {
  const data = hpEntrySchema.parse(req.body);
  const entry = await hpSvc.createHouseProperty(req.user!.userId, data as any);
  sendSuccess(res, entry, 201);
}));

router.put('/house-property/:id', asyncHandler(async (req, res) => {
  const data = hpEntrySchema.partial().parse(req.body);
  const entry = await hpSvc.updateHouseProperty(req.user!.userId, req.params.id, data as any);
  if (!entry) { res.status(404).json({ error: 'Not found' }); return; }
  sendSuccess(res, entry);
}));

router.delete('/house-property/:id', asyncHandler(async (req, res) => {
  const entry = await hpSvc.deleteHouseProperty(req.user!.userId, req.params.id);
  if (!entry) { res.status(404).json({ error: 'Not found' }); return; }
  sendSuccess(res, { deleted: true });
}));

// ─── Schedule FA: Foreign Assets ──────────────────────────────────────────────

const faEntrySchema = z.object({
  fyYear: z.string().regex(/^\d{4}-\d{2}$/),
  category: z.enum(['BANK_ACCOUNT', 'EQUITY_AND_MF', 'DEBT', 'IMMOVABLE_PROPERTY', 'OTHER']),
  country: z.string().min(1),
  assetDescription: z.string().min(1),
  acquisitionCostINR: z.number().min(0),
  peakValueINR: z.number().min(0),
  closingValueINR: z.number().min(0),
  incomeAccruedINR: z.number().min(0).optional(),
  notes: z.string().optional(),
});

router.get('/foreign-assets', asyncHandler(async (req, res) => {
  const fy = parseFY(req.query.fy);
  const { userId, role } = req.user!;
  const targetUserId = await resolveTargetUserId(req);
  const effectiveUserId = role === 'ADMIN' ? (targetUserId ?? userId) : userId;
  const entries = await faSvc.listForeignAssets(effectiveUserId, fy);
  sendSuccess(res, entries);
}));

router.get('/foreign-assets/summary', asyncHandler(async (req, res) => {
  const fy = parseFY(req.query.fy);
  const { userId, role } = req.user!;
  const targetUserId = await resolveTargetUserId(req);
  const effectiveUserId = role === 'ADMIN' ? (targetUserId ?? userId) : userId;
  const summary = await faSvc.getForeignAssetSummary(effectiveUserId, fy);
  sendSuccess(res, summary);
}));

router.post('/foreign-assets', asyncHandler(async (req, res) => {
  const data = faEntrySchema.parse(req.body);
  const entry = await faSvc.createForeignAsset(req.user!.userId, data as any);
  sendSuccess(res, entry, 201);
}));

router.put('/foreign-assets/:id', asyncHandler(async (req, res) => {
  const data = faEntrySchema.partial().parse(req.body);
  const entry = await faSvc.updateForeignAsset(req.user!.userId, req.params.id, data as any);
  if (!entry) { res.status(404).json({ error: 'Not found' }); return; }
  sendSuccess(res, entry);
}));

router.delete('/foreign-assets/:id', asyncHandler(async (req, res) => {
  const entry = await faSvc.deleteForeignAsset(req.user!.userId, req.params.id);
  if (!entry) { res.status(404).json({ error: 'Not found' }); return; }
  sendSuccess(res, { deleted: true });
}));

// ─── ITR-2 Summary ────────────────────────────────────────────────────────────

router.get('/itr2-summary', asyncHandler(async (req, res) => {
  const fy = parseFY(req.query.fy);
  const { userId, role } = req.user!;
  const targetUserId = await resolveTargetUserId(req);
  const effectiveUserId = role === 'ADMIN' ? (targetUserId ?? userId) : userId;
  const summary = await svc.getITR2Summary(effectiveUserId, fy);
  sendSuccess(res, summary);
}));

export default router;
