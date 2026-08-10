/**
 * Tests for errorHandler behaviour in production mode (isProd=true).
 * Kept separate from errorHandler.test.ts because vi.mock is hoisted to
 * file scope — mixing isProd=true and isProd=false mocks in one file is
 * not possible without resetModules gymnastics.
 */
import { describe, it, expect, vi } from 'vitest';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { AppError } from '../utils/AppError';

// ── Mock env so isProd=true for this entire test file ──────────────────────
vi.mock('../config/env', () => ({
  env: { NODE_ENV: 'production', PORT: 3000 },
  isDev: false,
  isProd: true,
  isTest: false,
}));

// Import errorHandler AFTER the mock is set up
const { errorHandler } = await import('../middleware/errorHandler');

function makeErrorApp(thrower: () => unknown) {
  const app = express();
  app.use(express.json());
  app.get('/test', (_req: Request, _res: Response, next: NextFunction) => {
    try { thrower(); } catch (err) { next(err); }
  });
  app.use(errorHandler);
  return app;
}

describe('errorHandler in production mode (isProd=true)', () => {
  it('does NOT include stack trace in 500 response', async () => {
    const app = makeErrorApp(() => { throw new Error('prod error'); });
    const res = await request(app).get('/test');
    expect(res.status).toBe(500);
    expect(res.body.stack).toBeUndefined();
    expect(res.body.message).toBe('An unexpected error occurred');
  });

  it('logs the url and method to console.error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = makeErrorApp(() => { throw new Error('logged'); });
    await request(app).get('/test');
    expect(spy).toHaveBeenCalledWith('[ERROR]', expect.objectContaining({
      url: '/test',
      method: 'GET',
    }));
    spy.mockRestore();
  });

  it('logs "Unknown error" message for non-Error throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = makeErrorApp(() => { throw 'raw string'; });
    await request(app).get('/test');
    expect(spy).toHaveBeenCalledWith('[ERROR]', expect.objectContaining({
      message: 'Unknown error',
    }));
    spy.mockRestore();
  });

  it('still returns operational AppError responses (not affected by isProd)', async () => {
    const app = makeErrorApp(() => { throw AppError.notFound('Item'); });
    const res = await request(app).get('/test');
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Item not found');
  });
});
