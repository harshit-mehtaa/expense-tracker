import type { RequestHandler } from 'express';
import type { Multer } from 'multer';
import { AppError } from '../utils/AppError';

// Type-only multer imports: route tests vi.mock('multer') with a default-only factory,
// and reading a named runtime export from that mock throws.

/**
 * multer's own rejections (size, counts, unexpected field). Matched by shape rather
 * than `instanceof multer.MulterError` for the same mocking reason.
 */
export function isMulterError(err: unknown): err is Error & { code: string } {
  return err instanceof Error
    && err.name === 'MulterError'
    && typeof (err as { code?: unknown }).code === 'string';
}

/** Connection-level failures caused by the client going away mid-upload. */
const CLIENT_STREAM_CODES = new Set(['ECONNRESET', 'ECONNABORTED', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE']);

/**
 * Decide what an error raised while multer reads the body means, by where it came from
 * (multer/lib/make-middleware.js):
 * - AppError (our fileFilter) and MulterError → unchanged; errorHandler maps them.
 * - Programmer errors (TypeError, ReferenceError, …) → unchanged: a bug is a 500.
 * - Client stream codes → the client aborted/reset: 400.
 * - Anything else carrying `syscall` → OUR I/O failed (DiskStorage: ENOSPC, EACCES…):
 *   unchanged, so it stays a logged 500 instead of blaming the client.
 * - The rest → the body itself was bad: busboy's "Boundary not found", "Unexpected end
 *   of form", "Malformed part header", or multer's "Request aborted/closed": 400.
 */
export function classifyUploadError(err: unknown): unknown {
  if (err instanceof AppError || isMulterError(err)) return err;
  // A bug in our own storage/fileFilter callbacks — log it as the 500 it is.
  if (err instanceof TypeError || err instanceof ReferenceError || err instanceof RangeError || err instanceof SyntaxError) {
    return err;
  }
  const { code, syscall } = (err ?? {}) as { code?: unknown; syscall?: unknown };
  if (typeof code === 'string' && CLIENT_STREAM_CODES.has(code)) return rejected();
  if (typeof syscall === 'string') return err;
  return rejected();
}

function rejected(): AppError {
  return new AppError('Upload was malformed or incomplete', 400, 'UPLOAD_REJECTED');
}

/** `upload.single(field)` with its errors classified before they reach errorHandler. */
export function singleFileUpload(upload: Multer, field: string): RequestHandler {
  const handler = upload.single(field);
  return (req, res, next) => handler(req, res, (err?: unknown) => (err ? next(classifyUploadError(err)) : next()));
}
