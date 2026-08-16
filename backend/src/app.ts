import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { env, isDev } from './config/env';
import { errorHandler } from './middleware/errorHandler';

import healthRouter from './routes/health';
import authRouter from './routes/auth';
import accountsRouter from './routes/accounts';
import importRouter from './routes/import';
import transactionsRouter from './routes/transactions';
import dashboardRouter from './routes/dashboard';
import investmentsRouter from './routes/investments';
import insuranceRouter from './routes/insurance';
import loansRouter from './routes/loans';
import taxRouter from './routes/tax';
import adminRouter from './routes/admin';
import categoriesRouter from './routes/categories';
import budgetsRouter from './routes/budgets';
import recurringRouter from './routes/recurring';
import snapshotsRouter from './routes/snapshots';
import reportsRouter from './routes/reports';
import categoryRulesRouter from './routes/categoryRules';
import documentsRouter from './routes/documents';

/**
 * Build the Express app.
 *
 * A factory, not a module-scope singleton, so each caller (and each test) gets its own
 * rate-limiter state. Middleware order below is load-bearing — see the comments.
 */
export function createApp() {
  const app = express();

  // Must precede the rate limiter: express-rate-limit reads X-Forwarded-For, which is
  // only trusted once this is set. Without it every client behind nginx shares a bucket.
  app.set('trust proxy', 1);

  // ── Security ────────────────────────────────────────────────────────────────
  app.use(helmet());
  app.use(cors({
    origin: env.FRONTEND_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  // Generous global cap; auth routes apply their own tighter limits.
  app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
  }));

  // ── Body parsing ────────────────────────────────────────────────────────────
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // ── Logging ─────────────────────────────────────────────────────────────────
  app.use(morgan(isDev ? 'dev' : 'combined'));

  // ── Routes ──────────────────────────────────────────────────────────────────
  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/accounts', accountsRouter);

  // MUST precede transactionsRouter. Express matches app.use prefixes in registration
  // order, so mounting the longer, more specific prefix first means a future
  // `router.post('/:id')` in transactions.ts can never swallow /import.
  app.use('/api/transactions/import', importRouter);
  app.use('/api/transactions', transactionsRouter);

  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/investments', investmentsRouter);
  app.use('/api/insurance', insuranceRouter);
  app.use('/api/loans', loansRouter);
  app.use('/api/tax', taxRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/budgets', budgetsRouter);
  app.use('/api/recurring', recurringRouter);
  app.use('/api/snapshots/net-worth', snapshotsRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/category-rules', categoryRulesRouter);
  app.use('/api/documents', documentsRouter);

  // Must be last — Express only treats a 4-arg middleware as an error handler, and only
  // reaches it via next(err) from handlers registered above it.
  app.use(errorHandler);

  return app;
}
