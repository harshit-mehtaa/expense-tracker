import fs from 'fs';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { singleFileUpload } from '../middleware/upload';
import { optionalQuery } from '../utils/querySchemas';
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
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB — PDF bank statements can be larger than CSV
    // multer 2's opt-in hardening, sized to the real form: one file plus at most three
    // text fields (bankAccountId, bank, pdfPassword — Transactions.tsx import dialog).
    files: 1,
    fields: 5,
    parts: 6,
    fieldSize: 1024,
    fieldNestingDepth: 0, // no `a[b]` field names: every field is a flat string
  },
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

// Multipart text fields arrive as strings; a repeated field would arrive as an array
// and crash the parser (bankHint.toUpperCase), so shape them before use.
const importBodySchema = z.object({
  bankAccountId: optionalQuery(z.string().cuid()),
  bank: optionalQuery(z.string().trim().max(50)), // free-form hint; the parser upper-cases it
  pdfPassword: optionalQuery(z.string().max(1024)),
});

router.post(
  '/',
  requireAuth,
  singleFileUpload(upload, 'file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw AppError.badRequest('No file uploaded');

    const isPDF = req.file.mimetype === 'application/pdf'
      || req.file.mimetype === 'application/x-pdf'
      || req.file.originalname.endsWith('.pdf');

    // The finally starts HERE, before resolveWriteUserId — that call throws on a bad
    // targetUserId, and multer has already written the temp file by this point, so
    // anything that throws between upload and cleanup orphans a file on the volume.
    let buffer: Buffer;
    let ownerUserId: string;
    let body: z.infer<typeof importBodySchema>;
    try {
      // Validated inside the try so a rejected body still unlinks the temp file.
      body = importBodySchema.parse(req.body);
      ownerUserId = await resolveWriteUserId(req);
      buffer = fs.readFileSync(req.file.path);
    } finally {
      // Always clean up the temp file, even if the read or the resolve fails
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    }

    const { bankAccountId: accountId, bank: bankHint, pdfPassword } = body;
    const result = isPDF
      ? await parsePDF(buffer, bankHint, pdfPassword)
      : parseCSV(buffer, bankHint);

    if (result.transactions.length === 0) {
      throw AppError.badRequest(`No transactions parsed. Errors: ${result.errors.slice(0, 3).map((e) => e.message).join(', ')}`);
    }

    const categorized = await applyCategoryRules(ownerUserId, result.transactions);

    const { imported, duplicatesSkipped, importRecord, warnings: persistWarnings } = await persistParsedStatement({
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
      warnings: [...result.warnings, ...categorized.warnings, ...persistWarnings],
    });
  }),
);

export default router;
