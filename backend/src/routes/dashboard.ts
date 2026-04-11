import { Router, Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/response';
import { requireAuth, requireAdmin } from '../middleware/auth';
import * as dashboardService from '../services/dashboardService';
import { getCurrentFY } from '../utils/financialYear';
import { AppError } from '../utils/AppError';
import { prisma } from '../config/prisma';

const router = Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveTargetUserId(req: Request): Promise<string | undefined> {
  if (req.user!.role !== 'ADMIN' || !req.query.targetUserId) return undefined;
  const raw = req.query.targetUserId as string;
  if (!UUID_RE.test(raw)) throw AppError.badRequest('Invalid targetUserId format');
  const target = await prisma.user.findFirst({ where: { id: raw, deletedAt: null } });
  if (!target) throw AppError.notFound('User');
  return raw;
}

router.get(
  '/summary',
  asyncHandler(async (req: Request, res: Response) => {
    const targetUserId = await resolveTargetUserId(req);
    const summary = await dashboardService.getDashboardSummary(
      req.user!.userId,
      req.user!.role,
      req.query.fy as string,
      targetUserId,
    );
    sendSuccess(res, summary);
  }),
);

router.get(
  '/cashflow',
  asyncHandler(async (req: Request, res: Response) => {
    const targetUserId = await resolveTargetUserId(req);
    const cashflow = await dashboardService.getCashflow(
      req.user!.userId,
      req.user!.role,
      req.query.fy as string,
      targetUserId,
    );
    sendSuccess(res, cashflow);
  }),
);

router.get(
  '/upcoming-alerts',
  asyncHandler(async (req: Request, res: Response) => {
    const targetUserId = await resolveTargetUserId(req);
    const alerts = await dashboardService.getUpcomingAlerts(
      req.user!.userId,
      req.user!.role,
      targetUserId,
    );
    sendSuccess(res, alerts);
  }),
);

router.get(
  '/family-overview',
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const fy = (req.query.fy as string) || getCurrentFY();
    const result = await dashboardService.getFamilyOverview(fy);
    sendSuccess(res, result);
  }),
);

export default router;
