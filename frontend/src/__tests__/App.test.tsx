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
import { screen } from '@testing-library/react';
import React from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
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

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

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
  http.get(url('/reports/spending-by-category'), () => HttpResponse.json({ data: [] })),
  http.get(url('/tax/profile'), () => HttpResponse.json({ data: { regime: 'OLD' } })),
  http.get(url('/tax/80c-tracker'), () => HttpResponse.json({ data: { limit: 150000, utilized: 0, remaining: 150000, pctUtilized: 0, breakdown: {} } })),
  http.get(url('/insurance/80d-summary'), () => HttpResponse.json({ data: { selfFamily: { paid: 0, limit: 25000, deductible: 0 }, parents: { paid: 0, limit: 25000, deductible: 0 }, total: 0, policies: [] } })),
  http.get(url('/investments/portfolio-summary'), () => HttpResponse.json({ data: { totalInvested: 0, totalCurrentValue: 0, absoluteGain: 0, absoluteReturnPct: 0, byType: {} } })),
  http.get(url('/loans'), () => HttpResponse.json({ data: [] })),
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

describe('App routing — legacy /gold redirect', () => {
  it('redirects an authenticated visitor from /gold to the Assets page\'s Gold tab', async () => {
    authState.user = ADMIN_USER;
    authState.isAuthenticated = true;
    renderPage(<App />, {
      route: '/gold',
      handlers: [
        ...shellHandlers(),
        http.get(url('/assets'), () => HttpResponse.json({ data: [] })),
        http.get(url('/investments/gold'), () => HttpResponse.json({ data: { holdings: [], summary: null } })),
      ],
    });

    expect(await screen.findByRole('heading', { level: 1, name: /^assets$/i })).toBeInTheDocument();
    expect(screen.getByText(/no gold holdings added yet/i)).toBeInTheDocument();
  });
});

describe('App routing — legacy /categories redirect', () => {
  it('redirects an authenticated visitor from /categories to the Settings page\'s Categories tab', async () => {
    authState.user = ADMIN_USER;
    authState.isAuthenticated = true;
    renderPage(<><App /><LocationProbe /></>, {
      route: '/categories',
      handlers: shellHandlers(),
    });

    expect(await screen.findByRole('heading', { level: 1, name: /^settings$/i })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/settings?tab=categories');
    expect(await screen.findByRole('button', { name: /add category/i })).toBeInTheDocument();
  });
});

describe('App routing — legacy /real-estate redirect', () => {
  it('redirects an authenticated visitor from /real-estate to the Assets page\'s Real Estate tab', async () => {
    authState.user = ADMIN_USER;
    authState.isAuthenticated = true;
    renderPage(<><App /><LocationProbe /></>, {
      route: '/real-estate',
      handlers: [
        ...shellHandlers(),
        http.get(url('/investments/real-estate'), () => HttpResponse.json({ data: { properties: [], summary: null } })),
      ],
    });

    expect(await screen.findByRole('heading', { level: 1, name: /^assets$/i })).toBeInTheDocument();
    // Not just "landed somewhere that renders Assets content" — proves the redirect
    // target is exactly /assets?tab=real-estate, not e.g. a default-tab landing that
    // happens to satisfy the h1 assertion.
    expect(screen.getByTestId('location')).toHaveTextContent('/assets?tab=real-estate');
    expect(screen.getByText(/no properties added yet/i)).toBeInTheDocument();
  });
});

describe('App routing — legacy /family redirect (Family Members is now a Settings tab)', () => {
  it('takes an ADMIN from /family to the Settings page\'s Family Members tab', async () => {
    authState.user = ADMIN_USER;
    authState.isAuthenticated = true;
    renderPage(<><App /><LocationProbe /></>, { route: '/family', handlers: shellHandlers() });

    expect(await screen.findByRole('heading', { level: 1, name: /^family members$/i })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/settings?tab=family');
  });

  it('lands a MEMBER on Settings → General, with no admin page and no admin request', async () => {
    authState.user = MEMBER_USER;
    authState.isAuthenticated = true;
    const adminRequests: string[] = [];
    renderPage(<App />, {
      route: '/family',
      handlers: [
        http.get(url('/admin/users'), ({ request }) => { adminRequests.push(request.url); return HttpResponse.json({ data: [] }); }),
        http.get(url('/investments/exchange-rates'), () => HttpResponse.json({ data: [] })), // General tab's own data
        ...shellHandlers(),
      ],
    });

    expect(await screen.findByRole('heading', { name: /profile/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^family members$/i })).toBeNull();
    expect(screen.queryByRole('tab', { name: /family/i })).toBeNull();
    expect(adminRequests).toEqual([]);
  });

  it('still sends an unauthenticated visitor to /login', async () => {
    renderPage(<App />, { route: '/family', handlers: shellHandlers() });
    expect(await screen.findByText(/Welcome back/i)).toBeInTheDocument();
  });
});

describe('App routing — legacy /subscriptions redirect (Subscriptions is now a Transactions tab)', () => {
  it('takes /subscriptions to the Transactions page\'s Subscriptions tab', async () => {
    authState.user = ADMIN_USER;
    authState.isAuthenticated = true;
    renderPage(<><App /><LocationProbe /></>, {
      route: '/subscriptions',
      handlers: [
        http.get(url('/subscriptions'), () => HttpResponse.json({ data: [] })),
        http.get(url('/transactions'), () => HttpResponse.json({ data: [], pagination: { total: 0, hasMore: false, nextCursor: null } })),
        ...shellHandlers(),
      ],
    });

    expect(await screen.findByRole('heading', { level: 1, name: /subscriptions/i })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/transactions?tab=subscriptions');
  });
});

describe('App routing — /reminders is still a page (reached from the bell and the Dashboard)', () => {
  it('renders the Reminders page', async () => {
    authState.user = ADMIN_USER;
    authState.isAuthenticated = true;
    renderPage(<><App /><LocationProbe /></>, { route: '/reminders', handlers: shellHandlers() });
    expect(await screen.findByRole('heading', { level: 1, name: /reminders/i })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/reminders');
  });
});

describe('App shell', () => {
  it('mounts the login route directly without the shell', async () => {
    renderPage(<App />, { route: '/login', handlers: shellHandlers() });
    expect(await screen.findByText(/Welcome back/i)).toBeInTheDocument();
  });
});

// ─── The ErrorBoundary wiring itself ──────────────────────────────────────────

describe('AppShell error containment', () => {
  it('wraps the routed outlet in an ErrorBoundary, so a page crash spares the shell', async () => {
    // Guards the WIRING, not the component. ErrorBoundary.test.tsx proves the boundary
    // works in isolation; this proves AppShell actually uses it. Deleting the wrapper
    // from AppShell.tsx passes every other test in the suite — verified.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    authState.user = ADMIN_USER;
    authState.isAuthenticated = true;
    authState.isLoading = false;

    function Exploding(): JSX.Element {
      throw new Error('page exploded');
    }

    renderPage(
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/boom" element={<Exploding />} />
        </Route>
      </Routes>,
      { route: '/boom', handlers: shellHandlers() },
    );

    // Fallback replaces the page...
    expect(await screen.findByText(/Something went wrong/i)).toBeInTheDocument();
    // ...and the shell's own navigation is still mounted and usable.
    expect(await screen.findByRole('navigation')).toBeInTheDocument();

    spy.mockRestore();
  });
});
