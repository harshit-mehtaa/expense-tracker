/**
 * Family Members page — smoke. Full bar applies for the loading transition
 * ("Loading members…" is distinct from the empty state).
 *
 * Bar deviation, documented: leg 4 (money) does not apply — this page renders a user
 * roster, no currency.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import FamilyMembersPage from '@/pages/admin/FamilyMembers';
import { renderPage, failOnConsoleError } from '../support/renderPage';
import { url } from '../support/handlers';

failOnConsoleError();

const USERS = [
  {
    id: 'u-admin',
    name: 'Asha',
    email: 'asha@example.com',
    role: 'ADMIN',
    isActive: true,
    colorTag: null,
    mustChangePassword: false,
  },
  {
    id: 'u-member',
    name: 'Ravi',
    email: 'ravi@example.com',
    role: 'MEMBER',
    isActive: false,
    colorTag: null,
    mustChangePassword: false,
  },
];

/**
 * /admin/users is also in baseHandlers (for the member selector), but renderPage puts
 * page handlers FIRST and MSW matches in order, so this richer shape wins.
 */
const memberHandlers = (users: unknown[] = USERS) => [
  http.get(url('/admin/users'), () => HttpResponse.json({ data: users })),
];

describe('Family Members page — smoke', () => {
  it('shows loading, then renders the member roster', async () => {
    renderPage(<FamilyMembersPage />, { route: '/family', handlers: memberHandlers() });

    // Leg 2: genuine loading affordance.
    expect(screen.getByText(/Loading members/i)).toBeInTheDocument();

    // Leg 3: sentinel appears only once data lands; loading is gone.
    expect(await screen.findByText('asha@example.com')).toBeInTheDocument();
    expect(screen.queryByText(/Loading members/i)).toBeNull();
    expect(screen.getByText('ravi@example.com')).toBeInTheDocument();
  });

  it('renders the page heading', async () => {
    renderPage(<FamilyMembersPage />, { route: '/family', handlers: memberHandlers() });
    expect(
      await screen.findByRole('heading', { level: 1, name: /family members/i }),
    ).toBeInTheDocument();
  });

  it('badges each member with their role', async () => {
    renderPage(<FamilyMembersPage />, { route: '/family', handlers: memberHandlers() });
    await screen.findByText('asha@example.com');

    expect(screen.getByText('ADMIN')).toBeInTheDocument();
    expect(screen.getByText('MEMBER')).toBeInTheDocument();
  });

  it('marks a deactivated member as inactive', async () => {
    renderPage(<FamilyMembersPage />, { route: '/family', handlers: memberHandlers() });
    await screen.findByText('ravi@example.com');
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('renders the empty state when there are no members', async () => {
    renderPage(<FamilyMembersPage />, { route: '/family', handlers: memberHandlers([]) });
    expect(await screen.findByText(/No family members added yet/i)).toBeInTheDocument();
  });

  it('opens the add-member modal', async () => {
    const user = userEvent.setup();
    renderPage(<FamilyMembersPage />, { route: '/family', handlers: memberHandlers() });
    await screen.findByText('asha@example.com');

    await user.click(screen.getByRole('button', { name: /add member/i }));

    expect(await screen.findByRole('heading', { name: /add family member/i })).toBeInTheDocument();
  });

  it('surfaces an error toast when the members request fails', async () => {
    renderPage(<FamilyMembersPage />, {
      route: '/family',
      handlers: [
        http.get(url('/admin/users'), () =>
          HttpResponse.json({ message: 'Server exploded' }, { status: 500 })),
      ],
    });

    await waitFor(() => {
      expect(screen.getByText(/Server exploded/i)).toBeInTheDocument();
    });
  });
});
