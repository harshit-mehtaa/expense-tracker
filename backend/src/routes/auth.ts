import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/response';
import { requireAuth } from '../middleware/auth';
import * as authService from '../services/authService';
import { env, isDev } from '../config/env';
import prisma from '../config/prisma';

const router = Router();

// Strict rate limiting for auth routes (prevent brute force)
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { success: false, message: 'Too many attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Cookie configuration — SameSite differs by environment (plan-challenger fix #3)
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: !isDev,
  sameSite: (isDev ? 'lax' : 'strict') as 'lax' | 'strict',
  domain: env.COOKIE_DOMAIN,
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
};

// ── Validation schemas ────────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Must contain at least one number'),
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────

router.post(
  '/login',
  authRateLimit,
  asyncHandler(async (req: Request, res: Response) => {
    const body = loginSchema.parse(req.body);
    const { tokens, user } = await authService.login(body.email, body.password);

    res.cookie('refreshToken', tokens.refreshToken, COOKIE_OPTIONS);

    sendSuccess(res, {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatarUrl,
        colorTag: user.colorTag,
        mustChangePassword: user.mustChangePassword,
      },
      accessToken: tokens.accessToken,
    }, 'Login successful');
  }),
);

// ── POST /api/auth/refresh ────────────────────────────────────────────────────

router.post(
  '/refresh',
  asyncHandler(async (req: Request, res: Response) => {
    const refreshToken = req.cookies?.refreshToken as string | undefined;
    if (!refreshToken) {
      res.status(401).json({ success: false, message: 'No refresh token' });
      return;
    }

    const tokens = await authService.refreshTokens(refreshToken);

    res.cookie('refreshToken', tokens.refreshToken, COOKIE_OPTIONS);
    sendSuccess(res, { accessToken: tokens.accessToken }, 'Token refreshed');
  }),
);

// ── POST /api/auth/logout ─────────────────────────────────────────────────────

router.post(
  '/logout',
  asyncHandler(async (req: Request, res: Response) => {
    const refreshToken = req.cookies?.refreshToken as string | undefined;
    if (refreshToken) {
      await authService.logout(refreshToken);
    }

    res.clearCookie('refreshToken', { ...COOKIE_OPTIONS, maxAge: 0 });
    sendSuccess(res, null, 'Logged out successfully');
  }),
);

// ── GET /api/auth/me ──────────────────────────────────────────────────────────

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatarUrl: true,
        colorTag: true,
        panNumberMasked: true,
        mustChangePassword: true,
        lastLoginAt: true,
        isActive: true,
      },
    });

    if (!user) {
      res.status(401).json({ success: false, message: 'User not found' });
      return;
    }

    sendSuccess(res, user);
  }),
);

// ── POST /api/auth/change-password ───────────────────────────────────────────

router.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const body = changePasswordSchema.parse(req.body);
    await authService.changePassword(req.user!.userId, body.newPassword, body.oldPassword);
    sendSuccess(res, null, 'Password changed successfully');
  }),
);

export default router;
