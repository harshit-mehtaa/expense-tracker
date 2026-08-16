/**
 * Tests for investmentsApi — ~30 methods across six asset classes.
 *
 * This file sat at 86% statements but 17% FUNCTIONS: the API object was defined but
 * almost none of its methods were ever called. Every method is exercised here.
 *
 * The read/write param asymmetry mirrors the backend deliberately: GET routes resolve the
 * target member from `userId` (backend passes `paramName: 'userId'`), writes use the
 * default `targetUserId`. Sending the wrong one silently returns the requester's own data
 * instead of the selected member's, so both are asserted on the wire.
 */
import { describe, it, expect } from 'vitest';
import { investmentsApi } from '@/api/investments';
import { capture } from './captureRequest';

const TARGET = 'clm1234567890abcdefghij';

const RAW_INVESTMENT = {
  id: 'i1', type: 'MUTUAL_FUND', name: 'Axis Bluechip', currency: 'INR',
  purchaseDate: '2024-01-01', isTaxSaving: false,
  investedINR: 100000, currentValueINR: 125000, gainINR: 25000, gainPct: 25,
  unitsOrQuantity: '100.5000', purchasePricePerUnit: '995.02', currentPricePerUnit: '1243.78',
};

const RAW_FD = {
  id: 'fd1', bankName: 'HDFC', tenureMonths: 12, startDate: '2025-04-01',
  maturityDate: '2026-04-01', interestPayoutType: 'CUMULATIVE', isTaxSaver: false,
  status: 'ACTIVE' as const,
  principalAmount: '125000.00', maturityAmount: '134000.00', interestRate: '7.20',
};

const RAW_RD = {
  id: 'rd1', bankName: 'SBI', tenureMonths: 24, startDate: '2025-04-01',
  maturityDate: '2027-04-01', installmentsPaid: 12, status: 'ACTIVE' as const,
  monthlyInstallment: '5000.00', maturityAmount: '128000.00',
  totalDeposited: '60000.00', interestRate: '6.80',
};

const RAW_SIP = {
  id: 's1', fundName: 'Axis Bluechip', sipDate: 5, startDate: '2024-01-01',
  status: 'ACTIVE', monthlyAmount: '5000.00', investment: RAW_INVESTMENT,
};

const RAW_GOLD = {
  id: 'g1', type: 'PHYSICAL', purchaseDate: '2024-01-01',
  quantityGrams: '50.500', purchasePricePerGram: '6000.00', currentPricePerGram: '7200.00',
};

const RAW_PROPERTY = {
  id: 're1', userId: 'u1', propertyType: 'RESIDENTIAL', propertyName: 'Flat 3B',
  location: 'Pune', purchaseDate: '2020-01-01',
  purchasePrice: '5000000.00', currentValue: '7500000.00',
  owners: [{ userId: 'u1', name: 'Asha', sharePercent: '60.00' }],
};

// ─── Reads: userId scoping ────────────────────────────────────────────────────

describe('investmentsApi — reads scope with `userId`', () => {
  const READS: Array<[string, string, (t?: string) => Promise<unknown>, unknown]> = [
    ['getPortfolioSummary', '/investments/portfolio-summary',
      (t) => investmentsApi.getPortfolioSummary(t ? { targetUserId: t } : undefined), { data: { totalInvested: 0 } }],
    ['getSIPs', '/investments/sip',
      (t) => investmentsApi.getSIPs(t ? { targetUserId: t } : undefined), { data: [] }],
  ];

  it.each(READS)('%s sends userId when a member is selected', async (_n, path, call, res) => {
    const c = capture('get', path, res);
    await call(TARGET);

    expect(c.seen?.params.get('userId')).toBe(TARGET);
    expect(c.seen?.params.has('targetUserId')).toBe(false);
  });

  it.each(READS)('%s sends no scope param when none is selected', async (_n, path, call, res) => {
    const c = capture('get', path, res);
    await call(undefined);
    expect(c.seen?.params.has('userId')).toBe(false);
  });

  it('get80CSummary always sends fy, plus userId only when selected', async () => {
    const withTarget = capture('get', '/investments/80c-summary', { data: { total: 150000 } });
    await investmentsApi.get80CSummary('2025-26', { targetUserId: TARGET });
    expect(withTarget.seen?.params.get('fy')).toBe('2025-26');
    expect(withTarget.seen?.params.get('userId')).toBe(TARGET);

    const without = capture('get', '/investments/80c-summary', { data: {} });
    await investmentsApi.get80CSummary('2025-26');
    expect(without.seen?.params.get('fy')).toBe('2025-26');
    expect(without.seen?.params.has('userId')).toBe(false);
  });
});

// ─── Investments list + pagination ────────────────────────────────────────────

describe('investmentsApi.getAll', () => {
  const PAGE = { data: [RAW_INVESTMENT], pagination: { total: 1, limit: 25, hasMore: false } };

  it('defaults to page 1 / pageSize 25 when called with no params', async () => {
    const c = capture('get', '/investments', PAGE);
    await investmentsApi.getAll();

    expect(c.seen?.params.get('page')).toBe('1');
    expect(c.seen?.params.get('pageSize')).toBe('25');
    expect(c.seen?.params.has('type')).toBe(false);
    expect(c.seen?.params.has('userId')).toBe(false);
  });

  it('forwards type, userId and explicit pagination together', async () => {
    const c = capture('get', '/investments', PAGE);
    await investmentsApi.getAll({ type: 'ELSS', page: 3, pageSize: 50, targetUserId: TARGET });

    expect(c.seen?.params.get('type')).toBe('ELSS');
    expect(c.seen?.params.get('userId')).toBe(TARGET);
    expect(c.seen?.params.get('page')).toBe('3');
    expect(c.seen?.params.get('pageSize')).toBe('50');
  });

  it('returns items normalized and pagination passed through untouched', async () => {
    capture('get', '/investments', PAGE);
    const result = await investmentsApi.getAll();

    expect(result.pagination).toEqual({ total: 1, limit: 25, hasMore: false });
    expect(result.items[0].unitsOrQuantity).toBe(100.5);
    expect(typeof result.items[0].purchasePricePerUnit).toBe('number');
  });
});

// ─── Per-asset CRUD ───────────────────────────────────────────────────────────

describe('investmentsApi — investment CRUD', () => {
  it('create sends targetUserId (write scoping) and normalizes', async () => {
    const c = capture('post', '/investments', { data: RAW_INVESTMENT });
    const created = await investmentsApi.create({ name: 'Axis' }, { targetUserId: TARGET });

    expect(c.seen?.params.get('targetUserId')).toBe(TARGET);
    expect(c.seen?.params.has('userId')).toBe(false);
    expect(created.unitsOrQuantity).toBe(100.5);
  });

  it('create omits the param with no opts', async () => {
    const c = capture('post', '/investments', { data: RAW_INVESTMENT });
    await investmentsApi.create({ name: 'X' });
    expect(c.seen?.params.has('targetUserId')).toBe(false);
  });

  it('update PUTs by id and normalizes', async () => {
    const c = capture('put', '/investments/i1', { data: RAW_INVESTMENT });
    const updated = await investmentsApi.update('i1', { currentPricePerUnit: 1243.78 });

    expect(c.seen?.url).toContain('/investments/i1');
    expect(updated.currentPricePerUnit).toBe(1243.78);
  });

  it('delete DELETEs by id', async () => {
    const c = capture('delete', '/investments/i1', { data: null });
    await investmentsApi.delete('i1');
    expect(c.seen?.method).toBe('DELETE');
  });

  it('normalizeInvestment only adds optional nav/rate keys when present', async () => {
    capture('get', '/investments', { data: [RAW_INVESTMENT], pagination: {} });
    const bare = (await investmentsApi.getAll()).items[0];
    expect(bare).not.toHaveProperty('purchaseNav');

    capture('get', '/investments', {
      data: [{ ...RAW_INVESTMENT, purchaseNav: '99.50', currentNav: '124.38', purchaseExchangeRate: '83.20' }],
      pagination: {},
    });
    const withNav = (await investmentsApi.getAll()).items[0];
    expect(withNav.purchaseNav).toBe(99.5);
    expect(withNav.currentNav).toBe(124.38);
    expect(withNav.purchaseExchangeRate).toBe(83.2);
  });
});

describe('investmentsApi — FD CRUD', () => {
  it('getFDs forwards status and userId independently', async () => {
    const both = capture('get', '/investments/fd', { data: [] });
    await investmentsApi.getFDs({ status: 'ACTIVE', targetUserId: TARGET });
    expect(both.seen?.params.get('status')).toBe('ACTIVE');
    expect(both.seen?.params.get('userId')).toBe(TARGET);

    const statusOnly = capture('get', '/investments/fd', { data: [] });
    await investmentsApi.getFDs({ status: 'MATURED' });
    expect(statusOnly.seen?.params.get('status')).toBe('MATURED');
    expect(statusOnly.seen?.params.has('userId')).toBe(false);

    const neither = capture('get', '/investments/fd', { data: [] });
    await investmentsApi.getFDs();
    expect([...neither.seen!.params.keys()]).toEqual([]);
  });

  it('getFDs normalizes principal, maturity and rate', async () => {
    capture('get', '/investments/fd', { data: [RAW_FD] });
    const [fd] = await investmentsApi.getFDs();

    expect(fd.principalAmount).toBe(125000);
    expect(fd.maturityAmount).toBe(134000);
    expect(fd.interestRate).toBe(7.2);
  });

  it('createFD / updateFD / deleteFD', async () => {
    const created = capture('post', '/investments/fd', { data: RAW_FD });
    const fd = await investmentsApi.createFD({ bankName: 'HDFC' }, { targetUserId: TARGET });
    expect(created.seen?.params.get('targetUserId')).toBe(TARGET);
    expect(fd.principalAmount).toBe(125000);

    const bare = capture('post', '/investments/fd', { data: RAW_FD });
    await investmentsApi.createFD({ bankName: 'X' });
    expect(bare.seen?.params.has('targetUserId')).toBe(false);

    const updated = capture('put', '/investments/fd/fd1', { data: RAW_FD });
    expect((await investmentsApi.updateFD('fd1', { interestRate: 7.2 })).interestRate).toBe(7.2);
    expect(updated.seen?.url).toContain('/investments/fd/fd1');

    const del = capture('delete', '/investments/fd/fd1', { data: null });
    await investmentsApi.deleteFD('fd1');
    expect(del.seen?.method).toBe('DELETE');
  });
});

describe('investmentsApi — RD CRUD', () => {
  it('getRDs forwards status and userId independently', async () => {
    const both = capture('get', '/investments/rd', { data: [] });
    await investmentsApi.getRDs({ status: 'ACTIVE', targetUserId: TARGET });
    expect(both.seen?.params.get('status')).toBe('ACTIVE');
    expect(both.seen?.params.get('userId')).toBe(TARGET);

    const neither = capture('get', '/investments/rd', { data: [] });
    await investmentsApi.getRDs();
    expect([...neither.seen!.params.keys()]).toEqual([]);
  });

  it('getRDs normalizes installment, maturity, deposited and rate', async () => {
    capture('get', '/investments/rd', { data: [RAW_RD] });
    const [rd] = await investmentsApi.getRDs();

    expect(rd.monthlyInstallment).toBe(5000);
    expect(rd.maturityAmount).toBe(128000);
    expect(rd.totalDeposited).toBe(60000);
    expect(rd.interestRate).toBe(6.8);
  });

  it('createRD / updateRD / deleteRD', async () => {
    const created = capture('post', '/investments/rd', { data: RAW_RD });
    expect((await investmentsApi.createRD({ bankName: 'SBI' }, { targetUserId: TARGET })).monthlyInstallment).toBe(5000);
    expect(created.seen?.params.get('targetUserId')).toBe(TARGET);

    const bare = capture('post', '/investments/rd', { data: RAW_RD });
    await investmentsApi.createRD({ bankName: 'X' });
    expect(bare.seen?.params.has('targetUserId')).toBe(false);

    const updated = capture('put', '/investments/rd/rd1', { data: RAW_RD });
    expect((await investmentsApi.updateRD('rd1', { interestRate: 6.8 })).interestRate).toBe(6.8);
    expect(updated.seen?.url).toContain('/investments/rd/rd1');

    const del = capture('delete', '/investments/rd/rd1', { data: null });
    await investmentsApi.deleteRD('rd1');
    expect(del.seen?.method).toBe('DELETE');
  });
});

describe('investmentsApi — SIP CRUD', () => {
  it('getSIPs normalizes the SIP AND its nested investment', async () => {
    capture('get', '/investments/sip', { data: [RAW_SIP] });
    const [sip] = await investmentsApi.getSIPs();

    expect(sip.monthlyAmount).toBe(5000);
    // The nested investment must be normalized too — a string here would break any
    // reduce over portfolio value.
    expect(sip.investment.unitsOrQuantity).toBe(100.5);
    expect(typeof sip.investment.purchasePricePerUnit).toBe('number');
  });

  it('createSIP / updateSIP / deleteSIP', async () => {
    const created = capture('post', '/investments/sip', { data: RAW_SIP });
    expect((await investmentsApi.createSIP({ fundName: 'Axis' }, { targetUserId: TARGET })).monthlyAmount).toBe(5000);
    expect(created.seen?.params.get('targetUserId')).toBe(TARGET);

    const bare = capture('post', '/investments/sip', { data: RAW_SIP });
    await investmentsApi.createSIP({ fundName: 'X' });
    expect(bare.seen?.params.has('targetUserId')).toBe(false);

    const updated = capture('put', '/investments/sip/s1', { data: RAW_SIP });
    expect((await investmentsApi.updateSIP('s1', { monthlyAmount: 5000 })).monthlyAmount).toBe(5000);
    expect(updated.seen?.url).toContain('/investments/sip/s1');

    const del = capture('delete', '/investments/sip/s1', { data: null });
    await investmentsApi.deleteSIP('s1');
    expect(del.seen?.method).toBe('DELETE');
  });
});

describe('investmentsApi — Gold CRUD', () => {
  it('getGold sends userId and normalizes every holding, preserving summary', async () => {
    const c = capture('get', '/investments/gold', {
      data: { holdings: [RAW_GOLD], summary: { totalGrams: 50.5 } },
    });
    const r = await investmentsApi.getGold({ targetUserId: TARGET });

    expect(c.seen?.params.get('userId')).toBe(TARGET);
    expect(r.holdings[0].quantityGrams).toBe(50.5);
    expect(r.holdings[0].purchasePricePerGram).toBe(6000);
    expect(r.holdings[0].currentPricePerGram).toBe(7200);
    expect(r.summary).toEqual({ totalGrams: 50.5 });
  });

  it('getGold sends no scope param when none is selected', async () => {
    const c = capture('get', '/investments/gold', { data: { holdings: [], summary: {} } });
    await investmentsApi.getGold();
    expect(c.seen?.params.has('userId')).toBe(false);
  });

  it('createGold / updateGold / deleteGold', async () => {
    const created = capture('post', '/investments/gold', { data: RAW_GOLD });
    expect((await investmentsApi.createGold({ type: 'PHYSICAL' }, { targetUserId: TARGET })).quantityGrams).toBe(50.5);
    expect(created.seen?.params.get('targetUserId')).toBe(TARGET);

    const bare = capture('post', '/investments/gold', { data: RAW_GOLD });
    await investmentsApi.createGold({ type: 'SGB' });
    expect(bare.seen?.params.has('targetUserId')).toBe(false);

    const updated = capture('put', '/investments/gold/g1', { data: RAW_GOLD });
    expect((await investmentsApi.updateGold('g1', { quantityGrams: 50.5 })).quantityGrams).toBe(50.5);
    expect(updated.seen?.url).toContain('/investments/gold/g1');

    const del = capture('delete', '/investments/gold/g1', { data: null });
    await investmentsApi.deleteGold('g1');
    expect(del.seen?.method).toBe('DELETE');
  });
});

describe('investmentsApi — Real estate CRUD', () => {
  it('getRealEstate sends userId and normalizes properties and their owner shares', async () => {
    const c = capture('get', '/investments/real-estate', {
      data: { properties: [RAW_PROPERTY], summary: { totalCurrent: 7500000 } },
    });
    const r = await investmentsApi.getRealEstate({ targetUserId: TARGET });

    expect(c.seen?.params.get('userId')).toBe(TARGET);
    expect(r.properties[0].purchasePrice).toBe(5000000);
    expect(r.properties[0].currentValue).toBe(7500000);
    expect(r.properties[0].owners[0].sharePercent).toBe(60);
  });

  it('normalizeRealEstateProperty adds share/rental/loan keys only when present', async () => {
    capture('get', '/investments/real-estate', { data: { properties: [RAW_PROPERTY] } });
    const bare = (await investmentsApi.getRealEstate()).properties[0];
    expect(bare).not.toHaveProperty('rentalIncomeMonthly');
    expect(bare).not.toHaveProperty('loan');

    capture('get', '/investments/real-estate', {
      data: {
        properties: [{
          ...RAW_PROPERTY,
          rentalIncomeMonthly: '25000.00', sharePercent: '60.00',
          purchasePriceShare: '3000000.00', currentValueShare: '4500000.00',
          rentalIncomeMonthlyShare: '15000.00',
          loan: { id: 'l1', outstandingBalance: '2500000.00' },
        }],
      },
    });
    const full = (await investmentsApi.getRealEstate()).properties[0];
    expect(full.rentalIncomeMonthly).toBe(25000);
    expect(full.sharePercent).toBe(60);
    expect(full.purchasePriceShare).toBe(3000000);
    expect(full.currentValueShare).toBe(4500000);
    expect(full.rentalIncomeMonthlyShare).toBe(15000);
    expect(full.loan.outstandingBalance).toBe(2500000);
  });

  it('defaults owners to an empty array when the field is absent', async () => {
    capture('get', '/investments/real-estate', {
      data: { properties: [{ ...RAW_PROPERTY, owners: undefined }] },
    });
    const p = (await investmentsApi.getRealEstate()).properties[0];
    expect(p.owners).toEqual([]);
  });

  it('createRealEstate / updateRealEstate / deleteRealEstate', async () => {
    const created = capture('post', '/investments/real-estate', { data: RAW_PROPERTY });
    expect((await investmentsApi.createRealEstate({ propertyName: 'Flat' }, { targetUserId: TARGET })).purchasePrice).toBe(5000000);
    expect(created.seen?.params.get('targetUserId')).toBe(TARGET);

    const bare = capture('post', '/investments/real-estate', { data: RAW_PROPERTY });
    await investmentsApi.createRealEstate({ propertyName: 'X' });
    expect(bare.seen?.params.has('targetUserId')).toBe(false);

    const updated = capture('put', '/investments/real-estate/re1', { data: RAW_PROPERTY });
    expect((await investmentsApi.updateRealEstate('re1', { currentValue: 7500000 })).currentValue).toBe(7500000);
    expect(updated.seen?.url).toContain('/investments/real-estate/re1');

    const del = capture('delete', '/investments/real-estate/re1', { data: null });
    await investmentsApi.deleteRealEstate('re1');
    expect(del.seen?.method).toBe('DELETE');
  });
});

describe('investmentsApi — exchange rates', () => {
  it('getExchangeRates returns the list unwrapped', async () => {
    const rates = [{ fromCurrency: 'USD', toCurrency: 'INR', rate: 83.2, updatedAt: '2026-04-01' }];
    capture('get', '/investments/exchange-rates', { data: rates });
    expect(await investmentsApi.getExchangeRates()).toEqual(rates);
  });

  it('updateExchangeRate PUTs the currency on the path and the rate in the body', async () => {
    const c = capture('put', '/investments/exchange-rates/USD', { data: {} });
    await investmentsApi.updateExchangeRate('USD', 83.2);

    expect(c.seen?.url).toContain('/investments/exchange-rates/USD');
    expect(c.seen?.body).toEqual({ rate: 83.2 });
  });
});
