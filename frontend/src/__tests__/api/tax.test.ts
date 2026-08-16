/**
 * Tests for taxApi.
 *
 * These are thin wrappers, so the risk is not logic — it is URL and query-param
 * construction. taxApi builds the target-user param TWO different ways:
 *
 *   uid(id)          -> `&targetUserId=${id}`   string-concatenated onto the path (GETs)
 *   targetParams(id) -> { targetUserId: id }    an axios params object (POSTs)
 *
 * Those two can drift independently, and if a GET asked for the wrong user the caller
 * would still receive a well-formed response — a silent cross-member data leak. Every
 * test here therefore asserts the OUTGOING request, not just the resolved value.
 *
 * Note the update and delete methods take no viewUserId at all: they address by id and rely
 * entirely on backend ownership scoping. That asymmetry is asserted explicitly below so
 * a future change that adds a param here has to update this test deliberately.
 */
import { describe, it, expect } from 'vitest';
import { taxApi } from '@/api/tax';
import { capture } from './captureRequest';

const FY = '2025-26';
const TARGET = 'clm1234567890abcdefghij';

// Every GET that accepts a viewUserId, with the path it must hit.
const GETS_WITH_TARGET: Array<[string, string, (v?: string) => Promise<unknown>]> = [
  ['getProfile', '/tax/profile', (v) => taxApi.getProfile(FY, v)],
  ['getSummary', '/tax/summary', (v) => taxApi.getSummary(FY, v)],
  ['get80CTracker', '/tax/80c-tracker', (v) => taxApi.get80CTracker(FY, v)],
  ['listCapitalGains', '/tax/capital-gains', (v) => taxApi.listCapitalGains(FY, v)],
  ['getCapitalGainsSummary', '/tax/capital-gains/summary', (v) => taxApi.getCapitalGainsSummary(FY, v)],
  ['listOtherIncome', '/tax/other-income', (v) => taxApi.listOtherIncome(FY, v)],
  ['getOtherIncomeSummary', '/tax/other-income/summary', (v) => taxApi.getOtherIncomeSummary(FY, v)],
  ['listHouseProperty', '/tax/house-property', (v) => taxApi.listHouseProperty(FY, v)],
  ['getHousePropertySummary', '/tax/house-property/summary', (v) => taxApi.getHousePropertySummary(FY, v)],
  ['listForeignAssets', '/tax/foreign-assets', (v) => taxApi.listForeignAssets(FY, v)],
  ['getForeignAssetSummary', '/tax/foreign-assets/summary', (v) => taxApi.getForeignAssetSummary(FY, v)],
  ['getITR2Summary', '/tax/itr2-summary', (v) => taxApi.getITR2Summary(FY, v)],
];

describe('taxApi — GET target-user scoping (string-concatenated)', () => {
  it.each(GETS_WITH_TARGET)('%s sends fy and targetUserId when a member is selected', async (_n, path, call) => {
    const c = capture('get', path, { data: {} });
    await call(TARGET);

    expect(c.seen?.params.get('fy')).toBe(FY);
    expect(c.seen?.params.get('targetUserId')).toBe(TARGET);
  });

  it.each(GETS_WITH_TARGET)('%s OMITS targetUserId entirely when no member is selected', async (_n, path, call) => {
    const c = capture('get', path, { data: {} });
    await call(undefined);

    expect(c.seen?.params.get('fy')).toBe(FY);
    // Must be absent, not empty-string: `&targetUserId=` would be sent as '' and could
    // be read by a backend as "a value was supplied".
    expect(c.seen?.params.has('targetUserId')).toBe(false);
    expect(c.seen?.url).not.toContain('targetUserId');
  });
});

describe('taxApi — POST target-user scoping (params object)', () => {
  const POSTS: Array<[string, string, (v?: string) => Promise<unknown>]> = [
    ['saveProfile', '/tax/profile', (v) => taxApi.saveProfile(FY, { regime: 'NEW' }, v)],
    ['createCapitalGain', '/tax/capital-gains', (v) => taxApi.createCapitalGain({ assetName: 'X' }, v)],
    ['createOtherIncome', '/tax/other-income', (v) => taxApi.createOtherIncome({ amount: 1 }, v)],
    ['createHouseProperty', '/tax/house-property', (v) => taxApi.createHouseProperty({ propertyName: 'X' }, v)],
    ['createForeignAsset', '/tax/foreign-assets', (v) => taxApi.createForeignAsset({ country: 'US' }, v)],
  ];

  it.each(POSTS)('%s sends targetUserId as a query param when supplied', async (_n, path, call) => {
    const c = capture('post', path, { data: {} });
    await call(TARGET);
    expect(c.seen?.params.get('targetUserId')).toBe(TARGET);
  });

  it.each(POSTS)('%s omits targetUserId when not supplied', async (_n, path, call) => {
    const c = capture('post', path, { data: {} });
    await call(undefined);
    expect(c.seen?.params.has('targetUserId')).toBe(false);
  });

  it('saveProfile puts fy on the path and targetUserId in params — the two mechanisms combined', async () => {
    const c = capture('post', '/tax/profile', { data: {} });
    await taxApi.saveProfile(FY, { regime: 'OLD' }, TARGET);

    expect(c.seen?.params.get('fy')).toBe(FY);
    expect(c.seen?.params.get('targetUserId')).toBe(TARGET);
    expect(c.seen?.body).toEqual({ regime: 'OLD' });
  });

  it('forwards the request body unchanged', async () => {
    const c = capture('post', '/tax/capital-gains', { data: {} });
    const payload = { assetName: 'Axis Bluechip', salePrice: 125000 };
    await taxApi.createCapitalGain(payload);
    expect(c.seen?.body).toEqual(payload);
  });
});

describe('taxApi — id-addressed writes carry NO target user', () => {
  const BY_ID: Array<[string, 'put' | 'delete', string, () => Promise<unknown>]> = [
    ['updateCapitalGain', 'put', '/tax/capital-gains/cg-1', () => taxApi.updateCapitalGain('cg-1', { salePrice: 2 })],
    ['deleteCapitalGain', 'delete', '/tax/capital-gains/cg-1', () => taxApi.deleteCapitalGain('cg-1')],
    ['updateOtherIncome', 'put', '/tax/other-income/oi-1', () => taxApi.updateOtherIncome('oi-1', { amount: 2 })],
    ['deleteOtherIncome', 'delete', '/tax/other-income/oi-1', () => taxApi.deleteOtherIncome('oi-1')],
    ['updateHouseProperty', 'put', '/tax/house-property/hp-1', () => taxApi.updateHouseProperty('hp-1', { usage: 'LET_OUT' })],
    ['deleteHouseProperty', 'delete', '/tax/house-property/hp-1', () => taxApi.deleteHouseProperty('hp-1')],
    ['updateForeignAsset', 'put', '/tax/foreign-assets/fa-1', () => taxApi.updateForeignAsset('fa-1', { country: 'UK' })],
    ['deleteForeignAsset', 'delete', '/tax/foreign-assets/fa-1', () => taxApi.deleteForeignAsset('fa-1')],
  ];

  it.each(BY_ID)('%s addresses the record by id with no user param', async (_n, method, path, call) => {
    const c = capture(method, path, { data: { deleted: true } });
    await call();

    expect(c.seen?.params.has('targetUserId')).toBe(false);
    expect(c.seen?.params.has('userId')).toBe(false);
    expect(c.seen?.url).toContain(path);
  });
});

describe('taxApi — endpoints with no target-user concept', () => {
  it('getAdvanceTaxCalendar sends only fy (the calendar is universal, not per-user)', async () => {
    const c = capture('get', '/tax/advance-tax-calendar', { data: [] });
    await taxApi.getAdvanceTaxCalendar(FY);

    expect(c.seen?.params.get('fy')).toBe(FY);
    expect(c.seen?.params.has('targetUserId')).toBe(false);
  });

  it('calcHRA sends all four calculator params (pure calculation, no user scope)', async () => {
    const c = capture('get', '/tax/hra-calculator', { data: { exempt: 60000, taxable: 60000 } });
    const result = await taxApi.calcHRA({
      basicSalary: 500000, hraReceived: 120000, rentPaid: 10000, city: 'METRO',
    });

    expect(c.seen?.params.get('basicSalary')).toBe('500000');
    expect(c.seen?.params.get('hraReceived')).toBe('120000');
    expect(c.seen?.params.get('rentPaid')).toBe('10000');
    expect(c.seen?.params.get('city')).toBe('METRO');
    expect(result).toEqual({ exempt: 60000, taxable: 60000 });
  });
});

describe('taxApi — unwrapping', () => {
  it('returns res.data.data, not the envelope', async () => {
    capture('get', '/tax/summary', { data: { oldRegime: { tax: 125000 } } });
    const result = await taxApi.getSummary(FY);
    expect(result).toEqual({ oldRegime: { tax: 125000 } });
  });

  it('returns an array payload intact', async () => {
    const entries = [{ id: 'cg-1', assetName: 'Axis' }, { id: 'cg-2', assetName: 'HDFC' }];
    capture('get', '/tax/capital-gains', { data: entries });
    const result = await taxApi.listCapitalGains(FY);
    expect(result).toEqual(entries);
  });
});
