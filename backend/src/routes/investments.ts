import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess, sendCreated, sendNoContent, sendPaginated } from '../utils/response';
import { getCurrentFY } from '../utils/financialYear';
import { resolveTargetUserId } from '../utils/resolveTargetUserId';
import * as svc from '../services/investmentService';

function parseFY(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  return /^\d{4}-\d{2}$/.test(s) ? s : getCurrentFY();
}

const router = Router();
router.use(requireAuth);

// ─── Portfolio ────────────────────────────────────────────────────────────────

router.get('/portfolio-summary', asyncHandler(async (req, res) => {
  const summary = await svc.getPortfolioSummary(req.user!.userId);
  sendSuccess(res, summary);
}));

router.get('/80c-summary', asyncHandler(async (req, res) => {
  const fy = parseFY(req.query.fy);
  const summary = await svc.get80CSummary(req.user!.userId, fy);
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
  const updated = await svc.upsertExchangeRate(currency.toUpperCase(), rate, req.user!.userId);
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
  const fd = await svc.createFD(req.user!.userId, data as any);
  sendCreated(res, fd);
}));

router.put('/fd/:id', asyncHandler(async (req, res) => {
  const data = fdSchema.partial().parse(req.body);
  const fd = await svc.updateFD(req.user!.userId, req.params.id, data as any);
  sendSuccess(res, fd);
}));

router.delete('/fd/:id', asyncHandler(async (req, res) => {
  await svc.deleteFD(req.user!.userId, req.params.id);
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
  const rd = await svc.createRD(req.user!.userId, data as any);
  sendCreated(res, rd);
}));

router.put('/rd/:id', asyncHandler(async (req, res) => {
  const data = rdSchema.partial().parse(req.body);
  const rd = await svc.updateRD(req.user!.userId, req.params.id, data as any);
  sendSuccess(res, rd);
}));

router.delete('/rd/:id', asyncHandler(async (req, res) => {
  await svc.deleteRD(req.user!.userId, req.params.id);
  sendNoContent(res);
}));

// ─── SIPs ─────────────────────────────────────────────────────────────────────

const sipSchema = z.object({
  investmentId: z.string(),
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
  const sips = await svc.getSIPs(req.user!.userId, status);
  sendSuccess(res, sips);
}));

router.get('/sip/upcoming', asyncHandler(async (req, res) => {
  const days = Number(req.query.days ?? 7);
  const sips = await svc.getSIPsUpcoming(req.user!.userId, days);
  sendSuccess(res, sips);
}));

router.post('/sip', asyncHandler(async (req, res) => {
  const data = sipSchema.parse(req.body);
  const sip = await svc.createSIP(req.user!.userId, data as any);
  sendCreated(res, sip);
}));

router.put('/sip/:id', asyncHandler(async (req, res) => {
  const data = sipSchema.partial().parse(req.body);
  const sip = await svc.updateSIP(req.user!.userId, req.params.id, data as any);
  sendSuccess(res, sip);
}));

router.delete('/sip/:id', asyncHandler(async (req, res) => {
  await svc.deleteSIP(req.user!.userId, req.params.id);
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
  const tx = await svc.addSIPTransaction(req.user!.userId, req.params.id, body);
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
  const rawPage = Number(req.query.page);
  const rawSize = Number(req.query.pageSize);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const pageSize = Number.isFinite(rawSize) && rawSize >= 1 ? Math.min(100, Math.floor(rawSize)) : 25;
  const { items, pagination } = await svc.getInvestments(req.user!.userId, type, page, pageSize);
  sendPaginated(res, items, pagination);
}));

router.post('/', asyncHandler(async (req, res) => {
  const data = investmentSchema.parse(req.body);
  const inv = await svc.createInvestment(req.user!.userId, data as any);
  sendCreated(res, inv);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const data = investmentSchema.partial().parse(req.body);
  const inv = await svc.updateInvestment(req.user!.userId, req.params.id, data as any);
  sendSuccess(res, inv);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await svc.deleteInvestment(req.user!.userId, req.params.id);
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
  const holding = await svc.createGoldHolding(req.user!.userId, data as any);
  sendCreated(res, holding);
}));

router.put('/gold/:id', asyncHandler(async (req, res) => {
  const data = goldSchema.partial().parse(req.body);
  const holding = await svc.updateGoldHolding(req.user!.userId, req.params.id, data as any);
  sendSuccess(res, holding);
}));

router.delete('/gold/:id', asyncHandler(async (req, res) => {
  await svc.deleteGoldHolding(req.user!.userId, req.params.id);
  sendNoContent(res);
}));

// ─── Real Estate ──────────────────────────────────────────────────────────────

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
});

router.get('/real-estate', asyncHandler(async (req, res) => {
  const targetUserId = await resolveTargetUserId(req, { paramName: 'userId' });
  const data = await svc.getRealEstate(targetUserId, req.user!.userId, req.user!.role);
  sendSuccess(res, data);
}));

router.post('/real-estate', asyncHandler(async (req, res) => {
  const data = reSchema.parse(req.body);
  const prop = await svc.createRealEstate(req.user!.userId, data as any);
  sendCreated(res, prop);
}));

router.put('/real-estate/:id', asyncHandler(async (req, res) => {
  const data = reSchema.partial().parse(req.body);
  const prop = await svc.updateRealEstate(req.user!.userId, req.params.id, data as any);
  sendSuccess(res, prop);
}));

router.delete('/real-estate/:id', asyncHandler(async (req, res) => {
  await svc.deleteRealEstate(req.user!.userId, req.params.id);
  sendNoContent(res);
}));

export default router;
