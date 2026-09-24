/**
 * The teardown drain in setup.ts depends on waitForNetworkIdle. If it regressed, the
 * failure would be silent: late requests would again leak "unhandled request" errors
 * into whichever test runs next.
 */
import { http, HttpResponse } from 'msw';
import { server, waitForNetworkIdle } from '../mswServer';

const API = 'http://localhost:3000';

describe('waitForNetworkIdle', () => {
  it('waits for a request chained on a previous response (the AuthProvider refresh → me shape)', async () => {
    const seen: string[] = [];
    server.use(
      http.post(`${API}/first`, () => { seen.push('first'); return HttpResponse.json({}); }),
      http.get(`${API}/second`, () => { seen.push('second'); return HttpResponse.json({}); }),
    );

    // Not awaited: the chain is still running when the "test body" returns.
    void fetch(`${API}/first`, { method: 'POST' }).then(() => fetch(`${API}/second`));
    await waitForNetworkIdle();

    expect(seen).toEqual(['first', 'second']);
  });

  it('gives up at the cap when a handler never resolves', async () => {
    server.use(http.get(`${API}/never`, () => new Promise<never>(() => {})));
    void fetch(`${API}/never`).catch(() => {});

    const started = Date.now();
    await waitForNetworkIdle(100);

    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('still terminates when a test left fake timers installed', async () => {
    vi.useFakeTimers();
    try {
      server.use(http.get(`${API}/never`, () => new Promise<never>(() => {})));
      void fetch(`${API}/never`).catch(() => {});
      await waitForNetworkIdle(100);
    } finally {
      vi.useRealTimers();
    }
  });
});
