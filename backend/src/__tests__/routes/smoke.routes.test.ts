/**
 * Smoke tests for remaining backend routes:
 * dashboard, investments, recurring, snapshots, tax, insurance.
 * One happy-path GET per route group to verify auth + service wiring.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'u1', email: 'a@b.com', role: 'ADMIN' };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../services/dashboardService', () => ({
  getDashboardSummary: vi.fn().mockResolvedValue({}),
  getMonthlyCashflow: vi.fn().mockResolvedValue([]),
  getNetWorthTrend: vi.fn().mockResolvedValue([]),
  computeNetWorthStatement: vi.fn().mockResolvedValue({}),
  getProfitAndLoss: vi.fn().mockResolvedValue({}),
  upsertNetWorthSnapshot: vi.fn().mockResolvedValue({}),
  getNetWorthHistory: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../services/investmentService', () => ({
  getPortfolioSummary: vi.fn().mockResolvedValue({ totalValue: 0 }),
  get80CSummary: vi.fn().mockResolvedValue({}),
  getMutualFunds: vi.fn().mockResolvedValue([]),
  getStocks: vi.fn().mockResolvedValue([]),
  getGoldHoldings: vi.fn().mockResolvedValue([]),
  getRealEstateHoldings: vi.fn().mockResolvedValue([]),
  getPPFBalance: vi.fn().mockResolvedValue({}),
  getEPFBalance: vi.fn().mockResolvedValue({}),
  getFDs: vi.fn().mockResolvedValue([]),
  createMutualFund: vi.fn().mockResolvedValue({}),
  updateMutualFund: vi.fn().mockResolvedValue({}),
  deleteMutualFund: vi.fn().mockResolvedValue(undefined),
  createStock: vi.fn().mockResolvedValue({}),
  updateStock: vi.fn().mockResolvedValue({}),
  deleteStock: vi.fn().mockResolvedValue(undefined),
  createGold: vi.fn().mockResolvedValue({}),
  updateGold: vi.fn().mockResolvedValue({}),
  deleteGold: vi.fn().mockResolvedValue(undefined),
  createRealEstate: vi.fn().mockResolvedValue({}),
  updateRealEstate: vi.fn().mockResolvedValue({}),
  deleteRealEstate: vi.fn().mockResolvedValue(undefined),
  updatePPF: vi.fn().mockResolvedValue({}),
  updateEPF: vi.fn().mockResolvedValue({}),
  createFD: vi.fn().mockResolvedValue({}),
  updateFD: vi.fn().mockResolvedValue({}),
  deleteFD: vi.fn().mockResolvedValue(undefined),
  getExchangeRates: vi.fn().mockResolvedValue([]),
  setExchangeRate: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../services/recurringService', () => ({
  listRecurringRules: vi.fn().mockResolvedValue([]),
  createRecurringRule: vi.fn().mockResolvedValue({}),
  updateRecurringRule: vi.fn().mockResolvedValue({}),
  deleteRecurringRule: vi.fn().mockResolvedValue(undefined),
  generateDueRecurringTransactions: vi.fn().mockResolvedValue({ generated: 0 }),
  applyRule: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../services/taxService', () => ({
  getTaxProfile: vi.fn().mockResolvedValue(null),
  upsertTaxProfile: vi.fn().mockResolvedValue({}),
  getTaxSummary: vi.fn().mockResolvedValue({}),
  get80CTracker: vi.fn().mockResolvedValue([]),
  getAdvanceTaxCalendar: vi.fn().mockResolvedValue([]),
  calcHRAExemption: vi.fn().mockReturnValue(0),
  getITR2Summary: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../services/capitalGainsService', () => ({
  listCapitalGains: vi.fn().mockResolvedValue([]),
  calcCapitalGainsSummary: vi.fn().mockResolvedValue({}),
  createCapitalGain: vi.fn().mockResolvedValue({}),
  updateCapitalGain: vi.fn().mockResolvedValue({}),
  deleteCapitalGain: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../services/otherIncomeService', () => ({
  listOtherIncome: vi.fn().mockResolvedValue([]),
  calcOtherIncomeSummary: vi.fn().mockResolvedValue({}),
  createOtherIncome: vi.fn().mockResolvedValue({}),
  updateOtherIncome: vi.fn().mockResolvedValue({}),
  deleteOtherIncome: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../services/housePropertyService', () => ({
  listHouseProperties: vi.fn().mockResolvedValue([]),
  calcHousePropertyIncome: vi.fn().mockResolvedValue({}),
  createHouseProperty: vi.fn().mockResolvedValue({}),
  updateHouseProperty: vi.fn().mockResolvedValue({}),
  deleteHouseProperty: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../services/foreignAssetService', () => ({
  listForeignAssets: vi.fn().mockResolvedValue([]),
  getForeignAssetSummary: vi.fn().mockResolvedValue({}),
  createForeignAsset: vi.fn().mockResolvedValue({}),
  updateForeignAsset: vi.fn().mockResolvedValue({}),
  deleteForeignAsset: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../services/insuranceService', () => ({
  getInsurancePolicies: vi.fn().mockResolvedValue([]),
  getPremiumCalendar: vi.fn().mockResolvedValue([]),
  get80DSummary: vi.fn().mockResolvedValue({}),
  createPolicy: vi.fn().mockResolvedValue({}),
  updatePolicy: vi.fn().mockResolvedValue({}),
  deletePolicy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../config/prisma', () => {
  const prisma = {
    user: { findFirst: vi.fn().mockResolvedValue({ id: 'u1' }) },
  };
  return { default: prisma, prisma };
});

import dashboardRouter from '../../routes/dashboard';
import investmentsRouter from '../../routes/investments';
import recurringRouter from '../../routes/recurring';
import snapshotsRouter from '../../routes/snapshots';
import taxRouter from '../../routes/tax';
import insuranceRouter from '../../routes/insurance';
import { makeApp } from '../helpers/makeApp';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Dashboard ────────────────────────────────────────────────────────────────

describe('Dashboard routes — smoke', () => {
  const app = makeApp(dashboardRouter, '/api/dashboard');

  it('GET /api/dashboard/summary returns 200', async () => {
    const { getDashboardSummary } = await import('../../services/dashboardService');
    (getDashboardSummary as ReturnType<typeof vi.fn>).mockResolvedValue({ income: 0, expense: 0 });
    const res = await request(app).get('/api/dashboard/summary');
    expect(res.status).toBe(200);
  });
});

// ─── Investments ──────────────────────────────────────────────────────────────

describe('Investments routes — smoke', () => {
  const app = makeApp(investmentsRouter, '/api/investments');

  it('GET /api/investments/portfolio-summary returns 200', async () => {
    const res = await request(app).get('/api/investments/portfolio-summary');
    expect(res.status).toBe(200);
  });
});

// ─── Recurring ────────────────────────────────────────────────────────────────

describe('Recurring routes — smoke', () => {
  const app = makeApp(recurringRouter, '/api/recurring');

  it('GET /api/recurring returns 200', async () => {
    const res = await request(app).get('/api/recurring');
    expect(res.status).toBe(200);
  });
});

// ─── Snapshots ────────────────────────────────────────────────────────────────

describe('Snapshots routes — smoke', () => {
  const app = makeApp(snapshotsRouter, '/api/snapshots/net-worth');

  it('GET /api/snapshots/net-worth returns 200', async () => {
    const res = await request(app).get('/api/snapshots/net-worth');
    expect(res.status).toBe(200);
  });
});

// ─── Tax ──────────────────────────────────────────────────────────────────────

describe('Tax routes — smoke', () => {
  const app = makeApp(taxRouter, '/api/tax');

  it('GET /api/tax/profile returns 200', async () => {
    const res = await request(app).get('/api/tax/profile');
    expect(res.status).toBe(200);
  });

  it('GET /api/tax/capital-gains returns 200', async () => {
    const res = await request(app).get('/api/tax/capital-gains');
    expect(res.status).toBe(200);
  });
});

// ─── Insurance ────────────────────────────────────────────────────────────────

describe('Insurance routes — smoke', () => {
  const app = makeApp(insuranceRouter, '/api/insurance');

  it('GET /api/insurance returns 200', async () => {
    const res = await request(app).get('/api/insurance');
    expect(res.status).toBe(200);
  });
});
