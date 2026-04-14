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
export async function resolveTargetUserId(
  req: Request,
  { paramName = 'targetUserId' }: { paramName?: string } = {},
): Promise<string | undefined> {
  if (req.user!.role !== 'ADMIN' || !req.query[paramName]) return undefined;
  const raw = req.query[paramName] as string;
  if (!CUID_RE.test(raw)) throw AppError.badRequest(`Invalid ${paramName} format`);
  const target = await prisma.user.findFirst({ where: { id: raw, deletedAt: null } });
  if (!target) throw AppError.notFound('User');
  return raw;
}
