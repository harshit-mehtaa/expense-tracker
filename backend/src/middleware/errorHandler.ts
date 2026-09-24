import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/AppError';
import { isProd } from '../config/env';

/**
 * multer rejections (oversize file, unexpected field, too many parts, …) are client
 * errors. Matched by shape rather than `instanceof multer.MulterError`: route tests
 * vi.mock('multer') with a default-only factory, and under Vitest's ESM mock reading
 * a missing export throws — this handler is mounted in every one of those apps.
 */
function isMulterError(err: unknown): err is Error & { code: string } {
  return err instanceof Error
    && err.name === 'MulterError'
    && typeof (err as { code?: unknown }).code === 'string';
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  // Zod validation errors
  if (err instanceof ZodError) {
    const errors: Record<string, string[]> = {};
    err.errors.forEach((e) => {
      const key = e.path.join('.');
      errors[key] = errors[key] ?? [];
      errors[key].push(e.message);
    });

    res.status(422).json({
      success: false,
      message: 'Validation failed',
      errors,
      code: 'VALIDATION_ERROR',
    });
    return;
  }

  // Known operational errors
  if (err instanceof AppError && err.isOperational) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      code: err.code,
    });
    return;
  }

  // Upload rejected by multer — 413 for size so the client can tell it apart, 400 for
  // the rest. multer's messages are fixed strings ("File too large"), safe to expose.
  if (isMulterError(err)) {
    const tooLarge = err.code === 'LIMIT_FILE_SIZE';
    res.status(tooLarge ? 413 : 400).json({
      success: false,
      message: err.message,
      code: tooLarge ? 'FILE_TOO_LARGE' : 'UPLOAD_REJECTED',
    });
    return;
  }

  // Unknown / programmer errors — log full details, return generic message
  console.error('[ERROR]', {
    message: err instanceof Error ? err.message : 'Unknown error',
    stack: err instanceof Error ? err.stack : undefined,
    url: req.url,
    method: req.method,
  });

  res.status(500).json({
    success: false,
    message: 'An unexpected error occurred',
    code: 'INTERNAL_ERROR',
    // Only expose stack trace in development
    ...(isProd ? {} : { stack: err instanceof Error ? err.stack : undefined }),
  });
}
