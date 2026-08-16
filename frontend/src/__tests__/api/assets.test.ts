/**
 * Tests for assetsApi, plus loansApi.derive.
 *
 * Same discipline as the other api-layer tests: assert what goes out on the wire, not
 * just what comes back. A wrapper that requested the wrong member's assets would still
 * return a well-formed response and pass a value-only assertion.
 */
import { describe, it, expect } from 'vitest';
import { assetsApi, normalizeAsset, ASSET_TYPES } from '@/api/assets';
import { loansApi } from '@/api/loans';
import { capture } from './captureRequest';

const TARGET = 'clm1234567890abcdefghij';

const RAW_ASSET = {
  id: 'a1',
  userId: 'u1',
  assetType: 'PROPERTY' as const,
  name: 'Flat 3B',
  // Prisma Decimals arrive as strings.
  value: '8500000.00' as unknown as number,
  realEstateId: 're1',
  notes: null,
  loans: [{ id: 'l1', lenderName: 'HDFC', loanType: 'HOME', outstandingBalance: '4000000.00' as unknown as number }],
};

describe('normalizeAsset', () => {
  it('coerces the Decimal value and nested loan balances', () => {
    const a = normalizeAsset(RAW_ASSET);
    expect(a.value).toBe(8500000);
    expect(a.loans?.[0].outstandingBalance).toBe(4000000);
  });

  it('leaves loans undefined when the payload omits them', () => {
    const a = normalizeAsset({ ...RAW_ASSET, loans: undefined });
    expect(a.loans).toBeUndefined();
  });
});

describe('ASSET_TYPES', () => {
  it('labels every type the backend enum allows', () => {
    expect(Object.keys(ASSET_TYPES).sort()).toEqual(['GOLD', 'OTHER', 'PROPERTY', 'VEHICLE']);
  });
});

describe('assetsApi', () => {
  it('getAll sends no params when no member is selected', async () => {
    const c = capture('get', '/assets', { data: [RAW_ASSET] });
    const assets = await assetsApi.getAll();

    expect(c.seen?.params.has('targetUserId')).toBe(false);
    expect(assets[0].value).toBe(8500000);
  });

  it('getAll scopes to a member with targetUserId', async () => {
    const c = capture('get', '/assets', { data: [] });
    await assetsApi.getAll(TARGET);
    expect(c.seen?.params.get('targetUserId')).toBe(TARGET);
  });

  it('getOne fetches by id and normalizes', async () => {
    capture('get', '/assets/a1', { data: RAW_ASSET });
    const asset = await assetsApi.getOne('a1');
    expect(asset.value).toBe(8500000);
  });

  it('create posts the body and normalizes the response', async () => {
    const c = capture('post', '/assets', { data: RAW_ASSET });
    const created = await assetsApi.create({ assetType: 'VEHICLE', name: 'Swift', value: 600000 });

    expect(c.seen?.body).toEqual({ assetType: 'VEHICLE', name: 'Swift', value: 600000 });
    expect(created.value).toBe(8500000);
  });

  it('create forwards targetUserId so an ADMIN can act for a member', async () => {
    const c = capture('post', '/assets', { data: RAW_ASSET });
    await assetsApi.create({ name: 'X' }, { targetUserId: TARGET });
    expect(c.seen?.params.get('targetUserId')).toBe(TARGET);
  });

  it('update puts to the id-scoped path', async () => {
    const c = capture('put', '/assets/a1', { data: RAW_ASSET });
    const updated = await assetsApi.update('a1', { value: 9000000 });

    expect(c.seen?.url).toContain('/assets/a1');
    expect(c.seen?.body).toEqual({ value: 9000000 });
    expect(updated.value).toBe(8500000);
  });

  it('delete calls the id-scoped path', async () => {
    const c = capture('delete', '/assets/a1', { data: null });
    await assetsApi.delete('a1');
    expect(c.seen?.url).toContain('/assets/a1');
  });
});

describe('loansApi.derive', () => {
  it('posts the inputs and coerces every derived field', async () => {
    const c = capture('post', '/loans/derive', {
      data: {
        emiAmount: '43391.17',
        endDate: '2046-01-15T00:00:00.000Z',
        preEmiAmount: '67500.00',
        monthlyPreEmiAmount: '22500.00',
        outstandingBalance: '5000000.00',
      },
    });

    const derived = await loansApi.derive({
      principalAmount: 5000000, interestRate: 8.5, tenureMonths: 240,
      disbursementDate: '2026-01-15',
    });

    expect(c.seen?.body).toEqual({
      principalAmount: 5000000, interestRate: 8.5, tenureMonths: 240,
      disbursementDate: '2026-01-15',
    });
    expect(derived.emiAmount).toBe(43391.17);
    expect(derived.preEmiAmount).toBe(67500);
    expect(derived.monthlyPreEmiAmount).toBe(22500);
    expect(derived.outstandingBalance).toBe(5000000);
    expect(derived.endDate).toBe('2046-01-15T00:00:00.000Z');
  });

  it('keeps nulls null — an absent pre-EMI is not a ₹0 charge', async () => {
    capture('post', '/loans/derive', {
      data: {
        emiAmount: null, endDate: null, preEmiAmount: null,
        monthlyPreEmiAmount: null, outstandingBalance: null,
      },
    });

    const derived = await loansApi.derive({ principalAmount: 1, interestRate: 1, tenureMonths: 1 });

    expect(derived.emiAmount).toBeNull();
    expect(derived.preEmiAmount).toBeNull();
    expect(derived.monthlyPreEmiAmount).toBeNull();
    expect(derived.outstandingBalance).toBeNull();
    expect(derived.endDate).toBeNull();
  });
});
