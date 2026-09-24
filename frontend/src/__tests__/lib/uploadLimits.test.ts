/**
 * The browser-side upload limits mirror the backend's multer limits, which are the
 * source of truth. shared/ cannot carry runtime values (the Docker build contexts are
 * ./backend and ./frontend), so this test reads the backend route files and fails if
 * the two copies drift — like paymentModes.test.ts does for the Prisma schema.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MAX_DOCUMENT_BYTES, MAX_STATEMENT_BYTES, fileTooLargeMessage } from '@/lib/uploadLimits';

function backendFileSize(route: string): number {
  const src = readFileSync(path.resolve(__dirname, `../../../../backend/src/routes/${route}`), 'utf-8');
  const m = /fileSize:\s*(\d+)\s*\*\s*1024\s*\*\s*1024/.exec(src);
  if (!m) throw new Error(`fileSize limit not found in backend/src/routes/${route}`);
  return Number(m[1]) * 1024 * 1024;
}

describe('upload limits', () => {
  it('match the backend multer limits', () => {
    expect(MAX_STATEMENT_BYTES).toBe(backendFileSize('import.ts'));
    expect(MAX_DOCUMENT_BYTES).toBe(backendFileSize('documents.ts'));
  });

  it('allow a file exactly at the limit (multer 2 is inclusive)', () => {
    expect(fileTooLargeMessage({ size: MAX_DOCUMENT_BYTES } as File, MAX_DOCUMENT_BYTES)).toBeNull();
  });

  it('describe a file over the limit in MB', () => {
    expect(fileTooLargeMessage({ size: MAX_DOCUMENT_BYTES + 1 } as File, MAX_DOCUMENT_BYTES))
      .toBe('File too large — the limit is 10 MB');
  });
});
