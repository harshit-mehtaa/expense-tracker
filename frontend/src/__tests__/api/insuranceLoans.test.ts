/**
 * Tests for insuranceApi and loansApi.
 *
 * Both sat at ~86-96% statements but ~12% FUNCTIONS: the API objects were being defined
 * (so their statements counted) while almost none of their methods were ever called. This
 * calls every method.
 *
 * Note the deliberate read/write param asymmetry, which mirrors the backend: GET routes
 * resolve the target member from `userId` (backend passes `paramName: 'userId'`), while
 * POST routes use the default `targetUserId`. Sending the wrong one is a silent no-op that
 * quietly returns the requesting user's own data, so both are pinned here.
 */
import { describe, it, expect } from 'vitest';
import { insuranceApi } from '@/api/insurance';
import { loansApi } from '@/api/loans';
import { capture } from './captureRequest';

const TARGET = 'clm1234567890abcdefghij';

const RAW_POLICY = {
  id: 'p1', policyType: 'TERM_LIFE', providerName: 'LIC', policyNumber: 'L1',
  policyName: 'Term Plan', premiumFrequency: 'ANNUALLY', startDate: '2020-01-01',
  is80cEligible: false, is80dEligible: true, isForParents: false,
  // Prisma Decimals arrive as strings — the normalizer must coerce these.
  sumAssured: '10000000.00', premiumAmount: '12500.50', lastPaidAmount: '12500.50',
};

const RAW_LOAN = {
  id: 'l1', lenderName: 'HDFC', loanType: 'HOME', emiDate: 5, tenureMonths: 240,
  disbursementDate: '2020-01-01', endDate: '2040-01-01',
  isTaxDeductible: true, section24bEligible: true,
  principalAmount: '5000000.00', outstandingBalance: '4250000.00',
  interestRate: '8.50', emiAmount: '43391.00', prepaymentChargesPct: '2.00',
};

describe('insuranceApi — reads scope with `userId`', () => {
  it('getAll sends userId (NOT targetUserId) when a member is selected', async () => {
    const c = capture('get', '/insurance', { data: [] });
    await insuranceApi.getAll({ targetUserId: TARGET });

    expect(c.seen?.params.get('userId')).toBe(TARGET);
    expect(c.seen?.params.has('targetUserId')).toBe(false);
  });

  it('getAll sends no params when called with no opts at all', async () => {
    const c = capture('get', '/insurance', { data: [] });
    await insuranceApi.getAll();
    expect([...c.seen!.params.keys()]).toEqual([]);
  });

  it('getAll sends no params when opts is present but empty', async () => {
    const c = capture('get', '/insurance', { data: [] });
    await insuranceApi.getAll({});
    expect(c.seen?.params.has('userId')).toBe(false);
  });

  it('getAll normalizes every policy in the list', async () => {
    capture('get', '/insurance', { data: [RAW_POLICY, { ...RAW_POLICY, id: 'p2', sumAssured: '750000.00' }] });
    const policies = await insuranceApi.getAll();

    expect(policies).toHaveLength(2);
    expect(policies[0].sumAssured).toBe(10000000);
    expect(typeof policies[0].sumAssured).toBe('number');
    expect(policies[1].sumAssured).toBe(750000);
  });

  it('get80D sends userId when supplied', async () => {
    const c = capture('get', '/insurance/80d-summary', { data: { total: 25000 } });
    const result = await insuranceApi.get80D({ targetUserId: TARGET });

    expect(c.seen?.params.get('userId')).toBe(TARGET);
    expect(result).toEqual({ total: 25000 });
  });

  it('get80D sends no params when omitted', async () => {
    const c = capture('get', '/insurance/80d-summary', { data: {} });
    await insuranceApi.get80D();
    expect(c.seen?.params.has('userId')).toBe(false);
  });

  it('getPremiumCalendar normalizes policies inside every month bucket', async () => {
    capture('get', '/insurance/premium-calendar', {
      data: { '2026-04': [RAW_POLICY], '2026-05': [{ ...RAW_POLICY, id: 'p2' }] },
    });
    const cal = await insuranceApi.getPremiumCalendar();

    expect(Object.keys(cal)).toEqual(['2026-04', '2026-05']);
    expect(cal['2026-04'][0].sumAssured).toBe(10000000);
    expect(typeof cal['2026-05'][0].premiumAmount).toBe('number');
  });

  it('getPremiumCalendar handles an empty calendar', async () => {
    capture('get', '/insurance/premium-calendar', { data: {} });
    expect(await insuranceApi.getPremiumCalendar()).toEqual({});
  });
});

describe('insuranceApi — writes scope with `targetUserId`', () => {
  it('create sends targetUserId (NOT userId) and normalizes the response', async () => {
    const c = capture('post', '/insurance', { data: RAW_POLICY });
    const created = await insuranceApi.create({ policyName: 'Term Plan' }, { targetUserId: TARGET });

    expect(c.seen?.params.get('targetUserId')).toBe(TARGET);
    expect(c.seen?.params.has('userId')).toBe(false);
    expect(c.seen?.body).toEqual({ policyName: 'Term Plan' });
    expect(created.sumAssured).toBe(10000000);
  });

  it('create omits the param when no opts are given', async () => {
    const c = capture('post', '/insurance', { data: RAW_POLICY });
    await insuranceApi.create({ policyName: 'X' });
    expect(c.seen?.params.has('targetUserId')).toBe(false);
  });

  it('update PUTs by id and normalizes', async () => {
    const c = capture('put', '/insurance/p1', { data: RAW_POLICY });
    const updated = await insuranceApi.update('p1', { sumAssured: 10000000 });

    expect(c.seen?.url).toContain('/insurance/p1');
    expect(c.seen?.body).toEqual({ sumAssured: 10000000 });
    expect(typeof updated.premiumAmount).toBe('number');
  });

  it('delete DELETEs by id', async () => {
    const c = capture('delete', '/insurance/p1', { data: null });
    await insuranceApi.delete('p1');
    expect(c.seen?.method).toBe('DELETE');
    expect(c.seen?.url).toContain('/insurance/p1');
  });
});

describe('loansApi', () => {
  it('getAll sends targetUserId — note loans uses targetUserId on READ, unlike insurance', async () => {
    const c = capture('get', '/loans', { data: [] });
    await loansApi.getAll(TARGET);
    expect(c.seen?.params.get('targetUserId')).toBe(TARGET);
  });

  it('getAll sends no params when omitted', async () => {
    const c = capture('get', '/loans', { data: [] });
    await loansApi.getAll();
    expect([...c.seen!.params.keys()]).toEqual([]);
  });

  it('getAll normalizes every Decimal field on every loan', async () => {
    capture('get', '/loans', { data: [RAW_LOAN] });
    const [loan] = await loansApi.getAll();

    expect(loan.principalAmount).toBe(5000000);
    expect(loan.outstandingBalance).toBe(4250000);
    expect(loan.interestRate).toBe(8.5);
    expect(loan.emiAmount).toBe(43391);
    expect(loan.prepaymentChargesPct).toBe(2);
  });

  it('create sends targetUserId and normalizes the response', async () => {
    const c = capture('post', '/loans', { data: RAW_LOAN });
    const created = await loansApi.create({ lenderName: 'HDFC' }, { targetUserId: TARGET });

    expect(c.seen?.params.get('targetUserId')).toBe(TARGET);
    expect(created.principalAmount).toBe(5000000);
  });

  it('create omits the param when no opts are given', async () => {
    const c = capture('post', '/loans', { data: RAW_LOAN });
    await loansApi.create({ lenderName: 'X' });
    expect(c.seen?.params.has('targetUserId')).toBe(false);
  });

  it('update PUTs by id and normalizes', async () => {
    const c = capture('put', '/loans/l1', { data: RAW_LOAN });
    const updated = await loansApi.update('l1', { emiAmount: 43391 });

    expect(c.seen?.url).toContain('/loans/l1');
    expect(updated.emiAmount).toBe(43391);
  });

  it('delete DELETEs by id', async () => {
    const c = capture('delete', '/loans/l1', { data: null });
    await loansApi.delete('l1');
    expect(c.seen?.method).toBe('DELETE');
  });

  it('getAmortization normalizes the nested loan but leaves the schedule alone', async () => {
    capture('get', '/loans/l1/amortization-schedule', {
      data: {
        loan: RAW_LOAN,
        schedule: [{ month: 1, date: '2020-02-01', openingBalance: 5000000, emi: 43391, principal: 8000, interest: 35391, closingBalance: 4992000, totalInterestPaid: 35391 }],
        summary: { totalInterest: 5413840 },
      },
    });
    const r = await loansApi.getAmortization('l1');

    expect(typeof r.loan.principalAmount).toBe('number');
    expect(r.loan.principalAmount).toBe(5000000);
    expect(r.schedule).toHaveLength(1);
    expect(r.summary).toEqual({ totalInterest: 5413840 });
  });

  it('simulatePrepayment POSTs the amount and mode, returning the raw result', async () => {
    const c = capture('post', '/loans/l1/prepayment-simulation', {
      data: { interestSaved: 125000, newTenureMonths: 210 },
    });
    const result = await loansApi.simulatePrepayment('l1', { prepaymentAmount: 500000, mode: 'REDUCE_TENURE' });

    expect(c.seen?.body).toEqual({ prepaymentAmount: 500000, mode: 'REDUCE_TENURE' });
    expect(result).toEqual({ interestSaved: 125000, newTenureMonths: 210 });
  });
});
