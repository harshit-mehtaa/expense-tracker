/**
 * Route integration tests for /api/auth.
 * All external dependencies are mocked — no DB, no real tokens.
 * express-rate-limit is mocked to bypass the 20-req/15min in-memory store.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';

// ── Bypass rate limiting before importing the router ─────────────────────────
vi.mock('express-rate-limit', () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
  rateLimit: () => (_req: any, _res: any, next: any) => next(),
}));

// ── Mock auth middleware ──────────────────────────────────────────────────────
const TEST_USER = { userId: 'test-user-id', email: 'test@example.com', role: 'ADMIN' as const };
vi.mock('../../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = TEST_USER; next(); },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

// ── Mock authService ──────────────────────────────────────────────────────────
vi.mock('../../services/authService', () => ({
  login: vi.fn(),
  refreshTokens: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
}));

// ── Mock prisma (auth.ts uses default import for /me endpoint) ────────────────
vi.mock('../../config/prisma', () => {
  const prisma = { user: { findUnique: vi.fn() } };
  return { default: prisma, prisma };
});

// ── Imports after mocks ───────────────────────────────────────────────────────
import authRouter from '../../routes/auth';
import * as authService from '../../services/authService';
import prisma from '../../config/prisma';
import { env } from '../../config/env';
import { errorHandler } from '../../middleware/errorHandler';

const findUniqueMock = (prisma as any).user.findUnique as ReturnType<typeof vi.fn>;
const loginMock = authService.login as ReturnType<typeof vi.fn>;
const refreshMock = authService.refreshTokens as ReturnType<typeof vi.fn>;
const logoutMock = authService.logout as ReturnType<typeof vi.fn>;
const changePasswordMock = authService.changePassword as ReturnType<typeof vi.fn>;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  const VALID_BODY = { email: 'user@example.com', password: 'secret' };
  const MOCK_RESPONSE = {
    tokens: { accessToken: 'access-tok', refreshToken: 'refresh-tok' },
    user: { id: 'u1', name: 'Alice', email: 'user@example.com', role: 'MEMBER', avatarUrl: null, colorTag: '#aaa', mustChangePassword: false },
  };

  it('returns 200 and sets refresh cookie on valid credentials', async () => {
    loginMock.mockResolvedValue(MOCK_RESPONSE);
    const res = await request(makeApp()).post('/api/auth/login').send(VALID_BODY);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBe('access-tok');
    expect(res.body.data.user.email).toBe('user@example.com');
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('calls authService.login with email and password', async () => {
    loginMock.mockResolvedValue(MOCK_RESPONSE);
    await request(makeApp()).post('/api/auth/login').send(VALID_BODY);
    expect(loginMock).toHaveBeenCalledWith('user@example.com', 'secret');
  });

  it('returns 422 when email is missing', async () => {
    const res = await request(makeApp()).post('/api/auth/login').send({ password: 'secret' });
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('returns 422 when email is invalid', async () => {
    const res = await request(makeApp()).post('/api/auth/login').send({ email: 'not-an-email', password: 'x' });
    expect(res.status).toBe(422);
  });

  it('propagates AppError from authService (e.g. wrong password → 401)', async () => {
    const { AppError } = await import('../../utils/AppError');
    loginMock.mockRejectedValue(AppError.unauthorized('Invalid credentials'));
    const res = await request(makeApp()).post('/api/auth/login').send(VALID_BODY);
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────

describe('POST /api/auth/refresh', () => {
  it('returns 401 when no refresh cookie is present', async () => {
    const res = await request(makeApp()).post('/api/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/refresh token/i);
  });

  it('returns 200 and new accessToken when cookie is valid', async () => {
    refreshMock.mockResolvedValue({ accessToken: 'new-access', refreshToken: 'new-refresh' });
    const res = await request(makeApp())
      .post('/api/auth/refresh')
      .set('Cookie', 'refreshToken=valid-token');
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBe('new-access');
  });

  it('calls authService.refreshTokens with the cookie value', async () => {
    refreshMock.mockResolvedValue({ accessToken: 'a', refreshToken: 'b' });
    await request(makeApp())
      .post('/api/auth/refresh')
      .set('Cookie', 'refreshToken=my-token');
    expect(refreshMock).toHaveBeenCalledWith('my-token');
  });
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  it('returns 200 and clears cookie when refresh token present', async () => {
    logoutMock.mockResolvedValue(undefined);
    const res = await request(makeApp())
      .post('/api/auth/logout')
      .set('Cookie', 'refreshToken=tok');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(logoutMock).toHaveBeenCalledWith('tok');
  });

  it('returns 200 even when no refresh cookie is present', async () => {
    const res = await request(makeApp()).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(logoutMock).not.toHaveBeenCalled();
  });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

describe('GET /api/auth/me', () => {
  const MOCK_USER = { id: 'u1', name: 'Alice', email: 'a@b.com', role: 'ADMIN', avatarUrl: null, colorTag: '#aaa', panNumberMasked: null, mustChangePassword: false, lastLoginAt: null, isActive: true };

  it('returns 200 with user data when user exists', async () => {
    findUniqueMock.mockResolvedValue(MOCK_USER);
    const res = await request(makeApp()).get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('a@b.com');
  });

  it('returns 401 when user is not found in DB', async () => {
    findUniqueMock.mockResolvedValue(null);
    const res = await request(makeApp()).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/user not found/i);
  });
});

// ─── POST /api/auth/change-password ──────────────────────────────────────────

describe('POST /api/auth/change-password', () => {
  const VALID_BODY = { oldPassword: 'OldPass1', newPassword: 'NewPass1' };

  it('returns 200 on success', async () => {
    changePasswordMock.mockResolvedValue(undefined);
    const res = await request(makeApp()).post('/api/auth/change-password').send(VALID_BODY);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/password changed/i);
  });

  it('returns 422 when newPassword is too short', async () => {
    const res = await request(makeApp())
      .post('/api/auth/change-password')
      .send({ oldPassword: 'Old1', newPassword: 'short' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when newPassword has no uppercase letter', async () => {
    const res = await request(makeApp())
      .post('/api/auth/change-password')
      .send({ oldPassword: 'Old1', newPassword: 'nouppercase1' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when newPassword has no number', async () => {
    const res = await request(makeApp())
      .post('/api/auth/change-password')
      .send({ oldPassword: 'Old1', newPassword: 'NoNumberHere' });
    expect(res.status).toBe(422);
  });

  it('calls authService.changePassword with userId, newPassword, oldPassword', async () => {
    changePasswordMock.mockResolvedValue(undefined);
    await request(makeApp()).post('/api/auth/change-password').send(VALID_BODY);
    expect(changePasswordMock).toHaveBeenCalledWith('test-user-id', 'NewPass1', 'OldPass1');
  });
});

// ─── Refresh-cookie domain scoping ────────────────────────────────────────────

/**
 * getCookieOptions reads env.COOKIE_DOMAIN at CALL time (not module-load time), so
 * these cases mutate the live env object and restore it afterwards rather than
 * needing a separate file with its own hoisted vi.mock.
 *
 * The Host header matters too: the domain is only attached when BOTH the configured
 * domain and the request host are non-local, so a cookie issued over localhost is
 * never scoped to a parent domain.
 */
describe('refresh cookie Domain attribute', () => {
  const ORIGINAL_COOKIE_DOMAIN = env.COOKIE_DOMAIN;
  const MOCK_RESPONSE = {
    tokens: { accessToken: 'access-tok', refreshToken: 'refresh-tok' },
    user: { id: 'u1', name: 'Alice', email: 'user@example.com', role: 'MEMBER', avatarUrl: null, colorTag: '#aaa', mustChangePassword: false },
  };

  beforeEach(() => {
    loginMock.mockResolvedValue(MOCK_RESPONSE);
  });

  afterEach(() => {
    env.COOKIE_DOMAIN = ORIGINAL_COOKIE_DOMAIN;
  });

  async function loginFrom(host: string) {
    const res = await request(makeApp())
      .post('/api/auth/login')
      .set('Host', host)
      .send({ email: 'user@example.com', password: 'secret' });
    expect(res.status).toBe(200);
    return String(res.headers['set-cookie']);
  }

  it('sets Domain when both the configured domain and the request host are non-local', async () => {
    env.COOKIE_DOMAIN = 'example.com';
    expect(await loginFrom('app.example.com')).toContain('Domain=example.com');
  });

  it('trims surrounding whitespace off the configured domain', async () => {
    env.COOKIE_DOMAIN = '  example.com  ';
    expect(await loginFrom('app.example.com')).toContain('Domain=example.com');
  });

  it('omits Domain when COOKIE_DOMAIN is blank', async () => {
    env.COOKIE_DOMAIN = '';
    expect(await loginFrom('app.example.com')).not.toContain('Domain=');
  });

  it('omits Domain when the configured domain is itself a local host', async () => {
    env.COOKIE_DOMAIN = 'localhost';
    expect(await loginFrom('app.example.com')).not.toContain('Domain=');
  });

  it('omits Domain when the request arrives over a local host', async () => {
    env.COOKIE_DOMAIN = 'example.com';
    expect(await loginFrom('localhost')).not.toContain('Domain=');
  });

  it('strips IPv6 brackets from the request host before the local-host check', async () => {
    // req.hostname yields "[::1]" for an IPv6 literal; the bracket-strip is what lets
    // "::1" match LOCAL_COOKIE_HOSTS and suppress the Domain attribute.
    env.COOKIE_DOMAIN = 'example.com';
    expect(await loginFrom('[::1]')).not.toContain('Domain=');
  });
});
