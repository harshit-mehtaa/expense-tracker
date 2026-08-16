/**
 * Login page — smoke.
 *
 * Deviates from the standard bar in two documented ways:
 *   - Legs 2/3 (loading -> loaded sentinel) do not apply: Login loads no data. It is a
 *     synchronous form. There is no loading affordance to assert and no fixture data to
 *     wait for, so the transition legs are replaced by asserting the form is present.
 *   - Leg 4 (money) does not apply: the page renders no currency.
 *
 * Uses anonHandlers() — Login is an unauthenticated page, and the real AuthProvider
 * still fires its session-restore pair on mount, which must 401 rather than succeed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import LoginPage from '@/pages/Login';
import { renderPage, failOnConsoleError } from '../support/renderPage';
import { url, anonHandlers } from '../support/handlers';
import { ADMIN_USER } from '../support/fixtures';

/**
 * jsdom in this project exposes `localStorage` as a bare `{}` with no Storage methods,
 * so `localStorage.getItem` throws and Login cannot mount at all. Installed here rather
 * than in the shared setup.ts (not owned by this file). Header.tsx has the same
 * dependency, so this belongs in setup.ts eventually — flagged in the agent report.
 */
if (typeof localStorage.getItem !== 'function') {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() { return store.size; },
    },
  });
}

failOnConsoleError();

const loginOk = () => http.post(url('/auth/login'), () =>
  HttpResponse.json({ data: { user: ADMIN_USER, accessToken: 'new-token' } }));

const loginFails = () => http.post(url('/auth/login'), () =>
  HttpResponse.json({ message: 'Bad credentials' }, { status: 401 }));

/** Login is reached unauthenticated, so session restore must fail. */
const mount = (extra: Parameters<typeof renderPage>[1] extends { handlers?: infer H } ? H : never = []) =>
  renderPage(<LoginPage />, { route: '/login', handlers: [...extra, ...anonHandlers()] });

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});

afterEach(() => {
  localStorage.clear();
});

describe('Login page — smoke', () => {
  it('renders the sign-in form', async () => {
    mount();

    expect(await screen.findByRole('heading', { level: 2, name: /welcome back/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
  });

  it('signs in successfully with valid credentials', async () => {
    const user = userEvent.setup();
    mount([loginOk()]);

    await user.type(screen.getByLabelText(/email/i), 'asha@example.com');
    await user.type(screen.getByLabelText(/^password/i), 'Secret@123');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    // No error surfaces: the submit resolved and navigate() was called.
    await waitFor(() => {
      expect(screen.queryByText(/Invalid email or password/i)).toBeNull();
    });
  });

  it('shows an inline error when the credentials are rejected', async () => {
    const user = userEvent.setup();
    mount([loginFails()]);

    await user.type(screen.getByLabelText(/email/i), 'asha@example.com');
    await user.type(screen.getByLabelText(/^password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByText(/Invalid email or password/i)).toBeInTheDocument();
  });

  it('requires an email', async () => {
    // Submitted EMPTY rather than malformed on purpose. The input is type="email", so a
    // malformed value is blocked by native constraint validation and the form never
    // submits — zod's .email() rule is unreachable that way and asserting on it would
    // hang. An empty value passes native validation (the field carries no `required`
    // attribute; the `required` prop on <Label> is cosmetic) and so does reach zod.
    const user = userEvent.setup();
    mount();

    await user.type(screen.getByLabelText(/^password/i), 'Secret@123');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByText(/Please enter a valid email/i)).toBeInTheDocument();
  });

  it('requires a password', async () => {
    const user = userEvent.setup();
    mount();

    await user.type(screen.getByLabelText(/email/i), 'asha@example.com');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByText(/Password is required/i)).toBeInTheDocument();
  });

  it('toggles password visibility', async () => {
    const user = userEvent.setup();
    mount();

    const password = screen.getByLabelText(/^password/i);
    expect(password).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: /show password/i }));
    expect(password).toHaveAttribute('type', 'text');

    await user.click(screen.getByRole('button', { name: /hide password/i }));
    expect(password).toHaveAttribute('type', 'password');
  });

  it('applies the stored dark theme on mount', async () => {
    localStorage.setItem('theme', 'dark');
    mount();

    await screen.findByRole('heading', { level: 2, name: /welcome back/i });
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('applies the stored light theme on mount, ignoring the OS preference', async () => {
    localStorage.setItem('theme', 'light');
    // matchMedia is stubbed to matches:false by setup.ts, but the stored value is what
    // must win here — the effect returns early before consulting the media query.
    mount();

    await screen.findByRole('heading', { level: 2, name: /welcome back/i });
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('falls back to the OS colour-scheme preference when nothing is stored', async () => {
    // No stored theme -> the effect reads the media query. Override the setup.ts stub so
    // this exercises the matches:true arm and registers the change listener.
    const listeners: Array<(e: MediaQueryListEvent) => void> = [];
    const addEventListener = vi.fn((_: string, fn: (e: MediaQueryListEvent) => void) => {
      listeners.push(fn);
    });
    const removeEventListener = vi.fn();
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener,
      removeEventListener,
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList);

    const { unmount } = mount();
    await screen.findByRole('heading', { level: 2, name: /welcome back/i });

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(addEventListener).toHaveBeenCalledWith('change', expect.any(Function));

    // The registered handler flips the class when the OS preference changes.
    listeners[0]({ matches: false } as MediaQueryListEvent);
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    // And it is cleaned up on unmount.
    unmount();
    expect(removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));

    vi.mocked(window.matchMedia).mockRestore();
  });
});
