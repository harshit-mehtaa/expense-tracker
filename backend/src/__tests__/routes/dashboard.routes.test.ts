/**
 * Route integration tests for /api/dashboard.
 *
 * dashboard.ts calls prisma.user.findFirst directly (via resolveTargetUserId)
 * when an ADMIN passes ?targetUserId=..., so prisma is also mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'u1', email: 'a@b.com', role: 'ADMIN' };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../services/dashboardService', () => ({
  getDashboardSummary: vi.fn(),
  getCashflow: vi.fn(),
  getUpcomingAlerts: vi.fn(),
  getFamilyOverview: vi.fn(),
}));

vi.mock('../../config/prisma', () => {
  const prisma = { user: { findFirst: vi.fn() } };
  return { default: prisma, prisma };
});

import dashboardRouter from '../../routes/dashboard';
import * as svc from '../../services/dashboardService';
import prisma from '../../config/prisma';
import { makeApp } from '../helpers/makeApp';

const userFindFirst = prisma.user.findFirst as ReturnType<typeof vi.fn>;

const app = makeApp(dashboardRouter, '/api/dashboard');

const summarySvc = svc.getDashboardSummary as ReturnType<typeof vi.fn>;
const cashflowSvc = svc.getCashflow as ReturnType<typeof vi.fn>;
const alertsSvc = svc.getUpcomingAlerts as ReturnType<typeof vi.fn>;
const familySvc = svc.getFamilyOverview as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  summarySvc.mockResolvedValue({ income: 0, expense: 0 });
  cashflowSvc.mockResolvedValue([]);
  alertsSvc.mockResolvedValue([]);
  familySvc.mockResolvedValue({ members: [] });
  userFindFirst.mockResolvedValue({ id: 'u2' }); // default: user found
});

// ─── GET /api/dashboard/summary ───────────────────────────────────────────────

describe('GET /api/dashboard/summary', () => {
  it('returns 200 with summary data', async () => {
    summarySvc.mockResolvedValue({ income: 10000, expense: 5000 });
    const res = await request(app).get('/api/dashboard/summary');
    expect(res.status).toBe(200);
    expect(res.body.data.income).toBe(10000);
  });

  it('passes fy query param to service', async () => {
    const res = await request(app).get('/api/dashboard/summary?fy=2024-25');
    expect(res.status).toBe(200);
    expect(summarySvc).toHaveBeenCalledWith('u1', 'ADMIN', '2024-25', undefined);
  });

  it('rejects invalid targetUserId format with 400', async () => {
    const res = await request(app).get('/api/dashboard/summary?targetUserId=not-valid!!');
    expect(res.status).toBe(400);
  });

  it('returns 404 when targetUserId is a valid CUID format but user not found', async () => {
    // Valid CUID format: 20-30 alphanumeric chars — but prisma returns null → AppError.notFound
    userFindFirst.mockResolvedValue(null);
    const res = await request(app).get('/api/dashboard/summary?targetUserId=clxyz1234567890abcdefgh');
    expect(res.status).toBe(404);
  });

  it('forwards resolved targetUserId to service when ADMIN passes valid user', async () => {
    // ADMIN + valid CUID + user found → service receives the resolved targetUserId
    userFindFirst.mockResolvedValue({ id: 'clxyz1234567890abcdefgh' });
    const res = await request(app).get('/api/dashboard/summary?fy=2024-25&targetUserId=clxyz1234567890abcdefgh');
    expect(res.status).toBe(200);
    expect(summarySvc).toHaveBeenCalledWith('u1', 'ADMIN', '2024-25', 'clxyz1234567890abcdefgh');
  });
});

// ─── GET /api/dashboard/cashflow ─────────────────────────────────────────────

describe('GET /api/dashboard/cashflow', () => {
  it('returns 200 with cashflow data', async () => {
    cashflowSvc.mockResolvedValue([{ month: '2024-01', income: 5000 }]);
    const res = await request(app).get('/api/dashboard/cashflow');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('calls service with userId, role, and fy', async () => {
    await request(app).get('/api/dashboard/cashflow?fy=2024-25');
    expect(cashflowSvc).toHaveBeenCalledWith('u1', 'ADMIN', '2024-25', undefined);
  });
});

// ─── GET /api/dashboard/upcoming-alerts ──────────────────────────────────────

describe('GET /api/dashboard/upcoming-alerts', () => {
  it('returns 200 with alerts array', async () => {
    alertsSvc.mockResolvedValue([{ type: 'SIP_DUE', daysUntil: 3 }]);
    const res = await request(app).get('/api/dashboard/upcoming-alerts');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('returns empty array when no alerts', async () => {
    const res = await request(app).get('/api/dashboard/upcoming-alerts');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

// ─── GET /api/dashboard/family-overview ──────────────────────────────────────

describe('GET /api/dashboard/family-overview', () => {
  it('returns 200 with family overview', async () => {
    familySvc.mockResolvedValue({ members: [{ name: 'Alice' }] });
    const res = await request(app).get('/api/dashboard/family-overview');
    expect(res.status).toBe(200);
    expect(res.body.data.members).toHaveLength(1);
  });

  it('propagates service errors', async () => {
    const { AppError } = await import('../../utils/AppError');
    familySvc.mockRejectedValue(AppError.internal('DB error'));
    const res = await request(app).get('/api/dashboard/family-overview');
    expect(res.status).toBe(500);
  });
});
