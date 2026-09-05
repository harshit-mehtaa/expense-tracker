/**
 * Header — notification bell dropdown.
 *
 * A pre-existing, separate consumer of the same `fetchUpcomingAlerts` data Dashboard's
 * alerts card and the Reminders page use (own query key `['dashboard','alerts']`, no
 * `viewUserId` — deliberately global/context-independent, always the logged-in user's
 * own alerts regardless of which member an admin happens to be viewing elsewhere). Added
 * here: a "View all" footer link to /reminders, for consistency now that a canonical
 * destination exists.
 */
import { describe, it, expect } from 'vitest';
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
