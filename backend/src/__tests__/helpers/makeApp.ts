/**
 * Test app factory — wraps a single Express router in a minimal Express app
 * suitable for supertest. NEVER import from index.ts (it calls app.listen()
 * and mkdirSync('/app/uploads') as top-level side effects).
 *
 * Prefer this over a hand-rolled express() in new route tests: it applies production's
 * query contract (simple parser + rejectAmbiguousQuery), so req.query has the shape the
 * route will really see. Older route files that build their own app predate it.
 */
import express, { Router } from 'express';
import cookieParser from 'cookie-parser';
import { errorHandler } from '../../middleware/errorHandler';
import { rejectAmbiguousQuery, useSimpleQueryParser } from '../../middleware/queryContract';

export function makeApp(router: Router, mountPath = '/') {
  const app = express();
  // Same query contract as createApp, so route tests see production's req.query shape.
  useSimpleQueryParser(app);
  app.use(express.json());
  app.use(cookieParser());
  app.use(rejectAmbiguousQuery);
  app.use(mountPath, router);
  app.use(errorHandler);
  return app;
}
