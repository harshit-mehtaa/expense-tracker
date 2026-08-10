import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/response';
import * as svc from '../services/adminService';
import { recordAuditLog } from '../services/auditService';
import { prisma } from '../config/prisma';
import { isTest } from '../config/env';

const router = Router();
router.use(requireAuth, requireAdmin);

const safeUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  colorTag: true,
  panNumberMasked: true,
  mustChangePassword: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as const;

router.get('/users', asyncHandler(async (_req, res) => {
  const users = await svc.getAllUsers();
  sendSuccess(res, users);
}));

router.post('/users', asyncHandler(async (req, res) => {
  const data = z.object({
    name: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(8),
    role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER'),
    panNumberMasked: z.string().optional(),
    colorTag: z.string().optional(),
  }).parse(req.body);
  const user = await svc.createUser(data);
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: 'CREATE',
    entityType: 'User',
    entityId: user.id,
    newValue: user,
  });
  sendCreated(res, user);
}));

router.put('/users/:id', asyncHandler(async (req, res) => {
  const data = z.object({
    name: z.string().optional(),
    email: z.string().email().optional(),
    role: z.enum(['ADMIN', 'MEMBER']).optional(),
    isActive: z.boolean().optional(),
    colorTag: z.string().optional(),
    panNumberMasked: z.string().optional(),
  }).parse(req.body);
  const oldUser = isTest ? null : await prisma.user.findFirst({ where: { id: req.params.id, deletedAt: null }, select: safeUserSelect });
  const user = await svc.updateUser(req.params.id, req.user!.userId, data);
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: 'UPDATE',
    entityType: 'User',
    entityId: user.id,
    oldValue: oldUser,
    newValue: user,
  });
  sendSuccess(res, user);
}));

router.delete('/users/:id', asyncHandler(async (req, res) => {
  const oldUser = isTest ? null : await prisma.user.findFirst({ where: { id: req.params.id, deletedAt: null }, select: safeUserSelect });
  const deleted = await svc.deleteUser(req.params.id, req.user!.userId);
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: 'DELETE',
    entityType: 'User',
    entityId: deleted?.id ?? req.params.id,
    oldValue: oldUser,
  });
  sendNoContent(res);
}));

router.post('/users/:id/reset-password', asyncHandler(async (req, res) => {
  const { password } = z.object({ password: z.string().min(8) }).parse(req.body);
  const user = await svc.resetUserPassword(req.params.id, password);
  await recordAuditLog({
    performedByUserId: req.user!.userId,
    action: 'RESET_PASSWORD',
    entityType: 'User',
    entityId: user?.id ?? req.params.id,
    newValue: { mustChangePassword: user?.mustChangePassword ?? true },
  });
  sendSuccess(res, { message: 'Password reset. User will be prompted to change on next login.' });
}));

router.get('/audit-log', asyncHandler(async (req, res) => {
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 50);
  const data = await svc.getAuditLog(page, limit);
  sendSuccess(res, data);
}));

export default router;
