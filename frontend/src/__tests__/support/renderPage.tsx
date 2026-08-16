import React from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { RequestHandler } from 'msw';
import { server } from '../mswServer';
import { ToastProvider } from '@/contexts/ToastContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { FYProvider } from '@/contexts/FYContext';
import { baseHandlers } from './handlers';
import type { TestUser } from './fixtures';

/**
 * Mount a page inside the real provider tree.
 *
 * Deliberately uses the REAL ToastProvider / AuthProvider / FYProvider rather than
 * mocks: AuthContext's context object is not exported, so it cannot be hand-provided
 * without editing production code, and the real provider is what exercises its
 * two-request session restore and its `auth:logout` listener. Substitution happens at
 * the HTTP boundary via MSW instead.
 *
 * Provider ORDER mirrors src/main.tsx (ToastProvider outside AuthProvider). A helper
 * that reorders these is testing a tree that does not exist in production.
 *
 * ONE deliberate deviation: main.tsx wraps everything in <React.StrictMode> and this
 * does not. StrictMode double-invokes render and mount effects, which would break
 * assertions that count requests (e.g. "the snapshot POST fired exactly once"). The
 * cost is real and worth knowing: StrictMode's double render is precisely what surfaces
 * render-phase side effects, the class of bug fixed in ChangePassword.tsx this cycle.
 * Those are guarded by explicit redirect tests instead.
 */
export function renderPage(
  ui: React.ReactElement,
  opts: { route?: string; handlers?: RequestHandler[]; user?: TestUser } = {},
): RenderResult & { queryClient: QueryClient } {
  const { route = '/', handlers = [], user } = opts;

  // Page-specific handlers first so they win over baseHandlers (MSW matches in order).
  server.use(...handlers, ...baseHandlers(user));

  // A FRESH client per render, never the lib/queryClient singleton: that one has
  // staleTime 5min and retry<2, so reusing it would leak cache between tests (a later
  // test renders an earlier test's data without hitting its own handlers — an invisible
  // false green) and would make 500-path tests retry past waitFor's 1s default.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <ToastProvider>
          <AuthProvider>
            <FYProvider>{ui}</FYProvider>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return Object.assign(result, { queryClient });
}

/**
 * Fail the test if the component logged a console.error.
 *
 * React reports several serious problems this way WITHOUT throwing — hook-order
 * changes, "cannot update a component while rendering another", act() violations,
 * key warnings. Those are exactly the silent runtime failures a smoke test exists to
 * catch, so they must not be allowed to pass quietly.
 */
export function failOnConsoleError() {
  const seen: unknown[][] = [];
  let spy: { mockRestore: () => void };

  beforeEach(() => {
    seen.length = 0;
    spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      seen.push(args);
    });
  });

  afterEach(() => {
    spy.mockRestore();
    if (seen.length > 0) {
      const rendered = seen.map((a) => a.map(String).join(' ')).join('\n---\n');
      throw new Error(`Expected no console.error, got ${seen.length}:\n${rendered}`);
    }
  });
}
