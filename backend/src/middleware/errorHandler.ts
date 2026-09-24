import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/AppError';
import { isProd } from '../config/env';
import { isMulterError } from './upload';

type ClientHttpError = Error & { status: number; type?: unknown; headers?: Record<string, string> };

/**
 * An http-errors 4xx marked `expose: true` — its message is meant for the client. Raised
 * by body-parser (express.json / urlencoded) and by `send` (res.download's 404/416).
 */
function isClientHttpError(err: unknown): err is ClientHttpError {
  if (!(err instanceof Error)) return false;
  const { status, expose } = err as { status?: unknown; expose?: unknown };
  return expose === true && typeof status === 'number' && status >= 400 && status < 500;
}

/** body-parser's error `type`s (body-parser/lib/read.js and the parsers). */
const BODY_PARSER_TYPES = new Set([
  'entity.parse.failed', 'entity.too.large', 'entity.verify.failed', 'request.aborted',
  'request.size.invalid', 'charset.unsupported', 'encoding.unsupported',
  'parameters.too.many', 'stream.encoding.set', 'stream.not.readable',
]);

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

  if (isClientHttpError(err)) {
    // Malformed / oversized request body — fixed messages, not the parser's own text.
    if (typeof err.type === 'string' && BODY_PARSER_TYPES.has(err.type)) {
      const tooLarge = err.status === 413;
      res.status(err.status).json({
        success: false,
        message: tooLarge ? 'Request body too large' : 'Malformed request body',
        code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'INVALID_BODY',
      });
      return;
    }
    // Any other client-safe http-error (e.g. res.download's 416 with Content-Range).
    if (err.headers) res.set(err.headers);
    res.status(err.status).json({ success: false, message: err.message, code: 'REQUEST_ERROR' });
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
