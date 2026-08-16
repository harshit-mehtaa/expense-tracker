/**
 * Tests for the shared Axios instance — token attachment, the 401 refresh flow, the
 * concurrent-request queue, and the error-toast dispatch.
 *
 * This is the most consequential untested code in the frontend: a bug in the refresh
 * queue logs the whole family out, or silently drops requests that were in flight when
 * a token expired.
 *
 * api.ts keeps module-level mutable state (accessToken, isRefreshing, failedQueue).
 * `isRefreshing` resets in a finally and `failedQueue` is drained by processQueue, but
 * `accessToken` persists, so it is explicitly cleared between tests — otherwise a test
 * can pass because of the previous test's token rather than its own.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mswServer';
import api, { setAccessToken, getAccessToken } from '@/lib/api';

const BASE = 'http://localhost:3000';

let logoutListener: ReturnType<typeof vi.fn>;
let apiErrorListener: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setAccessToken(null);
  logoutListener = vi.fn();
  apiErrorListener = vi.fn();
  window.addEventListener('auth:logout', logoutListener);
  window.addEventListener('api:error', apiErrorListener);
});

afterEach(() => {
  window.removeEventListener('auth:logout', logoutListener);
  window.removeEventListener('api:error', apiErrorListener);
  setAccessToken(null);
});

/** Captured Authorization headers, in request order. */
function captureAuth(path: string, statuses: number[]) {
  const seen: (string | null)[] = [];
  let call = 0;
  server.use(
    http.get(`${BASE}${path}`, ({ request }) => {
      seen.push(request.headers.get('authorization'));
      const status = statuses[Math.min(call, statuses.length - 1)];
      call += 1;
      return status === 200
        ? HttpResponse.json({ data: 'ok' })
        : new HttpResponse(null, { status });
    }),
  );
  return seen;
}

// ─── Token storage + request interceptor ──────────────────────────────────────

describe('access token storage', () => {
  it('round-trips a token through the setter and getter', () => {
    setAccessToken('abc123');
    expect(getAccessToken()).toBe('abc123');
  });

  it('clears the token when set to null', () => {
    setAccessToken('abc123');
    setAccessToken(null);
    expect(getAccessToken()).toBeNull();
  });

  it('attaches the token as a Bearer header on every request', async () => {
    setAccessToken('tok-1');
    const seen = captureAuth('/protected', [200]);

    await api.get('/protected');

    expect(seen[0]).toBe('Bearer tok-1');
  });

  it('sends no Authorization header when there is no token', async () => {
    const seen = captureAuth('/protected', [200]);

    await api.get('/protected');

    expect(seen[0]).toBeNull();
  });
});

// ─── 401 refresh — happy path ─────────────────────────────────────────────────

describe('401 refresh flow', () => {
  it('refreshes on 401, then replays the original request with the new token', async () => {
    setAccessToken('stale');
    const seen = captureAuth('/protected', [401, 200]);
    server.use(
      http.post(`${BASE}/auth/refresh`, () =>
        HttpResponse.json({ data: { accessToken: 'fresh' } })),
    );

    const res = await api.get('/protected');

    expect(res.data).toEqual({ data: 'ok' });
    // First attempt carried the stale token; the replay carried the refreshed one.
    expect(seen).toEqual(['Bearer stale', 'Bearer fresh']);
    expect(getAccessToken()).toBe('fresh');
  });

  it('does not dispatch a logout when the refresh succeeds', async () => {
    setAccessToken('stale');
    captureAuth('/protected', [401, 200]);
    server.use(
      http.post(`${BASE}/auth/refresh`, () =>
        HttpResponse.json({ data: { accessToken: 'fresh' } })),
    );

    await api.get('/protected');

    expect(logoutListener).not.toHaveBeenCalled();
  });

  it('does not retry a second time if the replay also 401s', async () => {
    setAccessToken('stale');
    // Always 401 — but _retry guards the second pass, so refresh is called once.
    const seen = captureAuth('/protected', [401]);
    let refreshCalls = 0;
    server.use(
      http.post(`${BASE}/auth/refresh`, () => {
        refreshCalls += 1;
        return HttpResponse.json({ data: { accessToken: 'fresh' } });
      }),
    );

    await expect(api.get('/protected')).rejects.toThrow();

    expect(refreshCalls).toBe(1);
    expect(seen).toHaveLength(2); // original + one replay, then it gives up
  });
});

// ─── 401 refresh — failure path ───────────────────────────────────────────────

describe('401 refresh failure', () => {
  beforeEach(() => {
    setAccessToken('stale');
    captureAuth('/protected', [401]);
    server.use(
      http.post(`${BASE}/auth/refresh`, () => new HttpResponse(null, { status: 401 })),
    );
  });

  it('rejects the original request', async () => {
    await expect(api.get('/protected')).rejects.toThrow();
  });

  it('clears the stored token, so nothing keeps sending a dead credential', async () => {
    await api.get('/protected').catch(() => {});
    expect(getAccessToken()).toBeNull();
  });

  it('dispatches auth:logout so AuthContext can redirect to login', async () => {
    await api.get('/protected').catch(() => {});
    expect(logoutListener).toHaveBeenCalledTimes(1);
  });
});

// ─── Concurrent 401s — the queue ──────────────────────────────────────────────

describe('concurrent 401s', () => {
  it('refreshes once and replays every queued request with the new token', async () => {
    setAccessToken('stale');
    const seenA = captureAuth('/a', [401, 200]);
    const seenB = captureAuth('/b', [401, 200]);

    let refreshCalls = 0;
    server.use(
      http.post(`${BASE}/auth/refresh`, async () => {
        refreshCalls += 1;
        // Hold the refresh open so the second 401 lands while isRefreshing is true.
        await new Promise((r) => setTimeout(r, 30));
        return HttpResponse.json({ data: { accessToken: 'fresh' } });
      }),
    );

    const [resA, resB] = await Promise.all([api.get('/a'), api.get('/b')]);

    // The whole point of the queue: one refresh, not one per in-flight request.
    expect(refreshCalls).toBe(1);
    expect(resA.data).toEqual({ data: 'ok' });
    expect(resB.data).toEqual({ data: 'ok' });
    expect(seenA).toEqual(['Bearer stale', 'Bearer fresh']);
    expect(seenB).toEqual(['Bearer stale', 'Bearer fresh']);
  });

  it('rejects every queued request when the shared refresh fails', async () => {
    setAccessToken('stale');
    captureAuth('/a', [401]);
    captureAuth('/b', [401]);

    server.use(
      http.post(`${BASE}/auth/refresh`, async () => {
        await new Promise((r) => setTimeout(r, 30));
        return new HttpResponse(null, { status: 401 });
      }),
    );

    const results = await Promise.allSettled([api.get('/a'), api.get('/b')]);

    // processQueue's reject path — a queued caller must not hang forever.
    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('rejected');
    expect(logoutListener).toHaveBeenCalledTimes(1);
  });
});

// ─── Auth endpoints are never refreshed ───────────────────────────────────────

describe('auth endpoints bypass the refresh flow', () => {
  it('does not attempt a refresh when /auth/login itself 401s', async () => {
    let refreshCalls = 0;
    server.use(
      http.post(`${BASE}/auth/login`, () => new HttpResponse(null, { status: 401 })),
      http.post(`${BASE}/auth/refresh`, () => {
        refreshCalls += 1;
        return HttpResponse.json({ data: { accessToken: 'x' } });
      }),
    );

    await expect(api.post('/auth/login', {})).rejects.toThrow();

    // A stale refresh cookie must not hijack an explicit login attempt.
    expect(refreshCalls).toBe(0);
  });

  it('does not recurse when /auth/refresh itself 401s', async () => {
    let refreshCalls = 0;
    server.use(
      http.post(`${BASE}/auth/refresh`, () => {
        refreshCalls += 1;
        return new HttpResponse(null, { status: 401 });
      }),
    );

    await expect(api.post('/auth/refresh')).rejects.toThrow();

    expect(refreshCalls).toBe(1);
  });

  it('shows no error toast for a login 401 — the login page renders that itself', async () => {
    server.use(
      http.post(`${BASE}/auth/login`, () =>
        HttpResponse.json({ message: 'Bad credentials' }, { status: 401 })),
    );

    await api.post('/auth/login', {}).catch(() => {});

    expect(apiErrorListener).not.toHaveBeenCalled();
  });

  it('shows no error toast for a refresh 401 — AuthContext handles the logout', async () => {
    server.use(
      http.post(`${BASE}/auth/refresh`, () => new HttpResponse(null, { status: 401 })),
    );

    await api.post('/auth/refresh').catch(() => {});

    expect(apiErrorListener).not.toHaveBeenCalled();
  });

  it('DOES toast a non-401 failure on an auth endpoint', async () => {
    server.use(
      http.post(`${BASE}/auth/login`, () =>
        HttpResponse.json({ message: 'Rate limited' }, { status: 429 })),
    );

    await api.post('/auth/login', {}).catch(() => {});

    expect(apiErrorListener).toHaveBeenCalledTimes(1);
    const evt = apiErrorListener.mock.calls[0][0] as CustomEvent<{ message: string }>;
    expect(evt.detail.message).toBe('Rate limited');
  });
});

// ─── Error toast dispatch ─────────────────────────────────────────────────────

describe('api:error dispatch', () => {
  it('uses the server-supplied message when present', async () => {
    server.use(
      http.get(`${BASE}/boom`, () =>
        HttpResponse.json({ message: 'Server exploded' }, { status: 500 })),
    );

    await api.get('/boom').catch(() => {});

    const evt = apiErrorListener.mock.calls[0][0] as CustomEvent<{ message: string }>;
    expect(evt.detail.message).toBe('Server exploded');
  });

  it('falls back to the status code when the body carries no message', async () => {
    server.use(
      http.get(`${BASE}/boom`, () => HttpResponse.json({}, { status: 503 })),
    );

    await api.get('/boom').catch(() => {});

    const evt = apiErrorListener.mock.calls[0][0] as CustomEvent<{ message: string }>;
    expect(evt.detail.message).toBe('Request failed (503)');
  });

  it('falls back to the status code when the body is not an object', async () => {
    server.use(
      http.get(`${BASE}/boom`, () => new HttpResponse(null, { status: 418 })),
    );

    await api.get('/boom').catch(() => {});

    const evt = apiErrorListener.mock.calls[0][0] as CustomEvent<{ message: string }>;
    expect(evt.detail.message).toBe('Request failed (418)');
  });

  it('stays silent for a network error with no response — queryClient owns that case', async () => {
    server.use(
      http.get(`${BASE}/down`, () => HttpResponse.error()),
    );

    await api.get('/down').catch(() => {});

    // Dispatching here too would double-toast the user.
    expect(apiErrorListener).not.toHaveBeenCalled();
  });

  it('toasts a 404 without attempting any refresh', async () => {
    server.use(
      http.get(`${BASE}/missing`, () =>
        HttpResponse.json({ message: 'Not found' }, { status: 404 })),
    );

    await api.get('/missing').catch(() => {});

    expect(apiErrorListener).toHaveBeenCalledTimes(1);
    expect(logoutListener).not.toHaveBeenCalled();
  });
});
