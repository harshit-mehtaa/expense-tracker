import { setupServer } from 'msw/node';

export const server = setupServer();

// ── In-flight tracking ────────────────────────────────────────────────────────
// A test can finish while a request chain it started is still running — e.g.
// AuthProvider's session restore sends GET /auth/me only after POST /auth/refresh
// resolves. If setup.ts reset the handlers at that moment, the late request would hit
// no handler and MSW's "unhandled request" error would surface in the NEXT test, whose
// failOnConsoleError then blames it for a request it never made.
//
// Tracked by requestId with a per-test clearInFlight(), not a bare counter, so a request
// that never emits request:end cannot wedge every later teardown. In msw 2.13's
// setupServer path (core/experimental/frames/http-frame) that is a handler throwing
// (lookupError); older/legacy paths skip it on more branches. The Set keeps this robust
// to msw internals rather than depending on which ones apply.
const inFlight = new Set<string>();
server.events.on('request:start', ({ requestId }) => { inFlight.add(requestId); });
server.events.on('request:end', ({ requestId }) => { inFlight.delete(requestId); });
server.events.on('unhandledException', ({ requestId }) => { inFlight.delete(requestId); });

/** Forget every tracked request — called once per test, after the drain. */
export function clearInFlight(): void {
  inFlight.clear();
}

// Real timers captured at module load (setup.ts imports this before any test runs):
// vi.useFakeTimers() replaces setTimeout AND Date.now by default in Vitest 3, and a test
// that leaves fakes installed would otherwise make this loop never tick — every afterEach
// would hang until hookTimeout.
const realSetTimeout = globalThis.setTimeout.bind(globalThis);
const realNow = Date.now.bind(Date);
const macrotask = () => new Promise<void>((resolve) => { realSetTimeout(resolve, 0); });

/**
 * Resolves once no request has been in flight for two consecutive macrotasks — long
 * enough for a follow-up request chained on the previous response to start. Capped so a
 * handler that deliberately never resolves (loading-state tests) cannot hang teardown.
 */
export async function waitForNetworkIdle(maxMs = 250): Promise<void> {
  const deadline = realNow() + maxMs;
  let quietTicks = 0;
  while (quietTicks < 2 && realNow() < deadline) {
    await macrotask();
    quietTicks = inFlight.size === 0 ? quietTicks + 1 : 0;
  }
}
