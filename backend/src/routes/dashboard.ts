import { Router, Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/response';
import { requireAuth, requireAdmin } from '../middleware/auth';
import * as dashboardService from '../services/dashboardService';
import { getCurrentFY } from '../utils/financialYear';

const router = Router();
router.use(requireAuth);

router.get(
  '/summary',
  asyncHandler(async (req: Request, res: Response) => {
    const summary = await dashboardService.getDashboardSummary(
      req.user!.userId,
      req.user!.role,
      req.query.fy as string,
    );
    sendSuccess(res, summary);
  }),
);

router.get(
  '/cashflow',
  asyncHandler(async (req: Request, res: Response) => {
    const cashflow = await dashboardService.getCashflow(
      req.user!.userId,
      req.user!.role,
      req.query.fy as string,
    );
    sendSuccess(res, cashflow);
  }),
);

router.get(
  '/upcoming-alerts',
  asyncHandler(async (req: Request, res: Response) => {
    const alerts = await dashboardService.getUpcomingAlerts(
      req.user!.userId,
      req.user!.role,
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
