/**
 * Header — notification bell dropdown.
 *
 * A pre-existing, separate consumer of the same `fetchUpcomingAlerts` data Dashboard's
 * alerts card and the Reminders page use (own query key `['dashboard','alerts']`, no
 * `viewUserId` — deliberately global/context-independent, always the logged-in user's
 * own alerts regardless of which member an admin happens to be viewing elsewhere). Added
 * here: a "View all" footer link to /reminders, for consistency now that a canonical
 * destination exists.
 *
 * Also: the account menu (UserMenu, which replaced the avatar + standalone Logout button)
 * and the dark-mode toggle that stays beside it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Header } from '@/components/layout/Header';
import { renderPage, failOnConsoleError } from './support/renderPage';
import { url } from './support/handlers';

failOnConsoleError();

const ALERTS = [
  { type: 'EMI' as const, title: 'Home loan EMI', amount: 25000, dueDate: '2025-04-05', daysUntilDue: 3, entityId: 'loan-1' },
];

describe('Header — notifications dropdown', () => {
  it('the "View all" footer link points to /reminders', async () => {
    const user = userEvent.setup();
    renderPage(<Header />, {
      route: '/',
      handlers: [http.get(url('/dashboard/upcoming-alerts'), () => HttpResponse.json({ data: ALERTS }))],
    });

    await user.click(await screen.findByRole('button', { name: /Notifications/i }));

    const link = await screen.findByRole('link', { name: /View all/i });
    expect(link).toHaveAttribute('href', '/reminders');
  });

  it('still shows the empty state and a "View all" link when there are no alerts', async () => {
    const user = userEvent.setup();
    renderPage(<Header />, {
      route: '/',
      handlers: [http.get(url('/dashboard/upcoming-alerts'), () => HttpResponse.json({ data: [] }))],
    });

    await user.click(await screen.findByRole('button', { name: /Notifications/i }));

    expect(await screen.findByText(/no upcoming alerts/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View all/i })).toHaveAttribute('href', '/reminders');
  });
});

const alertsHandler = () => http.get(url('/dashboard/upcoming-alerts'), () => HttpResponse.json({ data: ALERTS }));

describe('Header — account menu', () => {
  it('has an account menu and no standalone Logout button', async () => {
    renderPage(<Header />, { route: '/', handlers: [alertsHandler()] });
    expect(await screen.findByRole('button', { name: /account menu for asha/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^logout$/i })).toBeNull();
  });

  it('opening the account menu closes an open notifications popover', async () => {
    // Radix's trigger preventDefaults pointerdown, which suppresses the mousedown the
    // popover used to listen for — both overlays stayed open.
    const user = userEvent.setup();
    renderPage(<Header />, { route: '/', handlers: [alertsHandler()] });

    await user.click(await screen.findByRole('button', { name: /Notifications/i }));
    expect(await screen.findByText('Home loan EMI')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /account menu for asha/i }));

    await screen.findByRole('menu');
    expect(screen.queryByText('Home loan EMI')).toBeNull();
  });
});

describe('Header — dark mode toggle', () => {
  afterEach(() => {
    // setup.ts clears storage between tests but not the <html> class.
    document.documentElement.classList.remove('dark');
  });

  it('stays in the header and flips the theme', async () => {
    const user = userEvent.setup();
    renderPage(<Header />, { route: '/', handlers: [alertsHandler()] });
    const toggle = await screen.findByRole('button', { name: /toggle dark mode/i });

    await user.click(toggle);
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('theme')).toBe('dark');

    await user.click(toggle);
    expect(document.documentElement).not.toHaveClass('dark');
    expect(localStorage.getItem('theme')).toBe('light');
  });
});
