/**
 * Tests for AuthContext / AuthProvider / useAuth.
 *
 * We mock @/lib/api directly (not MSW) to bypass the 401-retry interceptor
 * logic in api.ts, which would silently fire /auth/refresh for any 401 and
 * make test assertions non-deterministic.
 *
 * setAccessToken is also mocked so we can spy on token state changes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';

// ─── Mock @/lib/api ───────────────────────────────────────────────────────────
// Replace the axios instance + token helpers with vi.fn() stubs.
// This fully isolates AuthContext from the real HTTP + interceptor logic.

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockSetAccessToken = vi.fn();

vi.mock('@/lib/api', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
  setAccessToken: (...args: unknown[]) => mockSetAccessToken(...args),
  getAccessToken: vi.fn().mockReturnValue(null),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MOCK_USER = {
  id: 'u1',
  name: 'Alice',
  email: 'alice@example.com',
  role: 'ADMIN' as const,
  mustChangePassword: false,
};

function wrapper({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

/** Renders useAuth inside AuthProvider and waits for loading to settle. */
async function renderAuth() {
  const hook = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// useAuth outside provider
// ─────────────────────────────────────────────────────────────────────────────

describe('useAuth — outside provider', () => {
  it('throws when used outside AuthProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow('useAuth must be used within AuthProvider');
    spy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Session restore (useEffect on mount)
// ─────────────────────────────────────────────────────────────────────────────

describe('AuthProvider — session restore', () => {
  it('isLoading starts true before settling', () => {
    // Use a never-resolving post to keep isLoading=true
    mockPost.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.isLoading).toBe(true);
  });

  it('sets user on successful refresh + me flow', async () => {
    mockPost.mockResolvedValueOnce({ data: { data: { accessToken: 'tok-123' } } });
    mockGet.mockResolvedValueOnce({ data: { data: MOCK_USER } });

    const { result } = await renderAuth();

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.name).toBe('Alice');
    expect(mockSetAccessToken).toHaveBeenCalledWith('tok-123');
  });

  it('user is null when refresh fails', async () => {
    mockPost.mockRejectedValueOnce(new Error('401 Unauthorized'));

    const { result } = await renderAuth();

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(mockSetAccessToken).toHaveBeenCalledWith(null);
  });

  it('user is null when /auth/me fails after refresh', async () => {
    mockPost.mockResolvedValueOnce({ data: { data: { accessToken: 'tok-abc' } } });
    mockGet.mockRejectedValueOnce(new Error('401 Me failed'));

    const { result } = await renderAuth();

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it('isLoading is false after session restore resolves', async () => {
    mockPost.mockResolvedValueOnce({ data: { data: { accessToken: 'tok' } } });
    mockGet.mockResolvedValueOnce({ data: { data: MOCK_USER } });

    const { result } = await renderAuth();

    expect(result.current.isLoading).toBe(false);
  });

  it('isLoading is false even when refresh fails', async () => {
    mockPost.mockRejectedValueOnce(new Error('no session'));

    const { result } = await renderAuth();

    expect(result.current.isLoading).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// login()
// ─────────────────────────────────────────────────────────────────────────────

describe('useAuth — login()', () => {
  it('sets user and marks isAuthenticated=true after successful login', async () => {
    // Session restore fails (no prior session)
    mockPost.mockRejectedValueOnce(new Error('no session'));
    const { result } = await renderAuth();
    expect(result.current.isAuthenticated).toBe(false);

    // login
    mockPost.mockResolvedValueOnce({
      data: { data: { user: MOCK_USER, accessToken: 'new-tok' } },
    });
    await act(async () => {
      await result.current.login('alice@example.com', 'pass');
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.email).toBe('alice@example.com');
    expect(mockSetAccessToken).toHaveBeenCalledWith('new-tok');
  });

  it('propagates error when login call rejects', async () => {
    mockPost.mockRejectedValueOnce(new Error('no session')); // restore
    const { result } = await renderAuth();

    mockPost.mockRejectedValueOnce(new Error('Wrong password'));

    await expect(
      act(async () => {
        await result.current.login('alice@example.com', 'wrong');
      }),
    ).rejects.toThrow('Wrong password');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// logout()
// ─────────────────────────────────────────────────────────────────────────────

describe('useAuth — logout()', () => {
  async function renderLoggedIn() {
    // Session restore succeeds
    mockPost.mockResolvedValueOnce({ data: { data: { accessToken: 'tok' } } });
    mockGet.mockResolvedValueOnce({ data: { data: MOCK_USER } });
    const hook = await renderAuth();
    expect(hook.result.current.isAuthenticated).toBe(true);
    return hook;
  }

  it('clears user on successful logout', async () => {
    const { result } = await renderLoggedIn();
    mockPost.mockResolvedValueOnce({}); // POST /auth/logout succeeds

    await act(async () => { await result.current.logout(); });

    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
    expect(mockSetAccessToken).toHaveBeenCalledWith(null);
  });

  it('clears user even when logout server call fails (finally block)', async () => {
    const { result } = await renderLoggedIn();
    mockPost.mockRejectedValueOnce(new Error('500 Server Error'));

    // logout() uses try/finally (not try/catch/finally), so the error propagates
    // after the finally block clears state. Swallow the error here to test side effects.
    await act(async () => {
      await result.current.logout().catch(() => {});
    });

    // finally block must run: user is cleared regardless of server error
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// auth:logout window event
// ─────────────────────────────────────────────────────────────────────────────

describe('AuthProvider — auth:logout event', () => {
  it('clears user when auth:logout is dispatched on window', async () => {
    mockPost.mockResolvedValueOnce({ data: { data: { accessToken: 'tok' } } });
    mockGet.mockResolvedValueOnce({ data: { data: MOCK_USER } });
    const { result } = await renderAuth();
    expect(result.current.isAuthenticated).toBe(true);

    await act(async () => {
      window.dispatchEvent(new CustomEvent('auth:logout'));
    });

    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
    expect(mockSetAccessToken).toHaveBeenCalledWith(null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// refreshUser()
// ─────────────────────────────────────────────────────────────────────────────

describe('useAuth — refreshUser()', () => {
  it('fetches updated user from /auth/me', async () => {
    mockPost.mockResolvedValueOnce({ data: { data: { accessToken: 'tok' } } });
    mockGet.mockResolvedValueOnce({ data: { data: MOCK_USER } });
    const { result } = await renderAuth();

    const updatedUser = { ...MOCK_USER, name: 'Alice Updated' };
    mockGet.mockResolvedValueOnce({ data: { data: updatedUser } });

    await act(async () => { await result.current.refreshUser(); });

    expect(result.current.user?.name).toBe('Alice Updated');
  });

  it('clears user when /auth/me returns an error', async () => {
    mockPost.mockResolvedValueOnce({ data: { data: { accessToken: 'tok' } } });
    mockGet.mockResolvedValueOnce({ data: { data: MOCK_USER } });
    const { result } = await renderAuth();

    mockGet.mockRejectedValueOnce(new Error('401'));

    await act(async () => { await result.current.refreshUser(); });

    expect(result.current.user).toBeNull();
  });
});
