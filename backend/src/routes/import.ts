import fs from 'fs';
import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { sendCreated } from '../utils/response';
import { AppError } from '../utils/AppError';
import { env } from '../config/env';
import { resolveWriteUserId } from '../utils/resolveTargetUserId';
import { parseCSV, parsePDF } from '../services/importService';
import { applyCategoryRules } from '../services/categoryRuleService';
import { persistParsedStatement } from '../services/statementImportService';
import { recordAuditLog } from '../services/auditService';

const router = Router();

// env.UPLOADS_DIR rather than a hardcoded '/app/uploads': multer({ dest }) mkdirs at
// CONSTRUCTION time and is externalized CJS, so a non-writable path makes this module
// throw on import and vi.mock('fs') cannot intercept it.
const uploadsDir = env.UPLOADS_DIR;
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

router.post(
  '/',
  requireAuth,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw AppError.badRequest('No file uploaded');

    const accountId = req.body.bankAccountId as string | undefined;
    const bankHint = req.body.bank as string | undefined;
    const pdfPassword = req.body.pdfPassword as string | undefined;

    const isPDF = req.file.mimetype === 'application/pdf'
      || req.file.mimetype === 'application/x-pdf'
      || req.file.originalname.endsWith('.pdf');

    // The finally starts HERE, before resolveWriteUserId — that call throws on a bad
    // targetUserId, and multer has already written the temp file by this point, so
    // anything that throws between upload and cleanup orphans a file on the volume.
    let buffer: Buffer;
    let ownerUserId: string;
    try {
      ownerUserId = await resolveWriteUserId(req);
      buffer = fs.readFileSync(req.file.path);
    } finally {
      // Always clean up the temp file, even if the read or the resolve fails
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    }

    const result = isPDF
      ? await parsePDF(buffer, bankHint, pdfPassword)
      : parseCSV(buffer, bankHint);

    if (result.transactions.length === 0) {
      throw AppError.badRequest(`No transactions parsed. Errors: ${result.errors.slice(0, 3).map((e) => e.message).join(', ')}`);
    }

    const categorized = await applyCategoryRules(ownerUserId, result.transactions);

    const { imported, duplicatesSkipped, importRecord } = await persistParsedStatement({
      ownerUserId,
      accountId,
      bank: result.bank,
      rowCount: result.transactions.length,
      transactions: categorized.transactions,
      filename: req.file.originalname,
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
      duplicatesSkipped,
      categorized: categorized.appliedCount,
      // Retained for API stability. Always [] now: a partial batch failure is impossible
      // ($transaction is atomic) and a total failure throws before reaching here.
      errors: [],
      parseErrors: result.errors.slice(0, 10),
      warnings: result.warnings,
    });
  }),
);

export default router;
