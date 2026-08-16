/**
 * Tests for getApiBaseURL — the same-origin collapse that lets the SPA talk to
 * nginx via a relative /api path instead of an absolute cross-origin URL.
 *
 * getApiBaseURL runs once at module load, so each case needs a fresh module graph:
 * vi.resetModules() plus a dynamic import, with VITE_API_URL stubbed beforehand.
 *
 * jsdom's origin is http://localhost:3000 throughout, so the cases vary the
 * CONFIGURED value against that fixed current origin.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

/** Load a fresh copy of lib/api with VITE_API_URL stubbed, and read its baseURL. */
async function baseURLFor(configured: string | undefined): Promise<string | undefined> {
  vi.resetModules();
  if (configured === undefined) {
    vi.stubEnv('VITE_API_URL', '');
  } else {
    vi.stubEnv('VITE_API_URL', configured);
  }
  const mod = await import('@/lib/api');
  return mod.default.defaults.baseURL;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('getApiBaseURL', () => {
  it('collapses to /api when the configured URL is the same origin', async () => {
    // nginx serves the SPA and proxies /api, so a relative path avoids CORS entirely.
    expect(await baseURLFor('http://localhost:3000/api')).toBe('/api');
  });

  it('collapses to /api when a trailing slash is present on the /api path', async () => {
    expect(await baseURLFor('http://localhost:3000/api/')).toBe('/api');
  });

  it('collapses to /api across two loopback aliases on the same protocol and port', async () => {
    // 127.0.0.1 and localhost are different origins but the same machine — during
    // local dev these must not be treated as cross-origin.
    expect(await baseURLFor('http://127.0.0.1:3000/api')).toBe('/api');
  });

  it('keeps the absolute URL when the port differs, even between loopback aliases', async () => {
    expect(await baseURLFor('http://127.0.0.1:9999/api')).toBe('http://127.0.0.1:9999/api');
  });

  it('keeps the absolute URL when the protocol differs', async () => {
    expect(await baseURLFor('https://127.0.0.1:3000/api')).toBe('https://127.0.0.1:3000/api');
  });

  it('keeps the absolute URL for a genuinely remote host', async () => {
    expect(await baseURLFor('https://api.example.com/api'))
      .toBe('https://api.example.com/api');
  });

  it('keeps the absolute URL when the path is not /api', async () => {
    // Only the exact /api mount collapses; anything else is a deliberate override.
    expect(await baseURLFor('http://localhost:3000/v2')).toBe('http://localhost:3000/v2');
  });

  it('keeps the absolute URL for a nested path under the same origin', async () => {
    expect(await baseURLFor('http://localhost:3000/api/v2'))
      .toBe('http://localhost:3000/api/v2');
  });

  it('falls back to the configured value when URL parsing throws', async () => {
    // An unparseable value must not crash module load — the app still boots and the
    // request simply fails later with a clear network error.
    const malformed = 'http://[';
    expect(await baseURLFor(malformed)).toBe(malformed);
  });

  it('returns the empty configured value untouched when nothing is set', async () => {
    // Documents current behaviour: the `!configured` guard returns early, and
    // `'' ?? '/api'` yields '' because ?? only catches null/undefined.
    expect(await baseURLFor('')).toBe('');
  });
});
