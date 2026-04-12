/**
 * Unit tests for authService.ts.
 *
 * Three mocking layers:
 * 1. prisma (default import) — user, refreshToken models
 * 2. bcryptjs — compare and hash
 * 3. ../middleware/auth — signAccessToken, signRefreshToken, verifyRefreshToken
 *
 * Key security invariant: login always calls bcrypt.compare even when user is null
 * (constant-time comparison to prevent timing attacks).
 *
 * refreshTokens has 6 distinct paths including a concurrent-replay guard
 * (deleteMany returns count=0 → nuke all user tokens).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/prisma', () => {
  const mockPrisma = {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    refreshToken: {
      findUnique: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
  return { default: mockPrisma, prisma: mockPrisma };
});

vi.mock('../middleware/auth', () => ({
  signAccessToken: vi.fn().mockReturnValue('mock-access-token'),
  signRefreshToken: vi.fn().mockReturnValue('mock-refresh-token'),
  verifyRefreshToken: vi.fn().mockReturnValue({ userId: 'u1', email: 'test@x.com', role: 'MEMBER' }),
}));

vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn().mockResolvedValue('hashed-pw'),
  },
}));

import prisma from '../config/prisma';
import bcrypt from 'bcryptjs';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../middleware/auth';
import {
  login,
  refreshTokens,
  logout,
  createUser,
  changePassword,
} from '../services/authService';

const userMock = (prisma as any).user;
const tokenMock = (prisma as any).refreshToken;
const bcryptCompare = bcrypt.compare as ReturnType<typeof vi.fn>;
const bcryptHash = bcrypt.hash as ReturnType<typeof vi.fn>;
const signAccess = signAccessToken as ReturnType<typeof vi.fn>;
const signRefresh = signRefreshToken as ReturnType<typeof vi.fn>;
const verifyRefresh = verifyRefreshToken as ReturnType<typeof vi.fn>;

const MOCK_USER = {
  id: 'u1',
  email: 'test@x.com',
  name: 'Test User',
  role: 'MEMBER',
  isActive: true,
  deletedAt: null,
  passwordHash: '$2b$12$stored-hash',
};

const MOCK_STORED_TOKEN = {
  token: 'old-refresh-token',
  userId: 'u1',
  expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000), // 7 days from now
};

beforeEach(() => {
  vi.clearAllMocks();
  userMock.findUnique.mockResolvedValue(MOCK_USER);
  userMock.create.mockResolvedValue(MOCK_USER);
  userMock.update.mockResolvedValue(MOCK_USER);
  tokenMock.findUnique.mockResolvedValue(MOCK_STORED_TOKEN);
  tokenMock.create.mockResolvedValue({});
  tokenMock.deleteMany.mockResolvedValue({ count: 1 });
  bcryptCompare.mockResolvedValue(true);
  bcryptHash.mockResolvedValue('hashed-pw');
  signAccess.mockReturnValue('mock-access-token');
  signRefresh.mockReturnValue('mock-refresh-token');
  verifyRefresh.mockReturnValue({ userId: 'u1', email: 'test@x.com', role: 'MEMBER' });
});

// ─────────────────────────────────────────────────────────────────────────────
// login
// ─────────────────────────────────────────────────────────────────────────────

describe('login', () => {
  it('security invariant: bcrypt.compare called even when user does not exist (constant-time)', async () => {
    userMock.findUnique.mockResolvedValue(null);
    bcryptCompare.mockResolvedValue(false);
    await expect(login('ghost@x.com', 'any-pass')).rejects.toThrow(/invalid/i);
    // CRITICAL: bcrypt.compare must be called with the dummy hash to prevent timing attacks
    expect(bcryptCompare).toHaveBeenCalled();
  });

  it('throws Unauthorized when password does not match', async () => {
    bcryptCompare.mockResolvedValue(false);
    await expect(login('test@x.com', 'wrong-pass')).rejects.toThrow(/invalid/i);
  });

  it('throws Forbidden when user account is inactive', async () => {
    userMock.findUnique.mockResolvedValue({ ...MOCK_USER, isActive: false });
    bcryptCompare.mockResolvedValue(true);
    await expect(login('test@x.com', 'correct-pass')).rejects.toThrow(/deactivated/i);
  });

  it('happy path: returns tokens and user, updates lastLoginAt', async () => {
    const result = await login('test@x.com', 'correct-pass');
    expect(result.tokens.accessToken).toBe('mock-access-token');
    expect(result.tokens.refreshToken).toBe('mock-refresh-token');
    expect(result.user).toBeDefined();
    expect(userMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastLoginAt: expect.any(Date) }),
      }),
    );
  });

  it('stores new refresh token in database on successful login', async () => {
    await login('test@x.com', 'correct-pass');
    expect(tokenMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'u1', token: 'mock-refresh-token' }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// refreshTokens — 6 distinct paths
// ─────────────────────────────────────────────────────────────────────────────

describe('refreshTokens', () => {
  it('PATH 1: verifyRefreshToken throws → error propagates', async () => {
    verifyRefresh.mockImplementation(() => { throw new Error('invalid signature'); });
    await expect(refreshTokens('bad-token')).rejects.toThrow(/invalid signature/i);
  });

  it('PATH 2: token not in DB → nuke all user tokens + Unauthorized', async () => {
    tokenMock.findUnique.mockResolvedValue(null);
    await expect(refreshTokens('old-refresh-token')).rejects.toThrow(/invalid or expired/i);
    // Must nuke all tokens for this user as replay protection
    expect(tokenMock.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });

  it('PATH 3: token found but expiresAt in the past → Unauthorized', async () => {
    tokenMock.findUnique.mockResolvedValue({
      ...MOCK_STORED_TOKEN,
      expiresAt: new Date(Date.now() - 1000), // expired 1s ago
    });
    await expect(refreshTokens('old-refresh-token')).rejects.toThrow(/invalid or expired/i);
  });

  it('PATH 4: concurrent replay — deleteMany returns count=0 → nuke + Unauthorized', async () => {
    // Token exists in DB, not expired, but deleteMany says count=0 (someone else consumed it first)
    tokenMock.deleteMany.mockResolvedValue({ count: 0 });
    await expect(refreshTokens('old-refresh-token')).rejects.toThrow(/invalid or expired/i);
    // Nuke all user tokens
    expect(tokenMock.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });

  it('PATH 5: user inactive or deleted → Unauthorized', async () => {
    userMock.findUnique.mockResolvedValue({ ...MOCK_USER, isActive: false, deletedAt: null });
    tokenMock.deleteMany.mockResolvedValue({ count: 1 });
    await expect(refreshTokens('old-refresh-token')).rejects.toThrow(/inactive or deleted/i);
  });

  it('PATH 6: happy path → returns new token pair', async () => {
    tokenMock.deleteMany.mockResolvedValue({ count: 1 });
    const result = await refreshTokens('old-refresh-token');
    expect(result.accessToken).toBe('mock-access-token');
    expect(result.refreshToken).toBe('mock-refresh-token');
    expect(tokenMock.create).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// logout
// ─────────────────────────────────────────────────────────────────────────────

describe('logout', () => {
  it('deletes the refresh token by value', async () => {
    await logout('some-refresh-token');
    expect(tokenMock.deleteMany).toHaveBeenCalledWith({ where: { token: 'some-refresh-token' } });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createUser (auth service version — public signup / admin creation)
// ─────────────────────────────────────────────────────────────────────────────

describe('createUser (authService)', () => {
  it('throws Conflict when email already exists', async () => {
    userMock.findUnique.mockResolvedValue(MOCK_USER); // email taken
    await expect(
      createUser({ name: 'Bob', email: 'test@x.com', password: 'pass123' }),
    ).rejects.toThrow(/already exists/i);
  });

  it('hashes password and sets mustChangePassword=true', async () => {
    userMock.findUnique.mockResolvedValue(null); // email available
    await createUser({ name: 'Bob', email: 'new@x.com', password: 'plain-pass' });
    expect(bcryptHash).toHaveBeenCalledWith('plain-pass', 12);
    expect(userMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mustChangePassword: true }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// changePassword
// ─────────────────────────────────────────────────────────────────────────────

describe('changePassword', () => {
  it('throws NotFound when user does not exist', async () => {
    userMock.findUnique.mockResolvedValue(null);
    await expect(changePassword('u-x', 'new-pass')).rejects.toThrow(/not found/i);
  });

  it('throws BadRequest when old password is provided but wrong', async () => {
    bcryptCompare.mockResolvedValue(false);
    await expect(changePassword('u1', 'new-pass', 'wrong-old')).rejects.toThrow(/incorrect/i);
  });

  it('updates password hash and clears mustChangePassword flag', async () => {
    await changePassword('u1', 'new-plain-pass');
    expect(bcryptHash).toHaveBeenCalledWith('new-plain-pass', 12);
    expect(userMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ passwordHash: 'hashed-pw', mustChangePassword: false }),
      }),
    );
  });

  it('invalidates all refresh tokens after password change', async () => {
    await changePassword('u1', 'new-pass');
    expect(tokenMock.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });

  it('skips old-password check when oldPassword not provided (admin reset path)', async () => {
    await changePassword('u1', 'admin-reset-pass');
    expect(bcryptCompare).not.toHaveBeenCalled();
  });
});
