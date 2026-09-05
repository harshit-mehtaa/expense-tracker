/**
 * Reminders page — the full, unbounded "View all" destination for Dashboard's
 * "Upcoming This Month" alerts card, which truncates to 5. Reuses the exact
 * `fetchUpcomingAlerts` query key Dashboard uses (`['dashboard','alerts', viewUserId]`)
 * — the query-key-prefix test below pins this via `queryClient.getQueryData`, since RTL
 * renders each test with a fresh QueryClient and can't observe real cross-page cache
 * sharing directly; a typo'd key would still pass every other test here while silently
 * defeating cache sharing in production.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import RemindersPage, { ALERT_TYPE_ROUTE } from '@/pages/Reminders';
import { renderPage, failOnConsoleError } from '../support/renderPage';
import { url } from '../support/handlers';
import { MEMBER_USER } from '../support/fixtures';

failOnConsoleError();

const ALERTS = [
  { type: 'EMI' as const, title: 'Home loan EMI', amount: 25000, dueDate: '2025-04-05', daysUntilDue: 3, entityId: 'loan-1' },
  { type: 'SIP' as const, title: 'Mutual fund SIP', amount: 5000, dueDate: '2025-04-06', daysUntilDue: 4, entityId: 'sip-1' },
  { type: 'FD_MATURITY' as const, title: 'FD maturing', amount: 100000, dueDate: '2025-04-10', daysUntilDue: 8, entityId: 'fd-1' },
  { type: 'RD_MATURITY' as const, title: 'RD maturing', amount: 50000, dueDate: '2025-04-10', daysUntilDue: 8, entityId: 'rd-1' },
  { type: 'INSURANCE_PREMIUM' as const, title: 'Health insurance premium', amount: 12000, dueDate: '2025-04-12', daysUntilDue: 10, entityId: 'pol-1' },
  { type: 'SUBSCRIPTION_TRIAL' as const, title: 'Netflix trial ending', dueDate: '2025-04-13', daysUntilDue: 11, entityId: 'sub-1' },
  { type: 'SUBSCRIPTION_RENEWAL' as const, title: 'Spotify renewal', amount: 199, dueDate: '2025-04-14', daysUntilDue: 12, entityId: 'sub-2' },
  { type: 'ADVANCE_TAX' as const, title: 'Advance tax Q1', amount: 15000, dueDate: '2025-06-15', daysUntilDue: 60, entityId: 'atax-1' },
  { type: 'BUDGET_ALERT' as const, title: 'Food budget 90% used', dueDate: '2025-04-30', daysUntilDue: 20, entityId: 'budget-1' },
];

const remindersHandlers = (data: unknown = ALERTS) => [
  http.get(url('/dashboard/upcoming-alerts'), () => HttpResponse.json({ data })),
];

describe('Reminders page — smoke', () => {
  it('shows loading, then renders all 9 alerts, in the exact order the backend provides (no client re-sort)', async () => {
    renderPage(<RemindersPage />, { route: '/reminders', handlers: remindersHandlers() });

    expect(screen.getByRole('status')).toBeInTheDocument();

    expect(await screen.findByText('Home loan EMI')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();

    // All 9 rows render, not just 5 — the whole point of this page vs. Dashboard's card.
    // ALERTS is deliberately NOT sorted by daysUntilDue (60 appears before 20) — if
    // Reminders.tsx ever added a client-side `.sort()`, this would catch it, unlike
    // just checking every title is present somewhere on the page.
    const renderedTitles = screen.getAllByRole('link').map((el) => el.querySelector('p')?.textContent);
    expect(renderedTitles).toEqual(ALERTS.map((a) => a.title));
  });

  it('shares Dashboard\'s exact query key (cache is really shared, not just coincidentally identical requests)', async () => {
    const { queryClient } = renderPage(<RemindersPage />, { route: '/reminders', handlers: remindersHandlers() });
    await screen.findByText('Home loan EMI');

    // A typo'd key (e.g. ['dashboard','reminders',...]) would pass every other test in
    // this file while silently defeating cache sharing with Dashboard.tsx in production.
    expect(queryClient.getQueryData(['dashboard', 'alerts', undefined])).toEqual(ALERTS);
  });

  it('renders the page heading', async () => {
    renderPage(<RemindersPage />, { route: '/reminders', handlers: remindersHandlers() });
    expect(await screen.findByRole('heading', { level: 1, name: /reminders/i })).toBeInTheDocument();
  });

  it('every alert type in the fixture has a mapped route, and vice versa', () => {
    // Guards against the fixture and ALERT_TYPE_ROUTE silently drifting apart — a type
    // present in one but not the other would make the it.each below under-cover without
    // any test failing to say so.
    expect(new Set(ALERTS.map((a) => a.type))).toEqual(new Set(Object.keys(ALERT_TYPE_ROUTE)));
  });

  it.each(Object.entries(ALERT_TYPE_ROUTE))('links a %s alert to %s', async (type, expectedHref) => {
    renderPage(<RemindersPage />, { route: '/reminders', handlers: remindersHandlers() });
    await screen.findByText('Home loan EMI');

    const alert = ALERTS.find((a) => a.type === type)!;
    const link = screen.getByText(alert.title).closest('a');
    expect(link).toHaveAttribute('href', expectedHref);
  });

  it('renders "Due today" / "Due tomorrow" phrasing, not "Due in 0/1 days"', async () => {
    renderPage(<RemindersPage />, {
      route: '/reminders',
      handlers: remindersHandlers([
        { type: 'EMI', title: 'Due today alert', amount: 100, dueDate: '2025-04-01', daysUntilDue: 0, entityId: 'e1' },
        { type: 'EMI', title: 'Due tomorrow alert', amount: 100, dueDate: '2025-04-02', daysUntilDue: 1, entityId: 'e2' },
      ]),
    });

    const todayRow = (await screen.findByText('Due today alert')).closest('a') as HTMLElement;
    expect(within(todayRow).getByText('Due today')).toBeInTheDocument();
    const tomorrowRow = screen.getByText('Due tomorrow alert').closest('a') as HTMLElement;
    expect(within(tomorrowRow).getByText('Due tomorrow')).toBeInTheDocument();
  });

  it('renders a row without an amount when alert.amount is absent, no NaN/undefined', async () => {
    renderPage(<RemindersPage />, {
      route: '/reminders',
      handlers: remindersHandlers([
        { type: 'SUBSCRIPTION_TRIAL', title: 'No-amount alert', dueDate: '2025-04-05', daysUntilDue: 3, entityId: 'e1' },
      ]),
    });

    const row = (await screen.findByText('No-amount alert')).closest('a') as HTMLElement;
    expect(within(row).queryByText(/NaN|undefined/i)).toBeNull();
  });

  it('renders a friendly empty state when there are no alerts', async () => {
    renderPage(<RemindersPage />, { route: '/reminders', handlers: remindersHandlers([]) });
    expect(await screen.findByText(/nothing due soon/i)).toBeInTheDocument();
  });

  it('shows an explicit failure message on a fetch error, not a silent empty state', async () => {
    renderPage(<RemindersPage />, {
      route: '/reminders',
      handlers: [http.get(url('/dashboard/upcoming-alerts'), () => HttpResponse.json({ message: 'boom' }, { status: 500 }))],
    });

    await waitFor(() => {
      expect(screen.getByText(/failed to load reminders/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/nothing due soon/i)).toBeNull();
  });

  it('an ADMIN can switch member and the query refetches with targetUserId', async () => {
    const user = userEvent.setup();
    const seenTargetUserIds: (string | null)[] = [];
    renderPage(<RemindersPage />, {
      route: '/reminders',
      handlers: [
        http.get(url('/dashboard/upcoming-alerts'), ({ request }) => {
          seenTargetUserIds.push(new URL(request.url).searchParams.get('targetUserId'));
          return HttpResponse.json({ data: ALERTS });
        }),
      ],
    });
    await screen.findByText('Home loan EMI');

    const select = await screen.findByLabelText(/View:/i) as HTMLSelectElement;
    await user.selectOptions(select, 'u-member');
    await waitFor(() => expect(select.value).toBe('u-member'));

    await waitFor(() => expect(seenTargetUserIds).toContain('u-member'));
  });

  it('a MEMBER sees no member selector', async () => {
    renderPage(<RemindersPage />, { route: '/reminders', handlers: remindersHandlers(), user: MEMBER_USER });
    await screen.findByText('Home loan EMI');
    expect(screen.queryByLabelText(/View:/i)).toBeNull();
  });
});
