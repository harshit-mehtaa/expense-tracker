import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

import { env, isDev } from './config/env';
import { requireAuth } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';
import { asyncHandler } from './utils/asyncHandler';
import { sendCreated, sendSuccess } from './utils/response';
import { getFYRange, getCurrentFY, validateFY } from './utils/financialYear';

/** Sanitize filename for storage — strip HTML tags and control chars, limit length */
function sanitizeFilename(name: string): string {
  return name.replace(/[<>"'/\\]/g, '_').replace(/[\x00-\x1f]/g, '').slice(0, 200);
}

// Routes
import healthRouter from './routes/health';
import authRouter from './routes/auth';
import accountsRouter from './routes/accounts';
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

// Import service
import { parseCSV, makeImportHash } from './services/importService';
import { prisma } from './config/prisma';
import { AppError } from './utils/AppError';
import { computeNetWorthStatement, getProfitAndLoss } from './services/dashboardService';

const app = express();

// Trust the nginx reverse proxy (required for express-rate-limit + X-Forwarded-For)
app.set('trust proxy', 1);

// ── Security middleware ────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: env.FRONTEND_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Global rate limiter (generous limit; tighter limits on auth routes)
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
}));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Logging ───────────────────────────────────────────────────────────────────
app.use(morgan(isDev ? 'dev' : 'combined'));

// ── File upload (multer) ──────────────────────────────────────────────────────
const uploadsDir = path.join('/app/uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel'].includes(file.mimetype)
      || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new AppError('Only CSV files are allowed', 400));
    }
  },
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/accounts', accountsRouter);
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

// ── Bank Statement Import ─────────────────────────────────────────────────────
app.post(
  '/api/transactions/import',
  requireAuth,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw AppError.badRequest('No file uploaded');

    const accountId = req.body.bankAccountId as string | undefined;
    const bankHint = req.body.bank as string | undefined;

    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(req.file.path);
    } finally {
      // Always clean up the temp file, even if read fails
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    }

    const result = parseCSV(buffer, bankHint);

    if (result.transactions.length === 0) {
      throw AppError.badRequest(`No transactions parsed. Errors: ${result.errors.slice(0, 3).map((e) => e.message).join(', ')}`);
    }

    // Verify account belongs to user (if provided)
    if (accountId) {
      const account = await prisma.bankAccount.findFirst({
        where: { id: accountId, userId: req.user!.userId },
      });
      if (!account) throw AppError.notFound('Bank account');
    }

    // Compute import hashes upfront
    const txsWithHash = result.transactions.map((tx) => ({
      ...tx,
      hash: accountId ? makeImportHash(tx.date, tx.amount, tx.type, tx.description, accountId) : null,
    }));

    // Batch dedup check: fetch all existing hashes in one query
    const hashes = txsWithHash.map((t) => t.hash).filter((h): h is string => h !== null);
    const existingHashes = hashes.length > 0
      ? new Set((await prisma.transaction.findMany({
          where: { importHash: { in: hashes } },
          select: { importHash: true },
        })).map((r) => r.importHash!))
      : new Set<string>();

    const toCreate = txsWithHash.filter((t) => !t.hash || !existingHashes.has(t.hash));
    const duplicates = txsWithHash.length - toCreate.length;

    // Atomic batch insert + balance sync — all succeed or all fail
    let imported = 0;
    const errors: string[] = [];
    try {
      await prisma.$transaction(async (tx) => {
        for (const t of toCreate) {
          await tx.transaction.create({
            data: {
              userId: req.user!.userId,
              bankAccountId: accountId ?? null,
              amount: t.amount,
              type: t.type,
              description: t.description,
              date: t.date,
              paymentMode: null,
              importHash: t.hash,
            },
          });
          imported++;
        }
        // Sync account balance atomically with the inserts
        if (accountId && toCreate.length > 0) {
          const netDelta = toCreate.reduce((sum, t) => sum + (t.type === 'INCOME' ? t.amount : -t.amount), 0);
          if (netDelta !== 0) {
            await tx.bankAccount.update({
              where: { id: accountId },
              data: { currentBalance: { increment: netDelta } },
            });
          }
        }
      });
    } catch (err) {
      // Atomic failure — partial inserts are rolled back
      errors.push(`Batch insert failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      imported = 0;
    }

    // Record import in audit table (filename sanitized to prevent stored XSS)
    await prisma.bankStatementImport.create({
      data: {
        userId: req.user!.userId,
        bankAccountId: accountId ?? null,
        bankName: result.bank,
        rowCount: result.transactions.length,
        importedCount: imported,
        duplicatesSkipped: duplicates,
        errorsCount: errors.length,
        filename: sanitizeFilename(req.file.originalname),
      },
    });

    sendCreated(res, {
      bank: result.bank,
      total: result.transactions.length,
      imported,
      duplicatesSkipped: duplicates,
      errors: errors.slice(0, 10),
      parseErrors: result.errors.slice(0, 10),
      warnings: result.warnings,
    });
  }),
);

// ── Reports ───────────────────────────────────────────────────────────────────
app.get('/api/reports/spending-by-category', requireAuth, asyncHandler(async (req, res) => {
  const fy = validateFY(req.query.fy);
  const { start, end } = getFYRange(fy);

  const data = await prisma.transaction.groupBy({
    by: ['categoryId'],
    where: { userId: req.user!.userId, deletedAt: null, type: 'EXPENSE', date: { gte: start, lt: end } },
    _sum: { amount: true },
    orderBy: { _sum: { amount: 'desc' } },
  });

  const categories = await prisma.category.findMany({ where: { id: { in: data.map((d) => d.categoryId!).filter(Boolean) } } });
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));

  const result = data.map((d) => ({
    categoryId: d.categoryId,
    category: d.categoryId ? catMap[d.categoryId] : null,
    total: Number(d._sum.amount ?? 0),
  }));

  sendSuccess(res, result);
}));

app.get('/api/reports/net-worth-statement', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const statement = await computeNetWorthStatement(userId);
  sendSuccess(res, statement);
}));

app.get('/api/reports/profit-and-loss', requireAuth, asyncHandler(async (req, res) => {
  const fy = validateFY(req.query.fy);
  const { userId, role } = req.user!;
  let targetUserId: string | undefined;
  if (role === 'ADMIN' && req.query.targetUserId) {
    const raw = req.query.targetUserId as string;
    const CUID_RE = /^[a-z0-9]{20,30}$/i;
    if (!CUID_RE.test(raw)) throw AppError.badRequest('Invalid targetUserId format');
    const target = await prisma.user.findFirst({ where: { id: raw, deletedAt: null } });
    if (!target) throw AppError.notFound('User');
    targetUserId = raw;
  }
  const data = await getProfitAndLoss(userId, role, fy, targetUserId);
  sendSuccess(res, data);
}));

// ── Error handler (must be last) ──────────────────────────────────────────────
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(env.PORT, () => {
  console.log(`🚀 Family Finance API running on port ${env.PORT} [${env.NODE_ENV}]`);
});

export default app;
