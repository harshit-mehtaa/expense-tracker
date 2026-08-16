/**
 * createApp() in development mode (isDev = true).
 *
 * Separate file because vi.mock is hoisted to file scope: app.test.ts runs with the
 * real env (isDev = false, so morgan gets 'combined'), and the two cannot coexist.
 * This covers the 'dev' arm of `morgan(isDev ? 'dev' : 'combined')`.
 */
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import morgan from 'morgan';

// Mocked so the chosen format string is OBSERVABLE. Without this the test can only see
// that the app still works, which stays green even if the format silently changes.
vi.mock('morgan', () => ({
  default: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

vi.mock('../config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/env')>();
  return {
    ...actual,
    env: { ...actual.env, NODE_ENV: 'development' },
    isDev: true,
    isProd: false,
    isTest: false,
  };
});

vi.mock('../config/prisma', () => {
  const prisma = {
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    user: { findFirst: vi.fn() },
  };
  return { default: prisma, prisma };
});

vi.mock('../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'u1', email: 'u@e.com', role: 'ADMIN' };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

const { createApp } = await import('../app');

describe('createApp with isDev = true', () => {
  it('selects morgan\'s "dev" log format, not "combined"', async () => {
    createApp();
    expect(morgan).toHaveBeenCalledWith('dev');
    expect(morgan).not.toHaveBeenCalledWith('combined');
  });

  it('still builds a working app in dev mode', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
  });
});
