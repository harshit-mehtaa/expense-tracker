import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

import { env, isDev, isTest } from './config/env';
import { requireAuth } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';
import { asyncHandler } from './utils/asyncHandler';
import { sendCreated, sendSuccess } from './utils/response';

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
import reportsRouter from './routes/reports';
import categoryRulesRouter from './routes/categoryRules';
import documentsRouter from './routes/documents';

// Import service
import { parseCSV, parsePDF, makeImportHash } from './services/importService';
import { prisma } from './config/prisma';
import { AppError } from './utils/AppError';
import { applyCategoryRules } from './services/categoryRuleService';
import { recordAuditLog } from './services/auditService';
import { generateDueRecurringTransactionsForAllUsers } from './services/recurringService';
import { resolveWriteUserId } from './utils/resolveTargetUserId';

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
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB — PDF bank statements can be larger than CSV
  fileFilter: (_req, file, cb) => {
    const isCSV = ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel'].includes(file.mimetype)
      || file.originalname.endsWith('.csv');
    const isPDF = ['application/pdf', 'application/x-pdf'].includes(file.mimetype)
      || file.originalname.endsWith('.pdf');
    if (isCSV || isPDF) {
      cb(null, true);
    } else {
      cb(new AppError('Only CSV or PDF files are allowed', 400));
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
app.use('/api/reports', reportsRouter);
app.use('/api/category-rules', categoryRulesRouter);
app.use('/api/documents', documentsRouter);

// ── Bank Statement Import ─────────────────────────────────────────────────────
app.post(
  '/api/transactions/import',
  requireAuth,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw AppError.badRequest('No file uploaded');

    const accountId = req.body.bankAccountId as string | undefined;
    const bankHint = req.body.bank as string | undefined;
    const pdfPassword = req.body.pdfPassword as string | undefined;
    const ownerUserId = await resolveWriteUserId(req);

    const isPDF = req.file.mimetype === 'application/pdf'
      || req.file.mimetype === 'application/x-pdf'
      || req.file.originalname.endsWith('.pdf');

    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(req.file.path);
    } finally {
      // Always clean up the temp file, even if read fails
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    }

    const result = isPDF
      ? await parsePDF(buffer, bankHint, pdfPassword)
      : parseCSV(buffer, bankHint);

    if (result.transactions.length === 0) {
      throw AppError.badRequest(`No transactions parsed. Errors: ${result.errors.slice(0, 3).map((e) => e.message).join(', ')}`);
    }

    const categorized = await applyCategoryRules(ownerUserId, result.transactions);

    // Verify account belongs to user (if provided)
    if (accountId) {
      const account = await prisma.bankAccount.findFirst({
        where: { id: accountId, userId: ownerUserId },
      });
      if (!account) throw AppError.notFound('Bank account');
    }

    // Compute import hashes upfront.
    // scopeId = accountId when linked to an account; userId otherwise.
    // This ensures deduplication works even without a linked account (re-import is always safe).
    const scopeId = accountId ?? ownerUserId;
    const txsWithHash = categorized.transactions.map((tx) => ({
      ...tx,
      hash: makeImportHash(tx.date, tx.amount, tx.type, tx.description, scopeId),
    }));

    // Batch dedup check: fetch all existing hashes in one query
    const hashes = txsWithHash.map((t) => t.hash);
    const existingHashes = new Set(
      (await prisma.transaction.findMany({
        where: { importHash: { in: hashes } },
        select: { importHash: true },
      })).map((r) => r.importHash!),
    );

    const toCreate = txsWithHash.filter((t) => !existingHashes.has(t.hash));
    const duplicates = txsWithHash.length - toCreate.length;

    // Atomic batch insert + balance sync — all succeed or all fail
    let imported = 0;
    const errors: string[] = [];
    try {
      await prisma.$transaction(async (tx) => {
        for (const t of toCreate) {
          await tx.transaction.create({
            data: {
              userId: ownerUserId,
              bankAccountId: accountId ?? null,
              amount: t.amount,
              type: t.type,
              categoryId: t.categoryId ?? null,
              description: t.description,
              remark: t.remark ?? null,
              date: t.date,
              paymentMode: t.paymentMode ?? null,
              balanceImpactApplied: true,
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
    const importRecord = await prisma.bankStatementImport.create({
      data: {
        userId: ownerUserId,
        bankAccountId: accountId ?? null,
        bankName: result.bank,
        rowCount: result.transactions.length,
        importedCount: imported,
        duplicatesSkipped: duplicates,
        errorsCount: errors.length,
        filename: sanitizeFilename(req.file.originalname),
      },
    });

    await recordAuditLog({
      performedByUserId: req.user!.userId,
      action: 'CREATE',
      entityType: 'BankStatementImport',
      entityId: importRecord.id,
      newValue: importRecord,
    });

    sendCreated(res, {
      bank: result.bank,
      total: result.transactions.length,
      imported,
      duplicatesSkipped: duplicates,
      categorized: categorized.appliedCount,
      errors: errors.slice(0, 10),
      parseErrors: result.errors.slice(0, 10),
      warnings: result.warnings,
    });
  }),
);

// ── Error handler (must be last) ──────────────────────────────────────────────
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(env.PORT, () => {
  console.log(`🚀 Family Finance API running on port ${env.PORT} [${env.NODE_ENV}]`);
});

let recurringCatchUpRunning = false;
async function runRecurringCatchUp() {
  if (recurringCatchUpRunning) return;
  recurringCatchUpRunning = true;
  try {
    const result = await generateDueRecurringTransactionsForAllUsers();
    if (result.generated > 0) {
      console.log(`[recurring] generated ${result.generated} transaction(s) for ${result.usersProcessed} user(s)`);
    }
  } catch (err) {
    console.error('[recurring] catch-up failed', err);
  } finally {
    recurringCatchUpRunning = false;
  }
}

if (!isTest) {
  setTimeout(runRecurringCatchUp, 2_000);
  setInterval(runRecurringCatchUp, 60 * 60 * 1000);
}

export default app;
