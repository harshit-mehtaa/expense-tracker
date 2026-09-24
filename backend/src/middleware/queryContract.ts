import type { Application, NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/AppError';

/**
 * The single-value query contract: every value in req.query is ONE plain string.
 *
 * Routes read query params as `req.query.x as string` (dozens of sites). Express's
 * default "extended" parser (qs) breaks that cast: ?fy=a&fy=b yields an array and
 * ?search[a]=1 an object, which then reach .split()/Prisma and surface as 500s.
 * Enforcing the contract once, app-wide, covers every current and future route.
 */

/**
 * Switch to Node's querystring parser ("simple"): no nested objects, null-prototype
 * result, and none of qs's parsing surface. Repeated keys still yield arrays, and
 * bracketed keys stay literal ("a[b]") — rejectAmbiguousQuery refuses both.
 *
 * Must run before the first app.use()/route: Express captures the query parser when
 * it lazily creates its router, after which app.set('query parser') silently does
 * nothing. Throwing turns that silent no-op into a startup failure.
 * `_router` is Express 4's private lazily-created router; Express 5 resolves the parser
 * per request (and defaults to "simple"), so there the guard is simply never true.
 */
export function useSimpleQueryParser(app: Application): void {
  if ((app as unknown as { _router?: unknown })._router) {
    throw new Error(
      'useSimpleQueryParser must run before the first app.use() — Express captures the query parser when its router is created',
    );
  }
  app.set('query parser', 'simple');
}

/**
 * 400 INVALID_QUERY for anything that is not a single plain string. Mounted as
 * middleware, not thrown from the parser, because the query parser runs before
 * helmet/CORS/logging and its errors would skip them.
 */
export function rejectAmbiguousQuery(req: Request, _res: Response, next: NextFunction): void {
  for (const [rawKey, value] of Object.entries(req.query)) {
    // The key is client-controlled and echoed into the message (and a toast): bound it.
    const key = rawKey.length > 40 ? `${rawKey.slice(0, 40)}…` : rawKey;
    if (rawKey.includes('[')) {
      return next(AppError.badRequest(`Query parameter "${key}" uses unsupported bracket syntax`, 'INVALID_QUERY'));
    }
    if (typeof value !== 'string') {
      return next(AppError.badRequest(`Query parameter "${key}" must appear only once`, 'INVALID_QUERY'));
    }
    // Postgres rejects NUL in text, so a %00 reaching a Prisma filter is a 500.
    if (rawKey.includes('\u0000') || value.includes('\u0000')) {
      return next(AppError.badRequest(`Query parameter "${key}" contains an invalid character`, 'INVALID_QUERY'));
    }
  }
  next();
}
