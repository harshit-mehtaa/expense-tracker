/**
 * Tests for auth middleware and token helpers.
 *
 * Note: setup.ts sets JWT_SECRET and JWT_REFRESH_SECRET in process.env BEFORE
 * this file is imported (Vitest runs setupFiles first), so env.ts parses
 * successfully and the env singleton is safe to use.
 */
import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { requireAuth, requireAdmin, signAccessToken, signRefreshToken, verifyRefreshToken } from '../middleware/auth';
import { AppError } from '../utils/AppError';
import type { AuthPayload } from '../middleware/auth';

const JWT_SECRET = process.env.JWT_SECRET!;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;

const TEST_PAYLOAD: AuthPayload = {
  userId: 'cltest00000000000000000001',
  email: 'test@example.com',
  role: 'ADMIN' as any,
};

function makeReq(overrides: Record<string, any> = {}) {
  return {
    headers: {},
    user: undefined,
    ...overrides,
  } as any;
}

function makeRes() {
  return {} as any;
}

function makeNext() {
  return vi.fn();
}

// ─────────────────────────────────────────────────────────────────────────────
// requireAuth
// ─────────────────────────────────────────────────────────────────────────────

describe('requireAuth', () => {
  it('calls next(AppError 401) when Authorization header is absent', () => {
    const req = makeReq();
    const next = makeNext();
    requireAuth(req, makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(401);
  });

  it('calls next(AppError 401) when header does not start with "Bearer "', () => {
    const req = makeReq({ headers: { authorization: 'Basic abc123' } });
    const next = makeNext();
    requireAuth(req, makeRes(), next);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(401);
  });

  it('sets req.user and calls next() with no argument on valid token', () => {
    const token = jwt.sign(TEST_PAYLOAD, JWT_SECRET, { expiresIn: '15m' });
    const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
    const next = makeNext();
    requireAuth(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(); // called with no args = success
    expect(req.user).toMatchObject({
      userId: TEST_PAYLOAD.userId,
      email: TEST_PAYLOAD.email,
      role: TEST_PAYLOAD.role,
    });
  });

  it('calls next(AppError 401) with "expired" message for expired token', () => {
    const token = jwt.sign(TEST_PAYLOAD, JWT_SECRET, { expiresIn: -1 });
    const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
    const next = makeNext();
    requireAuth(req, makeRes(), next);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('Access token expired');
  });

  it('calls next(AppError 401) with "invalid" message for tampered token', () => {
    const token = 'definitely.not.a.valid.jwt';
    const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
    const next = makeNext();
    requireAuth(req, makeRes(), next);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('Invalid access token');
  });

  it('calls next(AppError 401) for token signed with wrong secret', () => {
    const token = jwt.sign(TEST_PAYLOAD, 'wrong-secret-entirely');
    const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
    const next = makeNext();
    requireAuth(req, makeRes(), next);
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// requireAdmin
// ─────────────────────────────────────────────────────────────────────────────

describe('requireAdmin', () => {
  it('calls next(AppError 401) when req.user is not set', () => {
    const req = makeReq({ user: undefined });
    const next = makeNext();
    requireAdmin(req, makeRes(), next);
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
  });

  it('calls next(AppError 403) when user role is MEMBER', () => {
    const req = makeReq({ user: { ...TEST_PAYLOAD, role: 'MEMBER' } });
    const next = makeNext();
    requireAdmin(req, makeRes(), next);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe('Admin access required');
  });

  it('calls next() with no argument when user is ADMIN', () => {
    const req = makeReq({ user: { ...TEST_PAYLOAD, role: 'ADMIN' } });
    const next = makeNext();
    requireAdmin(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// signAccessToken + signRefreshToken + verifyRefreshToken
// ─────────────────────────────────────────────────────────────────────────────

describe('signAccessToken', () => {
  it('returns a JWT that decodes with the correct payload', () => {
    const before = Math.floor(Date.now() / 1000);
    const token = signAccessToken(TEST_PAYLOAD);
    const decoded = jwt.verify(token, JWT_SECRET) as AuthPayload & { exp: number };
    expect(decoded.userId).toBe(TEST_PAYLOAD.userId);
    expect(decoded.email).toBe(TEST_PAYLOAD.email);
    expect(decoded.role).toBe(TEST_PAYLOAD.role);
    // expires in ~15 minutes — TTL measured from sign time, ±5s tolerance for slow runners
    const ttl = decoded.exp - before;
    expect(ttl).toBeGreaterThanOrEqual(895);
    expect(ttl).toBeLessThanOrEqual(900);
  });
});

describe('signRefreshToken', () => {
  it('returns a JWT that decodes with the correct payload', () => {
    const before = Math.floor(Date.now() / 1000);
    const token = signRefreshToken(TEST_PAYLOAD);
    const decoded = jwt.verify(token, JWT_REFRESH_SECRET) as AuthPayload & { exp: number };
    expect(decoded.userId).toBe(TEST_PAYLOAD.userId);
    // expires in ~7 days — TTL measured from sign time, ±5s tolerance for slow runners
    const ttl = decoded.exp - before;
    expect(ttl).toBeGreaterThanOrEqual(604795);
    expect(ttl).toBeLessThanOrEqual(604800);
  });
});

describe('verifyRefreshToken', () => {
  it('returns the payload for a valid refresh token', () => {
    const token = signRefreshToken(TEST_PAYLOAD);
    const payload = verifyRefreshToken(token);
    expect(payload.userId).toBe(TEST_PAYLOAD.userId);
  });

  it('throws AppError 401 for an invalid refresh token', () => {
    expect(() => verifyRefreshToken('garbage')).toThrow(AppError);
    expect(() => verifyRefreshToken('garbage')).toThrow(
      expect.objectContaining({ statusCode: 401 })
    );
  });

  it('throws AppError 401 for an expired refresh token', () => {
    const expired = jwt.sign(TEST_PAYLOAD, JWT_REFRESH_SECRET, { expiresIn: -1 });
    expect(() => verifyRefreshToken(expired)).toThrow(AppError);
  });
});
