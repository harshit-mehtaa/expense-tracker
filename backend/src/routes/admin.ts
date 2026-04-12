import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/response';
import * as svc from '../services/adminService';

const router = Router();
router.use(requireAuth, requireAdmin);

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
  const user = await svc.updateUser(req.params.id, req.user!.userId, data);
  sendSuccess(res, user);
}));

router.delete('/users/:id', asyncHandler(async (req, res) => {
  await svc.deleteUser(req.params.id, req.user!.userId);
  sendNoContent(res);
}));

router.post('/users/:id/reset-password', asyncHandler(async (req, res) => {
  const { password } = z.object({ password: z.string().min(8) }).parse(req.body);
  await svc.resetUserPassword(req.params.id, password);
  sendSuccess(res, { message: 'Password reset. User will be prompted to change on next login.' });
}));

router.get('/audit-log', asyncHandler(async (req, res) => {
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 50);
  const data = await svc.getAuditLog(page, limit);
  sendSuccess(res, data);
}));

export default router;
