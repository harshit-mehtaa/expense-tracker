import { Router, Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess, sendCreated } from '../utils/response';
import { requireAuth } from '../middleware/auth';
import { upsertNetWorthSnapshot, getNetWorthHistory } from '../services/dashboardService';

const router = Router();
router.use(requireAuth);

// POST / — upsert this month's snapshot for the authenticated user
router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const snapshot = await upsertNetWorthSnapshot(req.user!.userId);
    sendCreated(res, snapshot, 'Snapshot saved');
  }),
);

// GET / — last 24 months of snapshots for the authenticated user
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const history = await getNetWorthHistory(req.user!.userId);
    sendSuccess(res, history);
  }),
);

export default router;
