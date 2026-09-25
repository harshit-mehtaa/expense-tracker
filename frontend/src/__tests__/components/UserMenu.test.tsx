/**
 * Account menu under the header avatar: identity, Settings, Log out. Settings moved
 * here from the sidebar. Rendered with the real AuthProvider (renderPage), so every
 * test first waits for the session restore to produce a user.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, type RequestHandler } from 'msw';
import { useLocation } from 'react-router-dom';
import { UserMenu } from '@/components/layout/UserMenu';
import { renderPage, failOnConsoleError } from '../support/renderPage';
import { url } from '../support/handlers';
import { ADMIN_USER, MEMBER_USER } from '../support/fixtures';

failOnConsoleError();

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function logoutHandler(status = 200) {
  const calls: string[] = [];
  const handler = http.post(url('/auth/logout'), () => {
    calls.push('logout');
    return status === 200 ? HttpResponse.json({ success: true }) : HttpResponse.json({ message: 'Server exploded' }, { status });
  });
  return { calls, handler };
}

async function openMenu(route = '/', user = ADMIN_USER, handlers: RequestHandler[] = []) {
  const ue = userEvent.setup();
  renderPage(<><UserMenu /><LocationProbe /></>, { route, user, handlers });
  const trigger = await screen.findByRole('button', { name: `Account menu for ${user.name}` });
  await ue.click(trigger);
  await screen.findByRole('menu');
  return { ue, trigger };
}

describe('UserMenu', () => {
  it('shows who is signed in, with a human-readable role', async () => {
    await openMenu();
    const menu = screen.getByRole('menu');
    expect(menu).toHaveTextContent('Asha');
    expect(menu).toHaveTextContent('asha@example.com');
    expect(menu).toHaveTextContent('Admin');
    expect(menu).not.toHaveTextContent('ADMIN');
  });

  it('labels a member as Member', async () => {
    await openMenu('/', MEMBER_USER);
    expect(screen.getByRole('menu')).toHaveTextContent('Member');
  });

  it('offers exactly Settings and Log out', async () => {
    await openMenu();
    const items = screen.getAllByRole('menuitem').map((el) => el.textContent?.trim());
    expect(items).toEqual(['Settings', 'Log out']);
  });

  it('Settings is a real link (middle-click / open in new tab work)', async () => {
    await openMenu();
    const settings = screen.getByRole('menuitem', { name: 'Settings' });
    expect(settings.tagName).toBe('A');
    expect(settings).toHaveAttribute('href', '/settings');
  });

  it('clicking Settings navigates and closes the menu', async () => {
    const { ue } = await openMenu('/transactions');
    await ue.click(screen.getByRole('menuitem', { name: 'Settings' }));

    expect(screen.getByTestId('location')).toHaveTextContent('/settings');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('works from the keyboard: Enter opens, arrows move, Escape closes and returns focus', async () => {
    const ue = userEvent.setup();
    renderPage(<UserMenu />, { user: ADMIN_USER });
    const trigger = await screen.findByRole('button', { name: 'Account menu for Asha' });

    trigger.focus();
    await ue.keyboard('{Enter}');
    await screen.findByRole('menu');
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveFocus());

    await ue.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Log out' })).toHaveFocus();

    await ue.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('Enter on Settings navigates', async () => {
    const ue = userEvent.setup();
    renderPage(<><UserMenu /><LocationProbe /></>, { user: ADMIN_USER });
    const trigger = await screen.findByRole('button', { name: 'Account menu for Asha' });
    trigger.focus();
    await ue.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveFocus());

    await ue.keyboard('{Enter}');
    expect(screen.getByTestId('location')).toHaveTextContent('/settings');
  });

  it('marks the trigger and the Settings item as current on any /settings tab', async () => {
    const { trigger } = await openMenu('/settings?tab=categories');
    expect(trigger).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  });

  it('does not mark anything current elsewhere', async () => {
    const { trigger } = await openMenu('/transactions');
    expect(trigger).not.toHaveAttribute('data-active');
    expect(screen.getByRole('menuitem', { name: 'Settings' })).not.toHaveAttribute('aria-current');
  });

  it('Log out calls the server once and closes the menu', async () => {
    const { calls, handler } = logoutHandler();
    const { ue } = await openMenu('/', ADMIN_USER, [handler]);
    await ue.click(screen.getByRole('menuitem', { name: 'Log out' }));

    await waitFor(() => expect(calls).toEqual(['logout']));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('a failed logout still signs out locally without an unhandled rejection', async () => {
    const { calls, handler } = logoutHandler(500);
    const { ue } = await openMenu('/', ADMIN_USER, [handler]);
    await ue.click(screen.getByRole('menuitem', { name: 'Log out' }));

    await waitFor(() => expect(calls).toEqual(['logout']));
    // The session is cleared locally (AuthContext's finally), so the trigger — which
    // needs a user — goes away. failOnConsoleError + vitest's unhandled-rejection check
    // guard the "no uncaught error" half.
    await waitFor(() => expect(screen.queryByRole('button', { name: /account menu/i })).toBeNull());
  });
});
