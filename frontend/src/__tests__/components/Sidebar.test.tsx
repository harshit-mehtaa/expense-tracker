/**
 * Regression guard for the "orphan <li>" bug: NavItem always renders an <li> root,
 * and Tailwind preflight only resets list-style on ul/ol — an <li> with no list
 * ancestor keeps the browser's default disc marker. Every <li> in the sidebar must
 * have a ul/ol ancestor, or the marker silently reappears.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { Sidebar } from '@/components/layout/Sidebar';
import { renderPage } from '../support/renderPage';
import { ADMIN_USER, MEMBER_USER } from '../support/fixtures';

describe('Sidebar', () => {
  it('renders every <li> inside a <ul>/<ol> ancestor, for both roles', async () => {
    for (const user of [ADMIN_USER, MEMBER_USER]) {
      const { container, unmount } = renderPage(<Sidebar />, { user });
      await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());

      const items = container.querySelectorAll('li');
      expect(items.length).toBeGreaterThan(0);
      items.forEach((li) => {
        expect(li.closest('ul, ol')).not.toBeNull();
      });

      unmount();
    }
  });

  it('has no dedicated Gold nav item — Gold moved under the Assets tab', async () => {
    for (const user of [ADMIN_USER, MEMBER_USER]) {
      const { unmount } = renderPage(<Sidebar />, { user });
      await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());

      expect(screen.queryByRole('link', { name: /^gold$/i })).not.toBeInTheDocument();
      expect(screen.queryAllByRole('link').map((l) => l.getAttribute('href'))).not.toContain('/gold');
      expect(screen.getByRole('link', { name: /^assets$/i })).toHaveAttribute('href', '/assets');

      unmount();
    }
  });

  it('groups the navigation under section labels, each naming its own list of links', async () => {
    for (const user of [ADMIN_USER, MEMBER_USER]) {
      const { unmount } = renderPage(<Sidebar />, { user });
      await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());

      const nav = screen.getByRole('navigation', { name: 'Main' });
      const group = (name: string) => within(within(nav).getByRole('list', { name }))
        .getAllByRole('link').map((l) => l.textContent);
      expect(group('Money')).toEqual(['Transactions', 'Budgets']);
      expect(group('Wealth')).toEqual(['Accounts & Deposits', 'Investments', 'Assets']);
      expect(group('Protection & Debt')).toEqual(['Loans & EMIs', 'Insurance']);
      expect(group('Planning')).toEqual(['Tax Centre', 'Reports']);
      expect(within(nav).getByRole('link', { name: /^dashboard$/i })).toHaveAttribute('href', '/');

      unmount();
    }
  });

  it('has no Reminders, Subscriptions or Family Members items, and no Admin block', async () => {
    for (const user of [ADMIN_USER, MEMBER_USER]) {
      const { unmount } = renderPage(<Sidebar />, { user });
      await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());

      const hrefs = screen.queryAllByRole('link').map((l) => l.getAttribute('href'));
      for (const moved of ['/reminders', '/subscriptions', '/family']) expect(hrefs).not.toContain(moved);
      expect(screen.queryByText(/^admin$/i)).toBeNull();
      expect(screen.getByRole('link', { name: /^settings$/i })).toHaveAttribute('href', '/settings');

      unmount();
    }
  });

  it('keeps Transactions and Settings highlighted on their tab URLs', async () => {
    const { unmount } = renderPage(<Sidebar />, { route: '/transactions?tab=subscriptions' });
    expect(await screen.findByRole('link', { name: /^transactions$/i })).toHaveAttribute('aria-current', 'page');
    unmount();
    renderPage(<Sidebar />, { route: '/settings?tab=family' });
    expect(await screen.findByRole('link', { name: /^settings$/i })).toHaveAttribute('aria-current', 'page');
  });

  it('has no dedicated Categories nav item — Categories moved under Settings', async () => {
    for (const user of [ADMIN_USER, MEMBER_USER]) {
      const { unmount } = renderPage(<Sidebar />, { user });
      await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());

      expect(screen.queryByRole('link', { name: /^categories$/i })).not.toBeInTheDocument();
      expect(screen.queryAllByRole('link').map((l) => l.getAttribute('href'))).not.toContain('/categories');
      expect(screen.getByRole('link', { name: /^settings$/i })).toHaveAttribute('href', '/settings');

      unmount();
    }
  });

  it('has no dedicated Real Estate nav item — Real Estate moved under the Assets tab', async () => {
    for (const user of [ADMIN_USER, MEMBER_USER]) {
      const { unmount } = renderPage(<Sidebar />, { user });
      await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());

      expect(screen.queryByRole('link', { name: /real estate/i })).not.toBeInTheDocument();
      expect(screen.queryAllByRole('link').map((l) => l.getAttribute('href'))).not.toContain('/real-estate');
      expect(screen.getByRole('link', { name: /^assets$/i })).toHaveAttribute('href', '/assets');

      unmount();
    }
  });
});
