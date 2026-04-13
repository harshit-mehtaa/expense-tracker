/**
 * Route integration tests for /api/transactions.
 * Services and Prisma are fully mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';

// ── Auth middleware mock ──────────────────────────────────────────────────────
const ADMIN_USER = { userId: 'admin-id', email: 'admin@example.com', role: 'ADMIN' as const };
const MEMBER_USER = { userId: 'member-id', email: 'member@example.com', role: 'MEMBER' as const };

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = (req as any).__testUser ?? ADMIN_USER;
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

// ── Mock transactionService ───────────────────────────────────────────────────
vi.mock('../../services/transactionService', () => ({
  getTransactions: vi.fn(),
  getAllTransactionsForExport: vi.fn(),
  buildCsv: vi.fn(),
  getTransactionById: vi.fn(),
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  softDeleteTransaction: vi.fn(),
}));

// ── Mock prisma (for targetUserId lookup in GET /) ────────────────────────────
vi.mock('../../config/prisma', () => {
  const prisma = { user: { findFirst: vi.fn() } };
  return { default: prisma, prisma };
});

import transactionsRouter from '../../routes/transactions';
import * as txSvc from '../../services/transactionService';
import { prisma } from '../../config/prisma';
import { errorHandler } from '../../middleware/errorHandler';

const getTransactionsMock = txSvc.getTransactions as ReturnType<typeof vi.fn>;
const getAllForExportMock = txSvc.getAllTransactionsForExport as ReturnType<typeof vi.fn>;
const buildCsvMock = txSvc.buildCsv as ReturnType<typeof vi.fn>;
const getByIdMock = txSvc.getTransactionById as ReturnType<typeof vi.fn>;
const createMock = txSvc.createTransaction as ReturnType<typeof vi.fn>;
const updateMock = txSvc.updateTransaction as ReturnType<typeof vi.fn>;
const softDeleteMock = txSvc.softDeleteTransaction as ReturnType<typeof vi.fn>;
const userFindFirstMock = (prisma as any).user.findFirst as ReturnType<typeof vi.fn>;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/transactions', transactionsRouter);
  app.use(errorHandler);
  return app;
}

/** App that injects MEMBER_USER so the else-branch (line 57) is exercised. */
function makeMemberApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((req: any, _res: any, next: any) => { req.__testUser = MEMBER_USER; next(); });
  app.use('/api/transactions', transactionsRouter);
  app.use(errorHandler);
  return app;
}

const MOCK_TX = { id: 'tx-1', amount: 1000, type: 'EXPENSE', description: 'Coffee', date: new Date().toISOString() };
const MOCK_META = { total: 1, limit: 20, hasMore: false, nextCursor: null };

beforeEach(() => {
  vi.clearAllMocks();
  getTransactionsMock.mockResolvedValue({ items: [MOCK_TX], meta: MOCK_META });
  getByIdMock.mockResolvedValue(MOCK_TX);
  createMock.mockResolvedValue({ ...MOCK_TX, id: 'tx-new' });
  updateMock.mockResolvedValue(MOCK_TX);
  softDeleteMock.mockResolvedValue(undefined);
  userFindFirstMock.mockResolvedValue({ id: 'user-2' });
});

// ─── GET /api/transactions ────────────────────────────────────────────────────

describe('GET /api/transactions', () => {
  it('returns 200 with paginated data', async () => {
    const res = await request(makeApp()).get('/api/transactions');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination).toBeDefined();
  });

  it('passes query filters to transactionService.getTransactions', async () => {
    await request(makeApp()).get('/api/transactions?fy=2025-26&search=coffee');
    expect(getTransactionsMock).toHaveBeenCalledWith(
      expect.any(String),
      'ADMIN',
      expect.objectContaining({ fy: '2025-26', search: 'coffee' }),
    );
  });

  it('returns 400 for invalid targetUserId format', async () => {
    const res = await request(makeApp()).get('/api/transactions?targetUserId=not-a-cuid');
    expect(res.status).toBe(400);
  });

  it('returns 404 when targetUserId does not exist', async () => {
    userFindFirstMock.mockResolvedValue(null);
    const res = await request(makeApp()).get('/api/transactions?targetUserId=clm1234567890abcdefghij');
    expect(res.status).toBe(404);
  });

  it('ADMIN with valid targetUserId found — forwards resolved userId to service', async () => {
    // userFindFirstMock returns { id: 'user-2' } from beforeEach
    const res = await request(makeApp()).get('/api/transactions?targetUserId=clm1234567890abcdefghij');
    expect(res.status).toBe(200);
    expect(getTransactionsMock).toHaveBeenCalledWith(
      'admin-id',
      'ADMIN',
      expect.objectContaining({ userId: 'clm1234567890abcdefghij' }),
    );
  });

  it('MEMBER role — scopes to own userId (else branch)', async () => {
    const res = await request(makeMemberApp()).get('/api/transactions');
    expect(res.status).toBe(200);
    // MEMBER path: effectiveUserId = req.user.userId = 'member-id'
    expect(getTransactionsMock).toHaveBeenCalledWith(
      'member-id',
      'MEMBER',
      expect.objectContaining({ userId: 'member-id' }),
    );
  });

  it('parses comma-separated type filter into array (parseMultiParam positive path)', async () => {
    await request(makeApp()).get('/api/transactions?type=INCOME,EXPENSE');
    expect(getTransactionsMock).toHaveBeenCalledWith(
      expect.any(String),
      'ADMIN',
      expect.objectContaining({ types: ['INCOME', 'EXPENSE'] }),
    );
  });

  it('parseMultiParam returns undefined for empty string (false branch, line 17)', async () => {
    // ?type= is an empty string → parseMultiParam('') → !s is true → returns undefined
    await request(makeApp()).get('/api/transactions?type=');
    expect(getTransactionsMock).toHaveBeenCalledWith(
      expect.any(String),
      'ADMIN',
      expect.objectContaining({ types: undefined }),
    );
  });

  it('passes undefined for absent minAmount and maxAmount filters', async () => {
    await request(makeApp()).get('/api/transactions');
    const call = getTransactionsMock.mock.calls[0][2];
    expect(call.minAmount).toBeUndefined();
    expect(call.maxAmount).toBeUndefined();
  });

  it('passes minAmount, maxAmount and limit as numbers when provided (lines 73-76 truthy branches)', async () => {
    await request(makeApp()).get('/api/transactions?minAmount=500&maxAmount=5000&limit=50');
    const call = getTransactionsMock.mock.calls[0][2];
    expect(call.minAmount).toBe(500);
    expect(call.maxAmount).toBe(5000);
    expect(call.limit).toBe(50);
  });
});

// ─── GET /api/transactions/export ─────────────────────────────────────────────

describe('GET /api/transactions/export', () => {
  it('returns CSV content-type', async () => {
    getAllForExportMock.mockResolvedValue([MOCK_TX]);
    buildCsvMock.mockReturnValue('date,amount,description\n2025-01-01,1000,Coffee');
    const res = await request(makeApp()).get('/api/transactions/export?fy=2025-26');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
  });

  it('calls getAllTransactionsForExport and buildCsv', async () => {
    getAllForExportMock.mockResolvedValue([MOCK_TX]);
    buildCsvMock.mockReturnValue('csv-content');
    await request(makeApp()).get('/api/transactions/export?fy=2025-26');
    expect(getAllForExportMock).toHaveBeenCalled();
    expect(buildCsvMock).toHaveBeenCalled();
  });

  it('passes fy=undefined when fy param is absent (false branch, line 93)', async () => {
    getAllForExportMock.mockResolvedValue([]);
    buildCsvMock.mockReturnValue('');
    await request(makeApp()).get('/api/transactions/export');
    const call = getAllForExportMock.mock.calls[0];
    // args: (userId, role, filters) — filters.fy should be undefined
    expect(call[2]).toEqual(expect.objectContaining({ fy: undefined }));
  });
});

// ─── GET /api/transactions/:id ────────────────────────────────────────────────

describe('GET /api/transactions/:id', () => {
  it('returns 200 with the transaction', async () => {
    const res = await request(makeApp()).get('/api/transactions/tx-1');
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('tx-1');
  });

  it('propagates AppError (e.g. 404 not found)', async () => {
    const { AppError } = await import('../../utils/AppError');
    getByIdMock.mockRejectedValue(AppError.notFound('Transaction'));
    const res = await request(makeApp()).get('/api/transactions/nonexistent');
    expect(res.status).toBe(404);
  });
});

// ─── POST /api/transactions ───────────────────────────────────────────────────

describe('POST /api/transactions', () => {
  const VALID_INCOME = {
    amount: 50000,
    type: 'INCOME',
    description: 'Salary',
    date: '2025-04-01',
  };

  it('returns 201 on valid INCOME transaction', async () => {
    const res = await request(makeApp()).post('/api/transactions').send(VALID_INCOME);
    expect(res.status).toBe(201);
    expect(createMock).toHaveBeenCalled();
  });

  it('returns 422 when amount is negative', async () => {
    const res = await request(makeApp()).post('/api/transactions').send({ ...VALID_INCOME, amount: -100 });
    expect(res.status).toBe(422);
  });

  it('returns 422 when type is invalid', async () => {
    const res = await request(makeApp()).post('/api/transactions').send({ ...VALID_INCOME, type: 'INVALID' });
    expect(res.status).toBe(422);
  });

  it('returns 422 for TRANSFER without transferToAccountId', async () => {
    const res = await request(makeApp()).post('/api/transactions').send({
      ...VALID_INCOME,
      type: 'TRANSFER',
    });
    expect(res.status).toBe(422);
    expect(res.body.errors?.['transferToAccountId']).toBeDefined();
  });

  it('returns 422 when description is empty', async () => {
    const res = await request(makeApp()).post('/api/transactions').send({ ...VALID_INCOME, description: '' });
    expect(res.status).toBe(422);
  });
});

// ─── PUT /api/transactions/:id ────────────────────────────────────────────────

describe('PUT /api/transactions/:id', () => {
  it('returns 200 with updated transaction', async () => {
    const res = await request(makeApp()).put('/api/transactions/tx-1').send({ description: 'Updated' });
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith('tx-1', 'admin-id', 'ADMIN', { description: 'Updated' });
  });

  it('returns 422 when type TRANSFER is passed (TRANSFER edits not supported)', async () => {
    const res = await request(makeApp()).put('/api/transactions/tx-1').send({ type: 'TRANSFER' });
    expect(res.status).toBe(422);
  });
});

// ─── DELETE /api/transactions/:id ─────────────────────────────────────────────

describe('DELETE /api/transactions/:id', () => {
  it('returns 204 on successful soft delete', async () => {
    const res = await request(makeApp()).delete('/api/transactions/tx-1');
    expect(res.status).toBe(204);
    expect(softDeleteMock).toHaveBeenCalledWith('tx-1', 'admin-id', 'ADMIN');
  });

  it('propagates AppError 403 when user does not own transaction', async () => {
    const { AppError } = await import('../../utils/AppError');
    softDeleteMock.mockRejectedValue(AppError.forbidden());
    const res = await request(makeApp()).delete('/api/transactions/tx-99');
    expect(res.status).toBe(403);
  });
});
