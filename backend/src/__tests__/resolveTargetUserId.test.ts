/**
 * Unit tests for resolveTargetUserId.ts
 *
 * This module decides whether an ADMIN may act on another family member's data,
 * so these tests assert the AUTHORIZATION SEMANTICS (who the resulting query is
 * scoped to), not merely that a line executed.
 *
 * Three exports:
 *   - resolveTargetUserId  → read paths; undefined means "caller uses own userId"
 *   - resolveWriteUserId   → write paths; always resolves to a concrete owner id
 *   - ownerScopedWhere     → builds the Prisma `where` that enforces ownership
 *
 * Uses named import { prisma } — dual-export mock required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/prisma', () => {
  const mock = { user: { findFirst: vi.fn() } };
  return { default: mock, prisma: mock };
});

import { prisma } from '../config/prisma';
import { resolveTargetUserId, resolveWriteUserId, ownerScopedWhere } from '../utils/resolveTargetUserId';
import { AppError } from '../utils/AppError';
import type { Request } from 'express';

const userMock = (prisma as any).user;

/** Valid CUID-shaped id (matches /^[a-z0-9]{20,30}$/i). */
const TARGET_ID = 'clm1234567890abcdefghij';
const ADMIN_ID = 'admin-self-id';
const MEMBER_ID = 'member-self-id';

function makeReq(role: 'ADMIN' | 'MEMBER', userId: string, query: Record<string, unknown> = {}): Request {
  return { user: { userId, role }, query } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  userMock.findFirst.mockResolvedValue({ id: TARGET_ID });
});

// ─── resolveTargetUserId (read paths) ─────────────────────────────────────────

describe('resolveTargetUserId', () => {
  it('returns undefined for a MEMBER even when targetUserId is supplied — a member can never read another member', async () => {
    const result = await resolveTargetUserId(makeReq('MEMBER', MEMBER_ID, { targetUserId: TARGET_ID }));
    expect(result).toBeUndefined();
    expect(userMock.findFirst).not.toHaveBeenCalled();
  });

  it('returns undefined for an ADMIN with no targetUserId (family-wide read)', async () => {
    const result = await resolveTargetUserId(makeReq('ADMIN', ADMIN_ID));
    expect(result).toBeUndefined();
    expect(userMock.findFirst).not.toHaveBeenCalled();
  });

  it('returns the target id for an ADMIN with a valid targetUserId', async () => {
    const result = await resolveTargetUserId(makeReq('ADMIN', ADMIN_ID, { targetUserId: TARGET_ID }));
    expect(result).toBe(TARGET_ID);
  });

  it('excludes soft-deleted users from the existence check', async () => {
    await resolveTargetUserId(makeReq('ADMIN', ADMIN_ID, { targetUserId: TARGET_ID }));
    expect(userMock.findFirst).toHaveBeenCalledWith({ where: { id: TARGET_ID, deletedAt: null } });
  });

  it('throws 400 for a malformed targetUserId, without querying the database', async () => {
    await expect(resolveTargetUserId(makeReq('ADMIN', ADMIN_ID, { targetUserId: 'not-a-cuid' })))
      .rejects.toMatchObject({ statusCode: 400, message: 'Invalid targetUserId format' });
    expect(userMock.findFirst).not.toHaveBeenCalled();
  });

  it('throws 404 when the target user does not exist', async () => {
    userMock.findFirst.mockResolvedValue(null);
    await expect(resolveTargetUserId(makeReq('ADMIN', ADMIN_ID, { targetUserId: TARGET_ID })))
      .rejects.toMatchObject({ statusCode: 404, message: 'User not found', code: 'NOT_FOUND' });
  });

  it('honours a custom paramName, including in the error message', async () => {
    const result = await resolveTargetUserId(makeReq('ADMIN', ADMIN_ID, { userId: TARGET_ID }), { paramName: 'userId' });
    expect(result).toBe(TARGET_ID);

    await expect(
      resolveTargetUserId(makeReq('ADMIN', ADMIN_ID, { userId: 'bad' }), { paramName: 'userId' }),
    ).rejects.toMatchObject({ statusCode: 400, message: 'Invalid userId format' });
  });

  it('ignores an empty-string targetUserId (treated as absent)', async () => {
    const result = await resolveTargetUserId(makeReq('ADMIN', ADMIN_ID, { targetUserId: '' }));
    expect(result).toBeUndefined();
  });
});

// ─── resolveWriteUserId (write paths) ─────────────────────────────────────────

describe('resolveWriteUserId', () => {
  it('returns the MEMBER\'s own id, ignoring any targetUserId they try to pass', async () => {
    const result = await resolveWriteUserId(makeReq('MEMBER', MEMBER_ID, { targetUserId: TARGET_ID }));
    expect(result).toBe(MEMBER_ID);
    expect(userMock.findFirst).not.toHaveBeenCalled();
  });

  it('returns the ADMIN\'s own id when no target is supplied', async () => {
    const result = await resolveWriteUserId(makeReq('ADMIN', ADMIN_ID));
    expect(result).toBe(ADMIN_ID);
    expect(userMock.findFirst).not.toHaveBeenCalled();
  });

  it('returns the target id when an ADMIN passes targetUserId', async () => {
    const result = await resolveWriteUserId(makeReq('ADMIN', ADMIN_ID, { targetUserId: TARGET_ID }));
    expect(result).toBe(TARGET_ID);
  });

  it('accepts the ?userId= alias', async () => {
    const result = await resolveWriteUserId(makeReq('ADMIN', ADMIN_ID, { userId: TARGET_ID }));
    expect(result).toBe(TARGET_ID);
  });

  it('prefers targetUserId over userId when both are present', async () => {
    const other = 'clzzzzzzzzzzzzzzzzzzzz';
    await resolveWriteUserId(makeReq('ADMIN', ADMIN_ID, { targetUserId: TARGET_ID, userId: other }));
    expect(userMock.findFirst).toHaveBeenCalledWith({ where: { id: TARGET_ID, deletedAt: null } });
  });

  it('throws 400 for a malformed target, without querying the database', async () => {
    await expect(resolveWriteUserId(makeReq('ADMIN', ADMIN_ID, { targetUserId: 'nope!' })))
      .rejects.toMatchObject({ statusCode: 400, message: 'Invalid targetUserId format' });
    expect(userMock.findFirst).not.toHaveBeenCalled();
  });

  it('throws 400 for a too-short id even though it is alphanumeric', async () => {
    await expect(resolveWriteUserId(makeReq('ADMIN', ADMIN_ID, { targetUserId: 'abc123' })))
      .rejects.toBeInstanceOf(AppError);
  });

  it('throws 404 when the target user does not exist — an admin cannot write to a phantom account', async () => {
    userMock.findFirst.mockResolvedValue(null);
    await expect(resolveWriteUserId(makeReq('ADMIN', ADMIN_ID, { targetUserId: TARGET_ID })))
      .rejects.toMatchObject({ statusCode: 404, message: 'User not found', code: 'NOT_FOUND' });
  });

  it('throws 404 when the target user is soft-deleted (findFirst filters deletedAt)', async () => {
    userMock.findFirst.mockResolvedValue(null);
    await expect(resolveWriteUserId(makeReq('ADMIN', ADMIN_ID, { targetUserId: TARGET_ID })))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(userMock.findFirst).toHaveBeenCalledWith({ where: { id: TARGET_ID, deletedAt: null } });
  });
});

// ─── ownerScopedWhere ─────────────────────────────────────────────────────────

describe('ownerScopedWhere', () => {
  it('pins a MEMBER to their own rows by adding a userId filter', () => {
    expect(ownerScopedWhere('row-1', MEMBER_ID, 'MEMBER')).toEqual({ id: 'row-1', userId: MEMBER_ID });
  });

  it('drops the userId filter for an ADMIN so any family member\'s row is reachable', () => {
    expect(ownerScopedWhere('row-1', ADMIN_ID, 'ADMIN')).toEqual({ id: 'row-1' });
    expect(ownerScopedWhere('row-1', ADMIN_ID, 'ADMIN')).not.toHaveProperty('userId');
  });

  it('fails closed for an unrecognised role — anything that is not exactly "ADMIN" stays owner-scoped', () => {
    expect(ownerScopedWhere('row-1', MEMBER_ID, 'admin')).toEqual({ id: 'row-1', userId: MEMBER_ID });
    expect(ownerScopedWhere('row-1', MEMBER_ID, '')).toEqual({ id: 'row-1', userId: MEMBER_ID });
    expect(ownerScopedWhere('row-1', MEMBER_ID, 'SUPERUSER')).toEqual({ id: 'row-1', userId: MEMBER_ID });
  });
});
