import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/response';
import { prisma } from '../config/prisma';

const router = Router();
router.use(requireAuth);

/**
 * The family members a co-owner can be chosen from.
 *
 * Exists because `/admin/users` is admin-only, so a MEMBER's owner dropdown contained
 * only themselves — they could not record a jointly-owned loan or property at all, which
 * is the whole point of co-ownership in a two-person household.
 *
 * Deliberately NOT a relaxation of `/admin/users`. That returns email, masked PAN, last
 * login, and account and transaction counts; none of it is needed to pick a co-owner, and
 * all of it would be a real widening. This returns the least that makes the picker work.
 *
 * Names are already reachable by any member through a shared loan or property —
 * `loanService`'s owner rows carry `userName` — so this is not new information about
 * anything already shared. What it does add is the name of a member you share nothing
 * with, which is the trade for being able to share something with them in the first
 * place.
 *
 * Note this grants no ability to VIEW another member's data. `resolveTargetUserId`
 * refuses a `targetUserId` from a non-admin regardless of what the client sends.
 */
router.get('/members', asyncHandler(async (_req, res) => {
  const members = await prisma.user.findMany({
    where: { isActive: true, deletedAt: null },
    select: { id: true, name: true, colorTag: true },
    orderBy: { name: 'asc' },
  });
  sendSuccess(res, members);
}));

export default router;
