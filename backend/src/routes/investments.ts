import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess, sendCreated, sendNoContent, sendPaginated } from '../utils/response';
import { getCurrentFY } from '../utils/financialYear';
import { resolveTargetUserId, resolveWriteUserId } from '../utils/resolveTargetUserId';
import * as svc from '../services/investmentService';
import { recordAuditLog } from '../services/auditService';

function parseFY(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  return /^\d{4}-\d{2}$/.test(s) ? s : getCurrentFY();
}

const router = Router();
router.use(requireAuth);

// ─── Portfolio ────────────────────────────────────────────────────────────────

router.get('/portfolio-summary', asyncHandler(async (req, res) => {
  const targetUserId = await resolveTargetUserId(req, { paramName: 'userId' });
  const summary = await svc.getPortfolioSummary(targetUserId, req.user!.userId, req.user!.role);
  sendSuccess(res, summary);
}));

router.get('/80c-summary', asyncHandler(async (req, res) => {
  const fy = parseFY(req.query.fy);
  const targetUserId = await resolveTargetUserId(req, { paramName: 'userId' });
  const summary = await svc.get80CSummary(targetUserId, fy, req.user!.userId, req.user!.role);
  sendSuccess(res, summary);
}));

// ─── Exchange Rates ───────────────────────────────────────────────────────────

router.get('/exchange-rates', asyncHandler(async (_req, res) => {
  const rates = await svc.getExchangeRates();
  sendSuccess(res, rates);
}));

router.put('/exchange-rates/:currency', requireAdmin, asyncHandler(async (req, res) => {
  const { currency } = req.params;
  const { rate } = z.object({ rate: z.number().positive() }).parse(req.body);
  const oldRate = await svc.getExchangeRateForAudit(currency.toUpperCase());
  const updated = await svc.upsertExchangeRate(currency.toUpperCase(), rate, req.user!.userId);
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: oldRate ? 'UPDATE' : 'CREATE',
    entityType: 'ExchangeRate',
    entityId: updated.id,
    oldValue: oldRate,
    newValue: updated,
  });
  sendSuccess(res, updated);
}));

// ─── FDs ──────────────────────────────────────────────────────────────────────

const fdSchema = z.object({
  bankName: z.string().min(1),
  bankAccountId: z.string().optional(),
  principalAmount: z.number().positive(),
  interestRate: z.number().positive(),
  tenureMonths: z.number().int().positive(),
  startDate: z.string().transform((s) => new Date(s)),
  maturityDate: z.string().transform((s) => new Date(s)),
  interestPayoutType: z.enum(['CUMULATIVE', 'MONTHLY', 'QUARTERLY']).default('CUMULATIVE'),
  isTaxSaver: z.boolean().default(false),
  tdsApplicable: z.boolean().default(true),
  status: z.enum(['ACTIVE', 'MATURED', 'BROKEN']).default('ACTIVE'),
  notes: z.string().optional(),
});

router.get('/fd', asyncHandler(async (req, res) => {
  const status = req.query.status as any;
  const targetUserId = await resolveTargetUserId(req, { paramName: 'userId' });
  const fds = await svc.getFDs(targetUserId, req.user!.userId, req.user!.role, status);
  sendSuccess(res, fds);
}));

router.get('/fd/maturing-soon', asyncHandler(async (req, res) => {
  const days = Number(req.query.days ?? 30);
  const fds = await svc.getFDsMaturing(req.user!.userId, days);
  sendSuccess(res, fds);
}));

router.post('/fd', asyncHandler(async (req, res) => {
  const data = fdSchema.parse(req.body);
  const ownerUserId = await resolveWriteUserId(req);
  const fd = await svc.createFD(ownerUserId, data as any);
  await recordAuditLog({ performedByUserId: req.user!.userId, action: 'CREATE', entityType: 'FixedDeposit', entityId: fd.id, newValue: fd });
  sendCreated(res, fd);
}));

router.put('/fd/:id', asyncHandler(async (req, res) => {
  const data = fdSchema.partial().parse(req.body);
  const oldFd = await svc.getFDForAudit(req.user!.userId, req.params.id, req.user!.role);
  const fd = await svc.updateFD(req.user!.userId, req.params.id, data as any, req.user!.role);
  await recordAuditLog({ performedByUserId: req.user!.userId, action: 'UPDATE', entityType: 'FixedDeposit', entityId: fd.id, oldValue: oldFd, newValue: fd });
  sendSuccess(res, fd);
}));

router.delete('/fd/:id', asyncHandler(async (req, res) => {
  const oldFd = await svc.getFDForAudit(req.user!.userId, req.params.id, req.user!.role);
  const fd = await svc.deleteFD(req.user!.userId, req.params.id, req.user!.role);
  await recordAuditLog({ performedByUserId: req.user!.userId, action: 'DELETE', entityType: 'FixedDeposit', entityId: fd?.id ?? req.params.id, oldValue: oldFd });
  sendNoContent(res);
}));

// ─── RDs ──────────────────────────────────────────────────────────────────────

const rdSchema = z.object({
  bankName: z.string().min(1),
  bankAccountId: z.string().optional(),
  monthlyInstallment: z.number().positive(),
  interestRate: z.number().positive(),
  tenureMonths: z.number().int().positive(),
  startDate: z.string().transform((s) => new Date(s)),
  maturityDate: z.string().transform((s) => new Date(s)),
  status: z.enum(['ACTIVE', 'MATURED', 'CLOSED']).default('ACTIVE'),
  notes: z.string().optional(),
});

router.get('/rd', asyncHandler(async (req, res) => {
  const status = req.query.status as any;
  const targetUserId = await resolveTargetUserId(req, { paramName: 'userId' });
  const rds = await svc.getRDs(targetUserId, req.user!.userId, req.user!.role, status);
  sendSuccess(res, rds);
}));

router.post('/rd', asyncHandler(async (req, res) => {
  const data = rdSchema.parse(req.body);
  const ownerUserId = await resolveWriteUserId(req);
  const rd = await svc.createRD(ownerUserId, data as any);
  await recordAuditLog({ performedByUserId: req.user!.userId, action: 'CREATE', entityType: 'RecurringDeposit', entityId: rd.id, newValue: rd });
  sendCreated(res, rd);
}));

router.put('/rd/:id', asyncHandler(async (req, res) => {
  const data = rdSchema.partial().parse(req.body);
  const oldRd = await svc.getRDForAudit(req.user!.userId, req.params.id, req.user!.role);
  const rd = await svc.updateRD(req.user!.userId, req.params.id, data as any, req.user!.role);
  await recordAuditLog({ performedByUserId: req.user!.userId, action: 'UPDATE', entityType: 'RecurringDeposit', entityId: rd.id, oldValue: oldRd, newValue: rd });
  sendSuccess(res, rd);
}));

router.delete('/rd/:id', asyncHandler(async (req, res) => {
  const oldRd = await svc.getRDForAudit(req.user!.userId, req.params.id, req.user!.role);
  const rd = await svc.deleteRD(req.user!.userId, req.params.id, req.user!.role);
  await recordAuditLog({ performedByUserId: req.user!.userId, action: 'DELETE', entityType: 'RecurringDeposit', entityId: rd?.id ?? req.params.id, oldValue: oldRd });
  sendNoContent(res);
}));

// ─── SIPs ─────────────────────────────────────────────────────────────────────

const sipSchema = z.object({
  investmentId: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().optional(),
  ),
  fundName: z.string().min(1),
  folioNumber: z.string().optional(),
  monthlyAmount: z.number().positive(),
  sipDate: z.number().int().min(1).max(28),
  startDate: z.string().transform((s) => new Date(s)),
  endDate: z.string().transform((s) => new Date(s)).optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'STOPPED']).default('ACTIVE'),
  bankAccountId: z.string().optional(),
});

router.get('/sip', asyncHandler(async (req, res) => {
  const status = req.query.status as any;
  const targetUserId = await resolveTargetUserId(req, { paramName: 'userId' });
  const effectiveUserId = req.user!.role === 'ADMIN' ? (targetUserId ?? req.user!.userId) : req.user!.userId;
  const sips = await svc.getSIPs(effectiveUserId, status, req.user!.role);
  sendSuccess(res, sips);
}));

router.get('/sip/upcoming', asyncHandler(async (req, res) => {
  const days = Number(req.query.days ?? 7);
  const sips = await svc.getSIPsUpcoming(req.user!.userId, days);
  sendSuccess(res, sips);
}));

router.post('/sip', asyncHandler(async (req, res) => {
  const data = sipSchema.parse(req.body);
  const ownerUserId = await resolveWriteUserId(req);
  const sip = await svc.createSIP(ownerUserId, data as any);
  await recordAuditLog({ performedByUserId: req.user!.userId, action: 'CREATE', entityType: 'SIP', entityId: sip.id, newValue: sip });
  sendCreated(res, sip);
}));

router.put('/sip/:id', asyncHandler(async (req, res) => {
  const data = sipSchema.partial().parse(req.body);
  const oldSip = await svc.getSIPForAudit(req.user!.userId, req.params.id, req.user!.role);
  const sip = await svc.updateSIP(req.user!.userId, req.params.id, data as any, req.user!.role);
  await recordAuditLog({ performedByUserId: req.user!.userId, action: 'UPDATE', entityType: 'SIP', entityId: sip.id, oldValue: oldSip, newValue: sip });
  sendSuccess(res, sip);
}));

router.delete('/sip/:id', asyncHandler(async (req, res) => {
  const oldSip = await svc.getSIPForAudit(req.user!.userId, req.params.id, req.user!.role);
  const sip = await svc.deleteSIP(req.user!.userId, req.params.id, req.user!.role);
  await recordAuditLog({ performedByUserId: req.user!.userId, action: 'DELETE', entityType: 'SIP', entityId: sip?.id ?? req.params.id, oldValue: oldSip });
  sendNoContent(res);
}));

router.post('/sip/:id/transactions', asyncHandler(async (req, res) => {
  const body = z.object({
    date: z.string().transform((s) => new Date(s)),
    units: z.number().positive(),
    nav: z.number().positive(),
    amount: z.number().positive(),
    type: z.enum(['BUY', 'SELL', 'DIVIDEND']).default('BUY'),
  }).parse(req.body);
  const tx = await svc.addSIPTransaction(req.user!.userId, req.params.id, body, req.user!.role);
  await recordAuditLog({ performedByUserId: req.user!.userId, action: 'CREATE', entityType: 'SIPTransaction', entityId: tx.id, newValue: tx });
  sendCreated(res, tx);
}));

// ─── Investments ──────────────────────────────────────────────────────────────

const investmentSchema = z.object({
  type: z.enum(['STOCKS_INDIA', 'STOCKS_FOREIGN', 'MUTUAL_FUND', 'ELSS', 'PPF', 'NPS', 'EPF', 'SGB', 'GOLD_ETF', 'BONDS', 'CRYPTO', 'OTHER']),
  name: z.string().min(1),
  folioNumber: z.string().optional(),
  isin: z.string().optional(),
  tickerSymbolNSE: z.string().optional(),
  tickerSymbolBSE: z.string().optional(),
  tickerSymbolForeign: z.string().optional(),
  exchange: z.enum(['NSE', 'BSE', 'NYSE', 'NASDAQ', 'LSE', 'SGX', 'OTHER']).optional(),
  currency: z.string().default('INR'),
  unitsOrQuantity: z.number().positive(),
  purchasePricePerUnit: z.number().positive(),
  purchaseDate: z.string().transform((s) => new Date(s)),
  purchaseNav: z.number().optional(),
  purchaseExchangeRate: z.number().optional(),
  currentPricePerUnit: z.number().positive(),
  currentNav: z.number().optional(),
  isTaxSaving: z.boolean().default(false),
  lockInEndDate: z.string().transform((s) => new Date(s)).optional(),
  notes: z.string().optional(),
});

router.get('/', asyncHandler(async (req, res) => {
  const type = req.query.type as any;
  const targetUserId = await resolveTargetUserId(req, { paramName: 'userId' });
  const effectiveUserId = req.user!.role === 'ADMIN' ? (targetUserId ?? req.user!.userId) : req.user!.userId;
  const rawPage = Number(req.query.page);
  const rawSize = Number(req.query.pageSize);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const pageSize = Number.isFinite(rawSize) && rawSize >= 1 ? Math.min(100, Math.floor(rawSize)) : 25;
  const { items, pagination } = await svc.getInvestments(effectiveUserId, type, page, pageSize, req.user!.role);
  sendPaginated(res, items, pagination);
}));

router.post('/', asyncHandler(async (req, res) => {
  const data = investmentSchema.parse(req.body);
  const ownerUserId = await resolveWriteUserId(req);
  const inv = await svc.createInvestment(ownerUserId, data as any);
  await recordAuditLog({ performedByUserId: req.user!.userId, action: 'CREATE', entityType: 'Investment', entityId: inv.id, newValue: inv });
  sendCreated(res, inv);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const data = investmentSchema.partial().parse(req.body);
  const oldInv = await svc.getInvestmentForAudit(req.user!.userId, req.params.id, req.user!.role);
  const inv = await svc.updateInvestment(req.user!.userId, req.params.id, data as any, req.user!.role);
  await recordAuditLog({ performedByUserId: req.user!.userId, action: 'UPDATE', entityType: 'Investment', entityId: inv.id, oldValue: oldInv, newValue: inv });
  sendSuccess(res, inv);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const oldInv = await svc.getInvestmentForAudit(req.user!.userId, req.params.id, req.user!.role);
  const inv = await svc.deleteInvestment(req.user!.userId, req.params.id, req.user!.role);
  await recordAuditLog({ performedByUserId: req.user!.userId, action: 'DELETE', entityType: 'Investment', entityId: inv?.id ?? req.params.id, oldValue: oldInv });
  sendNoContent(res);
}));

// ─── Gold ─────────────────────────────────────────────────────────────────────

const goldSchema = z.object({
  type: z.enum(['PHYSICAL', 'SGB', 'GOLD_ETF', 'DIGITAL']),
  description: z.string().optional(),
  quantityGrams: z.number().positive(),
  purchasePricePerGram: z.number().positive(),
  currentPricePerGram: z.number().positive(),
  purchaseDate: z.string().transform((s) => new Date(s)),
  notes: z.string().optional(),
});

router.get('/gold', asyncHandler(async (req, res) => {
  const targetUserId = await resolveTargetUserId(req, { paramName: 'userId' });
  const data = await svc.getGoldHoldings(targetUserId, req.user!.userId, req.user!.role);
  sendSuccess(res, data);
}));

router.post('/gold', asyncHandler(async (req, res) => {
  const data = goldSchema.parse(req.body);
  const ownerUserId = await resolveWriteUserId(req);
  const holding = await svc.createGoldHolding(ownerUserId, data as any);
  await recordAuditLog({ performedByUserId: req.user!.userId, action: 'CREATE', entityType: 'GoldHolding', entityId: holding.id, newValue: holding });
  sendCreated(res, holding);
}));

router.put('/gold/:id', asyncHandler(async (req, res) => {
  const data = goldSchema.partial().parse(req.body);
  const oldHolding = await svc.getGoldHoldingForAudit(req.user!.userId, req.params.id, req.user!.role);
  const holding = await svc.updateGoldHolding(req.user!.userId, req.params.id, data as any, req.user!.role);
  await recordAuditLog({ performedByUserId: req.user!.userId, action: 'UPDATE', entityType: 'GoldHolding', entityId: holding.id, oldValue: oldHolding, newValue: holding });
  sendSuccess(res, holding);
}));

router.delete('/gold/:id', asyncHandler(async (req, res) => {
  const oldHolding = await svc.getGoldHoldingForAudit(req.user!.userId, req.params.id, req.user!.role);
  const holding = await svc.deleteGoldHolding(req.user!.userId, req.params.id, req.user!.role);
  await recordAuditLog({ performedByUserId: req.user!.userId, action: 'DELETE', entityType: 'GoldHolding', entityId: holding?.id ?? req.params.id, oldValue: oldHolding });
  sendNoContent(res);
}));

// ─── Real Estate ──────────────────────────────────────────────────────────────

const reOwnerSchema = z.object({
  userId: z.string().min(1),
  sharePercent: z.number().positive().max(100),
});

const reSchema = z.object({
  propertyType: z.enum(['RESIDENTIAL', 'COMMERCIAL', 'LAND', 'PLOT']),
  propertyName: z.string().min(1),
  location: z.string().min(1),
  purchasePrice: z.number().positive(),
  currentValue: z.number().positive(),
  purchaseDate: z.string().transform((s) => new Date(s)),
  loanId: z.string().optional(),
  rentalIncomeMonthly: z.number().optional(),
  notes: z.string().optional(),
  owners: z.array(reOwnerSchema).min(1).optional(),
});

router.get('/real-estate', asyncHandler(async (req, res) => {
  const targetUserId = await resolveTargetUserId(req, { paramName: 'userId' });
  const data = await svc.getRealEstate(targetUserId, req.user!.userId, req.user!.role);
  sendSuccess(res, data);
}));

router.post('/real-estate', asyncHandler(async (req, res) => {
  const data = reSchema.parse(req.body);
  const ownerUserId = await resolveWriteUserId(req);
  const prop = await svc.createRealEstate(ownerUserId, data as any);
  await recordAuditLog({ performedByUserId: req.user!.userId, action: 'CREATE', entityType: 'RealEstate', entityId: prop.id, newValue: prop });
  sendCreated(res, prop);
}));

router.put('/real-estate/:id', asyncHandler(async (req, res) => {
  const data = reSchema.partial().parse(req.body);
  const oldProp = await svc.getRealEstateForAudit(req.user!.userId, req.params.id, req.user!.role);
  const prop = await svc.updateRealEstate(req.user!.userId, req.params.id, data as any, req.user!.role);
  await recordAuditLog({ performedByUserId: req.user!.userId, action: 'UPDATE', entityType: 'RealEstate', entityId: prop.id, oldValue: oldProp, newValue: prop });
  sendSuccess(res, prop);
}));

router.delete('/real-estate/:id', asyncHandler(async (req, res) => {
  const oldProp = await svc.getRealEstateForAudit(req.user!.userId, req.params.id, req.user!.role);
  const prop = await svc.deleteRealEstate(req.user!.userId, req.params.id, req.user!.role);
  await recordAuditLog({ performedByUserId: req.user!.userId, action: 'DELETE', entityType: 'RealEstate', entityId: prop?.id ?? req.params.id, oldValue: oldProp });
  sendNoContent(res);
}));

export default router;
