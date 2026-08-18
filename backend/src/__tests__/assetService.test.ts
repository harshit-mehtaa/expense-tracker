/**
 * Unit tests for assetService.
 *
 * Assets are single-owner, so these use the shared ownerScopedWhere. The interesting
 * case is delete: a secured loan must always name its collateral, so an asset that
 * still secures a loan cannot simply vanish.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/prisma', () => {
  const mock = {
    asset: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    // assertRealEstateOwned confirms a linked property belongs to the asset's owner.
    realEstate: { findFirst: vi.fn() },
    goldHolding: { findFirst: vi.fn() },
    loan: { findFirst: vi.fn() },
  };
  return { default: mock, prisma: mock };
});

import { prisma } from '../config/prisma';
import {
  listAssets, getAsset, createAsset, updateAsset, deleteAsset, getAssetForAudit,
  recordAssetSale, findActiveLoanSecuring,
} from '../services/assetService';

const assetMock = (prisma as any).asset;
const realEstateMock = (prisma as any).realEstate;
const goldMock = (prisma as any).goldHolding;
const loanMock = (prisma as any).loan;

const MOCK_ASSET = {
  id: 'asset-1',
  userId: 'u1',
  assetType: 'PROPERTY',
  name: 'Flat 3B',
  value: 8_500_000,
  realEstateId: null,
  loans: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  assetMock.findMany.mockResolvedValue([MOCK_ASSET]);
  assetMock.findFirst.mockResolvedValue(MOCK_ASSET);
  assetMock.create.mockResolvedValue(MOCK_ASSET);
  assetMock.update.mockResolvedValue(MOCK_ASSET);
  assetMock.delete.mockResolvedValue(MOCK_ASSET);
  loanMock.findFirst.mockResolvedValue(null);
});

describe('listAssets', () => {
  it('scopes to a user when one is given', async () => {
    await listAssets('u1');
    expect(assetMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' }, orderBy: { createdAt: 'desc' } }),
    );
  });

  it('returns every asset on the family-wide view', async () => {
    await listAssets();
    expect(assetMock.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('includes the linked property and any loans it secures', async () => {
    await listAssets('u1');
    const { include } = assetMock.findMany.mock.calls[0][0];
    expect(include).toHaveProperty('realEstate');
    expect(include).toHaveProperty('loans');
  });
});

describe('getAsset', () => {
  it('scopes a MEMBER to their own assets', async () => {
    await getAsset('u1', 'asset-1');
    expect(assetMock.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'asset-1', userId: 'u1' } }),
    );
  });

  it('drops the owner filter for an ADMIN', async () => {
    await getAsset('admin-1', 'asset-1', 'ADMIN');
    expect(assetMock.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'asset-1' } }),
    );
  });

  it('returns null when not found', async () => {
    assetMock.findFirst.mockResolvedValue(null);
    expect(await getAsset('u1', 'nope')).toBeNull();
  });
});

describe('createAsset', () => {
  it('merges the owner into the row', async () => {
    await createAsset('u1', { assetType: 'VEHICLE', name: 'Swift', value: 600_000 } as never);
    expect(assetMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'u1', assetType: 'VEHICLE', name: 'Swift' }),
      }),
    );
  });
});

describe('updateAsset', () => {
  it('updates when the caller owns it', async () => {
    await updateAsset('u1', 'asset-1', { value: 9_000_000 } as never);
    expect(assetMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'asset-1' } }),
    );
  });

  it('throws NotFound for someone else\'s asset, without updating', async () => {
    assetMock.findFirst.mockResolvedValue(null);
    await expect(updateAsset('stranger', 'asset-1', {} as never)).rejects.toThrow(/not found/i);
    expect(assetMock.update).not.toHaveBeenCalled();
  });
});

describe('deleteAsset', () => {
  it('deletes an asset that secures nothing', async () => {
    assetMock.findFirst.mockResolvedValue({ ...MOCK_ASSET, loans: [] });
    await deleteAsset('u1', 'asset-1');
    expect(assetMock.delete).toHaveBeenCalledWith({ where: { id: 'asset-1' } });
  });

  it('refuses to delete an asset that still secures a loan', async () => {
    // The FK is ON DELETE SET NULL, so without this guard the delete would succeed and
    // silently leave a secured loan with no collateral — violating the rule it was
    // created under, and only surfacing later as a constraint error on the next edit.
    assetMock.findFirst.mockResolvedValue({
      ...MOCK_ASSET, loans: [{ id: 'loan-1' }, { id: 'loan-2' }],
    });
    await expect(deleteAsset('u1', 'asset-1')).rejects.toThrow(/secures 2 loan/i);
    expect(assetMock.delete).not.toHaveBeenCalled();
  });

  it('throws NotFound for someone else\'s asset', async () => {
    assetMock.findFirst.mockResolvedValue(null);
    await expect(deleteAsset('stranger', 'asset-1')).rejects.toThrow(/not found/i);
    expect(assetMock.delete).not.toHaveBeenCalled();
  });
});

describe('getAssetForAudit', () => {
  it('scopes a MEMBER, and drops the filter for an ADMIN', async () => {
    await getAssetForAudit('u1', 'asset-1');
    expect(assetMock.findFirst).toHaveBeenCalledWith({ where: { id: 'asset-1', userId: 'u1' } });

    await getAssetForAudit('admin-1', 'asset-1', 'ADMIN');
    expect(assetMock.findFirst).toHaveBeenCalledWith({ where: { id: 'asset-1' } });
  });
});

/**
 * `assetInclude` returns the linked property's name and current value, and the asset's
 * own `loans` selection exposes lender name and outstanding balance. An unvalidated
 * `realEstateId` therefore leaked another member's property details through the asset —
 * and because `Asset.realEstateId` is UNIQUE, it also let the attacker permanently
 * squat the slot so the real owner could never link their own property.
 */
describe('a linked property must belong to the asset owner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assetMock.create.mockResolvedValue({ id: 'a-1' });
  });

  it('refuses to create an asset pointing at another member\'s property', async () => {
    realEstateMock.findFirst.mockResolvedValue(null); // not owned by this user

    await expect(
      createAsset('u1', { assetType: 'PROPERTY', name: 'Flat', value: 100, realEstateId: 're-other' } as never),
    ).rejects.toThrow(/property/i);

    expect(assetMock.create).not.toHaveBeenCalled();
  });

  it('allows a property the user does own', async () => {
    realEstateMock.findFirst.mockResolvedValue({ id: 're-mine' });

    await createAsset('u1', { assetType: 'PROPERTY', name: 'Flat', value: 100, realEstateId: 're-mine' } as never);

    expect(assetMock.create).toHaveBeenCalled();
    expect(realEstateMock.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 're-mine', userId: 'u1' } }),
    );
  });

  it('skips the check when no property is linked', async () => {
    await createAsset('u1', { assetType: 'VEHICLE', name: 'Swift', value: 100 } as never);

    expect(realEstateMock.findFirst).not.toHaveBeenCalled();
    expect(assetMock.create).toHaveBeenCalled();
  });

  it('checks against the ASSET owner on update, not the requester', async () => {
    // An admin editing a member's asset must not be able to attach their own property.
    assetMock.findFirst.mockResolvedValue({ id: 'a-1', userId: 'u-member' });
    realEstateMock.findFirst.mockResolvedValue(null);

    await expect(
      updateAsset('admin-1', 'a-1', { realEstateId: 're-admin' } as never, 'ADMIN'),
    ).rejects.toThrow(/property/i);

    expect(realEstateMock.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 're-admin', userId: 'u-member' } }),
    );
    expect(assetMock.update).not.toHaveBeenCalled();
  });
});

/**
 * The gold link mirrors the property one, and exists so net worth can tell whether gold
 * pledged against a loan is already counted as a holding.
 */
describe('a linked gold holding must belong to the asset owner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assetMock.create.mockResolvedValue({ id: 'a-1' });
  });

  it("refuses to create an asset pointing at another member's gold", async () => {
    goldMock.findFirst.mockResolvedValue(null);

    await expect(
      createAsset('u1', { assetType: 'GOLD', name: 'Chain', value: 100, goldHoldingId: 'g-other' } as never),
    ).rejects.toThrow(/gold holding/i);

    expect(assetMock.create).not.toHaveBeenCalled();
  });

  it('allows a holding the user does own', async () => {
    goldMock.findFirst.mockResolvedValue({ id: 'g-mine' });

    await createAsset('u1', { assetType: 'GOLD', name: 'Chain', value: 100, goldHoldingId: 'g-mine' } as never);

    expect(goldMock.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'g-mine', userId: 'u1' } }),
    );
    expect(assetMock.create).toHaveBeenCalled();
  });

  it('skips the check when no holding is linked', async () => {
    await createAsset('u1', { assetType: 'VEHICLE', name: 'Swift', value: 100 } as never);

    expect(goldMock.findFirst).not.toHaveBeenCalled();
    expect(assetMock.create).toHaveBeenCalled();
  });

  it('checks against the ASSET owner on update, not the requester', async () => {
    assetMock.findFirst.mockResolvedValue({ id: 'a-1', userId: 'u-member' });
    goldMock.findFirst.mockResolvedValue(null);

    await expect(
      updateAsset('admin-1', 'a-1', { goldHoldingId: 'g-admin' } as never, 'ADMIN'),
    ).rejects.toThrow(/gold holding/i);

    expect(goldMock.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'g-admin', userId: 'u-member' } }),
    );
    expect(assetMock.update).not.toHaveBeenCalled();
  });
});

// ─── Selling an unlinked asset ─────────────────────────────────────────────────
// Nothing on Asset, RealEstate, or GoldHolding ever recorded a sale before this — the
// only removal mechanism was a hard delete, which destroyed the entire history.

describe('recordAssetSale', () => {
  const UNLINKED = { ...MOCK_ASSET, realEstateId: null, goldHoldingId: null };

  it('sets soldAt/salePrice, never deletes', async () => {
    assetMock.findFirst.mockResolvedValue(UNLINKED);
    await recordAssetSale('u1', 'asset-1', { salePrice: 500_000, date: '2026-06-01' });

    expect(assetMock.delete).not.toHaveBeenCalled();
    expect(assetMock.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'asset-1' },
      data: { soldAt: new Date('2026-06-01'), salePrice: 500_000 },
    }));
  });

  it('refuses to sell an asset that represents a property or gold holding instead', async () => {
    assetMock.findFirst.mockResolvedValue({ ...MOCK_ASSET, realEstateId: 're-1' });
    await expect(
      recordAssetSale('u1', 'asset-1', { salePrice: 500_000, date: '2026-06-01' }),
    ).rejects.toThrow(/record the sale there instead/i);
    expect(assetMock.update).not.toHaveBeenCalled();
  });

  it('DQ5/DQ6: blocks the sale if it still secures an active (not closedAt) loan', async () => {
    assetMock.findFirst.mockResolvedValue(UNLINKED);
    loanMock.findFirst.mockResolvedValue({ id: 'loan-1', lenderName: 'HDFC Bank' });

    await expect(
      recordAssetSale('u1', 'asset-1', { salePrice: 500_000, date: '2026-06-01' }),
    ).rejects.toThrow(/active loan/i);
    expect(assetMock.update).not.toHaveBeenCalled();
    expect(loanMock.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { assetId: 'asset-1', closedAt: null },
    }));
  });

  it('allows the sale once the securing loan is closed', async () => {
    assetMock.findFirst.mockResolvedValue(UNLINKED);
    loanMock.findFirst.mockResolvedValue(null); // findActiveLoanSecuring filters closedAt: null itself
    await expect(
      recordAssetSale('u1', 'asset-1', { salePrice: 500_000, date: '2026-06-01' }),
    ).resolves.toBeDefined();
    expect(assetMock.update).toHaveBeenCalled();
  });

  it('404s for a loan the requester cannot write to', async () => {
    assetMock.findFirst.mockResolvedValue(null);
    await expect(
      recordAssetSale('u3', 'asset-1', { salePrice: 500_000, date: '2026-06-01' }),
    ).rejects.toThrow(/not found/i);
  });
});

describe('findActiveLoanSecuring', () => {
  it('filters to loans that are not yet closedAt-closed', async () => {
    await findActiveLoanSecuring('asset-1');
    expect(loanMock.findFirst).toHaveBeenCalledWith({
      where: { assetId: 'asset-1', closedAt: null },
      select: { id: true, lenderName: true },
    });
  });
});
