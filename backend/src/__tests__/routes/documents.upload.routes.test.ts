/**
 * POST /api/documents with REAL multer (documents.routes.test.ts mocks multer to test
 * the storage callbacks directly, so none of its cases exercise multer's own limits).
 * Covers the 10MB file limit, the multer 2 count/nesting limits, malformed multipart
 * bodies, and that every rejection leaves nothing on disk and nothing in the error log.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';

// Own upload dir: this suite lists and wipes it, so it must not share with others.
const { UPLOAD_DIR } = vi.hoisted(() => ({
  UPLOAD_DIR: require('path').join(require('os').tmpdir(), `expense-tracker-doc-upload-${process.pid}`) as string,
}));

vi.mock('../../config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/env')>();
  return { ...actual, env: { ...actual.env, UPLOADS_DIR: UPLOAD_DIR } };
});

vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'admin-id', email: 'admin@example.com', role: 'ADMIN' };
    next();
  },
}));

vi.mock('../../config/prisma', () => {
  const prisma = {
    transaction: { findFirst: vi.fn() },
    document: { create: vi.fn() },
  };
  return { default: prisma, prisma };
});

vi.mock('../../services/auditService', () => ({ recordAuditLog: vi.fn() }));

import documentsRouter from '../../routes/documents';
import { prisma } from '../../config/prisma';
import { makeApp } from '../helpers/makeApp';

const app = makeApp(documentsRouter, '/api/documents');
const DOCS_DIR = path.join(UPLOAD_DIR, 'documents');
const ENTITY_ID = 'clm1234567890abcdefghij';
const LIMIT = 10 * 1024 * 1024;

const storedFiles = () => (fs.existsSync(DOCS_DIR) ? fs.readdirSync(DOCS_DIR) : []);
const post = () => request(app).post('/api/documents');

beforeEach(() => {
  vi.clearAllMocks();
  for (const f of storedFiles()) fs.unlinkSync(path.join(DOCS_DIR, f));
  (prisma as any).transaction.findFirst.mockResolvedValue({ userId: 'admin-id' });
  (prisma as any).document.create.mockImplementation(async ({ data }: any) => ({ id: 'doc-1', ...data }));
});

afterAll(() => { fs.rmSync(UPLOAD_DIR, { recursive: true, force: true }); });

describe('POST /api/documents — real multer limits', () => {
  it('accepts the real attach form (file + entityType + entityId)', async () => {
    const res = await post()
      .field('entityType', 'Transaction')
      .field('entityId', ENTITY_ID)
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'receipt.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    expect(storedFiles()).toHaveLength(1);
  });

  it('accepts a document of exactly 10MB (the limit is inclusive)', async () => {
    const res = await post()
      .field('entityType', 'Transaction')
      .field('entityId', ENTITY_ID)
      .attach('file', Buffer.alloc(LIMIT), { filename: 'edge.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
  });

  it('rejects one byte over 10MB with 413 FILE_TOO_LARGE and stores nothing', async () => {
    const res = await post()
      .field('entityType', 'Transaction')
      .field('entityId', ENTITY_ID)
      .attach('file', Buffer.alloc(LIMIT + 1), { filename: 'big.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ success: false, message: 'File too large', code: 'FILE_TOO_LARGE' });
    expect(storedFiles()).toEqual([]);
    expect((prisma as any).document.create).not.toHaveBeenCalled();
  });

  it('rejects a second file with 400 UPLOAD_REJECTED and removes the first', async () => {
    const res = await post()
      .field('entityType', 'Transaction')
      .field('entityId', ENTITY_ID)
      .attach('file', Buffer.from('a'), { filename: 'a.pdf', contentType: 'application/pdf' })
      .attach('file', Buffer.from('b'), { filename: 'b.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('UPLOAD_REJECTED');
    expect(storedFiles()).toEqual([]);
  });

  it('rejects too many text fields with 400', async () => {
    let req = post();
    for (let i = 0; i < 5; i++) req = req.field(`f${i}`, 'x');
    const res = await req.attach('file', Buffer.from('a'), { filename: 'a.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('UPLOAD_REJECTED');
  });

  it('rejects a bracketed field name with 400 (fieldNestingDepth: 0)', async () => {
    const res = await post()
      .field('entityType[x]', 'Transaction')
      .attach('file', Buffer.from('a'), { filename: 'a.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('UPLOAD_REJECTED');
  });

  it('rejects an oversized text field value with 400', async () => {
    const res = await post()
      .field('entityType', 'x'.repeat(2000))
      .attach('file', Buffer.from('a'), { filename: 'a.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('UPLOAD_REJECTED');
  });
});

describe('POST /api/documents — malformed multipart is a client error, not a 500', () => {
  it('no boundary → 400 UPLOAD_REJECTED, nothing logged as a server error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await post().set('Content-Type', 'multipart/form-data').send('xx');
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, message: 'Upload was malformed or incomplete', code: 'UPLOAD_REJECTED' });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('truncated body (no closing boundary) → 400 and no file left behind', async () => {
    const body = [
      '--XBOUNDARY',
      'Content-Disposition: form-data; name="file"; filename="cut.pdf"',
      'Content-Type: application/pdf',
      '',
      '%PDF-1.4 partial',
    ].join('\r\n');
    const res = await post().set('Content-Type', 'multipart/form-data; boundary=XBOUNDARY').send(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('UPLOAD_REJECTED');
    expect(storedFiles()).toEqual([]);
  });
});
