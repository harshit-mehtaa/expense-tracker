import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { sendCreated, sendNoContent, sendSuccess } from '../utils/response';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { sanitizeFilename } from '../utils/sanitizeFilename';
import { AppError } from '../utils/AppError';
import { recordAuditLog } from '../services/auditService';

const router = Router();
router.use(requireAuth);

const uploadsRoot = env.UPLOADS_DIR;
const uploadsRootResolved = path.resolve(uploadsRoot);
const documentsDir = path.join(uploadsRoot, 'documents');
if (!fs.existsSync(documentsDir)) fs.mkdirSync(documentsDir, { recursive: true });

const relatedEntityTypes = [
  'Transaction',
  'InsurancePolicy',
  'FixedDeposit',
  'GoldHolding',
  'RealEstate',
  'BankAccount',
  'Loan',
  'Investment',
  'Budget',
  'TaxProfile',
  'TaxEntry',
  'CapitalGainEntry',
  'OtherSourceIncome',
  'HousePropertyDetail',
  'ForeignAssetDisclosure',
] as const;

type RelatedEntityType = typeof relatedEntityTypes[number];

const documentStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, documentsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 12);
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage: documentStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set([
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'text/csv',
      'text/plain',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
    ]);
    if (allowed.has(file.mimetype)) cb(null, true);
    else cb(new AppError('Unsupported document type', 400));
  },
});

function unlinkQuietly(filePath: string | undefined): void {
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch { /* ignore cleanup failures */ }
}

function resolveUploadPath(relativePath: string): string {
  const filePath = path.resolve(uploadsRoot, relativePath);
  if (filePath !== uploadsRootResolved && !filePath.startsWith(`${uploadsRootResolved}${path.sep}`)) {
    throw AppError.badRequest('Invalid file path');
  }
  return filePath;
}

async function getEntityOwner(entityType: RelatedEntityType, entityId: string): Promise<string> {
  switch (entityType) {
    case 'Transaction': {
      const row = await prisma.transaction.findFirst({ where: { id: entityId, deletedAt: null }, select: { userId: true } });
      if (!row) throw AppError.notFound('Transaction');
      return row.userId;
    }
    case 'InsurancePolicy': {
      const row = await prisma.insurancePolicy.findUnique({ where: { id: entityId }, select: { userId: true } });
      if (!row) throw AppError.notFound('Insurance policy');
      return row.userId;
    }
    case 'FixedDeposit': {
      const row = await prisma.fixedDeposit.findUnique({ where: { id: entityId }, select: { userId: true } });
      if (!row) throw AppError.notFound('Fixed deposit');
      return row.userId;
    }
    case 'GoldHolding': {
      const row = await prisma.goldHolding.findUnique({ where: { id: entityId }, select: { userId: true } });
      if (!row) throw AppError.notFound('Gold holding');
      return row.userId;
    }
    case 'RealEstate': {
      const row = await prisma.realEstate.findUnique({ where: { id: entityId }, select: { userId: true } });
      if (!row) throw AppError.notFound('Property');
      return row.userId;
    }
    case 'BankAccount': {
      const row = await prisma.bankAccount.findUnique({ where: { id: entityId }, select: { userId: true } });
      if (!row) throw AppError.notFound('Bank account');
      return row.userId;
    }
    case 'Loan': {
      const row = await prisma.loan.findUnique({ where: { id: entityId }, select: { userId: true } });
      if (!row) throw AppError.notFound('Loan');
      return row.userId;
    }
    case 'Investment': {
      const row = await prisma.investment.findUnique({ where: { id: entityId }, select: { userId: true } });
      if (!row) throw AppError.notFound('Investment');
      return row.userId;
    }
    case 'Budget': {
      const row = await prisma.budget.findUnique({ where: { id: entityId }, select: { userId: true } });
      if (!row) throw AppError.notFound('Budget');
      return row.userId;
    }
    case 'TaxProfile': {
      const row = await prisma.taxProfile.findUnique({ where: { id: entityId }, select: { userId: true } });
      if (!row) throw AppError.notFound('Tax profile');
      return row.userId;
    }
    case 'TaxEntry': {
      const row = await prisma.taxEntry.findUnique({ where: { id: entityId }, select: { userId: true } });
      if (!row) throw AppError.notFound('Tax entry');
      return row.userId;
    }
    case 'CapitalGainEntry': {
      const row = await prisma.capitalGainEntry.findUnique({ where: { id: entityId }, select: { userId: true } });
      if (!row) throw AppError.notFound('Capital gain entry');
      return row.userId;
    }
    case 'OtherSourceIncome': {
      const row = await prisma.otherSourceIncome.findUnique({ where: { id: entityId }, select: { userId: true } });
      if (!row) throw AppError.notFound('Other income entry');
      return row.userId;
    }
    case 'HousePropertyDetail': {
      const row = await prisma.housePropertyDetail.findUnique({ where: { id: entityId }, select: { userId: true } });
      if (!row) throw AppError.notFound('House property entry');
      return row.userId;
    }
    case 'ForeignAssetDisclosure': {
      const row = await prisma.foreignAssetDisclosure.findUnique({ where: { id: entityId }, select: { userId: true } });
      if (!row) throw AppError.notFound('Foreign asset entry');
      return row.userId;
    }
  }
}

function assertCanAccess(ownerId: string, requesterId: string, role: Role): void {
  if (role !== Role.ADMIN && ownerId !== requesterId) throw AppError.forbidden();
}

const entityQuerySchema = z.object({
  entityType: z.enum(relatedEntityTypes),
  entityId: z.string().cuid(),
});

router.get('/', asyncHandler(async (req, res) => {
  const { entityType, entityId } = entityQuerySchema.parse(req.query);
  const ownerId = await getEntityOwner(entityType, entityId);
  assertCanAccess(ownerId, req.user!.userId, req.user!.role);

  const documents = await prisma.document.findMany({
    where: { relatedEntityType: entityType, relatedEntityId: entityId },
    orderBy: { createdAt: 'desc' },
  });
  sendSuccess(res, documents);
}));

router.post('/', upload.single('file'), asyncHandler(async (req, res) => {
  const parsed = entityQuerySchema.safeParse(req.body);
  if (!parsed.success) {
    unlinkQuietly(req.file?.path);
    throw parsed.error;
  }
  if (!req.file) throw AppError.badRequest('No file uploaded');

  let ownerId: string;
  try {
    ownerId = await getEntityOwner(parsed.data.entityType, parsed.data.entityId);
    assertCanAccess(ownerId, req.user!.userId, req.user!.role);
  } catch (err) {
    unlinkQuietly(req.file.path);
    throw err;
  }

  const document = await prisma.document.create({
    data: {
      userId: ownerId,
      relatedEntityType: parsed.data.entityType,
      relatedEntityId: parsed.data.entityId,
      fileName: sanitizeFilename(req.file.originalname),
      filePath: `documents/${req.file.filename}`,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
    },
  });

  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: 'CREATE',
    entityType: 'Document',
    entityId: document.id,
    newValue: document,
  });

  sendCreated(res, document);
}));

async function getVisibleDocument(documentId: string, requesterId: string, role: Role) {
  const document = await prisma.document.findUnique({ where: { id: documentId } });
  if (!document) throw AppError.notFound('Document');
  assertCanAccess(document.userId, requesterId, role);
  return document;
}

router.get('/:id/download', asyncHandler(async (req, res) => {
  const document = await getVisibleDocument(req.params.id, req.user!.userId, req.user!.role);
  const filePath = resolveUploadPath(document.filePath);
  if (!fs.existsSync(filePath)) throw AppError.notFound('Document file');
  res.download(filePath, document.fileName);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const document = await getVisibleDocument(req.params.id, req.user!.userId, req.user!.role);
  await prisma.document.delete({ where: { id: document.id } });
  unlinkQuietly(resolveUploadPath(document.filePath));
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: 'DELETE',
    entityType: 'Document',
    entityId: document.id,
    oldValue: document,
  });
  sendNoContent(res);
}));

export default router;
