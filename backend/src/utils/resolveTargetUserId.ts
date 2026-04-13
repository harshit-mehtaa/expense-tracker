import { Request } from 'express';
import { AppError } from './AppError';
import { prisma } from '../config/prisma';

const CUID_RE = /^[a-z0-9]{20,30}$/i;

/**
 * Resolves the effective target user ID for ADMIN requests.
 *
 * - Non-ADMIN or missing ?targetUserId: returns undefined (caller uses own userId)
 * - ADMIN with ?targetUserId: validates CUID format, confirms user exists, returns the ID
 *
 * Throws 400 for invalid format, 404 for non-existent user.
 */
export async function resolveTargetUserId(req: Request): Promise<string | undefined> {
  if (req.user!.role !== 'ADMIN' || !req.query.targetUserId) return undefined;
  const raw = req.query.targetUserId as string;
  if (!CUID_RE.test(raw)) throw AppError.badRequest('Invalid targetUserId format');
  const target = await prisma.user.findFirst({ where: { id: raw, deletedAt: null } });
  if (!target) throw AppError.notFound('User');
  return raw;
}
