/**
 * Family Members page — smoke. Full bar applies for the loading transition
 * ("Loading members…" is distinct from the empty state).
 *
 * Bar deviation, documented: leg 4 (money) does not apply — this page renders a user
 * roster, no currency.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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

    // findBy, not getBy: the Add button is gated on isAdmin, which comes from the auth
    // session restore — a DIFFERENT async source than the users list. Awaiting only the
    // list can leave auth unresolved and the button unrendered (passed locally, failed
    // on CI's slower runner).
    await user.click(await screen.findByRole('button', { name: /add member/i }));

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

// ─── Behaviour: every mutation, asserted on what the admin sees and what is sent ─
// Assertions are on the request body and the visible result, not on React Query
// cache keys, so these do not pin the known ['family-members'] vs ['admin-users']
// key mismatch (vision.md tech debt).

type Captured = { method: string; path: string; body: unknown };

/** Records every write request; each responds as configured. */
function writeHandlers(opts: { putStatus?: number; deleteStatus?: number; message?: string } = {}) {
  const calls: Captured[] = [];
  const record = async (request: Request) => {
    const body = request.method === 'DELETE' ? undefined : await request.json();
    calls.push({ method: request.method, path: new URL(request.url).pathname, body });
  };
  const fail = (status: number) => HttpResponse.json({ message: opts.message ?? 'Failed' }, { status });
  const handlers = [
    http.post(url('/admin/users'), async ({ request }) => { await record(request); return HttpResponse.json({ data: { id: 'u-new' } }, { status: 201 }); }),
    http.post(url('/admin/users/:id/reset-password'), async ({ request }) => { await record(request); return HttpResponse.json({ data: {} }); }),
    http.put(url('/admin/users/:id'), async ({ request }) => {
      await record(request);
      return opts.putStatus ? fail(opts.putStatus) : HttpResponse.json({ data: {} });
    }),
    http.delete(url('/admin/users/:id'), async ({ request }) => {
      await record(request);
      return opts.deleteStatus ? fail(opts.deleteStatus) : HttpResponse.json({ data: {} });
    }),
  ];
  return { calls, handlers };
}

async function renderRoster(opts?: Parameters<typeof writeHandlers>[0]) {
  const user = userEvent.setup();
  const writes = writeHandlers(opts);
  renderPage(<FamilyMembersPage />, { route: '/family', handlers: [...memberHandlers(), ...writes.handlers] });
  await screen.findByText('ravi@example.com');
  return { user, calls: writes.calls };
}

async function openMenuFor(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name: `Actions for ${name}` }));
}

describe('Family Members page — add member', () => {
  it('creates a member with the entered details and closes the form', async () => {
    const { user, calls } = await renderRoster();
    await user.click(await screen.findByRole('button', { name: /add member/i }));
    const dialog = (await screen.findByRole('heading', { name: /add family member/i })).parentElement!;

    const inputs = within(dialog).getAllByRole('textbox');
    await user.type(inputs[0], 'Meera');
    await user.type(inputs[1], 'meera@example.com');
    await user.type(dialog.querySelector('input[type="password"]')!, 'TempPass#1');
    await user.click(within(dialog).getByRole('button', { name: /^add member$/i }));

    await waitFor(() => expect(screen.queryByRole('heading', { name: /add family member/i })).toBeNull());
    expect(calls).toEqual([{
      method: 'POST',
      path: '/admin/users',
      body: expect.objectContaining({ name: 'Meera', email: 'meera@example.com', password: 'TempPass#1', role: 'MEMBER' }),
    }]);
  });

  it('blocks a password shorter than 8 characters without sending anything', async () => {
    const { user, calls } = await renderRoster();
    await user.click(await screen.findByRole('button', { name: /add member/i }));
    const dialog = (await screen.findByRole('heading', { name: /add family member/i })).parentElement!;

    const inputs = within(dialog).getAllByRole('textbox');
    await user.type(inputs[0], 'Meera');
    await user.type(inputs[1], 'meera@example.com');
    await user.type(dialog.querySelector('input[type="password"]')!, 'short');
    await user.click(within(dialog).getByRole('button', { name: /^add member$/i }));

    expect(await within(dialog).findByText('Minimum 8 characters')).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('cancel closes the form', async () => {
    const { user } = await renderRoster();
    await user.click(await screen.findByRole('button', { name: /add member/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('heading', { name: /add family member/i })).toBeNull();
  });
});

describe('Family Members page — row actions', () => {
  it('Escape closes an open actions menu', async () => {
    const { user } = await renderRoster();
    await openMenuFor(user, 'Ravi');
    expect(screen.getByText('Edit Details')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByText('Edit Details')).toBeNull();
  });

  it('does not offer "Delete Member" on your own row', async () => {
    const { user } = await renderRoster();
    await openMenuFor(user, 'Asha');
    expect(screen.getByText('Edit Details')).toBeInTheDocument();
    expect(screen.queryByText('Delete Member')).toBeNull();
  });

  it('edit: prefills the member, saves the change and closes', async () => {
    const { user, calls } = await renderRoster();
    await openMenuFor(user, 'Ravi');
    await user.click(screen.getByText('Edit Details'));
    const dialog = (await screen.findByRole('heading', { name: /edit member details/i })).parentElement!;

    const name = within(dialog).getByDisplayValue('Ravi');
    await user.clear(name);
    await user.type(name, 'Ravi Kumar');
    await user.click(within(dialog).getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(screen.queryByRole('heading', { name: /edit member details/i })).toBeNull());
    expect(calls).toEqual([{
      method: 'PUT',
      path: '/admin/users/u-member',
      body: expect.objectContaining({ name: 'Ravi Kumar', email: 'ravi@example.com', role: 'MEMBER' }),
    }]);
  });

  it('edit: shows the server error inline and keeps the form open', async () => {
    const { user } = await renderRoster({ putStatus: 409, message: 'Email already in use' });
    await openMenuFor(user, 'Ravi');
    await user.click(screen.getByText('Edit Details'));
    const dialog = (await screen.findByRole('heading', { name: /edit member details/i })).parentElement!;
    await user.click(within(dialog).getByRole('button', { name: /save changes/i }));

    expect(await within(dialog).findByText('Email already in use')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /edit member details/i })).toBeInTheDocument();
  });

  it('edit: you cannot change your own role', async () => {
    const { user } = await renderRoster();
    await openMenuFor(user, 'Asha');
    await user.click(screen.getByText('Edit Details'));
    const dialog = (await screen.findByRole('heading', { name: /edit member details/i })).parentElement!;

    expect(within(dialog).getByRole('combobox')).toBeDisabled();
    expect(within(dialog).getByText('You cannot change your own role')).toBeInTheDocument();
  });

  it('activate: re-activates an inactive member', async () => {
    const { user, calls } = await renderRoster();
    await openMenuFor(user, 'Ravi');
    await user.click(screen.getByText('Activate'));

    await waitFor(() => expect(calls).toEqual([{ method: 'PUT', path: '/admin/users/u-member', body: { isActive: true } }]));
  });

  it('reset password: requires 8+ characters, then sends it and closes', async () => {
    const { user, calls } = await renderRoster();
    await openMenuFor(user, 'Ravi');
    await user.click(screen.getByText('Reset Password'));
    await screen.findByRole('heading', { name: /reset password/i });

    const submit = screen.getByRole('button', { name: /^reset password$/i });
    await user.type(screen.getByPlaceholderText(/new password/i), 'short');
    expect(submit).toBeDisabled();
    await user.type(screen.getByPlaceholderText(/new password/i), 'Enough#9');
    await user.click(submit);

    await waitFor(() => expect(screen.queryByRole('heading', { name: /reset password/i })).toBeNull());
    expect(calls).toEqual([{ method: 'POST', path: '/admin/users/u-member/reset-password', body: { password: 'shortEnough#9' } }]);
  });

  it('delete: confirms, deletes and closes', async () => {
    const { user, calls } = await renderRoster();
    await openMenuFor(user, 'Ravi');
    await user.click(screen.getByText('Delete Member'));
    const dialog = (await screen.findByRole('heading', { name: /^delete member$/i })).parentElement!;
    expect(within(dialog).getByText('Ravi')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /^delete member$/i }));

    await waitFor(() => expect(screen.queryByRole('heading', { name: /^delete member$/i })).toBeNull());
    expect(calls).toEqual([{ method: 'DELETE', path: '/admin/users/u-member', body: undefined }]);
  });

  it('delete: shows the server error inline and keeps the dialog open', async () => {
    const { user } = await renderRoster({ deleteStatus: 400, message: 'Member still owns accounts' });
    await openMenuFor(user, 'Ravi');
    await user.click(screen.getByText('Delete Member'));
    const dialog = (await screen.findByRole('heading', { name: /^delete member$/i })).parentElement!;

    await user.click(within(dialog).getByRole('button', { name: /^delete member$/i }));

    expect(await within(dialog).findByText('Member still owns accounts')).toBeInTheDocument();
  });
});
