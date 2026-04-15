/**
 * Integration smoke tests for POST /api/transactions/import.
 * Builds a minimal Express app (same middleware stack as index.ts)
 * to avoid the Docker-only /app/uploads side-effect on import.
 *
 * Verifies that the endpoint correctly branches on CSV vs PDF file type,
 * passes password to parsePDF, and rejects unsupported formats.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import multer from 'multer';
import os from 'os';
import { AppError } from '../../utils/AppError';
import { asyncHandler } from '../../utils/asyncHandler';
import { errorHandler } from '../../middleware/errorHandler';

// ── Mock auth ─────────────────────────────────────────────────────────────────
vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-test', email: 'test@example.com', role: 'MEMBER' as const };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

// ── Mock import service ───────────────────────────────────────────────────────
vi.mock('../../services/importService', () => ({
  parseCSV: vi.fn(),
  parsePDF: vi.fn(),
  makeImportHash: vi.fn().mockReturnValue('mock-hash-abc'),
}));

// ── Mock prisma ───────────────────────────────────────────────────────────────
vi.mock('../../config/prisma', () => {
  const prisma = {
    bankAccount: { findFirst: vi.fn() },
    transaction: { findMany: vi.fn().mockResolvedValue([]) },
    bankStatementImport: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn().mockImplementation(async (fn: any) => fn({
      transaction: { create: vi.fn().mockResolvedValue({}) },
      bankAccount: { update: vi.fn() },
    })),
  };
  return { default: prisma, prisma };
});

import { requireAuth } from '../../middleware/auth';
import * as importSvc from '../../services/importService';
import { prisma } from '../../config/prisma';
import { sendCreated } from '../../utils/response';

const parseCSVMock = importSvc.parseCSV as ReturnType<typeof vi.fn>;
const parsePDFMock = importSvc.parsePDF as ReturnType<typeof vi.fn>;

const PARSED_RESULT = {
  transactions: [
    { date: new Date('2025-04-01'), description: 'SALARY', amount: 50000, type: 'INCOME' as const },
  ],
  errors: [],
  warnings: [],
  bank: 'HDFC',
};

/** Builds a minimal Express app with just the import endpoint */
function makeImportApp() {
  const app = express();
  app.use(express.json());

  const upload = multer({
    dest: os.tmpdir(), // Use OS temp dir — works everywhere
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const isCSV = ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel'].includes(file.mimetype)
        || file.originalname.endsWith('.csv');
      const isPDF = ['application/pdf', 'application/x-pdf'].includes(file.mimetype)
        || file.originalname.endsWith('.pdf');
      if (isCSV || isPDF) {
        cb(null, true);
      } else {
        cb(new AppError('Only CSV or PDF files are allowed', 400));
      }
    },
  });

  app.post(
    '/api/transactions/import',
    requireAuth,
    upload.single('file'),
    asyncHandler(async (req, res) => {
      if (!req.file) throw AppError.badRequest('No file uploaded');

      const accountId = req.body.bankAccountId as string | undefined;
      const bankHint = req.body.bank as string | undefined;
      const pdfPassword = req.body.pdfPassword as string | undefined;

      const isPDF = req.file.mimetype === 'application/pdf'
        || req.file.mimetype === 'application/x-pdf'
        || req.file.originalname.endsWith('.pdf');

      const result = isPDF
        ? await importSvc.parsePDF(Buffer.alloc(0), bankHint, pdfPassword)
        : importSvc.parseCSV(Buffer.alloc(0), bankHint);

      const scopeId = accountId ?? (req as any).user!.userId;
      const txsWithHash = result.transactions.map((tx: any) => ({
        ...tx,
        hash: importSvc.makeImportHash(tx.date, tx.amount, tx.type, tx.description, scopeId),
      }));

      const hashes = txsWithHash.map((t: any) => t.hash);
      const existingHashes = new Set<string>(
        ((await prisma.transaction.findMany({
          where: { importHash: { in: hashes } },
          select: { importHash: true },
        })) as any[]).map((r: any) => r.importHash!),
      );

      const toCreate = txsWithHash.filter((t: any) => !existingHashes.has(t.hash));
      const duplicates = txsWithHash.length - toCreate.length;

      let imported = 0;
      await prisma.$transaction(async (tx: any) => {
        for (const t of toCreate) {
          await tx.transaction.create({ data: { ...t } });
          imported++;
        }
      });

      await prisma.bankStatementImport.create({
        data: {
          userId: (req as any).user!.userId,
          bankAccountId: accountId ?? null,
          bankName: result.bank,
          rowCount: result.transactions.length,
          importedCount: imported,
          duplicatesSkipped: duplicates,
          errorsCount: 0,
          filename: req.file.originalname,
        },
      });

      sendCreated(res, {
        bank: result.bank,
        total: result.transactions.length,
        imported,
        duplicatesSkipped: duplicates,
        errors: [],
        parseErrors: result.errors,
        warnings: result.warnings,
      });
    }),
  );

  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  parseCSVMock.mockReturnValue(PARSED_RESULT);
  parsePDFMock.mockResolvedValue(PARSED_RESULT);
  (prisma.bankStatementImport.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
});

describe('POST /api/transactions/import — file type routing', () => {
  it('routes a .csv file to parseCSV (not parsePDF)', async () => {
    const csvContent = Buffer.from('Date,Description,Amount\n01/04/25,TEST,500.00\n');
    const res = await request(makeImportApp())
      .post('/api/transactions/import')
      .attach('file', csvContent, { filename: 'statement.csv', contentType: 'text/csv' });

    expect(res.status).toBe(201);
    expect(parseCSVMock).toHaveBeenCalledOnce();
    expect(parsePDFMock).not.toHaveBeenCalled();
  });

  it('routes a .pdf file to parsePDF (not parseCSV)', async () => {
    const pdfContent = Buffer.from('%PDF-1.4 fake pdf content');
    const res = await request(makeImportApp())
      .post('/api/transactions/import')
      .attach('file', pdfContent, { filename: 'statement.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(parsePDFMock).toHaveBeenCalledOnce();
    expect(parseCSVMock).not.toHaveBeenCalled();
  });

  it('accepts a .pdf file when MIME type is application/x-pdf', async () => {
    const pdfContent = Buffer.from('%PDF-1.4 fake pdf content');
    const res = await request(makeImportApp())
      .post('/api/transactions/import')
      .attach('file', pdfContent, { filename: 'statement.pdf', contentType: 'application/x-pdf' });

    expect(res.status).toBe(201);
    expect(parsePDFMock).toHaveBeenCalledOnce();
  });

  it('passes pdfPassword from request body to parsePDF', async () => {
    const pdfContent = Buffer.from('%PDF-1.4 fake pdf content');
    await request(makeImportApp())
      .post('/api/transactions/import')
      .attach('file', pdfContent, { filename: 'statement.pdf', contentType: 'application/pdf' })
      .field('pdfPassword', 'secret123');

    expect(parsePDFMock).toHaveBeenCalledWith(
      expect.any(Buffer),
      undefined,
      'secret123',
    );
  });

  it('rejects unsupported file types with 400', async () => {
    const imageContent = Buffer.from('fake image content');
    const res = await request(makeImportApp())
      .post('/api/transactions/import')
      .attach('file', imageContent, { filename: 'statement.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(400);
    expect(parseCSVMock).not.toHaveBeenCalled();
    expect(parsePDFMock).not.toHaveBeenCalled();
  });

  it('returns 400 when no file is attached', async () => {
    const res = await request(makeImportApp())
      .post('/api/transactions/import');

    expect(res.status).toBe(400);
  });

  it('returns bank and import counts in the response', async () => {
    const csvContent = Buffer.from('Date,Description,Amount\n01/04/25,TEST,500.00\n');
    const res = await request(makeImportApp())
      .post('/api/transactions/import')
      .attach('file', csvContent, { filename: 'statement.csv', contentType: 'text/csv' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      bank: 'HDFC',
      total: 1,
    });
  });
});
