/**
 * Route integration tests for /api/snapshots/net-worth.
 *
 * snapshots.ts imports from dashboardService (upsertNetWorthSnapshot, getNetWorthHistory).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'u1', email: 'a@b.com', role: 'MEMBER' };
    next();
  },
}));

vi.mock('../../services/dashboardService', () => ({
  upsertNetWorthSnapshot: vi.fn(),
  getNetWorthHistory: vi.fn(),
}));

import snapshotsRouter from '../../routes/snapshots';
import * as svc from '../../services/dashboardService';
import { makeApp } from '../helpers/makeApp';

// Snapshots are mounted at /api/snapshots/net-worth in the real app
const app = makeApp(snapshotsRouter, '/api/snapshots/net-worth');

const upsertMock = svc.upsertNetWorthSnapshot as ReturnType<typeof vi.fn>;
const historyMock = svc.getNetWorthHistory as ReturnType<typeof vi.fn>;

const MOCK_SNAPSHOT = { id: 'snap-1', userId: 'u1', netWorth: 500_000, month: '2024-04' };

beforeEach(() => {
  vi.clearAllMocks();
  upsertMock.mockResolvedValue(MOCK_SNAPSHOT);
  historyMock.mockResolvedValue([MOCK_SNAPSHOT]);
});

// ─── POST /api/snapshots/net-worth ────────────────────────────────────────────

describe('POST /api/snapshots/net-worth', () => {
  it('returns 201 with the created snapshot', async () => {
    const res = await request(app).post('/api/snapshots/net-worth');
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe('snap-1');
    expect(res.body.data.netWorth).toBe(500_000);
  });

  it('calls upsertNetWorthSnapshot with userId', async () => {
    await request(app).post('/api/snapshots/net-worth');
    expect(upsertMock).toHaveBeenCalledWith('u1');
  });

  it('propagates service errors', async () => {
    const { AppError } = await import('../../utils/AppError');
    upsertMock.mockRejectedValue(AppError.internal('DB error'));
    const res = await request(app).post('/api/snapshots/net-worth');
    expect(res.status).toBe(500);
  });
});

// ─── GET /api/snapshots/net-worth ─────────────────────────────────────────────

describe('GET /api/snapshots/net-worth', () => {
  it('returns 200 with snapshot history', async () => {
    const res = await request(app).get('/api/snapshots/net-worth');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].month).toBe('2024-04');
  });

  it('returns empty array when no snapshots exist', async () => {
    historyMock.mockResolvedValue([]);
    const res = await request(app).get('/api/snapshots/net-worth');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('calls getNetWorthHistory with userId', async () => {
    await request(app).get('/api/snapshots/net-worth');
    expect(historyMock).toHaveBeenCalledWith('u1');
  });
});
