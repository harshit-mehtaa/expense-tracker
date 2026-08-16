/**
 * App routing + shell.
 *
 * This is the ONE place mocking AuthContext is the right call. The four routing
 * branches in App.tsx need a null / MEMBER / mustChangePassword user present at FIRST
 * PAINT, and the real AuthProvider can only reach those states through a contorted
 * sequence of MSW responses — the mock expresses the intent directly.
 *
 * The mock factory exports BOTH `AuthProvider` and `useAuth`, which are exactly the two
 * symbols AuthContext.tsx exports. Vitest's ESM mock proxy THROWS on access to an
 * export a factory omitted, so a partial factory fails in a way that reads like an
 * unrelated bug — that mistake has cost this project a day before.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import React from 'react';
import { http, HttpResponse } from 'msw';
import { url } from './support/handlers';
import { ADMIN_USER, MEMBER_USER } from './support/fixtures';


const authState = {
  user: null as null | typeof ADMIN_USER,
  isAuthenticated: false,
  isLoading: false,
};

vi.mock('@/contexts/AuthContext', () => ({
  // Both exports, deliberately — see the file docblock.
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({
    ...authState,
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
  }),
}));

const { renderPage, failOnConsoleError } = await import('./support/renderPage');
const { default: App } = await import('@/App');

failOnConsoleError();

beforeEach(() => {
  authState.user = null;
  authState.isAuthenticated = false;
  authState.isLoading = false;
});

/**
 * Endpoints reachable once a route renders. The MEMBER-bounce case redirects to "/",
 * which mounts the Dashboard, so its queries need handlers too — under
 * onUnhandledRequest:'error' a missing one becomes a console.error and fails the test.
 */
const shellHandlers = () => [
  http.get(url('/dashboard/summary'), () => HttpResponse.json({ data: {} })),
  http.get(url('/dashboard/cashflow'), () => HttpResponse.json({ data: [] })),
  http.get(url('/dashboard/upcoming-alerts'), () => HttpResponse.json({ data: [] })),
  http.get(url('/budgets/vs-actuals'), () => HttpResponse.json({ data: [] })),
  http.get(url('/snapshots/net-worth'), () => HttpResponse.json({ data: [] })),
  http.post(url('/snapshots/net-worth'), () => HttpResponse.json({ data: {} })),
  http.post(url('/auth/change-password'), () => HttpResponse.json({ data: {} })),
];

describe('App routing — ProtectedRoute', () => {
  it('renders a loader while auth is still resolving', () => {
    authState.isLoading = true;
    renderPage(<App />, { route: '/', handlers: shellHandlers() });

    // Synchronous: the loading branch is the first paint and would be gone by the
    // time an async query retried.
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('redirects an unauthenticated visitor to /login', async () => {
    renderPage(<App />, { route: '/', handlers: shellHandlers() });
    expect(await screen.findByText(/Welcome back/i)).toBeInTheDocument();
  });

  it('redirects a user who must change their password', async () => {
    authState.user = { ...ADMIN_USER, mustChangePassword: true };
    authState.isAuthenticated = true;
    renderPage(<App />, { route: '/', handlers: shellHandlers() });

    expect(
      await screen.findByRole('heading', { level: 1, name: /Change Password/i }),
    ).toBeInTheDocument();
  });
});

describe('App routing — AdminRoute', () => {
  it('renders a loader while auth resolves on an admin route', () => {
    authState.isLoading = true;
    renderPage(<App />, { route: '/family', handlers: shellHandlers() });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('sends an unauthenticated visitor on an admin route to /login', async () => {
    renderPage(<App />, { route: '/family', handlers: shellHandlers() });
    expect(await screen.findByText(/Welcome back/i)).toBeInTheDocument();
  });

  it('bounces a MEMBER away from an admin-only route', async () => {
    authState.user = MEMBER_USER;
    authState.isAuthenticated = true;
    renderPage(<App />, { route: '/family', handlers: shellHandlers() });

    // Redirected to "/" — the assertion that matters is that the admin page is NOT
    // reachable, rather than what the landing page happens to render.
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /Family Members/i })).toBeNull();
    });
  });
});

describe('App shell', () => {
  it('mounts the login route directly without the shell', async () => {
    renderPage(<App />, { route: '/login', handlers: shellHandlers() });
    expect(await screen.findByText(/Welcome back/i)).toBeInTheDocument();
  });
});
