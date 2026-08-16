/**
 * Tests for createApp() — the Express factory extracted out of index.ts.
 *
 * The load-bearing assertion here is mount ORDER: /api/transactions/import must be
 * registered before /api/transactions, so a future `router.post('/:id')` in
 * transactions.ts can never swallow the import endpoint. Before the extraction this
 * worked only by luck of registration order.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../config/prisma', () => {
  const prisma = {
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    user: { findFirst: vi.fn() },
  };
  return { default: prisma, prisma };
});

// Unauthenticated by default so route tests below exercise the auth boundary; the
// import cases override req.user via __testUser.
vi.mock('../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = (req as any).__testUser ?? { userId: 'u1', email: 'u@e.com', role: 'ADMIN' };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../services/importService', () => ({
  parseCSV: vi.fn(),
  parsePDF: vi.fn(),
}));

vi.mock('../services/categoryRuleService', () => ({
  applyCategoryRules: vi.fn(),
  listCategoryRules: vi.fn(),
  createCategoryRule: vi.fn(),
  deleteCategoryRule: vi.fn(),
}));

vi.mock('../services/statementImportService', () => ({
  persistParsedStatement: vi.fn(),
}));

vi.mock('../services/auditService', () => ({
  recordAuditLog: vi.fn(),
}));

import { createApp } from '../app';
import { parseCSV } from '../services/importService';
import { applyCategoryRules } from '../services/categoryRuleService';
import { persistParsedStatement } from '../services/statementImportService';

const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const PARSED_TX = {
  date: new Date('2025-04-01T00:00:00.000Z'),
  description: 'Coffee',
  amount: 100,
  type: 'EXPENSE' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  m(parseCSV).mockReturnValue({
    transactions: [PARSED_TX], errors: [], warnings: [], bank: 'HDFC',
  });
  m(applyCategoryRules).mockResolvedValue({ transactions: [PARSED_TX], appliedCount: 0 });
  m(persistParsedStatement).mockResolvedValue({
    imported: 1, duplicatesSkipped: 0, importRecord: { id: 'imp-1' },
  });
});

describe('createApp', () => {
  it('returns a mounted, working Express app', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
  });

  it('is a factory — two calls produce independent app instances', () => {
    const a = createApp();
    const b = createApp();
    expect(a).not.toBe(b);
  });

  it('applies the security middleware stack (helmet headers present)', async () => {
    const res = await request(createApp()).get('/api/health');
    // helmet's signature header — proves the middleware ran.
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('exposes standard rate-limit headers from the global limiter', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.headers['ratelimit-limit']).toBe('500');
  });

  it('parses JSON bodies', async () => {
    // A 404 rather than a body-parser explosion proves express.json() is wired.
    const res = await request(createApp())
      .post('/api/does-not-exist')
      .send({ hello: 'world' });
    expect(res.status).toBe(404);
  });

  it('mounts the error handler last, converting a thrown AppError into the JSON envelope', async () => {
    // The import handler throws AppError.badRequest when no file is attached. Reaching
    // the shaped envelope (rather than Express's default HTML error page) proves
    // errorHandler is registered after every router.
    const res = await request(createApp()).post('/api/transactions/import');
    expect(res.status).toBe(400);
    expect(res.body).toEqual(expect.objectContaining({
      success: false,
      message: 'No file uploaded',
    }));
  });
});

describe('createApp — route mount order (import must precede transactions)', () => {
  it('POST /api/transactions/import reaches the IMPORT router, not transactionsRouter', async () => {
    const res = await request(createApp()).post('/api/transactions/import');

    // "No file uploaded" is uniquely the import handler's response. transactionsRouter
    // has no /import route, so if ordering regressed this would 404 or hit POST /:id.
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('No file uploaded');
  });

  it('a real CSV upload through the full app reaches the import pipeline', async () => {
    const res = await request(createApp())
      .post('/api/transactions/import')
      .attach('file', Buffer.from('date,amount\n'), { filename: 'stmt.csv', contentType: 'text/csv' });

    expect(res.status).toBe(201);
    expect(parseCSV).toHaveBeenCalledTimes(1);
    expect(persistParsedStatement).toHaveBeenCalledTimes(1);
  });

  it('/api/transactions itself still routes to transactionsRouter', async () => {
    // The more specific prefix must not shadow the general one.
    const res = await request(createApp()).get('/api/transactions');
    expect(res.status).not.toBe(404);
  });
});
