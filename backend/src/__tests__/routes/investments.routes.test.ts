/**
 * Route integration tests for /api/investments.
 *
 * Covers all 6 sub-domains: portfolio, exchange-rates, FD, RD, SIP,
 * investments (equity/MF), gold, real-estate.
 * Each group: happy-path GET + POST (valid/invalid) + PUT + DELETE.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'u1', email: 'a@b.com', role: 'ADMIN' };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../services/investmentService', () => ({
  getPortfolioSummary: vi.fn(),
  get80CSummary: vi.fn(),
  getExchangeRates: vi.fn(),
  upsertExchangeRate: vi.fn(),
  getFDs: vi.fn(),
  getFDsMaturing: vi.fn(),
  createFD: vi.fn(),
  updateFD: vi.fn(),
  deleteFD: vi.fn(),
  getRDs: vi.fn(),
  createRD: vi.fn(),
  updateRD: vi.fn(),
  deleteRD: vi.fn(),
  getSIPs: vi.fn(),
  getSIPsUpcoming: vi.fn(),
  createSIP: vi.fn(),
  updateSIP: vi.fn(),
  deleteSIP: vi.fn(),
  addSIPTransaction: vi.fn(),
  getInvestments: vi.fn(),
  createInvestment: vi.fn(),
  updateInvestment: vi.fn(),
  deleteInvestment: vi.fn(),
  getGoldHoldings: vi.fn(),
  createGoldHolding: vi.fn(),
  updateGoldHolding: vi.fn(),
  deleteGoldHolding: vi.fn(),
  getRealEstate: vi.fn(),
  createRealEstate: vi.fn(),
  updateRealEstate: vi.fn(),
  deleteRealEstate: vi.fn(),
}));

import investmentsRouter from '../../routes/investments';
import * as svc from '../../services/investmentService';
import { makeApp } from '../helpers/makeApp';

const app = makeApp(investmentsRouter, '/api/investments');

// Helper: cast any svc export to vi.fn
const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  m(svc.getPortfolioSummary).mockResolvedValue({ totalInvested: 0, totalCurrentValue: 0, xirr: null });
  m(svc.get80CSummary).mockResolvedValue({ totalInvested: 0, limit: 150_000 });
  m(svc.getExchangeRates).mockResolvedValue([{ fromCurrency: 'USD', toCurrency: 'INR', rate: 83 }]);
  m(svc.upsertExchangeRate).mockResolvedValue({ fromCurrency: 'USD', toCurrency: 'INR', rate: 85 });
  m(svc.getFDs).mockResolvedValue([]);
  m(svc.getFDsMaturing).mockResolvedValue([]);
  m(svc.createFD).mockResolvedValue({ id: 'fd-1' });
  m(svc.updateFD).mockResolvedValue({ id: 'fd-1' });
  m(svc.deleteFD).mockResolvedValue(undefined);
  m(svc.getRDs).mockResolvedValue([]);
  m(svc.createRD).mockResolvedValue({ id: 'rd-1' });
  m(svc.updateRD).mockResolvedValue({ id: 'rd-1' });
  m(svc.deleteRD).mockResolvedValue(undefined);
  m(svc.getSIPs).mockResolvedValue([]);
  m(svc.getSIPsUpcoming).mockResolvedValue([]);
  m(svc.createSIP).mockResolvedValue({ id: 'sip-1' });
  m(svc.updateSIP).mockResolvedValue({ id: 'sip-1' });
  m(svc.deleteSIP).mockResolvedValue(undefined);
  m(svc.addSIPTransaction).mockResolvedValue({ id: 'tx-1' });
  m(svc.getInvestments).mockResolvedValue({ items: [], pagination: { total: 0, page: 1, pageSize: 25 } });
  m(svc.createInvestment).mockResolvedValue({ id: 'inv-1' });
  m(svc.updateInvestment).mockResolvedValue({ id: 'inv-1' });
  m(svc.deleteInvestment).mockResolvedValue(undefined);
  m(svc.getGoldHoldings).mockResolvedValue([]);
  m(svc.createGoldHolding).mockResolvedValue({ id: 'gold-1' });
  m(svc.updateGoldHolding).mockResolvedValue({ id: 'gold-1' });
  m(svc.deleteGoldHolding).mockResolvedValue(undefined);
  m(svc.getRealEstate).mockResolvedValue([]);
  m(svc.createRealEstate).mockResolvedValue({ id: 're-1' });
  m(svc.updateRealEstate).mockResolvedValue({ id: 're-1' });
  m(svc.deleteRealEstate).mockResolvedValue(undefined);
});

// ─── Portfolio ────────────────────────────────────────────────────────────────

describe('GET /api/investments/portfolio-summary', () => {
  it('returns 200 with portfolio metrics', async () => {
    m(svc.getPortfolioSummary).mockResolvedValue({ totalInvested: 100_000, totalCurrentValue: 120_000, xirr: 0.2 });
    const res = await request(app).get('/api/investments/portfolio-summary');
    expect(res.status).toBe(200);
    expect(res.body.data.totalCurrentValue).toBe(120_000);
  });
});

describe('GET /api/investments/80c-summary', () => {
  it('returns 200 with 80C tracker', async () => {
    const res = await request(app).get('/api/investments/80c-summary?fy=2024-25');
    expect(res.status).toBe(200);
    expect(m(svc.get80CSummary)).toHaveBeenCalledWith('u1', '2024-25');
  });

  it('falls back to current FY when fy param is absent (parseFY non-string path)', async () => {
    // Pin clock to June 2025 → FY 2025-26 so the assertion is deterministic
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15'));
    try {
      await request(app).get('/api/investments/80c-summary');
      // parseFY(undefined) → typeof undefined !== 'string' → s='' → regex fails → getCurrentFY()
      expect(m(svc.get80CSummary)).toHaveBeenCalledWith('u1', '2025-26');
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── Exchange Rates ───────────────────────────────────────────────────────────

describe('GET /api/investments/exchange-rates', () => {
  it('returns 200 with exchange rates', async () => {
    const res = await request(app).get('/api/investments/exchange-rates');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('PUT /api/investments/exchange-rates/:currency', () => {
  it('returns 200 on valid rate update', async () => {
    const res = await request(app).put('/api/investments/exchange-rates/USD').send({ rate: 85 });
    expect(res.status).toBe(200);
    expect(m(svc.upsertExchangeRate)).toHaveBeenCalledWith('USD', 85, 'u1');
  });

  it('returns 422 when rate is not positive', async () => {
    const res = await request(app).put('/api/investments/exchange-rates/USD').send({ rate: -1 });
    expect(res.status).toBe(422);
  });
});

// ─── FDs ──────────────────────────────────────────────────────────────────────

const VALID_FD = {
  bankName: 'HDFC',
  principalAmount: 100_000,
  interestRate: 7.5,
  tenureMonths: 12,
  startDate: '2024-01-01',
  maturityDate: '2025-01-01',
};

describe('GET /api/investments/fd', () => {
  it('returns 200 with FD list', async () => {
    m(svc.getFDs).mockResolvedValue([{ id: 'fd-1', bankName: 'HDFC' }]);
    const res = await request(app).get('/api/investments/fd');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('GET /api/investments/fd/maturing-soon', () => {
  it('returns 200 with maturing FDs', async () => {
    const res = await request(app).get('/api/investments/fd/maturing-soon?days=7');
    expect(res.status).toBe(200);
    expect(m(svc.getFDsMaturing)).toHaveBeenCalledWith('u1', 7);
  });

  it('defaults to 30 days when days param is absent', async () => {
    await request(app).get('/api/investments/fd/maturing-soon');
    expect(m(svc.getFDsMaturing)).toHaveBeenCalledWith('u1', 30);
  });
});

describe('POST /api/investments/fd', () => {
  it('returns 201 on valid FD creation', async () => {
    const res = await request(app).post('/api/investments/fd').send(VALID_FD);
    expect(res.status).toBe(201);
  });

  it('returns 422 when bankName is missing', async () => {
    const { bankName: _, ...noBank } = VALID_FD;
    const res = await request(app).post('/api/investments/fd').send(noBank);
    expect(res.status).toBe(422);
  });

  it('returns 422 when principalAmount is not positive', async () => {
    const res = await request(app).post('/api/investments/fd').send({ ...VALID_FD, principalAmount: 0 });
    expect(res.status).toBe(422);
  });

  it('returns 422 when interestPayoutType is invalid', async () => {
    const res = await request(app).post('/api/investments/fd').send({ ...VALID_FD, interestPayoutType: 'INVALID' });
    expect(res.status).toBe(422);
  });
});

describe('PUT /api/investments/fd/:id', () => {
  it('returns 200 on successful FD update', async () => {
    const res = await request(app).put('/api/investments/fd/fd-1').send({ interestRate: 8.0 });
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/investments/fd/:id', () => {
  it('returns 204 on deletion', async () => {
    const res = await request(app).delete('/api/investments/fd/fd-1');
    expect(res.status).toBe(204);
  });
});

// ─── RDs ──────────────────────────────────────────────────────────────────────

const VALID_RD = {
  bankName: 'SBI',
  monthlyInstallment: 5_000,
  interestRate: 6.5,
  tenureMonths: 12,
  startDate: '2024-01-01',
  maturityDate: '2025-01-01',
};

describe('GET /api/investments/rd', () => {
  it('returns 200 with RD list', async () => {
    const res = await request(app).get('/api/investments/rd');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('POST /api/investments/rd', () => {
  it('returns 201 on valid RD creation', async () => {
    const res = await request(app).post('/api/investments/rd').send(VALID_RD);
    expect(res.status).toBe(201);
  });

  it('returns 422 when monthlyInstallment is not positive', async () => {
    const res = await request(app).post('/api/investments/rd').send({ ...VALID_RD, monthlyInstallment: -500 });
    expect(res.status).toBe(422);
  });
});

describe('PUT /api/investments/rd/:id', () => {
  it('returns 200 on valid update', async () => {
    const res = await request(app).put('/api/investments/rd/rd-1').send({ interestRate: 7.0 });
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/investments/rd/:id', () => {
  it('returns 204 on deletion', async () => {
    const res = await request(app).delete('/api/investments/rd/rd-1');
    expect(res.status).toBe(204);
  });
});

// ─── SIPs ─────────────────────────────────────────────────────────────────────

const VALID_SIP = {
  investmentId: 'inv-1',
  fundName: 'Axis Bluechip',
  monthlyAmount: 5_000,
  sipDate: 10,
  startDate: '2024-01-01',
};

describe('GET /api/investments/sip', () => {
  it('returns 200 with SIP list', async () => {
    m(svc.getSIPs).mockResolvedValue([{ id: 'sip-1', fundName: 'Axis Bluechip' }]);
    const res = await request(app).get('/api/investments/sip');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('GET /api/investments/sip/upcoming', () => {
  it('returns 200 with upcoming SIPs', async () => {
    const res = await request(app).get('/api/investments/sip/upcoming?days=14');
    expect(res.status).toBe(200);
    expect(m(svc.getSIPsUpcoming)).toHaveBeenCalledWith('u1', 14);
  });

  it('defaults to 7 days when days param is absent', async () => {
    await request(app).get('/api/investments/sip/upcoming');
    expect(m(svc.getSIPsUpcoming)).toHaveBeenCalledWith('u1', 7);
  });
});

describe('POST /api/investments/sip', () => {
  it('returns 201 on valid SIP creation', async () => {
    const res = await request(app).post('/api/investments/sip').send(VALID_SIP);
    expect(res.status).toBe(201);
  });

  it('returns 422 when sipDate is out of range (>28)', async () => {
    const res = await request(app).post('/api/investments/sip').send({ ...VALID_SIP, sipDate: 31 });
    expect(res.status).toBe(422);
  });

  it('returns 422 when monthlyAmount is not positive', async () => {
    const res = await request(app).post('/api/investments/sip').send({ ...VALID_SIP, monthlyAmount: 0 });
    expect(res.status).toBe(422);
  });
});

describe('PUT /api/investments/sip/:id', () => {
  it('returns 200 on valid SIP update', async () => {
    const res = await request(app).put('/api/investments/sip/sip-1').send({ monthlyAmount: 6_000 });
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/investments/sip/:id', () => {
  it('returns 204 on deletion', async () => {
    const res = await request(app).delete('/api/investments/sip/sip-1');
    expect(res.status).toBe(204);
  });
});

describe('POST /api/investments/sip/:id/transactions', () => {
  const VALID_TX = {
    date: '2024-01-10T00:00:00.000Z',
    units: 10.5,
    nav: 45.5,
    amount: 5_000,
  };

  it('returns 201 on valid SIP transaction', async () => {
    const res = await request(app).post('/api/investments/sip/sip-1/transactions').send(VALID_TX);
    expect(res.status).toBe(201);
  });

  it('returns 422 when units is not positive', async () => {
    const res = await request(app).post('/api/investments/sip/sip-1/transactions').send({ ...VALID_TX, units: -1 });
    expect(res.status).toBe(422);
  });
});

// ─── Investments (equity / MF) ────────────────────────────────────────────────

const VALID_INVESTMENT = {
  type: 'MUTUAL_FUND',
  name: 'Axis Bluechip Fund',
  currency: 'INR',
  unitsOrQuantity: 100,
  purchasePricePerUnit: 45,
  purchaseDate: '2023-01-01',
  currentPricePerUnit: 55,
};

describe('GET /api/investments', () => {
  it('returns 200 with paginated investments', async () => {
    m(svc.getInvestments).mockResolvedValue({
      items: [{ id: 'inv-1', name: 'Axis Bluechip' }],
      pagination: { total: 1, page: 1, pageSize: 25 },
    });
    const res = await request(app).get('/api/investments');
    expect(res.status).toBe(200);
  });

  it('clamps page=0 to page=1', async () => {
    await request(app).get('/api/investments?page=0');
    expect(m(svc.getInvestments)).toHaveBeenCalledWith('u1', undefined, 1, expect.any(Number));
  });

  it('falls back to page=1 when page is not a finite number', async () => {
    await request(app).get('/api/investments?page=invalid');
    // Number('invalid') is NaN → Number.isFinite(NaN) is false → defaults to 1
    expect(m(svc.getInvestments)).toHaveBeenCalledWith('u1', undefined, 1, expect.any(Number));
  });

  it('caps pageSize=200 to 100', async () => {
    await request(app).get('/api/investments?pageSize=200');
    expect(m(svc.getInvestments)).toHaveBeenCalledWith('u1', undefined, expect.any(Number), 100);
  });
});

describe('POST /api/investments', () => {
  it('returns 201 on valid investment creation', async () => {
    const res = await request(app).post('/api/investments').send(VALID_INVESTMENT);
    expect(res.status).toBe(201);
  });

  it('returns 422 when type is invalid', async () => {
    const res = await request(app).post('/api/investments').send({ ...VALID_INVESTMENT, type: 'BAD_TYPE' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when unitsOrQuantity is not positive', async () => {
    const res = await request(app).post('/api/investments').send({ ...VALID_INVESTMENT, unitsOrQuantity: -5 });
    expect(res.status).toBe(422);
  });
});

describe('PUT /api/investments/:id', () => {
  it('returns 200 on valid update', async () => {
    const res = await request(app).put('/api/investments/inv-1').send({ currentPricePerUnit: 60 });
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/investments/:id', () => {
  it('returns 204 on deletion', async () => {
    const res = await request(app).delete('/api/investments/inv-1');
    expect(res.status).toBe(204);
  });
});

// ─── Gold ─────────────────────────────────────────────────────────────────────

const VALID_GOLD = {
  type: 'PHYSICAL',
  quantityGrams: 10,
  purchasePricePerGram: 5000,
  currentPricePerGram: 6000,
  purchaseDate: '2023-01-01',
};

describe('GET /api/investments/gold', () => {
  it('returns 200 with gold holdings', async () => {
    const res = await request(app).get('/api/investments/gold');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('POST /api/investments/gold', () => {
  it('returns 201 on valid gold creation', async () => {
    const res = await request(app).post('/api/investments/gold').send(VALID_GOLD);
    expect(res.status).toBe(201);
  });

  it('returns 422 when type is invalid', async () => {
    const res = await request(app).post('/api/investments/gold').send({ ...VALID_GOLD, type: 'BAR' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when quantityGrams is not positive', async () => {
    const res = await request(app).post('/api/investments/gold').send({ ...VALID_GOLD, quantityGrams: 0 });
    expect(res.status).toBe(422);
  });
});

describe('PUT /api/investments/gold/:id', () => {
  it('returns 200 on valid update', async () => {
    const res = await request(app).put('/api/investments/gold/gold-1').send({ currentPricePerGram: 6500 });
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/investments/gold/:id', () => {
  it('returns 204 on deletion', async () => {
    const res = await request(app).delete('/api/investments/gold/gold-1');
    expect(res.status).toBe(204);
  });
});

// ─── Real Estate ──────────────────────────────────────────────────────────────

const VALID_RE = {
  propertyType: 'RESIDENTIAL',
  propertyName: 'My Apartment',
  location: 'Mumbai',
  purchasePrice: 5_000_000,
  currentValue: 6_000_000,
  purchaseDate: '2020-01-01',
};

describe('GET /api/investments/real-estate', () => {
  it('returns 200 with real estate list', async () => {
    const res = await request(app).get('/api/investments/real-estate');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('POST /api/investments/real-estate', () => {
  it('returns 201 on valid real estate creation', async () => {
    const res = await request(app).post('/api/investments/real-estate').send(VALID_RE);
    expect(res.status).toBe(201);
  });

  it('returns 422 when propertyType is invalid', async () => {
    const res = await request(app).post('/api/investments/real-estate').send({ ...VALID_RE, propertyType: 'SHED' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when purchasePrice is not positive', async () => {
    const res = await request(app).post('/api/investments/real-estate').send({ ...VALID_RE, purchasePrice: 0 });
    expect(res.status).toBe(422);
  });
});

describe('PUT /api/investments/real-estate/:id', () => {
  it('returns 200 on valid update', async () => {
    const res = await request(app).put('/api/investments/real-estate/re-1').send({ currentValue: 7_000_000 });
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/investments/real-estate/:id', () => {
  it('returns 204 on deletion', async () => {
    const res = await request(app).delete('/api/investments/real-estate/re-1');
    expect(res.status).toBe(204);
  });
});
