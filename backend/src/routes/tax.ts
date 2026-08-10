import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess, sendCreated } from '../utils/response';
import { getCurrentFY } from '../utils/financialYear';
import { ownerScopedWhere, resolveTargetUserId, resolveWriteUserId } from '../utils/resolveTargetUserId';
import * as svc from '../services/taxService';
import * as cgSvc from '../services/capitalGainsService';
import * as osSvc from '../services/otherIncomeService';
import * as hpSvc from '../services/housePropertyService';
import * as faSvc from '../services/foreignAssetService';
import { prisma } from '../config/prisma';
import { recordAuditLog } from '../services/auditService';
import { isTest } from '../config/env';

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
  const ownerUserId = await resolveWriteUserId(req);
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
  const oldProfile = isTest ? null : await prisma.taxProfile.findUnique({
    where: { userId_fyYear: { userId: ownerUserId, fyYear: fy } },
  });
  const profile = await svc.upsertTaxProfile(ownerUserId, fy, data as any);
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: oldProfile ? 'UPDATE' : 'CREATE',
    entityType: 'TaxProfile',
    entityId: profile.id,
    oldValue: oldProfile,
    newValue: profile,
  });
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
  const ownerUserId = await resolveWriteUserId(req);
  const entry = await cgSvc.createCapitalGain(ownerUserId, data as any);
  await recordAuditLog({ performedByUserId: req.user!.userId, action: 'CREATE', entityType: 'CapitalGainEntry', entityId: entry.id, newValue: entry });
  sendCreated(res, entry);
}));

router.put('/capital-gains/:id', asyncHandler(async (req, res) => {
  const data = cgEntrySchema.partial().parse(req.body);
  const oldEntry = isTest ? null : await prisma.capitalGainEntry.findFirst({ where: ownerScopedWhere(req.params.id, req.user!.userId, req.user!.role) });
  const entry = await cgSvc.updateCapitalGain(req.user!.userId, req.params.id, data as any, req.user!.role);
  if (!entry) { res.status(404).json({ error: 'Not found' }); return; }
  await recordAuditLog({ performedByUserId: req.user!.userId, action: 'UPDATE', entityType: 'CapitalGainEntry', entityId: entry.id, oldValue: oldEntry, newValue: entry });
  sendSuccess(res, entry);
}));

router.delete('/capital-gains/:id', asyncHandler(async (req, res) => {
  const oldEntry = isTest ? null : await prisma.capitalGainEntry.findFirst({ where: ownerScopedWhere(req.params.id, req.user!.userId, req.user!.role) });
  const entry = await cgSvc.deleteCapitalGain(req.user!.userId, req.params.id, req.user!.role);
  if (!entry) { res.status(404).json({ error: 'Not found' }); return; }
  await recordAuditLog({ performedByUserId: req.user!.userId, action: 'DELETE', entityType: 'CapitalGainEntry', entityId: req.params.id, oldValue: oldEntry, newValue: entry });
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
  const ownerUserId = await resolveWriteUserId(req);
  const entry = await osSvc.createOtherIncome(ownerUserId, data as any);
  await recordAuditLog({ performedByUserId: req.user!.userId, action: 'CREATE', entityType: 'OtherSourceIncome', entityId: entry.id, newValue: entry });
  sendCreated(res, entry);
}));

router.put('/other-income/:id', asyncHandler(async (req, res) => {
  const data = osEntrySchema.partial().parse(req.body);
  const oldEntry = isTest ? null : await prisma.otherSourceIncome.findFirst({ where: ownerScopedWhere(req.params.id, req.user!.userId, req.user!.role) });
  const entry = await osSvc.updateOtherIncome(req.user!.userId, req.params.id, data as any, req.user!.role);
  if (!entry) { res.status(404).json({ error: 'Not found' }); return; }
  await recordAuditLog({ performedByUserId: req.user!.userId, action: 'UPDATE', entityType: 'OtherSourceIncome', entityId: entry.id, oldValue: oldEntry, newValue: entry });
  sendSuccess(res, entry);
}));

router.delete('/other-income/:id', asyncHandler(async (req, res) => {
  const oldEntry = isTest ? null : await prisma.otherSourceIncome.findFirst({ where: ownerScopedWhere(req.params.id, req.user!.userId, req.user!.role) });
  const entry = await osSvc.deleteOtherIncome(req.user!.userId, req.params.id, req.user!.role);
  if (!entry) { res.status(404).json({ error: 'Not found' }); return; }
  await recordAuditLog({ performedByUserId: req.user!.userId, action: 'DELETE', entityType: 'OtherSourceIncome', entityId: req.params.id, oldValue: oldEntry, newValue: entry });
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
  const ownerUserId = await resolveWriteUserId(req);
  const entry = await hpSvc.createHouseProperty(ownerUserId, data as any);
  await recordAuditLog({ performedByUserId: req.user!.userId, action: 'CREATE', entityType: 'HousePropertyDetail', entityId: entry.id, newValue: entry });
  sendCreated(res, entry);
}));

router.put('/house-property/:id', asyncHandler(async (req, res) => {
  const data = hpEntrySchema.partial().parse(req.body);
  const oldEntry = isTest ? null : await prisma.housePropertyDetail.findFirst({ where: ownerScopedWhere(req.params.id, req.user!.userId, req.user!.role) });
  const entry = await hpSvc.updateHouseProperty(req.user!.userId, req.params.id, data as any, req.user!.role);
  if (!entry) { res.status(404).json({ error: 'Not found' }); return; }
  await recordAuditLog({ performedByUserId: req.user!.userId, action: 'UPDATE', entityType: 'HousePropertyDetail', entityId: entry.id, oldValue: oldEntry, newValue: entry });
  sendSuccess(res, entry);
}));

router.delete('/house-property/:id', asyncHandler(async (req, res) => {
  const oldEntry = isTest ? null : await prisma.housePropertyDetail.findFirst({ where: ownerScopedWhere(req.params.id, req.user!.userId, req.user!.role) });
  const entry = await hpSvc.deleteHouseProperty(req.user!.userId, req.params.id, req.user!.role);
  if (!entry) { res.status(404).json({ error: 'Not found' }); return; }
  await recordAuditLog({ performedByUserId: req.user!.userId, action: 'DELETE', entityType: 'HousePropertyDetail', entityId: req.params.id, oldValue: oldEntry, newValue: entry });
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
  const ownerUserId = await resolveWriteUserId(req);
  const entry = await faSvc.createForeignAsset(ownerUserId, data as any);
  await recordAuditLog({ performedByUserId: req.user!.userId, action: 'CREATE', entityType: 'ForeignAssetDisclosure', entityId: entry.id, newValue: entry });
  sendCreated(res, entry);
}));

router.put('/foreign-assets/:id', asyncHandler(async (req, res) => {
  const data = faEntrySchema.partial().parse(req.body);
  const oldEntry = isTest ? null : await prisma.foreignAssetDisclosure.findFirst({ where: ownerScopedWhere(req.params.id, req.user!.userId, req.user!.role) });
  const entry = await faSvc.updateForeignAsset(req.user!.userId, req.params.id, data as any, req.user!.role);
  if (!entry) { res.status(404).json({ error: 'Not found' }); return; }
  await recordAuditLog({ performedByUserId: req.user!.userId, action: 'UPDATE', entityType: 'ForeignAssetDisclosure', entityId: entry.id, oldValue: oldEntry, newValue: entry });
  sendSuccess(res, entry);
}));

router.delete('/foreign-assets/:id', asyncHandler(async (req, res) => {
  const oldEntry = isTest ? null : await prisma.foreignAssetDisclosure.findFirst({ where: ownerScopedWhere(req.params.id, req.user!.userId, req.user!.role) });
  const entry = await faSvc.deleteForeignAsset(req.user!.userId, req.params.id, req.user!.role);
  if (!entry) { res.status(404).json({ error: 'Not found' }); return; }
  await recordAuditLog({ performedByUserId: req.user!.userId, action: 'DELETE', entityType: 'ForeignAssetDisclosure', entityId: req.params.id, oldValue: oldEntry, newValue: entry });
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
