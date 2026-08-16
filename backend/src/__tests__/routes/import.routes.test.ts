/**
 * Route integration tests for POST /api/transactions/import.
 *
 * These drive the REAL router with REAL multer and REAL multipart uploads via
 * supertest .attach(). That is only possible because env.UPLOADS_DIR points at a
 * writable temp dir (see __tests__/setup.ts) — multer({ dest }) mkdirs at construction
 * time and, being externalized CJS, cannot be intercepted by vi.mock('fs').
 *
 * This file replaces a previous version that built its own copy of the handler inline
 * and tested that copy, which had silently drifted from production.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { errorHandler } from '../../middleware/errorHandler';

// Own upload dir, not the shared one from setup.ts. Vitest runs test files in parallel
// and this suite both lists and wipes the directory, so sharing it would make these
// assertions flaky the moment another file performs a real upload.
// vi.hoisted: the vi.mock factory below is hoisted above normal const declarations.
const { UPLOAD_DIR } = vi.hoisted(() => ({
  UPLOAD_DIR: require('path').join(
    require('os').tmpdir(),
    `expense-tracker-import-routes-${process.pid}`,
  ) as string,
}));

vi.mock('../../config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/env')>();
  return { ...actual, env: { ...actual.env, UPLOADS_DIR: UPLOAD_DIR } };
});

const ADMIN_USER = { userId: 'admin-id', email: 'admin@example.com', role: 'ADMIN' as const };
const MEMBER_USER = { userId: 'member-id', email: 'member@example.com', role: 'MEMBER' as const };

// ─── Module mocks (hoisted) ────────────────────────────────────────────────────

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = (req as any).__testUser ?? ADMIN_USER;
    next();
  },
}));

vi.mock('../../config/prisma', () => {
  const prisma = { user: { findFirst: vi.fn() } };
  return { default: prisma, prisma };
});

vi.mock('../../services/importService', () => ({
  parseCSV: vi.fn(),
  parsePDF: vi.fn(),
}));

vi.mock('../../services/categoryRuleService', () => ({
  applyCategoryRules: vi.fn(),
}));

vi.mock('../../services/statementImportService', () => ({
  persistParsedStatement: vi.fn(),
}));

vi.mock('../../services/auditService', () => ({
  recordAuditLog: vi.fn(),
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────────

import importRouter from '../../routes/import';
import { prisma } from '../../config/prisma';
import { parseCSV, parsePDF } from '../../services/importService';
import { applyCategoryRules } from '../../services/categoryRuleService';
import { persistParsedStatement } from '../../services/statementImportService';
import { recordAuditLog } from '../../services/auditService';
import { env } from '../../config/env';

const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const userFindFirstMock = (prisma as any).user.findFirst as ReturnType<typeof vi.fn>;

/** Valid CUID-format id (20-30 alphanumeric chars) for the admin-on-behalf-of cases. */
const VALID_TARGET_ID = 'clm1234567890abcdefghij';

function mountImportRouter(user?: typeof MEMBER_USER) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  if (user) app.use((req: any, _res: any, next: any) => { req.__testUser = user; next(); });
  app.use('/api/transactions/import', importRouter);
  app.use(errorHandler);
  return app;
}

const PARSED_TX = {
  date: new Date('2025-04-01T00:00:00.000Z'),
  description: 'Coffee',
  amount: 100,
  type: 'EXPENSE' as const,
};

const PARSE_RESULT = {
  transactions: [PARSED_TX],
  errors: [],
  warnings: [],
  bank: 'HDFC',
};

/** Files sitting in the multer dest dir, used to prove temp cleanup. */
function uploadsDirFiles(): string[] {
  if (!fs.existsSync(env.UPLOADS_DIR)) return [];
  return fs.readdirSync(env.UPLOADS_DIR).filter((f) => fs.statSync(`${env.UPLOADS_DIR}/${f}`).isFile());
}

beforeEach(() => {
  vi.clearAllMocks();
  userFindFirstMock.mockResolvedValue({ id: VALID_TARGET_ID });
  m(parseCSV).mockReturnValue(PARSE_RESULT);
  m(parsePDF).mockResolvedValue(PARSE_RESULT);
  m(applyCategoryRules).mockResolvedValue({ transactions: [PARSED_TX], appliedCount: 0 });
  m(persistParsedStatement).mockResolvedValue({
    imported: 1,
    duplicatesSkipped: 0,
    importRecord: { id: 'imp-1' },
  });
});

// ═══ Parser dispatch (the 7 assertions carried over from the deleted file) ═════

describe('POST /api/transactions/import — parser dispatch', () => {
  it('routes a .csv upload to parseCSV, not parsePDF', async () => {
    const res = await request(mountImportRouter())
      .post('/api/transactions/import')
      .attach('file', Buffer.from('date,amount\n'), { filename: 'stmt.csv', contentType: 'text/csv' });

    expect(res.status).toBe(201);
    expect(parseCSV).toHaveBeenCalledTimes(1);
    expect(parsePDF).not.toHaveBeenCalled();
  });

  it('routes a .pdf upload to parsePDF, not parseCSV', async () => {
    const res = await request(mountImportRouter())
      .post('/api/transactions/import')
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'stmt.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(parsePDF).toHaveBeenCalledTimes(1);
    expect(parseCSV).not.toHaveBeenCalled();
  });

  it('accepts the application/x-pdf mimetype variant', async () => {
    const res = await request(mountImportRouter())
      .post('/api/transactions/import')
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'stmt.pdf', contentType: 'application/x-pdf' });

    expect(res.status).toBe(201);
    expect(parsePDF).toHaveBeenCalledTimes(1);
  });

  it('forwards pdfPassword as parsePDF\'s 3rd arg, with bank undefined as the 2nd', async () => {
    await request(mountImportRouter())
      .post('/api/transactions/import')
      .field('pdfPassword', 'hunter2')
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'stmt.pdf', contentType: 'application/pdf' });

    expect(parsePDF).toHaveBeenCalledWith(expect.any(Buffer), undefined, 'hunter2');
  });

  it('forwards the bank hint to parseCSV when supplied', async () => {
    await request(mountImportRouter())
      .post('/api/transactions/import')
      .field('bank', 'ICICI')
      .attach('file', Buffer.from('date,amount\n'), { filename: 'stmt.csv', contentType: 'text/csv' });

    expect(parseCSV).toHaveBeenCalledWith(expect.any(Buffer), 'ICICI');
  });

  it('returns a body carrying bank and total', async () => {
    const res = await request(mountImportRouter())
      .post('/api/transactions/import')
      .attach('file', Buffer.from('date,amount\n'), { filename: 'stmt.csv', contentType: 'text/csv' });

    expect(res.body.data.bank).toBe('HDFC');
    expect(res.body.data.total).toBe(1);
  });
});

// ═══ fileFilter — the upload security boundary ════════════════════════════════

describe('POST /api/transactions/import — fileFilter', () => {
  it('rejects image/jpeg with 400', async () => {
    const res = await request(mountImportRouter())
      .post('/api/transactions/import')
      .attach('file', Buffer.from('\xff\xd8\xff'), { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Only CSV or PDF files are allowed');
    expect(parseCSV).not.toHaveBeenCalled();
    expect(parsePDF).not.toHaveBeenCalled();
  });

  it('accepts a CSV identified by EXTENSION alone (mimetype octet-stream)', async () => {
    const res = await request(mountImportRouter())
      .post('/api/transactions/import')
      .attach('file', Buffer.from('date,amount\n'), {
        filename: 'stmt.csv', contentType: 'application/octet-stream',
      });

    expect(res.status).toBe(201);
    expect(parseCSV).toHaveBeenCalledTimes(1);
  });

  it('accepts a PDF identified by EXTENSION alone (mimetype octet-stream)', async () => {
    const res = await request(mountImportRouter())
      .post('/api/transactions/import')
      .attach('file', Buffer.from('%PDF-1.4'), {
        filename: 'stmt.pdf', contentType: 'application/octet-stream',
      });

    expect(res.status).toBe(201);
  });

  it('routes an extension-only PDF to parsePDF (isPDF falls back to the suffix)', async () => {
    await request(mountImportRouter())
      .post('/api/transactions/import')
      .attach('file', Buffer.from('%PDF-1.4'), {
        filename: 'stmt.pdf', contentType: 'application/octet-stream',
      });

    expect(parsePDF).toHaveBeenCalledTimes(1);
    expect(parseCSV).not.toHaveBeenCalled();
  });

  it.each([
    ['application/csv', 'a.bin'],
    ['text/plain', 'b.bin'],
    ['application/vnd.ms-excel', 'c.bin'],
  ])('accepts the %s mimetype regardless of extension', async (contentType, filename) => {
    const res = await request(mountImportRouter())
      .post('/api/transactions/import')
      .attach('file', Buffer.from('date,amount\n'), { filename, contentType });

    expect(res.status).toBe(201);
  });
});

// ═══ Validation ═══════════════════════════════════════════════════════════════

describe('POST /api/transactions/import — validation', () => {
  it('returns 400 when no file is attached', async () => {
    const res = await request(mountImportRouter()).post('/api/transactions/import');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('No file uploaded');
  });

  it('returns 400 listing parse errors when nothing could be parsed', async () => {
    m(parseCSV).mockReturnValue({
      transactions: [],
      errors: [
        { row: 1, message: 'bad date', raw: 'x' },
        { row: 2, message: 'bad amount', raw: 'y' },
      ],
      warnings: [],
      bank: 'HDFC',
    });

    const res = await request(mountImportRouter())
      .post('/api/transactions/import')
      .attach('file', Buffer.from('garbage'), { filename: 'stmt.csv', contentType: 'text/csv' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('No transactions parsed');
    expect(res.body.message).toContain('bad date');
    expect(res.body.message).toContain('bad amount');
    expect(persistParsedStatement).not.toHaveBeenCalled();
  });
});

// ═══ Owner resolution ═════════════════════════════════════════════════════════

describe('POST /api/transactions/import — owner resolution', () => {
  it('an ADMIN with ?targetUserId persists under the TARGET member', async () => {
    await request(mountImportRouter())
      .post(`/api/transactions/import?targetUserId=${VALID_TARGET_ID}`)
      .attach('file', Buffer.from('date,amount\n'), { filename: 'stmt.csv', contentType: 'text/csv' });

    expect(persistParsedStatement).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: VALID_TARGET_ID }),
    );
    expect(applyCategoryRules).toHaveBeenCalledWith(VALID_TARGET_ID, expect.any(Array));
  });

  it('an ADMIN without targetUserId persists under their own id', async () => {
    await request(mountImportRouter())
      .post('/api/transactions/import')
      .attach('file', Buffer.from('date,amount\n'), { filename: 'stmt.csv', contentType: 'text/csv' });

    expect(persistParsedStatement).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: 'admin-id' }),
    );
  });

  it('a MEMBER passing targetUserId is IGNORED — they cannot import for someone else', async () => {
    await request(mountImportRouter(MEMBER_USER))
      .post(`/api/transactions/import?targetUserId=${VALID_TARGET_ID}`)
      .attach('file', Buffer.from('date,amount\n'), { filename: 'stmt.csv', contentType: 'text/csv' });

    expect(persistParsedStatement).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: MEMBER_USER.userId }),
    );
  });
});

// ═══ Persistence hand-off & audit ═════════════════════════════════════════════

describe('POST /api/transactions/import — persistence and audit', () => {
  it('hands the parsed statement to the service with the RAW filename (service sanitizes)', async () => {
    await request(mountImportRouter())
      .post('/api/transactions/import')
      .field('bankAccountId', 'acc1')
      .attach('file', Buffer.from('date,amount\n'), { filename: 'stmt.csv', contentType: 'text/csv' });

    expect(persistParsedStatement).toHaveBeenCalledWith({
      ownerUserId: 'admin-id',
      accountId: 'acc1',
      bank: 'HDFC',
      rowCount: 1,
      transactions: [expect.objectContaining({ description: 'Coffee' })],
      filename: 'stmt.csv',
    });
  });

  it('records an audit entry against the returned import record', async () => {
    m(persistParsedStatement).mockResolvedValue({
      imported: 5, duplicatesSkipped: 2, importRecord: { id: 'imp-42' },
    });

    await request(mountImportRouter())
      .post('/api/transactions/import')
      .attach('file', Buffer.from('date,amount\n'), { filename: 'stmt.csv', contentType: 'text/csv' });

    expect(recordAuditLog).toHaveBeenCalledWith({
      performedByUserId: 'admin-id',
      action: 'CREATE',
      entityType: 'BankStatementImport',
      entityId: 'imp-42',
      newValue: { id: 'imp-42' },
    });
  });

  it('logs the audit against the ACTING admin even when importing for another member', async () => {
    await request(mountImportRouter())
      .post(`/api/transactions/import?targetUserId=${VALID_TARGET_ID}`)
      .attach('file', Buffer.from('date,amount\n'), { filename: 'stmt.csv', contentType: 'text/csv' });

    expect(m(recordAuditLog).mock.calls[0][0].performedByUserId).toBe('admin-id');
  });

  it('surfaces a service failure through the error handler', async () => {
    const { AppError } = await import('../../utils/AppError');
    m(persistParsedStatement).mockRejectedValue(
      new AppError('Import failed — no transactions were saved. Please try again.', 500, 'IMPORT_FAILED', true),
    );

    const res = await request(mountImportRouter())
      .post('/api/transactions/import')
      .attach('file', Buffer.from('date,amount\n'), { filename: 'stmt.csv', contentType: 'text/csv' });

    expect(res.status).toBe(500);
    // isOperational was forced true, so the curated message reaches the user.
    expect(res.body.message).toBe('Import failed — no transactions were saved. Please try again.');
    expect(recordAuditLog).not.toHaveBeenCalled();
  });
});

// ═══ Response shape ═══════════════════════════════════════════════════════════

describe('POST /api/transactions/import — response shape', () => {
  it('reports counts from the service and categorized count from the rules pass', async () => {
    m(applyCategoryRules).mockResolvedValue({ transactions: [PARSED_TX], appliedCount: 3 });
    m(persistParsedStatement).mockResolvedValue({
      imported: 7, duplicatesSkipped: 4, importRecord: { id: 'imp-1' },
    });

    const res = await request(mountImportRouter())
      .post('/api/transactions/import')
      .attach('file', Buffer.from('date,amount\n'), { filename: 'stmt.csv', contentType: 'text/csv' });

    expect(res.body.data).toEqual(expect.objectContaining({
      bank: 'HDFC',
      total: 1,
      imported: 7,
      duplicatesSkipped: 4,
      categorized: 3,
      errors: [],
    }));
  });

  it('always returns an empty errors array (a partial batch failure is impossible)', async () => {
    const res = await request(mountImportRouter())
      .post('/api/transactions/import')
      .attach('file', Buffer.from('date,amount\n'), { filename: 'stmt.csv', contentType: 'text/csv' });

    expect(res.body.data.errors).toEqual([]);
  });

  it('passes through parse errors and warnings, capped at 10', async () => {
    m(parseCSV).mockReturnValue({
      transactions: [PARSED_TX],
      errors: Array.from({ length: 15 }, (_, i) => ({ row: i, message: `e${i}`, raw: '' })),
      warnings: ['heads up'],
      bank: 'HDFC',
    });

    const res = await request(mountImportRouter())
      .post('/api/transactions/import')
      .attach('file', Buffer.from('date,amount\n'), { filename: 'stmt.csv', contentType: 'text/csv' });

    expect(res.body.data.parseErrors).toHaveLength(10);
    expect(res.body.data.warnings).toEqual(['heads up']);
  });
});

// ═══ Temp file cleanup ════════════════════════════════════════════════════════

describe('POST /api/transactions/import — temp file cleanup', () => {
  it('unlinks the uploaded temp file after a successful read', async () => {
    const before = uploadsDirFiles();

    await request(mountImportRouter())
      .post('/api/transactions/import')
      .attach('file', Buffer.from('date,amount\n'), { filename: 'stmt.csv', contentType: 'text/csv' });

    // multer wrote a temp file; the finally block must have removed it.
    expect(uploadsDirFiles()).toEqual(before);
  });

  it('swallows an unlink failure so a locked temp file cannot fail the import', async () => {
    // The cleanup is best-effort: on Windows/NFS the handle can still be busy. If that
    // threw, a perfectly good import would 500 after the rows were already parsed.
    const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
    });

    const res = await request(mountImportRouter())
      .post('/api/transactions/import')
      .attach('file', Buffer.from('date,amount\n'), { filename: 'stmt.csv', contentType: 'text/csv' });

    expect(unlinkSpy).toHaveBeenCalled();
    expect(res.status).toBe(201); // the throw was caught and ignored
    unlinkSpy.mockRestore();

    // Clean up the file the mocked unlink skipped.
    for (const f of uploadsDirFiles()) fs.rmSync(`${env.UPLOADS_DIR}/${f}`, { force: true });
  });

  it('unlinks the temp file even when parsing throws', async () => {
    m(parseCSV).mockImplementation(() => { throw new Error('parser exploded'); });
    const before = uploadsDirFiles();

    const res = await request(mountImportRouter())
      .post('/api/transactions/import')
      .attach('file', Buffer.from('date,amount\n'), { filename: 'stmt.csv', contentType: 'text/csv' });

    expect(res.status).toBe(500);
    expect(uploadsDirFiles()).toEqual(before);
  });
});
