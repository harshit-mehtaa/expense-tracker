/**
 * Auth middleware stub for route tests.
 * Injects a test user into req.user so protected routes work without a real JWT.
 *
 * Usage:
 *   vi.mock('../../middleware/auth', () => mockAuthMiddleware())
 *   vi.mock('../../middleware/auth', () => mockAuthMiddleware({ role: 'MEMBER' }))
 */

interface TestUser {
  userId?: string;
  email?: string;
  role?: 'ADMIN' | 'MEMBER';
}

export function mockAuthMiddleware(user: TestUser = {}) {
  const testUser = {
    userId: user.userId ?? 'test-user-id',
    email: user.email ?? 'test@example.com',
    role: user.role ?? 'ADMIN',
  };

  return {
    requireAuth: (req: any, _res: any, next: any) => {
      req.user = testUser;
      next();
    },
    requireAdmin: (_req: any, _res: any, next: any) => next(),
    signAccessToken: vi.fn(),
    signRefreshToken: vi.fn(),
    verifyRefreshToken: vi.fn(),
  };
}
