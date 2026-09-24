import { Router, Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/response';
import { requireAuth, requireAdmin } from '../middleware/auth';
import * as dashboardService from '../services/dashboardService';
import { z } from 'zod';
import { getCurrentFY } from '../utils/financialYear';
import { optionalQueryFY } from '../utils/querySchemas';
import { resolveTargetUserId } from '../utils/resolveTargetUserId';

const router = Router();
router.use(requireAuth);

const fyQuery = z.object({ fy: optionalQueryFY() });

router.get(
  '/summary',
  asyncHandler(async (req: Request, res: Response) => {
    const targetUserId = await resolveTargetUserId(req);
    const summary = await dashboardService.getDashboardSummary(
      req.user!.userId,
      req.user!.role,
      fyQuery.parse(req.query).fy,
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
      fyQuery.parse(req.query).fy,
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
    const fy = fyQuery.parse(req.query).fy ?? getCurrentFY();
    const result = await dashboardService.getFamilyOverview(fy);
    sendSuccess(res, result);
  }),
);

export default router;
