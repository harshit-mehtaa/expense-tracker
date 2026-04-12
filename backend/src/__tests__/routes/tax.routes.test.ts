/**
 * Route integration tests for /api/tax.
 *
 * Covers: profile, summary, 80c-tracker, advance-tax-calendar, hra-calculator,
 * capital-gains (CG), other-income (OS), house-property (HP),
 * foreign-assets (FA), itr2-summary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'u1', email: 'a@b.com', role: 'ADMIN' };
    next();
  },
}));

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

import taxRouter from '../../routes/tax';
import * as taxSvc from '../../services/taxService';
import * as cgSvc from '../../services/capitalGainsService';
import * as osSvc from '../../services/otherIncomeService';
import * as hpSvc from '../../services/housePropertyService';
import * as faSvc from '../../services/foreignAssetService';
import { makeApp } from '../helpers/makeApp';

const app = makeApp(taxRouter, '/api/tax');

const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  // Tax service
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

// ─── Profile ──────────────────────────────────────────────────────────────────

describe('GET /api/tax/profile', () => {
  it('returns 200 with null profile when none exists', async () => {
    const res = await request(app).get('/api/tax/profile');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('passes fy query param to service', async () => {
    await request(app).get('/api/tax/profile?fy=2024-25');
    expect(m(taxSvc.getTaxProfile)).toHaveBeenCalledWith('u1', '2024-25');
  });
});

describe('POST /api/tax/profile', () => {
  it('returns 200 on valid profile upsert', async () => {
    const res = await request(app).post('/api/tax/profile').send({ regime: 'NEW', grossSalary: 1_200_000 });
    expect(res.status).toBe(200);
    expect(m(taxSvc.upsertTaxProfile)).toHaveBeenCalled();
  });

  it('returns 422 when regime is invalid', async () => {
    const res = await request(app).post('/api/tax/profile').send({ regime: 'BOTH' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when grossSalary is not a number', async () => {
    const res = await request(app).post('/api/tax/profile').send({ grossSalary: 'abc' });
    expect(res.status).toBe(422);
  });
});

// ─── Summary & Trackers ───────────────────────────────────────────────────────

describe('GET /api/tax/summary', () => {
  it('returns 200 with tax comparison data', async () => {
    m(taxSvc.getTaxSummary).mockResolvedValue({ oldRegime: { tax: 100_000 }, newRegime: { tax: 80_000 } });
    const res = await request(app).get('/api/tax/summary');
    expect(res.status).toBe(200);
    expect(res.body.data.oldRegime.tax).toBe(100_000);
  });
});

describe('GET /api/tax/80c-tracker', () => {
  it('returns 200 with 80C tracker data', async () => {
    m(taxSvc.get80CTracker).mockResolvedValue([{ name: 'ELSS', amount: 50_000 }]);
    const res = await request(app).get('/api/tax/80c-tracker');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('GET /api/tax/advance-tax-calendar', () => {
  it('returns 200 with advance tax schedule', async () => {
    m(taxSvc.getAdvanceTaxCalendar).mockResolvedValue([{ quarter: 'Q1', dueDate: '2024-06-15', amount: 25_000 }]);
    const res = await request(app).get('/api/tax/advance-tax-calendar');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

// ─── HRA Calculator ───────────────────────────────────────────────────────────

describe('GET /api/tax/hra-calculator', () => {
  it('returns 200 with exempt and taxable amounts', async () => {
    m(taxSvc.calcHRAExemption).mockReturnValue(60_000);
    const res = await request(app).get('/api/tax/hra-calculator?basicSalary=500000&hraReceived=120000&rentPaid=10000&city=METRO');
    expect(res.status).toBe(200);
    expect(res.body.data.exempt).toBe(60_000);
    expect(res.body.data.taxable).toBe(60_000); // 120000 - 60000
  });

  it('returns 422 when city is invalid', async () => {
    const res = await request(app).get('/api/tax/hra-calculator?basicSalary=500000&hraReceived=120000&rentPaid=10000&city=INVALID');
    expect(res.status).toBe(422);
  });

  it('returns 422 when basicSalary is non-numeric', async () => {
    const res = await request(app).get('/api/tax/hra-calculator?basicSalary=abc&hraReceived=120000&rentPaid=10000');
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
    const res = await request(app).get('/api/tax/capital-gains?fy=2024-25');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('GET /api/tax/capital-gains/summary', () => {
  it('returns 200 with CG summary', async () => {
    m(cgSvc.calcCapitalGainsSummary).mockResolvedValue({ stcg: 10_000, ltcg: 0, totalTaxableGain: 10_000 });
    const res = await request(app).get('/api/tax/capital-gains/summary');
    expect(res.status).toBe(200);
    expect(res.body.data.stcg).toBe(10_000);
  });
});

describe('POST /api/tax/capital-gains', () => {
  it('returns 200 on valid CG entry', async () => {
    // Note: tax routes use sendSuccess(res, entry, 201) where 201 is passed as
    // the message argument, so the actual HTTP status is 200 (not 201).
    const res = await request(app).post('/api/tax/capital-gains').send(VALID_CG);
    expect(res.status).toBe(200);
  });

  it('returns 422 when assetType is invalid', async () => {
    const res = await request(app).post('/api/tax/capital-gains').send({ ...VALID_CG, assetType: 'BITCOIN' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when purchaseDate is not a datetime', async () => {
    const res = await request(app).post('/api/tax/capital-gains').send({ ...VALID_CG, purchaseDate: 'not-a-date' });
    expect(res.status).toBe(422);
  });
});

describe('PUT /api/tax/capital-gains/:id', () => {
  it('returns 200 on valid update', async () => {
    const res = await request(app).put('/api/tax/capital-gains/cg-1').send({ salePrice: 60_000 });
    expect(res.status).toBe(200);
  });

  it('returns 404 when service returns null', async () => {
    m(cgSvc.updateCapitalGain).mockResolvedValue(null);
    const res = await request(app).put('/api/tax/capital-gains/nonexistent').send({ salePrice: 1 });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/tax/capital-gains/:id', () => {
  it('returns 200 on successful delete', async () => {
    const res = await request(app).delete('/api/tax/capital-gains/cg-1');
    expect(res.status).toBe(200);
  });

  it('returns 404 when service returns null', async () => {
    m(cgSvc.deleteCapitalGain).mockResolvedValue(null);
    const res = await request(app).delete('/api/tax/capital-gains/nonexistent');
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
    const res = await request(app).get('/api/tax/other-income');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('GET /api/tax/other-income/summary', () => {
  it('returns 200 with summary (OLD regime — null profile fallback)', async () => {
    const res = await request(app).get('/api/tax/other-income/summary');
    expect(res.status).toBe(200);
    // getTaxProfile returns null → regime defaults to 'OLD'
    expect(m(osSvc.calcOtherIncomeSummary)).toHaveBeenCalledWith('u1', expect.any(String), 'OLD');
  });

  it('uses NEW regime when profile has regime=NEW', async () => {
    m(taxSvc.getTaxProfile).mockResolvedValue({ regime: 'NEW' });
    const res = await request(app).get('/api/tax/other-income/summary');
    expect(res.status).toBe(200);
    expect(m(osSvc.calcOtherIncomeSummary)).toHaveBeenCalledWith('u1', expect.any(String), 'NEW');
  });
});

describe('POST /api/tax/other-income', () => {
  it('returns 200 on valid entry', async () => {
    // Note: uses sendSuccess(res, entry, 201) — 201 is passed as message, not status code
    const res = await request(app).post('/api/tax/other-income').send(VALID_OS);
    expect(res.status).toBe(200);
  });

  it('returns 422 when sourceType is invalid', async () => {
    const res = await request(app).post('/api/tax/other-income').send({ ...VALID_OS, sourceType: 'LOTTERY' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when amount is not positive', async () => {
    const res = await request(app).post('/api/tax/other-income').send({ ...VALID_OS, amount: -500 });
    expect(res.status).toBe(422);
  });
});

describe('PUT /api/tax/other-income/:id', () => {
  it('returns 200 on valid update', async () => {
    const res = await request(app).put('/api/tax/other-income/os-1').send({ amount: 6_000 });
    expect(res.status).toBe(200);
  });

  it('returns 404 when service returns null', async () => {
    m(osSvc.updateOtherIncome).mockResolvedValue(null);
    const res = await request(app).put('/api/tax/other-income/nonexistent').send({ amount: 1 });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/tax/other-income/:id', () => {
  it('returns 200 on successful delete', async () => {
    const res = await request(app).delete('/api/tax/other-income/os-1');
    expect(res.status).toBe(200);
  });

  it('returns 404 when service returns null', async () => {
    m(osSvc.deleteOtherIncome).mockResolvedValue(null);
    const res = await request(app).delete('/api/tax/other-income/nonexistent');
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
    const res = await request(app).get('/api/tax/house-property');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('GET /api/tax/house-property/summary', () => {
  it('returns 200 with HP income summary (OLD regime — null profile fallback)', async () => {
    const res = await request(app).get('/api/tax/house-property/summary');
    expect(res.status).toBe(200);
    // getTaxProfile returns null → regime defaults to 'OLD'
    expect(m(hpSvc.calcHousePropertyIncome)).toHaveBeenCalledWith('u1', expect.any(String), 'OLD');
  });

  it('uses NEW regime when profile has regime=NEW', async () => {
    m(taxSvc.getTaxProfile).mockResolvedValue({ regime: 'NEW' });
    const res = await request(app).get('/api/tax/house-property/summary');
    expect(res.status).toBe(200);
    expect(m(hpSvc.calcHousePropertyIncome)).toHaveBeenCalledWith('u1', expect.any(String), 'NEW');
  });
});

describe('POST /api/tax/house-property', () => {
  it('returns 200 on valid HP entry', async () => {
    // Note: uses sendSuccess(res, entry, 201) — 201 is passed as message, not status code
    const res = await request(app).post('/api/tax/house-property').send(VALID_HP);
    expect(res.status).toBe(200);
  });

  it('returns 422 when usage is invalid', async () => {
    const res = await request(app).post('/api/tax/house-property').send({ ...VALID_HP, usage: 'RENTED' });
    expect(res.status).toBe(422);
  });
});

describe('PUT /api/tax/house-property/:id', () => {
  it('returns 200 on valid update', async () => {
    const res = await request(app).put('/api/tax/house-property/hp-1').send({ usage: 'LET_OUT' });
    expect(res.status).toBe(200);
  });

  it('returns 404 when service returns null', async () => {
    m(hpSvc.updateHouseProperty).mockResolvedValue(null);
    const res = await request(app).put('/api/tax/house-property/nonexistent').send({ usage: 'LET_OUT' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/tax/house-property/:id', () => {
  it('returns 200 on successful delete', async () => {
    const res = await request(app).delete('/api/tax/house-property/hp-1');
    expect(res.status).toBe(200);
  });

  it('returns 404 when service returns null', async () => {
    m(hpSvc.deleteHouseProperty).mockResolvedValue(null);
    const res = await request(app).delete('/api/tax/house-property/nonexistent');
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
    const res = await request(app).get('/api/tax/foreign-assets');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('GET /api/tax/foreign-assets/summary', () => {
  it('returns 200 with FA summary', async () => {
    const res = await request(app).get('/api/tax/foreign-assets/summary');
    expect(res.status).toBe(200);
  });
});

describe('POST /api/tax/foreign-assets', () => {
  it('returns 200 on valid FA entry', async () => {
    // Note: uses sendSuccess(res, entry, 201) — 201 is passed as message, not status code
    const res = await request(app).post('/api/tax/foreign-assets').send(VALID_FA);
    expect(res.status).toBe(200);
  });

  it('returns 422 when category is invalid', async () => {
    const res = await request(app).post('/api/tax/foreign-assets').send({ ...VALID_FA, category: 'CRYPTO' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when acquisitionCostINR is negative', async () => {
    const res = await request(app).post('/api/tax/foreign-assets').send({ ...VALID_FA, acquisitionCostINR: -1000 });
    expect(res.status).toBe(422);
  });
});

describe('PUT /api/tax/foreign-assets/:id', () => {
  it('returns 200 on valid update', async () => {
    const res = await request(app).put('/api/tax/foreign-assets/fa-1').send({ closingValueINR: 700_000 });
    expect(res.status).toBe(200);
  });

  it('returns 404 when service returns null', async () => {
    m(faSvc.updateForeignAsset).mockResolvedValue(null);
    const res = await request(app).put('/api/tax/foreign-assets/nonexistent').send({ country: 'UK' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/tax/foreign-assets/:id', () => {
  it('returns 200 on successful delete', async () => {
    const res = await request(app).delete('/api/tax/foreign-assets/fa-1');
    expect(res.status).toBe(200);
  });

  it('returns 404 when service returns null', async () => {
    m(faSvc.deleteForeignAsset).mockResolvedValue(null);
    const res = await request(app).delete('/api/tax/foreign-assets/nonexistent');
    expect(res.status).toBe(404);
  });
});

// ─── ITR-2 Summary ────────────────────────────────────────────────────────────

describe('GET /api/tax/itr2-summary', () => {
  it('returns 200 with ITR-2 structure', async () => {
    m(taxSvc.getITR2Summary).mockResolvedValue({ schedules: { CG: {}, OS: {} } });
    const res = await request(app).get('/api/tax/itr2-summary?fy=2024-25');
    expect(res.status).toBe(200);
    expect(res.body.data.schedules).toBeDefined();
  });

  it('passes fy to service', async () => {
    await request(app).get('/api/tax/itr2-summary?fy=2025-26');
    expect(m(taxSvc.getITR2Summary)).toHaveBeenCalledWith('u1', '2025-26');
  });
});
