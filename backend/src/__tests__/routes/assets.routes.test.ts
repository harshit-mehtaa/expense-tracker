/**
 * Route integration tests for /api/assets.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';

const MEMBER_USER = { userId: 'u1', email: 'a@b.com', role: 'MEMBER' as const };
const ADMIN_USER = { userId: 'admin-1', email: 'admin@b.com', role: 'ADMIN' as const };

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = (req as any).__testUser ?? MEMBER_USER;
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../services/assetService', () => ({
  listAssets: vi.fn(),
  getAsset: vi.fn(),
  createAsset: vi.fn(),
  updateAsset: vi.fn(),
  deleteAsset: vi.fn(),
  getAssetForAudit: vi.fn(),
  recordAssetSale: vi.fn(),
}));

vi.mock('../../services/auditService', () => ({ recordAuditLog: vi.fn() }));

vi.mock('../../config/prisma', () => {
  const prisma = { user: { findFirst: vi.fn() } };
  return { default: prisma, prisma };
});

import assetsRouter from '../../routes/assets';
import * as svc from '../../services/assetService';
import { recordAuditLog } from '../../services/auditService';
import { prisma } from '../../config/prisma';
import { makeApp } from '../helpers/makeApp';
import { errorHandler } from '../../middleware/errorHandler';

const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const userFindFirstMock = (prisma as any).user.findFirst as ReturnType<typeof vi.fn>;

const VALID_TARGET_ID = 'clm1234567890abcdefghij';
const MOCK_ASSET = { id: 'asset-1', userId: 'u1', assetType: 'PROPERTY', name: 'Flat 3B', value: 8_500_000 };

function makeMemberApp() { return makeApp(assetsRouter, '/api/assets'); }

function makeAdminApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((req: any, _res: any, next: any) => { req.__testUser = ADMIN_USER; next(); });
  app.use('/api/assets', assetsRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  userFindFirstMock.mockResolvedValue({ id: VALID_TARGET_ID });
  m(svc.listAssets).mockResolvedValue([MOCK_ASSET]);
  m(svc.getAsset).mockResolvedValue(MOCK_ASSET);
  m(svc.createAsset).mockResolvedValue(MOCK_ASSET);
  m(svc.updateAsset).mockResolvedValue(MOCK_ASSET);
  m(svc.deleteAsset).mockResolvedValue(MOCK_ASSET);
  m(svc.getAssetForAudit).mockResolvedValue(MOCK_ASSET);
  m(svc.recordAssetSale).mockResolvedValue({ ...MOCK_ASSET, soldAt: new Date('2026-06-01'), salePrice: 500000 });
});

describe('GET /api/assets', () => {
  it('returns the caller\'s assets', async () => {
    const res = await request(makeMemberApp()).get('/api/assets');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(m(svc.listAssets)).toHaveBeenCalledWith('u1');
  });

  it('an ADMIN with no target sees the family-wide list', async () => {
    await request(makeAdminApp()).get('/api/assets');
    expect(m(svc.listAssets)).toHaveBeenCalledWith(undefined);
  });

  it('an ADMIN can scope to one member', async () => {
    await request(makeAdminApp()).get(`/api/assets?targetUserId=${VALID_TARGET_ID}`);
    expect(m(svc.listAssets)).toHaveBeenCalledWith(VALID_TARGET_ID);
  });

  it('a MEMBER cannot widen scope with targetUserId', async () => {
    await request(makeMemberApp()).get(`/api/assets?targetUserId=${VALID_TARGET_ID}`);
    expect(m(svc.listAssets)).toHaveBeenCalledWith('u1');
  });
});

describe('GET /api/assets/:id', () => {
  it('returns the asset', async () => {
    const res = await request(makeMemberApp()).get('/api/assets/asset-1');
    expect(res.status).toBe(200);
    expect(m(svc.getAsset)).toHaveBeenCalledWith('u1', 'asset-1', 'MEMBER');
  });

  it('404s when the service finds nothing', async () => {
    m(svc.getAsset).mockResolvedValue(null);
    const res = await request(makeMemberApp()).get('/api/assets/nope');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/assets', () => {
  const VALID = { assetType: 'VEHICLE', name: 'Swift Dzire', value: 600_000 };

  it('creates and records an audit entry', async () => {
    const res = await request(makeMemberApp()).post('/api/assets').send(VALID);
    expect(res.status).toBe(201);
    expect(m(recordAuditLog)).toHaveBeenCalledWith(expect.objectContaining({
      performedByUserId: 'u1', action: 'CREATE', entityType: 'Asset', entityId: 'asset-1',
    }));
  });

  it.each([
    ['assetType', { ...VALID, assetType: 'SPACESHIP' }],
    ['name', { ...VALID, name: '' }],
    ['value', { ...VALID, value: -1 }],
  ])('rejects an invalid %s with 422', async (_field, body) => {
    const res = await request(makeMemberApp()).post('/api/assets').send(body);
    expect(res.status).toBe(422);
  });

  it.each(['PROPERTY', 'VEHICLE', 'GOLD', 'OTHER'])('accepts assetType %s', async (assetType) => {
    const res = await request(makeMemberApp()).post('/api/assets').send({ ...VALID, assetType });
    expect(res.status).toBe(201);
  });

  it('an ADMIN can create on a member\'s behalf', async () => {
    await request(makeAdminApp()).post(`/api/assets?targetUserId=${VALID_TARGET_ID}`).send(VALID);
    expect(m(svc.createAsset)).toHaveBeenCalledWith(VALID_TARGET_ID, expect.any(Object));
  });
});

describe('PUT /api/assets/:id', () => {
  it('updates and records the pre-mutation snapshot', async () => {
    const before = { ...MOCK_ASSET, value: 8_000_000 };
    m(svc.getAssetForAudit).mockResolvedValue(before);

    const res = await request(makeMemberApp()).put('/api/assets/asset-1').send({ value: 8_500_000 });
    expect(res.status).toBe(200);
    expect(m(svc.getAssetForAudit)).toHaveBeenCalledWith('u1', 'asset-1', 'MEMBER');
    expect(m(recordAuditLog)).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UPDATE', entityType: 'Asset', oldValue: before,
    }));
  });

  it('accepts a partial body', async () => {
    const res = await request(makeMemberApp()).put('/api/assets/asset-1').send({ name: 'Renamed' });
    expect(res.status).toBe(200);
  });

  it('still validates the fields it is given', async () => {
    const res = await request(makeMemberApp()).put('/api/assets/asset-1').send({ value: -5 });
    expect(res.status).toBe(422);
  });
});

describe('DELETE /api/assets/:id', () => {
  it('deletes and records a DELETE audit entry', async () => {
    const res = await request(makeMemberApp()).delete('/api/assets/asset-1');
    expect(res.status).toBe(204);
    expect(m(recordAuditLog)).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DELETE', entityType: 'Asset', entityId: 'asset-1', oldValue: MOCK_ASSET,
    }));
  });

  it('surfaces the service\'s refusal when the asset still secures a loan', async () => {
    const { AppError } = await import('../../utils/AppError');
    m(svc.deleteAsset).mockRejectedValue(
      AppError.conflict('This asset secures 1 loan(s). Unlink or delete them first.'),
    );
    const res = await request(makeMemberApp()).delete('/api/assets/asset-1');
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/secures 1 loan/i);
  });
});

describe('POST /api/assets/:id/sell', () => {
  it('records the sale and an UPDATE audit entry', async () => {
    const res = await request(makeMemberApp()).post('/api/assets/asset-1/sell').send({ salePrice: 500000, date: '2026-06-01' });
    expect(res.status).toBe(200);
    expect(m(svc.recordAssetSale)).toHaveBeenCalledWith('u1', 'asset-1', { salePrice: 500000, date: '2026-06-01' }, 'MEMBER');
    expect(m(recordAuditLog)).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE', entityType: 'Asset' }));
  });

  it('422s a non-positive sale price', async () => {
    const res = await request(makeMemberApp()).post('/api/assets/asset-1/sell').send({ salePrice: 0, date: '2026-06-01' });
    expect(res.status).toBe(422);
    expect(m(svc.recordAssetSale)).not.toHaveBeenCalled();
  });

  it('422s an unparseable date', async () => {
    const res = await request(makeMemberApp()).post('/api/assets/asset-1/sell').send({ salePrice: 500000, date: 'nonsense' });
    expect(res.status).toBe(422);
    expect(m(svc.recordAssetSale)).not.toHaveBeenCalled();
  });

  it('surfaces the loan-collateral guard as a 409', async () => {
    const { AppError } = await import('../../utils/AppError');
    m(svc.recordAssetSale).mockRejectedValue(
      AppError.conflict('This still secures an active loan (HDFC Bank). Close or pay off the loan before recording a sale.'),
    );
    const res = await request(makeMemberApp()).post('/api/assets/asset-1/sell').send({ salePrice: 500000, date: '2026-06-01' });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/active loan/i);
  });
});
