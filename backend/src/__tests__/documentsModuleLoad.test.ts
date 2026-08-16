/**
 * Covers routes/documents.ts:21 — `if (!fs.existsSync(documentsDir)) fs.mkdirSync(...)`.
 *
 * This line only runs ONCE per test file, at module import time (Node/Vitest cache the
 * module after first load). documents.routes.test.ts mocks `existsSync` to `true` for
 * its whole run, so the "directory does not exist" branch can never fire there — it's
 * a separate, single-purpose file specifically to cover that one branch.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('fs', () => {
  const fsObj = {
    existsSync: vi.fn().mockReturnValue(false), // simulate a fresh container with no uploads dir yet
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
  return { default: fsObj, ...fsObj };
});

vi.mock('multer', () => {
  const multerFn: any = vi.fn(() => ({ single: () => (_req: any, _res: any, next: any) => next() }));
  multerFn.diskStorage = vi.fn((opts: any) => opts);
  return { default: multerFn };
});

vi.mock('../config/prisma', () => ({ default: {}, prisma: {} }));
vi.mock('../services/auditService', () => ({ recordAuditLog: vi.fn() }));

describe('documents.ts module load', () => {
  it('creates the uploads/documents directory when it does not already exist', async () => {
    const fsMock = (await import('fs')) as any;
    await import('../routes/documents');
    expect(fsMock.existsSync).toHaveBeenCalled();
    expect(fsMock.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('documents'),
      { recursive: true },
    );
  });
});
