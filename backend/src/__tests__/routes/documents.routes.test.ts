/**
 * Route integration tests for /api/documents.
 *
 * documents.ts is the only route file that touches the filesystem, and it does so
 * at MODULE IMPORT TIME (`fs.mkdirSync` if the uploads dir doesn't exist) — the
 * reason this file was never previously covered: /app/uploads doesn't exist on a
 * dev host or a GitHub Actions runner, so a plain import throws.
 *
 * Strategy:
 * - `fs` is mocked with a dynamic `existsSync` (default true, so mkdirSync is never
 *   reached at import time; overridden false per-test for the download-404 case —
 *   a STATIC true would make that branch permanently unreachable).
 * - `multer` is mocked entirely (real multer would try to write to disk). The
 *   options passed to `multer.diskStorage()` and `multer()` are captured via
 *   `vi.hoisted()` so `destination`/`filename`/`fileFilter` can be invoked directly
 *   as unit tests — this is required because these callbacks otherwise only run
 *   during a real multipart upload, and mocking multer wholesale would leave them
 *   permanently unexecuted.
 * - `getEntityOwner`'s 15-branch switch is exercised table-driven (found/not-found
 *   per entity type) via GET requests, since the function is module-private.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const MEMBER_USER = { userId: 'u1', email: 'a@b.com', role: 'MEMBER' as const };
const ADMIN_USER = { userId: 'admin-1', email: 'admin@b.com', role: 'ADMIN' as const };

// ── Hoisted capture cells (must exist before vi.mock factories run) ──
const hoisted = vi.hoisted(() => ({
  diskStorageOpts: { value: null as any },
  multerOpts: { value: null as any },
  uploadSingleImpl: { value: null as ((req: any, res: any, next: any) => void) | null },
}));

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = (req as any).__testUser ?? MEMBER_USER;
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('fs', () => {
  const fsObj = {
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
  return { default: fsObj, ...fsObj };
});

vi.mock('multer', () => {
  const multerFn: any = vi.fn((opts: any) => {
    hoisted.multerOpts.value = opts;
    return {
      single: (_field: string) => (req: any, res: any, next: any) => {
        if (hoisted.uploadSingleImpl.value) hoisted.uploadSingleImpl.value(req, res, next);
        else next();
      },
    };
  });
  multerFn.diskStorage = vi.fn((opts: any) => {
    hoisted.diskStorageOpts.value = opts;
    return opts;
  });
  return { default: multerFn };
});

vi.mock('../../services/auditService', () => ({
  recordAuditLog: vi.fn(),
}));

vi.mock('../../config/prisma', () => {
  const models = [
    'transaction', 'insurancePolicy', 'fixedDeposit', 'goldHolding', 'realEstate',
    'bankAccount', 'loan', 'investment', 'budget', 'taxProfile', 'taxEntry',
    'capitalGainEntry', 'otherSourceIncome', 'housePropertyDetail', 'foreignAssetDisclosure',
  ];
  const prismaObj: any = { document: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), delete: vi.fn() } };
  for (const m of models) {
    prismaObj[m] = m === 'transaction' ? { findFirst: vi.fn() } : { findUnique: vi.fn() };
  }
  return { default: prismaObj, prisma: prismaObj };
});

import documentsRouter from '../../routes/documents';
import { prisma } from '../../config/prisma';
import { recordAuditLog } from '../../services/auditService';
import { makeApp } from '../helpers/makeApp';
import { errorHandler } from '../../middleware/errorHandler';
import { AppError } from '../../utils/AppError';
import fsMockImport from 'fs';
const fsMock = fsMockImport as any;

const app = makeApp(documentsRouter, '/api/documents');

function makeAdminApp() {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res: any, next: any) => { req.__testUser = ADMIN_USER; next(); });
  a.use('/api/documents', documentsRouter);
  a.use(errorHandler);
  return a;
}

// res.download ultimately calls Express's `send`, which does real fs.stat/
// createReadStream — our fs mock only implements existsSync/mkdirSync/unlinkSync.
// Stub res.download itself so the happy-path test never reaches `send`.
const downloadCalls: Array<{ filePath: string; fileName: string }> = [];
function makeDownloadStubApp() {
  const a = express();
  a.use(express.json());
  a.use((req: any, res: any, next: any) => {
    req.__testUser = MEMBER_USER;
    res.download = (filePath: string, fileName: string) => {
      downloadCalls.push({ filePath, fileName });
      res.status(200).end();
    };
    next();
  });
  a.use('/api/documents', documentsRouter);
  a.use(errorHandler);
  return a;
}

const auditMock = recordAuditLog as ReturnType<typeof vi.fn>;

const CUID = 'clm1234567890abcdefghij';
const MOCK_DOC = {
  id: 'doc-1',
  userId: 'u1',
  relatedEntityType: 'Transaction',
  relatedEntityId: CUID,
  fileName: 'statement.pdf',
  filePath: 'documents/abc-123.pdf',
  fileSize: 1024,
  mimeType: 'application/pdf',
  createdAt: new Date('2025-06-01'),
};

// ── Table for the 15-branch getEntityOwner switch ──
const ENTITY_TABLE: { type: string; model: string; notFoundMessage: string }[] = [
  { type: 'Transaction', model: 'transaction', notFoundMessage: 'Transaction' },
  { type: 'InsurancePolicy', model: 'insurancePolicy', notFoundMessage: 'Insurance policy' },
  { type: 'FixedDeposit', model: 'fixedDeposit', notFoundMessage: 'Fixed deposit' },
  { type: 'GoldHolding', model: 'goldHolding', notFoundMessage: 'Gold holding' },
  { type: 'RealEstate', model: 'realEstate', notFoundMessage: 'Property' },
  { type: 'BankAccount', model: 'bankAccount', notFoundMessage: 'Bank account' },
  { type: 'Loan', model: 'loan', notFoundMessage: 'Loan' },
  { type: 'Investment', model: 'investment', notFoundMessage: 'Investment' },
  { type: 'Budget', model: 'budget', notFoundMessage: 'Budget' },
  { type: 'TaxProfile', model: 'taxProfile', notFoundMessage: 'Tax profile' },
  { type: 'TaxEntry', model: 'taxEntry', notFoundMessage: 'Tax entry' },
  { type: 'CapitalGainEntry', model: 'capitalGainEntry', notFoundMessage: 'Capital gain entry' },
  { type: 'OtherSourceIncome', model: 'otherSourceIncome', notFoundMessage: 'Other income entry' },
  { type: 'HousePropertyDetail', model: 'housePropertyDetail', notFoundMessage: 'House property entry' },
  { type: 'ForeignAssetDisclosure', model: 'foreignAssetDisclosure', notFoundMessage: 'Foreign asset entry' },
];

function ownerMock(model: string) {
  return model === 'transaction' ? (prisma as any).transaction.findFirst : (prisma as any)[model].findUnique;
}

beforeEach(() => {
  vi.clearAllMocks();
  downloadCalls.length = 0;
  fsMock.existsSync.mockReturnValue(true);
  hoisted.uploadSingleImpl.value = null;
  for (const { model } of ENTITY_TABLE) {
    ownerMock(model).mockResolvedValue({ userId: 'u1' });
  }
  (prisma as any).document.findMany.mockResolvedValue([MOCK_DOC]);
  (prisma as any).document.create.mockResolvedValue(MOCK_DOC);
  (prisma as any).document.findUnique.mockResolvedValue(MOCK_DOC);
  (prisma as any).document.delete.mockResolvedValue(MOCK_DOC);
});

// ── Module load: the side effect this whole file exists to neutralize ──
describe('module import', () => {
  it('imports without touching mkdirSync (existsSync mocked true)', () => {
    // If this describe block's import at the top of the file didn't throw, existsSync
    // already did its job — assert mkdirSync specifically was never reached.
    expect(fsMock.mkdirSync).not.toHaveBeenCalled();
  });
});

// ── GET / — list documents, table-driven over all 15 entity types ──
describe('GET /api/documents', () => {
  it.each(ENTITY_TABLE)('$type — owner found, requester owns it — 200', async ({ type, model }) => {
    const res = await request(app).get('/api/documents').query({ entityType: type, entityId: CUID });
    expect(res.status).toBe(200);
    // Date fields serialize to ISO strings over HTTP — compare against the JSON-safe shape.
    expect(res.body.data).toEqual([JSON.parse(JSON.stringify(MOCK_DOC))]);
    expect(ownerMock(model)).toHaveBeenCalled();
  });

  it.each(ENTITY_TABLE)('$type — entity not found — 404 "$notFoundMessage"', async ({ type, model, notFoundMessage }) => {
    ownerMock(model).mockResolvedValue(null);
    const res = await request(app).get('/api/documents').query({ entityType: type, entityId: CUID });
    expect(res.status).toBe(404);
    expect(res.body.message).toBe(`${notFoundMessage} not found`);
  });

  it('non-owner MEMBER gets 403', async () => {
    ownerMock('transaction').mockResolvedValue({ userId: 'someone-else' });
    const res = await request(app).get('/api/documents').query({ entityType: 'Transaction', entityId: CUID });
    expect(res.status).toBe(403);
  });

  it('ADMIN can access another member\'s document', async () => {
    ownerMock('transaction').mockResolvedValue({ userId: 'someone-else' });
    const res = await request(makeAdminApp()).get('/api/documents').query({ entityType: 'Transaction', entityId: CUID });
    expect(res.status).toBe(200);
  });

  it('rejects an invalid entityType — 422', async () => {
    const res = await request(app).get('/api/documents').query({ entityType: 'Bogus', entityId: CUID });
    expect(res.status).toBe(422);
  });

  it('rejects a non-CUID entityId — 422', async () => {
    const res = await request(app).get('/api/documents').query({ entityType: 'Transaction', entityId: 'not-a-cuid' });
    expect(res.status).toBe(422);
  });

  it('queries scoped to the given entity, most recent first', async () => {
    await request(app).get('/api/documents').query({ entityType: 'Transaction', entityId: CUID });
    expect((prisma as any).document.findMany).toHaveBeenCalledWith({
      where: { relatedEntityType: 'Transaction', relatedEntityId: CUID },
      orderBy: { createdAt: 'desc' },
    });
  });
});

// ── POST / — upload ──
describe('POST /api/documents', () => {
  function withFile(file: Partial<Express.Multer.File> = {}) {
    hoisted.uploadSingleImpl.value = (req: any, _res: any, next: any) => {
      req.file = {
        path: '/app/uploads/documents/tmp-abc.pdf',
        filename: 'tmp-abc.pdf',
        originalname: 'statement.pdf',
        mimetype: 'application/pdf',
        size: 2048,
        ...file,
      };
      next();
    };
  }

  it('201 on a valid upload; creates the document and records a CREATE audit entry', async () => {
    withFile();
    const res = await request(app).post('/api/documents').send({ entityType: 'Transaction', entityId: CUID });
    expect(res.status).toBe(201);
    expect((prisma as any).document.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        relatedEntityType: 'Transaction',
        relatedEntityId: CUID,
        fileName: 'statement.pdf',
        filePath: 'documents/tmp-abc.pdf',
        fileSize: 2048,
        mimeType: 'application/pdf',
      }),
    });
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE', entityType: 'Document', entityId: MOCK_DOC.id, newValue: MOCK_DOC }),
    );
  });

  it('400 when no file was uploaded', async () => {
    // uploadSingleImpl left null -> no req.file assigned
    const res = await request(app).post('/api/documents').send({ entityType: 'Transaction', entityId: CUID });
    expect(res.status).toBe(400);
    expect((prisma as any).document.create).not.toHaveBeenCalled();
  });

  it('422 with invalid body, and cleans up the uploaded file (unlinkSync called)', async () => {
    withFile();
    const res = await request(app).post('/api/documents').send({ entityType: 'Bogus', entityId: CUID });
    expect(res.status).toBe(422);
    expect(fsMock.unlinkSync).toHaveBeenCalledWith('/app/uploads/documents/tmp-abc.pdf');
  });

  it('422 with invalid body AND no file — unlinkQuietly(undefined) is a safe no-op', async () => {
    // uploadSingleImpl left null -> req.file is undefined -> unlinkQuietly(req.file?.path)
    // receives undefined and must return early rather than calling unlinkSync(undefined).
    const res = await request(app).post('/api/documents').send({ entityType: 'Bogus', entityId: CUID });
    expect(res.status).toBe(422);
    expect(fsMock.unlinkSync).not.toHaveBeenCalled();
  });

  it('403 when the entity is not owned by the requester, and cleans up the file', async () => {
    withFile();
    ownerMock('transaction').mockResolvedValue({ userId: 'someone-else' });
    const res = await request(app).post('/api/documents').send({ entityType: 'Transaction', entityId: CUID });
    expect(res.status).toBe(403);
    expect(fsMock.unlinkSync).toHaveBeenCalled();
    expect((prisma as any).document.create).not.toHaveBeenCalled();
  });

  it('404 when the entity does not exist, and cleans up the file', async () => {
    withFile();
    ownerMock('transaction').mockResolvedValue(null);
    const res = await request(app).post('/api/documents').send({ entityType: 'Transaction', entityId: CUID });
    expect(res.status).toBe(404);
    expect(fsMock.unlinkSync).toHaveBeenCalled();
  });

  it('unlinkSync throwing during cleanup does not crash the request', async () => {
    withFile();
    fsMock.unlinkSync.mockImplementation(() => { throw new Error('EACCES'); });
    ownerMock('transaction').mockResolvedValue(null);
    const res = await request(app).post('/api/documents').send({ entityType: 'Transaction', entityId: CUID });
    expect(res.status).toBe(404); // the real error, not a 500 from the failed cleanup
  });
});

// ── GET /:id/download ──
describe('GET /api/documents/:id/download', () => {
  it('200 and calls res.download with the resolved path and original filename', async () => {
    const res = await request(makeDownloadStubApp()).get(`/api/documents/${MOCK_DOC.id}/download`);
    expect(res.status).toBe(200);
    expect(downloadCalls).toHaveLength(1);
    expect(downloadCalls[0].filePath).toMatch(/documents\/abc-123\.pdf$/);
    expect(downloadCalls[0].fileName).toBe(MOCK_DOC.fileName);
  });

  it('404 "Document file" when the DB row exists but the file is missing on disk', async () => {
    fsMock.existsSync.mockReturnValueOnce(false); // per-call override — the module-load call already happened
    const res = await request(app).get(`/api/documents/${MOCK_DOC.id}/download`);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Document file not found');
  });

  it('404 when the document row itself does not exist', async () => {
    (prisma as any).document.findUnique.mockResolvedValue(null);
    const res = await request(app).get(`/api/documents/${MOCK_DOC.id}/download`);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Document not found');
  });

  it('403 when the document is not owned by the requester', async () => {
    (prisma as any).document.findUnique.mockResolvedValue({ ...MOCK_DOC, userId: 'someone-else' });
    const res = await request(app).get(`/api/documents/${MOCK_DOC.id}/download`);
    expect(res.status).toBe(403);
  });

  it('400 "Invalid file path" when filePath attempts traversal outside the uploads root', async () => {
    (prisma as any).document.findUnique.mockResolvedValue({ ...MOCK_DOC, filePath: '../../etc/passwd' });
    const res = await request(app).get(`/api/documents/${MOCK_DOC.id}/download`);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid file path');
  });

  it('rejects a filePath that shares the uploadsRoot as a string prefix but escapes it', async () => {
    // e.g. resolves to /app/uploadsEVIL/x — must not pass a bare startsWith check
    (prisma as any).document.findUnique.mockResolvedValue({ ...MOCK_DOC, filePath: '../uploadsEVIL/x' });
    const res = await request(app).get(`/api/documents/${MOCK_DOC.id}/download`);
    expect(res.status).toBe(400);
  });
});

// ── DELETE /:id ──
describe('DELETE /api/documents/:id', () => {
  it('204, deletes the row, unlinks the file, records a DELETE audit entry', async () => {
    const res = await request(app).delete(`/api/documents/${MOCK_DOC.id}`);
    expect(res.status).toBe(204);
    expect((prisma as any).document.delete).toHaveBeenCalledWith({ where: { id: MOCK_DOC.id } });
    expect(fsMock.unlinkSync).toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DELETE', entityType: 'Document', entityId: MOCK_DOC.id, oldValue: MOCK_DOC }),
    );
  });

  it('403 when the document is not owned by the requester', async () => {
    (prisma as any).document.findUnique.mockResolvedValue({ ...MOCK_DOC, userId: 'someone-else' });
    const res = await request(app).delete(`/api/documents/${MOCK_DOC.id}`);
    expect(res.status).toBe(403);
    expect((prisma as any).document.delete).not.toHaveBeenCalled();
  });

  it('404 when the document does not exist', async () => {
    (prisma as any).document.findUnique.mockResolvedValue(null);
    const res = await request(app).delete(`/api/documents/${MOCK_DOC.id}`);
    expect(res.status).toBe(404);
  });
});

// ── multer option callbacks, invoked directly (never run via a mocked upload.single) ──
describe('multer configuration (destination/filename/fileFilter)', () => {
  it('destination always resolves to the documents subdirectory', () => {
    expect(hoisted.diskStorageOpts.value).toBeTruthy();
    const cb = vi.fn();
    hoisted.diskStorageOpts.value.destination({}, {}, cb);
    expect(cb).toHaveBeenCalledWith(null, expect.stringContaining('documents'));
  });

  it('filename lowercases and strips a normal extension, capped at 12 chars, prefixed with a UUID', () => {
    const cb = vi.fn();
    hoisted.diskStorageOpts.value.filename({}, { originalname: 'Statement.PDF' }, cb);
    const [err, name] = cb.mock.calls[0];
    expect(err).toBeNull();
    expect(name).toMatch(/^[0-9a-f-]{36}\.pdf$/);
  });

  it('filename strips non-alphanumeric characters from the extension', () => {
    const cb = vi.fn();
    hoisted.diskStorageOpts.value.filename({}, { originalname: 'file.p;df$' }, cb);
    const [, name] = cb.mock.calls[0];
    expect(name).toMatch(/^[0-9a-f-]{36}\.pdf$/);
  });

  it('filename handles no extension at all', () => {
    const cb = vi.fn();
    hoisted.diskStorageOpts.value.filename({}, { originalname: 'noextension' }, cb);
    const [, name] = cb.mock.calls[0];
    expect(name).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('fileFilter accepts every allow-listed mimetype', () => {
    const allowed = [
      'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/csv', 'text/plain',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
    ];
    for (const mimetype of allowed) {
      const cb = vi.fn();
      hoisted.multerOpts.value.fileFilter({}, { mimetype }, cb);
      expect(cb).toHaveBeenCalledWith(null, true);
    }
  });

  it('fileFilter rejects an unsupported mimetype with an AppError', () => {
    const cb = vi.fn();
    hoisted.multerOpts.value.fileFilter({}, { mimetype: 'application/zip' }, cb);
    expect(cb).toHaveBeenCalledWith(expect.any(AppError));
    const [err] = cb.mock.calls[0];
    expect(err.statusCode).toBe(400);
  });

  it('the file size limit is 10MB', () => {
    expect(hoisted.multerOpts.value.limits).toEqual({ fileSize: 10 * 1024 * 1024 });
  });
});
