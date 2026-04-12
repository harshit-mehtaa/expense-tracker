/**
 * Route integration tests for /api/health.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// health.ts uses `import prisma from '../config/prisma'` (default import)
vi.mock('../../config/prisma', () => {
  const prisma = { $queryRaw: vi.fn() };
  return { default: prisma, prisma };
});

import healthRouter from '../../routes/health';
import prisma from '../../config/prisma';
import { makeApp } from '../helpers/makeApp';

const queryRawMock = (prisma as any).$queryRaw as ReturnType<typeof vi.fn>;
const app = makeApp(healthRouter, '/api/health');

beforeEach(() => {
  vi.clearAllMocks();
  queryRawMock.mockResolvedValue([{ 1: 1 }]);
});

describe('GET /api/health', () => {
  it('returns 200 with status ok when DB is connected', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.db).toBe('connected');
  });

  it('returns 200 with status degraded when DB query fails', async () => {
    queryRawMock.mockRejectedValue(new Error('Connection refused'));
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('degraded');
    expect(res.body.data.db).toBe('disconnected');
  });

  it('includes uptime and timestamp fields', async () => {
    const res = await request(app).get('/api/health');
    expect(res.body.data.uptime).toBeTypeOf('number');
    expect(res.body.data.timestamp).toMatch(/^\d{4}-/); // ISO date string
  });
});
