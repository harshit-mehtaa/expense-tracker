import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/AppError';
import { isProd } from '../config/env';

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
