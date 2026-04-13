/**
 * Route integration tests for /api/tax.
 *
 * Covers:
 *   - Happy-path: profile, summary, 80c-tracker, advance-tax-calendar, hra-calculator,
 *     capital-gains (CG), other-income (OS), house-property (HP),
 *     foreign-assets (FA), itr2-summary
 *   - Per-member scoping: 12 GET endpoints × 6 role/access scenarios = 72 tests
 *   - Write regression: POST/PUT/DELETE always scoped to req.user!.userId
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { errorHandler } from '../../middleware/errorHandler';

const ADMIN_USER = { userId: 'admin-id', email: 'admin@example.com', role: 'ADMIN' as const };
const MEMBER_USER = { userId: 'member-id', email: 'member@example.com', role: 'MEMBER' as const };

// ─── Module mocks (hoisted) ────────────────────────────────────────────────────

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = (req as any).__testUser ?? ADMIN_USER;
    next();
  },
}));

vi.mock('../../config/prisma', () => {
  const prisma = { user: { findFirst: vi.fn() } };
  return { default: prisma, prisma };
});

vi.mock('../../services/taxService', () => ({
  getTaxProfile: vi.fn(),
  upsertTaxProfile: vi.fn(),
  getTaxSummary: vi.fn(),
  get80CTracker: vi.fn(),
  getAdvanceTaxCalendar: vi.fn(),
  calcHRAExemption: vi.fn(),
  getITR2Summary: vi.fn(),
}));

vi.mock('../../services/capitalGainsService', () => ({
  listCapitalGains: vi.fn(),
  calcCapitalGainsSummary: vi.fn(),
  createCapitalGain: vi.fn(),
  updateCapitalGain: vi.fn(),
  deleteCapitalGain: vi.fn(),
}));

vi.mock('../../services/otherIncomeService', () => ({
  listOtherIncome: vi.fn(),
  calcOtherIncomeSummary: vi.fn(),
  createOtherIncome: vi.fn(),
  updateOtherIncome: vi.fn(),
  deleteOtherIncome: vi.fn(),
}));

vi.mock('../../services/housePropertyService', () => ({
  listHouseProperties: vi.fn(),
  calcHousePropertyIncome: vi.fn(),
  createHouseProperty: vi.fn(),
  updateHouseProperty: vi.fn(),
  deleteHouseProperty: vi.fn(),
}));

vi.mock('../../services/foreignAssetService', () => ({
  listForeignAssets: vi.fn(),
  getForeignAssetSummary: vi.fn(),
  createForeignAsset: vi.fn(),
  updateForeignAsset: vi.fn(),
  deleteForeignAsset: vi.fn(),
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────────

import taxRouter from '../../routes/tax';
import { prisma } from '../../config/prisma';
import * as taxSvc from '../../services/taxService';
import * as cgSvc from '../../services/capitalGainsService';
import * as osSvc from '../../services/otherIncomeService';
import * as hpSvc from '../../services/housePropertyService';
import * as faSvc from '../../services/foreignAssetService';
import { makeApp } from '../helpers/makeApp';

// ─── Helpers ───────────────────────────────────────────────────────────────────

const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const userFindFirstMock = (prisma as any).user.findFirst as ReturnType<typeof vi.fn>;

/** Admin app — uses ADMIN_USER by default (no __testUser override) */
function makeAdminApp() {
  return makeApp(taxRouter, '/api/tax');
}

/** Member app — injects MEMBER_USER via __testUser */
function makeMemberApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((req: any, _res: any, next: any) => { req.__testUser = MEMBER_USER; next(); });
  app.use('/api/tax', taxRouter);
  app.use(errorHandler);
  return app;
}

/** Valid CUID-format target user ID (20 chars, alphanumeric lowercase) */
const VALID_TARGET_ID = 'clm1234567890abcdefghij';

beforeEach(() => {
  vi.clearAllMocks();

  // Default: user exists (for resolveTargetUserId lookups)
  userFindFirstMock.mockResolvedValue({ id: VALID_TARGET_ID });

  // Tax service defaults
  m(taxSvc.getTaxProfile).mockResolvedValue(null);
  m(taxSvc.upsertTaxProfile).mockResolvedValue({ regime: 'OLD', grossSalary: 0 });
  m(taxSvc.getTaxSummary).mockResolvedValue({ oldRegime: { tax: 0 }, newRegime: { tax: 0 } });
  m(taxSvc.get80CTracker).mockResolvedValue([]);
  m(taxSvc.getAdvanceTaxCalendar).mockResolvedValue([]);
  m(taxSvc.calcHRAExemption).mockReturnValue(50_000);
  m(taxSvc.getITR2Summary).mockResolvedValue({ schedules: {} });

  // Capital gains
  m(cgSvc.listCapitalGains).mockResolvedValue([]);
  m(cgSvc.calcCapitalGainsSummary).mockResolvedValue({ stcg: 0, ltcg: 0, totalTaxableGain: 0 });
  m(cgSvc.createCapitalGain).mockResolvedValue({ id: 'cg-1' });
  m(cgSvc.updateCapitalGain).mockResolvedValue({ id: 'cg-1' });
  m(cgSvc.deleteCapitalGain).mockResolvedValue({ id: 'cg-1' });

  // Other income
  m(osSvc.listOtherIncome).mockResolvedValue([]);
  m(osSvc.calcOtherIncomeSummary).mockResolvedValue({ total: 0 });
  m(osSvc.createOtherIncome).mockResolvedValue({ id: 'os-1' });
  m(osSvc.updateOtherIncome).mockResolvedValue({ id: 'os-1' });
  m(osSvc.deleteOtherIncome).mockResolvedValue({ id: 'os-1' });

  // House property
  m(hpSvc.listHouseProperties).mockResolvedValue([]);
  m(hpSvc.calcHousePropertyIncome).mockResolvedValue({ income: 0, deduction: 0 });
  m(hpSvc.createHouseProperty).mockResolvedValue({ id: 'hp-1' });
  m(hpSvc.updateHouseProperty).mockResolvedValue({ id: 'hp-1' });
  m(hpSvc.deleteHouseProperty).mockResolvedValue({ id: 'hp-1' });

  // Foreign assets
  m(faSvc.listForeignAssets).mockResolvedValue([]);
  m(faSvc.getForeignAssetSummary).mockResolvedValue({ total: 0 });
  m(faSvc.createForeignAsset).mockResolvedValue({ id: 'fa-1' });
  m(faSvc.updateForeignAsset).mockResolvedValue({ id: 'fa-1' });
  m(faSvc.deleteForeignAsset).mockResolvedValue({ id: 'fa-1' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: Happy-path tests (all via admin app, original coverage)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Profile ──────────────────────────────────────────────────────────────────

describe('GET /api/tax/profile', () => {
  it('returns 200 with null profile when none exists', async () => {
    const res = await request(makeAdminApp()).get('/api/tax/profile');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('passes fy query param to service', async () => {
    await request(makeAdminApp()).get('/api/tax/profile?fy=2024-25');
    expect(m(taxSvc.getTaxProfile)).toHaveBeenCalledWith('admin-id', '2024-25');
  });
});

describe('POST /api/tax/profile', () => {
  it('returns 200 on valid profile upsert', async () => {
    const res = await request(makeAdminApp()).post('/api/tax/profile').send({ regime: 'NEW', grossSalary: 1_200_000 });
    expect(res.status).toBe(200);
    expect(m(taxSvc.upsertTaxProfile)).toHaveBeenCalled();
  });

  it('returns 422 when regime is invalid', async () => {
    const res = await request(makeAdminApp()).post('/api/tax/profile').send({ regime: 'BOTH' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when grossSalary is not a number', async () => {
    const res = await request(makeAdminApp()).post('/api/tax/profile').send({ grossSalary: 'abc' });
    expect(res.status).toBe(422);
  });
});

// ─── Summary & Trackers ───────────────────────────────────────────────────────

describe('GET /api/tax/summary', () => {
  it('returns 200 with tax comparison data', async () => {
    m(taxSvc.getTaxSummary).mockResolvedValue({ oldRegime: { tax: 100_000 }, newRegime: { tax: 80_000 } });
    const res = await request(makeAdminApp()).get('/api/tax/summary');
    expect(res.status).toBe(200);
    expect(res.body.data.oldRegime.tax).toBe(100_000);
  });
});

describe('GET /api/tax/80c-tracker', () => {
  it('returns 200 with 80C tracker data', async () => {
    m(taxSvc.get80CTracker).mockResolvedValue([{ name: 'ELSS', amount: 50_000 }]);
    const res = await request(makeAdminApp()).get('/api/tax/80c-tracker');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('GET /api/tax/advance-tax-calendar', () => {
  it('returns 200 with advance tax schedule', async () => {
    m(taxSvc.getAdvanceTaxCalendar).mockResolvedValue([{ quarter: 'Q1', dueDate: '2024-06-15', amount: 25_000 }]);
    const res = await request(makeAdminApp()).get('/api/tax/advance-tax-calendar');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

// ─── HRA Calculator ───────────────────────────────────────────────────────────

describe('GET /api/tax/hra-calculator', () => {
  it('returns 200 with exempt and taxable amounts', async () => {
    m(taxSvc.calcHRAExemption).mockReturnValue(60_000);
    const res = await request(makeAdminApp()).get('/api/tax/hra-calculator?basicSalary=500000&hraReceived=120000&rentPaid=10000&city=METRO');
    expect(res.status).toBe(200);
    expect(res.body.data.exempt).toBe(60_000);
    expect(res.body.data.taxable).toBe(60_000); // 120000 - 60000
  });

  it('returns 422 when city is invalid', async () => {
    const res = await request(makeAdminApp()).get('/api/tax/hra-calculator?basicSalary=500000&hraReceived=120000&rentPaid=10000&city=INVALID');
    expect(res.status).toBe(422);
  });

  it('returns 422 when basicSalary is non-numeric', async () => {
    const res = await request(makeAdminApp()).get('/api/tax/hra-calculator?basicSalary=abc&hraReceived=120000&rentPaid=10000');
    expect(res.status).toBe(422);
  });
});

// ─── Capital Gains (Schedule CG) ──────────────────────────────────────────────

const VALID_CG = {
  fyYear: '2024-25',
  assetName: 'Axis Bluechip Units',
  assetType: 'EQUITY_MUTUAL_FUND',
  purchaseDate: '2023-01-01T00:00:00.000Z',
  saleDate: '2024-01-01T00:00:00.000Z',
  purchasePrice: 45_000,
  salePrice: 55_000,
};

describe('GET /api/tax/capital-gains', () => {
  it('returns 200 with capital gains list', async () => {
    m(cgSvc.listCapitalGains).mockResolvedValue([{ id: 'cg-1', assetName: 'Axis Bluechip Units' }]);
    const res = await request(makeAdminApp()).get('/api/tax/capital-gains?fy=2024-25');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('GET /api/tax/capital-gains/summary', () => {
  it('returns 200 with CG summary', async () => {
    m(cgSvc.calcCapitalGainsSummary).mockResolvedValue({ stcg: 10_000, ltcg: 0, totalTaxableGain: 10_000 });
    const res = await request(makeAdminApp()).get('/api/tax/capital-gains/summary');
    expect(res.status).toBe(200);
    expect(res.body.data.stcg).toBe(10_000);
  });
});

describe('POST /api/tax/capital-gains', () => {
  it('returns 200 on valid CG entry', async () => {
    const res = await request(makeAdminApp()).post('/api/tax/capital-gains').send(VALID_CG);
    expect(res.status).toBe(200);
  });

  it('returns 422 when assetType is invalid', async () => {
    const res = await request(makeAdminApp()).post('/api/tax/capital-gains').send({ ...VALID_CG, assetType: 'BITCOIN' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when purchaseDate is not a datetime', async () => {
    const res = await request(makeAdminApp()).post('/api/tax/capital-gains').send({ ...VALID_CG, purchaseDate: 'not-a-date' });
    expect(res.status).toBe(422);
  });
});

describe('PUT /api/tax/capital-gains/:id', () => {
  it('returns 200 on valid update', async () => {
    const res = await request(makeAdminApp()).put('/api/tax/capital-gains/cg-1').send({ salePrice: 60_000 });
    expect(res.status).toBe(200);
  });

  it('returns 404 when service returns null', async () => {
    m(cgSvc.updateCapitalGain).mockResolvedValue(null);
    const res = await request(makeAdminApp()).put('/api/tax/capital-gains/nonexistent').send({ salePrice: 1 });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/tax/capital-gains/:id', () => {
  it('returns 200 on successful delete', async () => {
    const res = await request(makeAdminApp()).delete('/api/tax/capital-gains/cg-1');
    expect(res.status).toBe(200);
  });

  it('returns 404 when service returns null', async () => {
    m(cgSvc.deleteCapitalGain).mockResolvedValue(null);
    const res = await request(makeAdminApp()).delete('/api/tax/capital-gains/nonexistent');
    expect(res.status).toBe(404);
  });
});

// ─── Other Income (Schedule OS) ───────────────────────────────────────────────

const VALID_OS = {
  fyYear: '2024-25',
  sourceType: 'FD_INTEREST',
  description: 'HDFC FD interest',
  amount: 5_000,
};

describe('GET /api/tax/other-income', () => {
  it('returns 200 with other income list', async () => {
    const res = await request(makeAdminApp()).get('/api/tax/other-income');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('GET /api/tax/other-income/summary', () => {
  it('returns 200 with summary (OLD regime — null profile fallback)', async () => {
    const res = await request(makeAdminApp()).get('/api/tax/other-income/summary');
    expect(res.status).toBe(200);
    // getTaxProfile returns null → regime defaults to 'OLD'
    expect(m(osSvc.calcOtherIncomeSummary)).toHaveBeenCalledWith('admin-id', expect.any(String), 'OLD');
  });

  it('uses NEW regime when profile has regime=NEW', async () => {
    m(taxSvc.getTaxProfile).mockResolvedValue({ regime: 'NEW' });
    const res = await request(makeAdminApp()).get('/api/tax/other-income/summary');
    expect(res.status).toBe(200);
    expect(m(osSvc.calcOtherIncomeSummary)).toHaveBeenCalledWith('admin-id', expect.any(String), 'NEW');
  });
});

describe('POST /api/tax/other-income', () => {
  it('returns 200 on valid entry', async () => {
    const res = await request(makeAdminApp()).post('/api/tax/other-income').send(VALID_OS);
    expect(res.status).toBe(200);
  });

  it('returns 422 when sourceType is invalid', async () => {
    const res = await request(makeAdminApp()).post('/api/tax/other-income').send({ ...VALID_OS, sourceType: 'LOTTERY' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when amount is not positive', async () => {
    const res = await request(makeAdminApp()).post('/api/tax/other-income').send({ ...VALID_OS, amount: -500 });
    expect(res.status).toBe(422);
  });
});

describe('PUT /api/tax/other-income/:id', () => {
  it('returns 200 on valid update', async () => {
    const res = await request(makeAdminApp()).put('/api/tax/other-income/os-1').send({ amount: 6_000 });
    expect(res.status).toBe(200);
  });

  it('returns 404 when service returns null', async () => {
    m(osSvc.updateOtherIncome).mockResolvedValue(null);
    const res = await request(makeAdminApp()).put('/api/tax/other-income/nonexistent').send({ amount: 1 });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/tax/other-income/:id', () => {
  it('returns 200 on successful delete', async () => {
    const res = await request(makeAdminApp()).delete('/api/tax/other-income/os-1');
    expect(res.status).toBe(200);
  });

  it('returns 404 when service returns null', async () => {
    m(osSvc.deleteOtherIncome).mockResolvedValue(null);
    const res = await request(makeAdminApp()).delete('/api/tax/other-income/nonexistent');
    expect(res.status).toBe(404);
  });
});

// ─── House Property (Schedule HP) ────────────────────────────────────────────

const VALID_HP = {
  fyYear: '2024-25',
  propertyName: 'Flat 3B',
  usage: 'SELF_OCCUPIED',
};

describe('GET /api/tax/house-property', () => {
  it('returns 200 with house properties', async () => {
    const res = await request(makeAdminApp()).get('/api/tax/house-property');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('GET /api/tax/house-property/summary', () => {
  it('returns 200 with HP income summary (OLD regime — null profile fallback)', async () => {
    const res = await request(makeAdminApp()).get('/api/tax/house-property/summary');
    expect(res.status).toBe(200);
    // getTaxProfile returns null → regime defaults to 'OLD'
    expect(m(hpSvc.calcHousePropertyIncome)).toHaveBeenCalledWith('admin-id', expect.any(String), 'OLD');
  });

  it('uses NEW regime when profile has regime=NEW', async () => {
    m(taxSvc.getTaxProfile).mockResolvedValue({ regime: 'NEW' });
    const res = await request(makeAdminApp()).get('/api/tax/house-property/summary');
    expect(res.status).toBe(200);
    expect(m(hpSvc.calcHousePropertyIncome)).toHaveBeenCalledWith('admin-id', expect.any(String), 'NEW');
  });
});

describe('POST /api/tax/house-property', () => {
  it('returns 200 on valid HP entry', async () => {
    const res = await request(makeAdminApp()).post('/api/tax/house-property').send(VALID_HP);
    expect(res.status).toBe(200);
  });

  it('returns 422 when usage is invalid', async () => {
    const res = await request(makeAdminApp()).post('/api/tax/house-property').send({ ...VALID_HP, usage: 'RENTED' });
    expect(res.status).toBe(422);
  });
});

describe('PUT /api/tax/house-property/:id', () => {
  it('returns 200 on valid update', async () => {
    const res = await request(makeAdminApp()).put('/api/tax/house-property/hp-1').send({ usage: 'LET_OUT' });
    expect(res.status).toBe(200);
  });

  it('returns 404 when service returns null', async () => {
    m(hpSvc.updateHouseProperty).mockResolvedValue(null);
    const res = await request(makeAdminApp()).put('/api/tax/house-property/nonexistent').send({ usage: 'LET_OUT' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/tax/house-property/:id', () => {
  it('returns 200 on successful delete', async () => {
    const res = await request(makeAdminApp()).delete('/api/tax/house-property/hp-1');
    expect(res.status).toBe(200);
  });

  it('returns 404 when service returns null', async () => {
    m(hpSvc.deleteHouseProperty).mockResolvedValue(null);
    const res = await request(makeAdminApp()).delete('/api/tax/house-property/nonexistent');
    expect(res.status).toBe(404);
  });
});

// ─── Foreign Assets (Schedule FA) ────────────────────────────────────────────

const VALID_FA = {
  fyYear: '2024-25',
  category: 'EQUITY_AND_MF',
  country: 'US',
  assetDescription: 'Apple Inc stock',
  acquisitionCostINR: 500_000,
  peakValueINR: 700_000,
  closingValueINR: 650_000,
};

describe('GET /api/tax/foreign-assets', () => {
  it('returns 200 with foreign assets list', async () => {
    const res = await request(makeAdminApp()).get('/api/tax/foreign-assets');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('GET /api/tax/foreign-assets/summary', () => {
  it('returns 200 with FA summary', async () => {
    const res = await request(makeAdminApp()).get('/api/tax/foreign-assets/summary');
    expect(res.status).toBe(200);
  });
});

describe('POST /api/tax/foreign-assets', () => {
  it('returns 200 on valid FA entry', async () => {
    const res = await request(makeAdminApp()).post('/api/tax/foreign-assets').send(VALID_FA);
    expect(res.status).toBe(200);
  });

  it('returns 422 when category is invalid', async () => {
    const res = await request(makeAdminApp()).post('/api/tax/foreign-assets').send({ ...VALID_FA, category: 'CRYPTO' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when acquisitionCostINR is negative', async () => {
    const res = await request(makeAdminApp()).post('/api/tax/foreign-assets').send({ ...VALID_FA, acquisitionCostINR: -1000 });
    expect(res.status).toBe(422);
  });
});

describe('PUT /api/tax/foreign-assets/:id', () => {
  it('returns 200 on valid update', async () => {
    const res = await request(makeAdminApp()).put('/api/tax/foreign-assets/fa-1').send({ closingValueINR: 700_000 });
    expect(res.status).toBe(200);
  });

  it('returns 404 when service returns null', async () => {
    m(faSvc.updateForeignAsset).mockResolvedValue(null);
    const res = await request(makeAdminApp()).put('/api/tax/foreign-assets/nonexistent').send({ country: 'UK' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/tax/foreign-assets/:id', () => {
  it('returns 200 on successful delete', async () => {
    const res = await request(makeAdminApp()).delete('/api/tax/foreign-assets/fa-1');
    expect(res.status).toBe(200);
  });

  it('returns 404 when service returns null', async () => {
    m(faSvc.deleteForeignAsset).mockResolvedValue(null);
    const res = await request(makeAdminApp()).delete('/api/tax/foreign-assets/nonexistent');
    expect(res.status).toBe(404);
  });
});

// ─── ITR-2 Summary ────────────────────────────────────────────────────────────

describe('GET /api/tax/itr2-summary', () => {
  it('returns 200 with ITR-2 structure', async () => {
    m(taxSvc.getITR2Summary).mockResolvedValue({ schedules: { CG: {}, OS: {} } });
    const res = await request(makeAdminApp()).get('/api/tax/itr2-summary?fy=2024-25');
    expect(res.status).toBe(200);
    expect(res.body.data.schedules).toBeDefined();
  });

  it('passes fy to service', async () => {
    await request(makeAdminApp()).get('/api/tax/itr2-summary?fy=2025-26');
    expect(m(taxSvc.getITR2Summary)).toHaveBeenCalledWith('admin-id', '2025-26');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: Per-member scoping tests (12 GET endpoints × 6 scenarios)
//
// Scenarios per endpoint:
//   1. MEMBER → service called with 'member-id'
//   2. ADMIN without targetUserId → defaults to own data ('admin-id')
//   3. ADMIN with valid targetUserId → service called with VALID_TARGET_ID
//   4. ADMIN with invalid CUID format → 400
//   5. ADMIN with non-existent targetUserId → 404
//   6. MEMBER with targetUserId param → ignored, still gets own data ('member-id')
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Scoping: GET /api/tax/profile ───────────────────────────────────────────

describe('GET /api/tax/profile — per-member scoping', () => {
  it('MEMBER — gets own profile', async () => {
    await request(makeMemberApp()).get('/api/tax/profile?fy=2025-26');
    expect(m(taxSvc.getTaxProfile)).toHaveBeenCalledWith('member-id', '2025-26');
  });

  it('ADMIN without targetUserId — defaults to own profile', async () => {
    await request(makeAdminApp()).get('/api/tax/profile?fy=2025-26');
    expect(m(taxSvc.getTaxProfile)).toHaveBeenCalledWith('admin-id', '2025-26');
  });

  it('ADMIN with valid targetUserId — gets target member profile', async () => {
    await request(makeAdminApp()).get(`/api/tax/profile?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(m(taxSvc.getTaxProfile)).toHaveBeenCalledWith(VALID_TARGET_ID, '2025-26');
  });

  it('ADMIN with invalid targetUserId format — returns 400', async () => {
    const res = await request(makeAdminApp()).get('/api/tax/profile?fy=2025-26&targetUserId=not-a-cuid');
    expect(res.status).toBe(400);
  });

  it('ADMIN with non-existent targetUserId — returns 404', async () => {
    userFindFirstMock.mockResolvedValue(null);
    const res = await request(makeAdminApp()).get(`/api/tax/profile?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(res.status).toBe(404);
  });

  it('MEMBER with targetUserId param — param ignored, gets own profile', async () => {
    await request(makeMemberApp()).get(`/api/tax/profile?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(m(taxSvc.getTaxProfile)).toHaveBeenCalledWith('member-id', '2025-26');
  });
});

// ─── Scoping: GET /api/tax/summary ───────────────────────────────────────────

describe('GET /api/tax/summary — per-member scoping', () => {
  it('MEMBER — gets own summary', async () => {
    await request(makeMemberApp()).get('/api/tax/summary?fy=2025-26');
    expect(m(taxSvc.getTaxSummary)).toHaveBeenCalledWith('member-id', '2025-26');
  });

  it('ADMIN without targetUserId — defaults to own summary', async () => {
    await request(makeAdminApp()).get('/api/tax/summary?fy=2025-26');
    expect(m(taxSvc.getTaxSummary)).toHaveBeenCalledWith('admin-id', '2025-26');
  });

  it('ADMIN with valid targetUserId — gets target member summary', async () => {
    await request(makeAdminApp()).get(`/api/tax/summary?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(m(taxSvc.getTaxSummary)).toHaveBeenCalledWith(VALID_TARGET_ID, '2025-26');
  });

  it('ADMIN with invalid targetUserId format — returns 400', async () => {
    const res = await request(makeAdminApp()).get('/api/tax/summary?fy=2025-26&targetUserId=not-a-cuid');
    expect(res.status).toBe(400);
  });

  it('ADMIN with non-existent targetUserId — returns 404', async () => {
    userFindFirstMock.mockResolvedValue(null);
    const res = await request(makeAdminApp()).get(`/api/tax/summary?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(res.status).toBe(404);
  });

  it('MEMBER with targetUserId param — param ignored, gets own summary', async () => {
    await request(makeMemberApp()).get(`/api/tax/summary?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(m(taxSvc.getTaxSummary)).toHaveBeenCalledWith('member-id', '2025-26');
  });
});

// ─── Scoping: GET /api/tax/80c-tracker ───────────────────────────────────────

describe('GET /api/tax/80c-tracker — per-member scoping', () => {
  it('MEMBER — gets own 80C data', async () => {
    await request(makeMemberApp()).get('/api/tax/80c-tracker?fy=2025-26');
    expect(m(taxSvc.get80CTracker)).toHaveBeenCalledWith('member-id', '2025-26');
  });

  it('ADMIN without targetUserId — defaults to own 80C data', async () => {
    await request(makeAdminApp()).get('/api/tax/80c-tracker?fy=2025-26');
    expect(m(taxSvc.get80CTracker)).toHaveBeenCalledWith('admin-id', '2025-26');
  });

  it('ADMIN with valid targetUserId — gets target member 80C data', async () => {
    await request(makeAdminApp()).get(`/api/tax/80c-tracker?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(m(taxSvc.get80CTracker)).toHaveBeenCalledWith(VALID_TARGET_ID, '2025-26');
  });

  it('ADMIN with invalid targetUserId format — returns 400', async () => {
    const res = await request(makeAdminApp()).get('/api/tax/80c-tracker?fy=2025-26&targetUserId=bad-id!');
    expect(res.status).toBe(400);
  });

  it('ADMIN with non-existent targetUserId — returns 404', async () => {
    userFindFirstMock.mockResolvedValue(null);
    const res = await request(makeAdminApp()).get(`/api/tax/80c-tracker?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(res.status).toBe(404);
  });

  it('MEMBER with targetUserId param — param ignored, gets own 80C data', async () => {
    await request(makeMemberApp()).get(`/api/tax/80c-tracker?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(m(taxSvc.get80CTracker)).toHaveBeenCalledWith('member-id', '2025-26');
  });
});

// ─── Scoping: GET /api/tax/capital-gains ─────────────────────────────────────

describe('GET /api/tax/capital-gains — per-member scoping', () => {
  it('MEMBER — gets own capital gains', async () => {
    await request(makeMemberApp()).get('/api/tax/capital-gains?fy=2025-26');
    expect(m(cgSvc.listCapitalGains)).toHaveBeenCalledWith('member-id', '2025-26');
  });

  it('ADMIN without targetUserId — defaults to own capital gains', async () => {
    await request(makeAdminApp()).get('/api/tax/capital-gains?fy=2025-26');
    expect(m(cgSvc.listCapitalGains)).toHaveBeenCalledWith('admin-id', '2025-26');
  });

  it('ADMIN with valid targetUserId — gets target member capital gains', async () => {
    await request(makeAdminApp()).get(`/api/tax/capital-gains?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(m(cgSvc.listCapitalGains)).toHaveBeenCalledWith(VALID_TARGET_ID, '2025-26');
  });

  it('ADMIN with invalid targetUserId format — returns 400', async () => {
    const res = await request(makeAdminApp()).get('/api/tax/capital-gains?fy=2025-26&targetUserId=not-a-cuid');
    expect(res.status).toBe(400);
  });

  it('ADMIN with non-existent targetUserId — returns 404', async () => {
    userFindFirstMock.mockResolvedValue(null);
    const res = await request(makeAdminApp()).get(`/api/tax/capital-gains?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(res.status).toBe(404);
  });

  it('MEMBER with targetUserId param — param ignored, gets own capital gains', async () => {
    await request(makeMemberApp()).get(`/api/tax/capital-gains?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(m(cgSvc.listCapitalGains)).toHaveBeenCalledWith('member-id', '2025-26');
  });
});

// ─── Scoping: GET /api/tax/capital-gains/summary ─────────────────────────────

describe('GET /api/tax/capital-gains/summary — per-member scoping', () => {
  it('MEMBER — gets own CG summary', async () => {
    await request(makeMemberApp()).get('/api/tax/capital-gains/summary?fy=2025-26');
    expect(m(cgSvc.calcCapitalGainsSummary)).toHaveBeenCalledWith('member-id', '2025-26');
  });

  it('ADMIN without targetUserId — defaults to own CG summary', async () => {
    await request(makeAdminApp()).get('/api/tax/capital-gains/summary?fy=2025-26');
    expect(m(cgSvc.calcCapitalGainsSummary)).toHaveBeenCalledWith('admin-id', '2025-26');
  });

  it('ADMIN with valid targetUserId — gets target member CG summary', async () => {
    await request(makeAdminApp()).get(`/api/tax/capital-gains/summary?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(m(cgSvc.calcCapitalGainsSummary)).toHaveBeenCalledWith(VALID_TARGET_ID, '2025-26');
  });

  it('ADMIN with invalid targetUserId format — returns 400', async () => {
    const res = await request(makeAdminApp()).get('/api/tax/capital-gains/summary?fy=2025-26&targetUserId=not-a-cuid');
    expect(res.status).toBe(400);
  });

  it('ADMIN with non-existent targetUserId — returns 404', async () => {
    userFindFirstMock.mockResolvedValue(null);
    const res = await request(makeAdminApp()).get(`/api/tax/capital-gains/summary?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(res.status).toBe(404);
  });

  it('MEMBER with targetUserId param — param ignored, gets own CG summary', async () => {
    await request(makeMemberApp()).get(`/api/tax/capital-gains/summary?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(m(cgSvc.calcCapitalGainsSummary)).toHaveBeenCalledWith('member-id', '2025-26');
  });
});

// ─── Scoping: GET /api/tax/other-income ──────────────────────────────────────

describe('GET /api/tax/other-income — per-member scoping', () => {
  it('MEMBER — gets own other income', async () => {
    await request(makeMemberApp()).get('/api/tax/other-income?fy=2025-26');
    expect(m(osSvc.listOtherIncome)).toHaveBeenCalledWith('member-id', '2025-26');
  });

  it('ADMIN without targetUserId — defaults to own other income', async () => {
    await request(makeAdminApp()).get('/api/tax/other-income?fy=2025-26');
    expect(m(osSvc.listOtherIncome)).toHaveBeenCalledWith('admin-id', '2025-26');
  });

  it('ADMIN with valid targetUserId — gets target member other income', async () => {
    await request(makeAdminApp()).get(`/api/tax/other-income?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(m(osSvc.listOtherIncome)).toHaveBeenCalledWith(VALID_TARGET_ID, '2025-26');
  });

  it('ADMIN with invalid targetUserId format — returns 400', async () => {
    const res = await request(makeAdminApp()).get('/api/tax/other-income?fy=2025-26&targetUserId=not-a-cuid');
    expect(res.status).toBe(400);
  });

  it('ADMIN with non-existent targetUserId — returns 404', async () => {
    userFindFirstMock.mockResolvedValue(null);
    const res = await request(makeAdminApp()).get(`/api/tax/other-income?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(res.status).toBe(404);
  });

  it('MEMBER with targetUserId param — param ignored, gets own other income', async () => {
    await request(makeMemberApp()).get(`/api/tax/other-income?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(m(osSvc.listOtherIncome)).toHaveBeenCalledWith('member-id', '2025-26');
  });
});

// ─── Scoping: GET /api/tax/other-income/summary ──────────────────────────────
// Special: effectiveUserId used for BOTH getTaxProfile AND calcOtherIncomeSummary

describe('GET /api/tax/other-income/summary — per-member scoping', () => {
  it('MEMBER — both profile and summary fetched with member-id', async () => {
    await request(makeMemberApp()).get('/api/tax/other-income/summary?fy=2025-26');
    expect(m(taxSvc.getTaxProfile)).toHaveBeenCalledWith('member-id', '2025-26');
    expect(m(osSvc.calcOtherIncomeSummary)).toHaveBeenCalledWith('member-id', '2025-26', 'OLD');
  });

  it('ADMIN without targetUserId — both profile and summary fetched with admin-id', async () => {
    await request(makeAdminApp()).get('/api/tax/other-income/summary?fy=2025-26');
    expect(m(taxSvc.getTaxProfile)).toHaveBeenCalledWith('admin-id', '2025-26');
    expect(m(osSvc.calcOtherIncomeSummary)).toHaveBeenCalledWith('admin-id', '2025-26', 'OLD');
  });

  it('ADMIN with valid targetUserId — both profile and summary fetched with target ID', async () => {
    m(taxSvc.getTaxProfile).mockResolvedValue({ regime: 'NEW' });
    await request(makeAdminApp()).get(`/api/tax/other-income/summary?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(m(taxSvc.getTaxProfile)).toHaveBeenCalledWith(VALID_TARGET_ID, '2025-26');
    expect(m(osSvc.calcOtherIncomeSummary)).toHaveBeenCalledWith(VALID_TARGET_ID, '2025-26', 'NEW');
  });

  it('ADMIN with invalid targetUserId format — returns 400', async () => {
    const res = await request(makeAdminApp()).get('/api/tax/other-income/summary?fy=2025-26&targetUserId=not-a-cuid');
    expect(res.status).toBe(400);
  });

  it('ADMIN with non-existent targetUserId — returns 404', async () => {
    userFindFirstMock.mockResolvedValue(null);
    const res = await request(makeAdminApp()).get(`/api/tax/other-income/summary?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(res.status).toBe(404);
  });

  it('MEMBER with targetUserId param — param ignored, both fetched with member-id', async () => {
    await request(makeMemberApp()).get(`/api/tax/other-income/summary?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(m(taxSvc.getTaxProfile)).toHaveBeenCalledWith('member-id', '2025-26');
    expect(m(osSvc.calcOtherIncomeSummary)).toHaveBeenCalledWith('member-id', '2025-26', 'OLD');
  });
});

// ─── Scoping: GET /api/tax/house-property ────────────────────────────────────

describe('GET /api/tax/house-property — per-member scoping', () => {
  it('MEMBER — gets own house properties', async () => {
    await request(makeMemberApp()).get('/api/tax/house-property?fy=2025-26');
    expect(m(hpSvc.listHouseProperties)).toHaveBeenCalledWith('member-id', '2025-26');
  });

  it('ADMIN without targetUserId — defaults to own house properties', async () => {
    await request(makeAdminApp()).get('/api/tax/house-property?fy=2025-26');
    expect(m(hpSvc.listHouseProperties)).toHaveBeenCalledWith('admin-id', '2025-26');
  });

  it('ADMIN with valid targetUserId — gets target member house properties', async () => {
    await request(makeAdminApp()).get(`/api/tax/house-property?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(m(hpSvc.listHouseProperties)).toHaveBeenCalledWith(VALID_TARGET_ID, '2025-26');
  });

  it('ADMIN with invalid targetUserId format — returns 400', async () => {
    const res = await request(makeAdminApp()).get('/api/tax/house-property?fy=2025-26&targetUserId=not-a-cuid');
    expect(res.status).toBe(400);
  });

  it('ADMIN with non-existent targetUserId — returns 404', async () => {
    userFindFirstMock.mockResolvedValue(null);
    const res = await request(makeAdminApp()).get(`/api/tax/house-property?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(res.status).toBe(404);
  });

  it('MEMBER with targetUserId param — param ignored, gets own house properties', async () => {
    await request(makeMemberApp()).get(`/api/tax/house-property?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(m(hpSvc.listHouseProperties)).toHaveBeenCalledWith('member-id', '2025-26');
  });
});

// ─── Scoping: GET /api/tax/house-property/summary ────────────────────────────
// Special: effectiveUserId used for BOTH getTaxProfile AND calcHousePropertyIncome

describe('GET /api/tax/house-property/summary — per-member scoping', () => {
  it('MEMBER — both profile and HP income fetched with member-id', async () => {
    await request(makeMemberApp()).get('/api/tax/house-property/summary?fy=2025-26');
    expect(m(taxSvc.getTaxProfile)).toHaveBeenCalledWith('member-id', '2025-26');
    expect(m(hpSvc.calcHousePropertyIncome)).toHaveBeenCalledWith('member-id', '2025-26', 'OLD');
  });

  it('ADMIN without targetUserId — both profile and HP income fetched with admin-id', async () => {
    await request(makeAdminApp()).get('/api/tax/house-property/summary?fy=2025-26');
    expect(m(taxSvc.getTaxProfile)).toHaveBeenCalledWith('admin-id', '2025-26');
    expect(m(hpSvc.calcHousePropertyIncome)).toHaveBeenCalledWith('admin-id', '2025-26', 'OLD');
  });

  it('ADMIN with valid targetUserId — both profile and HP income fetched with target ID', async () => {
    m(taxSvc.getTaxProfile).mockResolvedValue({ regime: 'NEW' });
    await request(makeAdminApp()).get(`/api/tax/house-property/summary?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(m(taxSvc.getTaxProfile)).toHaveBeenCalledWith(VALID_TARGET_ID, '2025-26');
    expect(m(hpSvc.calcHousePropertyIncome)).toHaveBeenCalledWith(VALID_TARGET_ID, '2025-26', 'NEW');
  });

  it('ADMIN with invalid targetUserId format — returns 400', async () => {
    const res = await request(makeAdminApp()).get('/api/tax/house-property/summary?fy=2025-26&targetUserId=not-a-cuid');
    expect(res.status).toBe(400);
  });

  it('ADMIN with non-existent targetUserId — returns 404', async () => {
    userFindFirstMock.mockResolvedValue(null);
    const res = await request(makeAdminApp()).get(`/api/tax/house-property/summary?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(res.status).toBe(404);
  });

  it('MEMBER with targetUserId param — param ignored, both fetched with member-id', async () => {
    await request(makeMemberApp()).get(`/api/tax/house-property/summary?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(m(taxSvc.getTaxProfile)).toHaveBeenCalledWith('member-id', '2025-26');
    expect(m(hpSvc.calcHousePropertyIncome)).toHaveBeenCalledWith('member-id', '2025-26', 'OLD');
  });
});

// ─── Scoping: GET /api/tax/foreign-assets ────────────────────────────────────

describe('GET /api/tax/foreign-assets — per-member scoping', () => {
  it('MEMBER — gets own foreign assets', async () => {
    await request(makeMemberApp()).get('/api/tax/foreign-assets?fy=2025-26');
    expect(m(faSvc.listForeignAssets)).toHaveBeenCalledWith('member-id', '2025-26');
  });

  it('ADMIN without targetUserId — defaults to own foreign assets', async () => {
    await request(makeAdminApp()).get('/api/tax/foreign-assets?fy=2025-26');
    expect(m(faSvc.listForeignAssets)).toHaveBeenCalledWith('admin-id', '2025-26');
  });

  it('ADMIN with valid targetUserId — gets target member foreign assets', async () => {
    await request(makeAdminApp()).get(`/api/tax/foreign-assets?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(m(faSvc.listForeignAssets)).toHaveBeenCalledWith(VALID_TARGET_ID, '2025-26');
  });

  it('ADMIN with invalid targetUserId format — returns 400', async () => {
    const res = await request(makeAdminApp()).get('/api/tax/foreign-assets?fy=2025-26&targetUserId=not-a-cuid');
    expect(res.status).toBe(400);
  });

  it('ADMIN with non-existent targetUserId — returns 404', async () => {
    userFindFirstMock.mockResolvedValue(null);
    const res = await request(makeAdminApp()).get(`/api/tax/foreign-assets?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(res.status).toBe(404);
  });

  it('MEMBER with targetUserId param — param ignored, gets own foreign assets', async () => {
    await request(makeMemberApp()).get(`/api/tax/foreign-assets?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(m(faSvc.listForeignAssets)).toHaveBeenCalledWith('member-id', '2025-26');
  });
});

// ─── Scoping: GET /api/tax/foreign-assets/summary ────────────────────────────

describe('GET /api/tax/foreign-assets/summary — per-member scoping', () => {
  it('MEMBER — gets own FA summary', async () => {
    await request(makeMemberApp()).get('/api/tax/foreign-assets/summary?fy=2025-26');
    expect(m(faSvc.getForeignAssetSummary)).toHaveBeenCalledWith('member-id', '2025-26');
  });

  it('ADMIN without targetUserId — defaults to own FA summary', async () => {
    await request(makeAdminApp()).get('/api/tax/foreign-assets/summary?fy=2025-26');
    expect(m(faSvc.getForeignAssetSummary)).toHaveBeenCalledWith('admin-id', '2025-26');
  });

  it('ADMIN with valid targetUserId — gets target member FA summary', async () => {
    await request(makeAdminApp()).get(`/api/tax/foreign-assets/summary?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(m(faSvc.getForeignAssetSummary)).toHaveBeenCalledWith(VALID_TARGET_ID, '2025-26');
  });

  it('ADMIN with invalid targetUserId format — returns 400', async () => {
    const res = await request(makeAdminApp()).get('/api/tax/foreign-assets/summary?fy=2025-26&targetUserId=not-a-cuid');
    expect(res.status).toBe(400);
  });

  it('ADMIN with non-existent targetUserId — returns 404', async () => {
    userFindFirstMock.mockResolvedValue(null);
    const res = await request(makeAdminApp()).get(`/api/tax/foreign-assets/summary?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(res.status).toBe(404);
  });

  it('MEMBER with targetUserId param — param ignored, gets own FA summary', async () => {
    await request(makeMemberApp()).get(`/api/tax/foreign-assets/summary?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(m(faSvc.getForeignAssetSummary)).toHaveBeenCalledWith('member-id', '2025-26');
  });
});

// ─── Scoping: GET /api/tax/itr2-summary ──────────────────────────────────────

describe('GET /api/tax/itr2-summary — per-member scoping', () => {
  it('MEMBER — gets own ITR-2 summary', async () => {
    await request(makeMemberApp()).get('/api/tax/itr2-summary?fy=2025-26');
    expect(m(taxSvc.getITR2Summary)).toHaveBeenCalledWith('member-id', '2025-26');
  });

  it('ADMIN without targetUserId — defaults to own ITR-2 summary', async () => {
    await request(makeAdminApp()).get('/api/tax/itr2-summary?fy=2025-26');
    expect(m(taxSvc.getITR2Summary)).toHaveBeenCalledWith('admin-id', '2025-26');
  });

  it('ADMIN with valid targetUserId — gets target member ITR-2 summary', async () => {
    await request(makeAdminApp()).get(`/api/tax/itr2-summary?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(m(taxSvc.getITR2Summary)).toHaveBeenCalledWith(VALID_TARGET_ID, '2025-26');
  });

  it('ADMIN with invalid targetUserId format — returns 400', async () => {
    const res = await request(makeAdminApp()).get('/api/tax/itr2-summary?fy=2025-26&targetUserId=not-a-cuid');
    expect(res.status).toBe(400);
  });

  it('ADMIN with non-existent targetUserId — returns 404', async () => {
    userFindFirstMock.mockResolvedValue(null);
    const res = await request(makeAdminApp()).get(`/api/tax/itr2-summary?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(res.status).toBe(404);
  });

  it('MEMBER with targetUserId param — param ignored, gets own ITR-2 summary', async () => {
    await request(makeMemberApp()).get(`/api/tax/itr2-summary?fy=2025-26&targetUserId=${VALID_TARGET_ID}`);
    expect(m(taxSvc.getITR2Summary)).toHaveBeenCalledWith('member-id', '2025-26');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: Write endpoint regression — POST/PUT/DELETE always use req.user!.userId
// (targetUserId query param must be ignored by write routes)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Write endpoints ignore targetUserId — always scope to req.user!.userId', () => {
  it('POST /capital-gains with targetUserId — creates under admin-id', async () => {
    await request(makeAdminApp())
      .post(`/api/tax/capital-gains?targetUserId=${VALID_TARGET_ID}`)
      .send(VALID_CG);
    expect(m(cgSvc.createCapitalGain)).toHaveBeenCalledWith('admin-id', expect.any(Object));
  });

  it('PUT /capital-gains/:id with targetUserId — updates under admin-id', async () => {
    await request(makeAdminApp())
      .put(`/api/tax/capital-gains/cg-1?targetUserId=${VALID_TARGET_ID}`)
      .send({ salePrice: 60_000 });
    expect(m(cgSvc.updateCapitalGain)).toHaveBeenCalledWith('admin-id', 'cg-1', expect.any(Object));
  });

  it('DELETE /capital-gains/:id with targetUserId — deletes under admin-id', async () => {
    await request(makeAdminApp())
      .delete(`/api/tax/capital-gains/cg-1?targetUserId=${VALID_TARGET_ID}`);
    expect(m(cgSvc.deleteCapitalGain)).toHaveBeenCalledWith('admin-id', 'cg-1');
  });

  it('POST /other-income with targetUserId — creates under admin-id', async () => {
    await request(makeAdminApp())
      .post(`/api/tax/other-income?targetUserId=${VALID_TARGET_ID}`)
      .send(VALID_OS);
    expect(m(osSvc.createOtherIncome)).toHaveBeenCalledWith('admin-id', expect.any(Object));
  });

  it('PUT /other-income/:id with targetUserId — updates under admin-id', async () => {
    await request(makeAdminApp())
      .put(`/api/tax/other-income/os-1?targetUserId=${VALID_TARGET_ID}`)
      .send({ amount: 6_000 });
    expect(m(osSvc.updateOtherIncome)).toHaveBeenCalledWith('admin-id', 'os-1', expect.any(Object));
  });

  it('DELETE /other-income/:id with targetUserId — deletes under admin-id', async () => {
    await request(makeAdminApp())
      .delete(`/api/tax/other-income/os-1?targetUserId=${VALID_TARGET_ID}`);
    expect(m(osSvc.deleteOtherIncome)).toHaveBeenCalledWith('admin-id', 'os-1');
  });

  it('POST /house-property with targetUserId — creates under admin-id', async () => {
    await request(makeAdminApp())
      .post(`/api/tax/house-property?targetUserId=${VALID_TARGET_ID}`)
      .send(VALID_HP);
    expect(m(hpSvc.createHouseProperty)).toHaveBeenCalledWith('admin-id', expect.any(Object));
  });

  it('PUT /house-property/:id with targetUserId — updates under admin-id', async () => {
    await request(makeAdminApp())
      .put(`/api/tax/house-property/hp-1?targetUserId=${VALID_TARGET_ID}`)
      .send({ usage: 'LET_OUT' });
    expect(m(hpSvc.updateHouseProperty)).toHaveBeenCalledWith('admin-id', 'hp-1', expect.any(Object));
  });

  it('DELETE /house-property/:id with targetUserId — deletes under admin-id', async () => {
    await request(makeAdminApp())
      .delete(`/api/tax/house-property/hp-1?targetUserId=${VALID_TARGET_ID}`);
    expect(m(hpSvc.deleteHouseProperty)).toHaveBeenCalledWith('admin-id', 'hp-1');
  });

  it('POST /foreign-assets with targetUserId — creates under admin-id', async () => {
    await request(makeAdminApp())
      .post(`/api/tax/foreign-assets?targetUserId=${VALID_TARGET_ID}`)
      .send(VALID_FA);
    expect(m(faSvc.createForeignAsset)).toHaveBeenCalledWith('admin-id', expect.any(Object));
  });

  it('PUT /foreign-assets/:id with targetUserId — updates under admin-id', async () => {
    await request(makeAdminApp())
      .put(`/api/tax/foreign-assets/fa-1?targetUserId=${VALID_TARGET_ID}`)
      .send({ closingValueINR: 700_000 });
    expect(m(faSvc.updateForeignAsset)).toHaveBeenCalledWith('admin-id', 'fa-1', expect.any(Object));
  });

  it('DELETE /foreign-assets/:id with targetUserId — deletes under admin-id', async () => {
    await request(makeAdminApp())
      .delete(`/api/tax/foreign-assets/fa-1?targetUserId=${VALID_TARGET_ID}`);
    expect(m(faSvc.deleteForeignAsset)).toHaveBeenCalledWith('admin-id', 'fa-1');
  });

  it('POST /profile with targetUserId — upserts under admin-id', async () => {
    await request(makeAdminApp())
      .post(`/api/tax/profile?targetUserId=${VALID_TARGET_ID}`)
      .send({ regime: 'NEW' });
    expect(m(taxSvc.upsertTaxProfile)).toHaveBeenCalledWith('admin-id', expect.any(String), expect.any(Object));
  });
});
