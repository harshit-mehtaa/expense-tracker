import bcrypt from 'bcryptjs';
import { User } from '@prisma/client';
import prisma from '../config/prisma';
import { AppError } from '../utils/AppError';
import {
  AuthPayload,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../middleware/auth';

const BCRYPT_ROUNDS = 12;
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Validates credentials and returns a token pair + user profile.
 * Throws 401 for invalid credentials (no distinction between wrong email/password).
 */
export async function login(email: string, password: string): Promise<{ tokens: TokenPair; user: User }> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  });

  // Constant-time comparison to prevent timing attacks
  const passwordToCompare = user?.passwordHash ?? '$2b$12$invalidhashforcomparison';
  const isValid = await bcrypt.compare(password, passwordToCompare);

  if (!user || !isValid) {
    throw AppError.unauthorized('Invalid email or password');
  }

  if (!user.isActive) {
    throw AppError.forbidden('Your account has been deactivated');
  }

  const payload: AuthPayload = { userId: user.id, email: user.email, role: user.role };
  const tokens = await createTokenPair(payload);

  // Update last login timestamp
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  return { tokens, user };
}

/**
 * Rotates the refresh token.
 * Old token is invalidated; new pair issued.
 * Safe for concurrent requests: if old token not found, reject (replay protection).
 */
export async function refreshTokens(oldRefreshToken: string): Promise<TokenPair> {
  // Verify the token is cryptographically valid first
  const payload = verifyRefreshToken(oldRefreshToken);

  // Then check it exists in the database (rotation invalidation)
  const stored = await prisma.refreshToken.findUnique({
    where: { token: oldRefreshToken },
  });

  if (!stored || stored.expiresAt < new Date()) {
    // If token was already used (not found), it may be a replay attack.
    // Invalidate ALL tokens for this user as a safety measure.
    if (!stored) {
      await prisma.refreshToken.deleteMany({ where: { userId: payload.userId } });
    }
    throw AppError.unauthorized('Refresh token is invalid or expired');
  }

  // Verify user still exists and is active
  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user || !user.isActive) {
    throw AppError.unauthorized('User account is inactive');
  }

  // Delete old token and issue new pair (rotation).
  // deleteMany returns count=0 if the token was already consumed (concurrent replay).
  // Treat that as an invalid token — nuke all user tokens and reject.
  const deleted = await prisma.refreshToken.deleteMany({ where: { token: oldRefreshToken } });
  if (deleted.count === 0) {
    await prisma.refreshToken.deleteMany({ where: { userId: payload.userId } });
    throw AppError.unauthorized('Refresh token is invalid or expired');
  }

  const newPayload: AuthPayload = { userId: user.id, email: user.email, role: user.role };
  return createTokenPair(newPayload);
}

/**
 * Invalidates the refresh token (logout).
 */
export async function logout(refreshToken: string): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
}

/**
 * Creates a new user (admin-only operation).
 */
export async function createUser(data: {
  name: string;
  email: string;
  password: string;
  role?: 'ADMIN' | 'MEMBER';
  colorTag?: string;
}): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
  if (existing) {
    throw AppError.conflict('A user with this email already exists');
  }

  const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
  return prisma.user.create({
    data: {
      name: data.name,
      email: data.email.toLowerCase().trim(),
      passwordHash,
      role: data.role ?? 'MEMBER',
      colorTag: data.colorTag,
      mustChangePassword: true,
    },
  });
}

/**
 * Changes a user's password. Verifies the old password first (unless admin reset).
 */
export async function changePassword(
  userId: string,
  newPassword: string,
  oldPassword?: string,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw AppError.notFound('User');

  if (oldPassword) {
    const isValid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!isValid) throw AppError.badRequest('Current password is incorrect');
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, mustChangePassword: false },
  });

  // Invalidate all refresh tokens (force re-login on all devices)
  await prisma.refreshToken.deleteMany({ where: { userId } });
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function createTokenPair(payload: AuthPayload): Promise<TokenPair> {
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  await prisma.refreshToken.create({
    data: {
      userId: payload.userId,
      token: refreshToken,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });

  return { accessToken, refreshToken };
}
