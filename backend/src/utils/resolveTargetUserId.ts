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

/**
 * Resolves the owner for write/create routes.
 *
 * Members always write to their own account. Admins can pass ?targetUserId= or
 * ?userId= to create data for a family member; when omitted, admin writes to
 * their own account.
 */
export async function resolveWriteUserId(req: Request): Promise<string> {
  if (req.user!.role !== 'ADMIN') return req.user!.userId;

  const raw = (req.query.targetUserId ?? req.query.userId) as string | undefined;
  if (!raw) return req.user!.userId;
  if (!CUID_RE.test(raw)) throw AppError.badRequest('Invalid targetUserId format');

  const target = await prisma.user.findFirst({ where: { id: raw, deletedAt: null } });
  if (!target) throw AppError.notFound('User');
  return raw;
}

export function ownerScopedWhere(
  id: string,
  requesterId: string,
  requesterRole: string,
): { id: string; userId?: string } {
  return requesterRole === 'ADMIN' ? { id } : { id, userId: requesterId };
}
