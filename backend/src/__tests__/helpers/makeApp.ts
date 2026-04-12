/**
 * Test app factory — wraps a single Express router in a minimal Express app
 * suitable for supertest. NEVER import from index.ts (it calls app.listen()
 * and mkdirSync('/app/uploads') as top-level side effects).
 */
import express, { Router } from 'express';
import cookieParser from 'cookie-parser';
import { errorHandler } from '../../middleware/errorHandler';

export function makeApp(router: Router, mountPath = '/') {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(mountPath, router);
  app.use(errorHandler);
  return app;
}
