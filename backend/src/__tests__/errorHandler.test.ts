/**
 * Unit tests for the errorHandler Express middleware.
 *
 * Creates a minimal Express app inline with a single error-throwing route,
 * then asserts the HTTP response shape for each error type.
 *
 * No mocking needed — errorHandler has no external dependencies beyond AppError and Zod.
 * NODE_ENV=test in the Vitest env, so isProd=false → stack traces are included.
 */
import { describe, it, expect, vi } from 'vitest';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import multer from 'multer';
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

// ─────────────────────────────────────────────────────────────────────────────
// MulterError → 413 / 400 (client upload errors, not server faults)
// ─────────────────────────────────────────────────────────────────────────────

describe('errorHandler — MulterError', () => {
  it('maps LIMIT_FILE_SIZE to 413 FILE_TOO_LARGE with multer\'s own message', async () => {
    const app = makeErrorApp(() => { throw new multer.MulterError('LIMIT_FILE_SIZE', 'file'); });

    const res = await request(app).get('/test');
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ success: false, message: 'File too large', code: 'FILE_TOO_LARGE' });
  });

  it('maps every other multer code to 400 UPLOAD_REJECTED', async () => {
    const app = makeErrorApp(() => { throw new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'other'); });

    const res = await request(app).get('/test');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: 'Unexpected file field', code: 'UPLOAD_REJECTED' });
  });

  it('does not log multer rejections as server errors', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const app = makeErrorApp(() => { throw new multer.MulterError('LIMIT_FILE_SIZE', 'file'); });
      await request(app).get('/test');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('matches by name AND a string code — an Error merely named MulterError without one is still a 500', async () => {
    const app = makeErrorApp(() => {
      const err = new Error('impostor');
      err.name = 'MulterError';
      throw err;
    });

    const res = await request(app).get('/test');
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('INTERNAL_ERROR');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// body-parser errors (malformed / oversized request bodies) → 4xx, not 500
// ─────────────────────────────────────────────────────────────────────────────

describe('errorHandler — request body errors', () => {
  function makeBodyApp(limit?: string) {
    const app = express();
    app.use(express.json(limit ? { limit } : undefined));
    app.post('/test', (_req: Request, res: Response) => { res.json({ ok: true }); });
    app.use(errorHandler);
    return app;
  }

  it('maps malformed JSON to 400 INVALID_BODY without leaking parser internals', async () => {
    const res = await request(makeBodyApp()).post('/test').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: 'Malformed request body', code: 'INVALID_BODY' });
  });

  it('maps an oversized JSON body to 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await request(makeBodyApp('10b')).post('/test').send({ a: 'more than ten bytes' });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ success: false, message: 'Request body too large', code: 'PAYLOAD_TOO_LARGE' });
  });

  it('does not log client body errors as server errors', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await request(makeBodyApp()).post('/test').set('Content-Type', 'application/json').send('{bad');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps other exposed http-errors (e.g. a 416 from res.download) as themselves, headers included', async () => {
    const app = makeErrorApp(() => {
      throw Object.assign(new Error('Range Not Satisfiable'), {
        status: 416, statusCode: 416, expose: true, headers: { 'Content-Range': 'bytes */10' },
      });
    });
    const res = await request(app).get('/test');
    expect(res.status).toBe(416);
    expect(res.headers['content-range']).toBe('bytes */10');
    expect(res.body).toEqual({ success: false, message: 'Range Not Satisfiable', code: 'REQUEST_ERROR' });
  });

  it('maps an unsupported body encoding (415) to INVALID_BODY with its own status', async () => {
    const app = express();
    app.use(express.json());
    app.post('/test', (_req: Request, res: Response) => { res.json({ ok: true }); });
    app.use(errorHandler);
    const res = await request(app).post('/test').set('Content-Type', 'application/json').set('Content-Encoding', 'xyz').send('{}');
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('INVALID_BODY');
  });

  it('leaves a non-exposed or 5xx http-error on the 500 path', async () => {
    const app = makeErrorApp(() => { throw Object.assign(new Error('internal'), { status: 500, expose: false }); });
    const res = await request(app).get('/test');
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('INTERNAL_ERROR');
  });
});
