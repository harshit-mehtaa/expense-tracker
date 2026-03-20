import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import { Role } from '@prisma/client';

export interface AuthPayload {
  userId: string;
  email: string;
  role: Role;
}

// Augment Express Request to carry the auth payload
declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

/**
 * Verifies the JWT access token from the Authorization header.
 * Attaches the decoded payload to req.user.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next(AppError.unauthorized('Missing or invalid Authorization header'));
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as AuthPayload;
    req.user = payload;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return next(AppError.unauthorized('Access token expired'));
    }
    return next(AppError.unauthorized('Invalid access token'));
  }
}

/**
 * Middleware that requires Admin role.
 * Must be used AFTER requireAuth.
 */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(AppError.unauthorized());
  if (req.user.role !== Role.ADMIN) {
    return next(AppError.forbidden('Admin access required'));
  }
  next();
}

/**
 * Generates a new access token (15 minutes).
 */
export function signAccessToken(payload: AuthPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '15m' });
}

/**
 * Generates a new refresh token (7 days).
 */
export function signRefreshToken(payload: AuthPayload): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: '7d' });
}

/**
 * Verifies a refresh token and returns the payload.
 */
export function verifyRefreshToken(token: string): AuthPayload {
  try {
    return jwt.verify(token, env.JWT_REFRESH_SECRET) as AuthPayload;
  } catch {
    throw AppError.unauthorized('Invalid or expired refresh token');
  }
}
