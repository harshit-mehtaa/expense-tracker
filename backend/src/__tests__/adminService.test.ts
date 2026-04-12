/**
 * Unit tests for adminService.ts.
 *
 * Key test focus:
 * - createUser: email conflict, bcrypt hash called, mustChangePassword=true
 * - updateUser: notFound, self-role-change guard, email conflict, happy path
 * - deleteUser: self-delete guard, notFound, revokes refreshTokens + soft-deletes
 * - resetUserPassword: notFound, bcrypt hash + mustChangePassword=true
 * - getAuditLog: pagination skip calculation
 *
 * adminService uses named import { prisma } and bcryptjs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/prisma', () => {
  const mockPrisma = {
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    refreshToken: {
      deleteMany: vi.fn(),
    },
    auditLog: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  };
  return { default: mockPrisma, prisma: mockPrisma };
});

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('hashed-password'),
  },
}));

import { prisma } from '../config/prisma';
import bcrypt from 'bcryptjs';
import {
  getAllUsers,
  createUser,
  updateUser,
  deleteUser,
  resetUserPassword,
  getAuditLog,
} from '../services/adminService';

const userMock = (prisma as any).user;
const tokenMock = (prisma as any).refreshToken;
const auditMock = (prisma as any).auditLog;
const bcryptHash = bcrypt.hash as ReturnType<typeof vi.fn>;

const MOCK_USER = {
  id: 'u1',
  name: 'Test User',
  email: 'test@example.com',
  passwordHash: 'hashed-old',
  role: 'MEMBER',
  isActive: true,
  deletedAt: null,
  createdAt: new Date('2024-01-01'),
};

beforeEach(() => {
  vi.clearAllMocks();
  userMock.findUnique.mockResolvedValue(null);
  userMock.findFirst.mockResolvedValue(MOCK_USER);
  userMock.findMany.mockResolvedValue([MOCK_USER]);
  userMock.create.mockResolvedValue({ id: 'u-new', ...MOCK_USER });
  userMock.update.mockResolvedValue(MOCK_USER);
  tokenMock.deleteMany.mockResolvedValue({ count: 0 });
  auditMock.findMany.mockResolvedValue([]);
  auditMock.count.mockResolvedValue(0);
  bcryptHash.mockResolvedValue('hashed-password');
});

// ─────────────────────────────────────────────────────────────────────────────
// getAllUsers
// ─────────────────────────────────────────────────────────────────────────────

describe('getAllUsers', () => {
  it('returns list of users', async () => {
    const result = await getAllUsers();
    expect(userMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null } }),
    );
    expect(result).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createUser
// ─────────────────────────────────────────────────────────────────────────────

describe('createUser', () => {
  it('throws Conflict when email already in use', async () => {
    userMock.findUnique.mockResolvedValue(MOCK_USER); // email exists
    await expect(
      createUser({ name: 'Bob', email: 'test@example.com', password: 'pass', role: 'MEMBER' }),
    ).rejects.toThrow(/already in use/i);
    expect(userMock.create).not.toHaveBeenCalled();
  });

  it('hashes password with bcrypt before creating user', async () => {
    await createUser({ name: 'Bob', email: 'new@example.com', password: 'plain-pass', role: 'MEMBER' });
    expect(bcryptHash).toHaveBeenCalledWith('plain-pass', 12);
  });

  it('sets mustChangePassword=true on newly created user', async () => {
    await createUser({ name: 'Bob', email: 'new@example.com', password: 'pass', role: 'MEMBER' });
    expect(userMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mustChangePassword: true, passwordHash: 'hashed-password' }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateUser
// ─────────────────────────────────────────────────────────────────────────────

describe('updateUser', () => {
  it('throws NotFound when user does not exist', async () => {
    userMock.findFirst.mockResolvedValue(null);
    await expect(updateUser('u-x', 'admin-1', { name: 'New Name' })).rejects.toThrow(/not found/i);
  });

  it('throws BadRequest when user tries to change their own role', async () => {
    // MOCK_USER has role 'MEMBER', so changing to 'ADMIN' while requesterId === userId triggers guard
    userMock.findFirst.mockResolvedValue({ ...MOCK_USER, id: 'u1', role: 'MEMBER' });
    await expect(updateUser('u1', 'u1', { role: 'ADMIN' })).rejects.toThrow(/own role/i);
  });

  it('does not throw when role is provided but matches current role (no actual change)', async () => {
    userMock.findFirst.mockResolvedValue({ ...MOCK_USER, id: 'u1', role: 'MEMBER' });
    // Same role — no guard triggered
    await expect(updateUser('u1', 'u1', { role: 'MEMBER' })).resolves.not.toThrow();
  });

  it('throws Conflict when new email is already taken', async () => {
    userMock.findFirst.mockResolvedValue(MOCK_USER);
    userMock.findUnique.mockResolvedValue({ id: 'u2', email: 'taken@example.com' }); // conflict
    await expect(
      updateUser('u1', 'admin-1', { email: 'taken@example.com' }),
    ).rejects.toThrow(/already in use/i);
  });

  it('updates user when all checks pass', async () => {
    userMock.findUnique.mockResolvedValue(null); // no email conflict
    await updateUser('u1', 'admin-1', { name: 'Updated Name' });
    expect(userMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' } }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteUser
// ─────────────────────────────────────────────────────────────────────────────

describe('deleteUser', () => {
  it('throws BadRequest when user tries to delete themselves (check fires before DB)', async () => {
    await expect(deleteUser('u1', 'u1')).rejects.toThrow(/own account/i);
    // No DB calls should have been made
    expect(userMock.findFirst).not.toHaveBeenCalled();
  });

  it('throws NotFound when user does not exist', async () => {
    userMock.findFirst.mockResolvedValue(null);
    await expect(deleteUser('u-x', 'admin-1')).rejects.toThrow(/not found/i);
  });

  it('revokes all refresh tokens then soft-deletes user', async () => {
    await deleteUser('u1', 'admin-1');
    // Tokens revoked first
    expect(tokenMock.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    // Then user soft-deleted
    expect(userMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({ isActive: false, deletedAt: expect.any(Date) }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resetUserPassword
// ─────────────────────────────────────────────────────────────────────────────

describe('resetUserPassword', () => {
  it('throws NotFound when user does not exist', async () => {
    userMock.findFirst.mockResolvedValue(null);
    await expect(resetUserPassword('u-x', 'newpass123')).rejects.toThrow(/not found/i);
  });

  it('hashes new password and sets mustChangePassword=true', async () => {
    await resetUserPassword('u1', 'new-plain-pass');
    expect(bcryptHash).toHaveBeenCalledWith('new-plain-pass', 12);
    expect(userMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({ passwordHash: 'hashed-password', mustChangePassword: true }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getAuditLog
// ─────────────────────────────────────────────────────────────────────────────

describe('getAuditLog', () => {
  it('uses default page=1, limit=50 (skip=0)', async () => {
    await getAuditLog();
    expect(auditMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 50 }),
    );
  });

  it('calculates correct skip for page=3, limit=20 (skip=40)', async () => {
    await getAuditLog(3, 20);
    expect(auditMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 40, take: 20 }),
    );
  });

  it('returns logs, total, page, limit in response', async () => {
    auditMock.findMany.mockResolvedValue([{ id: 'log-1', performedBy: { id: 'u1' } }]);
    auditMock.count.mockResolvedValue(1);
    const result = await getAuditLog(1, 50);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(50);
    expect(result.logs).toHaveLength(1);
  });
});
