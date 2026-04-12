/**
 * Unit tests for the errorHandler Express middleware.
 *
 * Creates a minimal Express app inline with a single error-throwing route,
 * then asserts the HTTP response shape for each error type.
 *
 * No mocking needed — errorHandler has no external dependencies beyond AppError and Zod.
 * NODE_ENV=test in the Vitest env, so isProd=false → stack traces are included.
 */
import { describe, it, expect } from 'vitest';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { AppError } from '../utils/AppError';
import { errorHandler } from '../middleware/errorHandler';

/** Build a throwable Zod error by parsing bad data through a schema. */
function makeZodError(schema: z.ZodTypeAny, badData: unknown): z.ZodError {
  const result = schema.safeParse(badData);
  if (!result.success) return result.error;
  throw new Error('Expected schema to fail but it succeeded');
}

/** Creates an Express app with a single GET /test route that throws the given error. */
function makeErrorApp(thrower: () => unknown) {
  const app = express();
  app.use(express.json());

  app.get('/test', (_req: Request, _res: Response, next: NextFunction) => {
    try {
      thrower();
    } catch (err) {
      next(err);
    }
  });

  // 4-arg signature required for Express to treat as error middleware
  app.use(errorHandler);
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// ZodError → 422 Unprocessable Entity
// ─────────────────────────────────────────────────────────────────────────────

describe('errorHandler — ZodError', () => {
  it('returns 422 with success=false and VALIDATION_ERROR code', async () => {
    const schema = z.object({ name: z.string() });
    const app = makeErrorApp(() => { throw makeZodError(schema, { name: 123 }); });

    const res = await request(app).get('/test');
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.message).toBe('Validation failed');
  });

  it('maps field paths to arrays of messages in the errors object', async () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const app = makeErrorApp(() => { throw makeZodError(schema, { name: 123, age: 'x' }); });

    const res = await request(app).get('/test');
    expect(res.body.errors).toBeDefined();
    // Each field path should have an array of messages
    expect(Array.isArray(res.body.errors.name)).toBe(true);
    expect(Array.isArray(res.body.errors.age)).toBe(true);
  });

  it('handles nested field paths with dot notation', async () => {
    const schema = z.object({ address: z.object({ city: z.string() }) });
    const app = makeErrorApp(() => { throw makeZodError(schema, { address: { city: 99 } }); });

    const res = await request(app).get('/test');
    expect(res.body.errors['address.city']).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AppError (operational 4xx) → matching status code
// ─────────────────────────────────────────────────────────────────────────────

describe('errorHandler — AppError (operational)', () => {
  it('returns 404 for AppError.notFound', async () => {
    const app = makeErrorApp(() => { throw AppError.notFound('Widget'); });

    const res = await request(app).get('/test');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Widget not found');
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('returns 403 for AppError.forbidden', async () => {
    const app = makeErrorApp(() => { throw AppError.forbidden(); });

    const res = await request(app).get('/test');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('returns 400 for AppError.badRequest', async () => {
    const app = makeErrorApp(() => { throw AppError.badRequest('Bad input', 'BAD_INPUT'); });

    const res = await request(app).get('/test');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_INPUT');
    expect(res.body.message).toBe('Bad input');
  });

  it('returns 401 for AppError.unauthorized', async () => {
    const app = makeErrorApp(() => { throw AppError.unauthorized(); });

    const res = await request(app).get('/test');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AppError non-operational (500) → generic message
// ─────────────────────────────────────────────────────────────────────────────

describe('errorHandler — AppError (non-operational 5xx)', () => {
  it('returns 500 and falls through to generic handler (isOperational=false)', async () => {
    // AppError with statusCode=500 → isOperational=false (see AppError constructor)
    const app = makeErrorApp(() => { throw AppError.internal('Database exploded'); });

    const res = await request(app).get('/test');
    // isOperational=false, so errorHandler falls to the generic "unknown" handler
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('INTERNAL_ERROR');
    // Security: internal error details must NOT leak to the client
    expect(res.body.message).toBe('An unexpected error occurred');
    expect(res.body.message).not.toBe('Database exploded');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unknown Error → 500 + INTERNAL_ERROR
// ─────────────────────────────────────────────────────────────────────────────

describe('errorHandler — unknown Error', () => {
  it('returns 500 with INTERNAL_ERROR code for a plain Error', async () => {
    const app = makeErrorApp(() => { throw new Error('Something exploded'); });

    const res = await request(app).get('/test');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('INTERNAL_ERROR');
    expect(res.body.message).toBe('An unexpected error occurred');
  });

  it('includes stack in non-prod env (NODE_ENV=test → isProd=false)', async () => {
    const app = makeErrorApp(() => { throw new Error('Trace me'); });

    const res = await request(app).get('/test');
    // In test env, isProd=false → stack is appended
    expect(res.body.stack).toBeDefined();
    expect(typeof res.body.stack).toBe('string');
  });

  it('returns 500 when a non-Error value is thrown (e.g. plain string)', async () => {
    const app = makeErrorApp(() => { throw 'raw string error'; });

    const res = await request(app).get('/test');
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('INTERNAL_ERROR');
    // No stack for non-Error throws
    expect(res.body.stack).toBeUndefined();
  });
});
