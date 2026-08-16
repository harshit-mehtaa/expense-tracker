/**
 * ChangePassword page — smoke.
 *
 * Deviates from the standard bar in two documented ways:
 *   - Legs 2/3 (loading -> loaded sentinel) do not apply: the page loads no data of its
 *     own. It gates on AuthContext's session restore, so the transition asserted here is
 *     auth-resolving rather than a data fetch.
 *   - Leg 4 (money) does not apply: the page renders no currency.
 *
 * Query note: the <Label> elements carry no htmlFor and the <Input>s no id, so
 * getByLabelText cannot associate them. The three password fields are therefore
 * selected positionally, which is what the DOM actually offers.
 */
import { describe, it, expect } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import ChangePasswordPage from '@/pages/ChangePassword';
import { renderPage, failOnConsoleError } from '../support/renderPage';
import { url, anonHandlers } from '../support/handlers';

failOnConsoleError();

const changeFails = (message = 'Current password is incorrect') =>
  http.post(url('/auth/change-password'), () =>
    HttpResponse.json({ message }, { status: 400 }));

function fields() {
  const inputs = document.querySelectorAll<HTMLInputElement>('input[type="password"]');
  return { current: inputs[0], next: inputs[1], confirm: inputs[2] };
}

async function mounted() {
  return screen.findByRole('heading', { level: 1, name: /change password/i });
}

/**
 * Text of the inline error paragraphs only.
 *
 * Needed because a bare getByText is ambiguous twice over: <Label required> renders
 * sr-only "Required" text on all three fields, and a rejected request ALSO surfaces its
 * message through the global error toast. Scoping to the destructive paragraphs asserts
 * the page's own inline error, which is the thing under test.
 */
function inlineErrors(): string[] {
  return [...document.querySelectorAll('p.text-destructive')].map((e) => e.textContent ?? '');
}

async function expectInlineError(pattern: RegExp) {
  await waitFor(() => {
    expect(inlineErrors().some((t) => pattern.test(t))).toBe(true);
  });
}

describe('ChangePassword page — smoke', () => {
  it('renders the three password fields once the session resolves', async () => {
    renderPage(<ChangePasswordPage />, { route: '/change-password' });
    await mounted();

    const { current, next, confirm } = fields();
    expect(current).toBeInTheDocument();
    expect(next).toBeInTheDocument();
    expect(confirm).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /change password/i })).toBeInTheDocument();
  });

  it('posts oldPassword/newPassword on submit, then logs out', async () => {
    // /auth/logout resolves normally. It used to be held permanently pending, because
    // the page called navigate() during the RENDER phase — logout() clearing the user
    // re-rendered into that branch, which navigated during render, which re-rendered,
    // spinning forever and hanging the vitest worker. That is fixed (the page now
    // returns <Navigate/>), so the success path can run to completion, and the
    // redirect-when-unauthenticated case below is what keeps the fix honest.
    const user = userEvent.setup();
    let body: unknown;
    let logoutCalled = false;

    renderPage(<ChangePasswordPage />, {
      route: '/change-password',
      handlers: [
        http.post(url('/auth/change-password'), async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ data: { ok: true } });
        }),
        http.post(url('/auth/logout'), () => {
          logoutCalled = true;
          return HttpResponse.json({ data: { ok: true } });
        }),
      ],
    });
    await mounted();

    const { current, next, confirm } = fields();
    await user.type(current, 'OldPass@1');
    await user.type(next, 'NewPass@1');
    await user.type(confirm, 'NewPass@1');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    // The field names are remapped on the way out — currentPassword -> oldPassword.
    await waitFor(() => {
      expect(body).toEqual({ oldPassword: 'OldPass@1', newPassword: 'NewPass@1' });
    });
    await waitFor(() => expect(logoutCalled).toBe(true));
  });

  it('surfaces the server message when the change is rejected', async () => {
    const user = userEvent.setup();
    renderPage(<ChangePasswordPage />, {
      route: '/change-password',
      handlers: [changeFails()],
    });
    await mounted();

    const { current, next, confirm } = fields();
    await user.type(current, 'WrongOld@1');
    await user.type(next, 'NewPass@1');
    await user.type(confirm, 'NewPass@1');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    await expectInlineError(/Current password is incorrect/i);
  });

  it('falls back to a generic message when the server sends no message', async () => {
    const user = userEvent.setup();
    renderPage(<ChangePasswordPage />, {
      route: '/change-password',
      handlers: [
        http.post(url('/auth/change-password'), () => new HttpResponse(null, { status: 500 })),
      ],
    });
    await mounted();

    const { current, next, confirm } = fields();
    await user.type(current, 'OldPass@1');
    await user.type(next, 'NewPass@1');
    await user.type(confirm, 'NewPass@1');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    await expectInlineError(/Failed to change password/i);
  });

  it('rejects a new password shorter than 8 characters', async () => {
    const user = userEvent.setup();
    renderPage(<ChangePasswordPage />, { route: '/change-password' });
    await mounted();

    const { current, next, confirm } = fields();
    await user.type(current, 'OldPass@1');
    await user.type(next, 'Ab1');
    await user.type(confirm, 'Ab1');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    await expectInlineError(/Must be at least 8 characters/i);
  });

  it('requires an uppercase letter in the new password', async () => {
    const user = userEvent.setup();
    renderPage(<ChangePasswordPage />, { route: '/change-password' });
    await mounted();

    const { current, next, confirm } = fields();
    await user.type(current, 'OldPass@1');
    await user.type(next, 'lowercase1');
    await user.type(confirm, 'lowercase1');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    await expectInlineError(/Must contain an uppercase letter/i);
  });

  it('requires a digit in the new password', async () => {
    const user = userEvent.setup();
    renderPage(<ChangePasswordPage />, { route: '/change-password' });
    await mounted();

    const { current, next, confirm } = fields();
    await user.type(current, 'OldPass@1');
    await user.type(next, 'NoDigitsHere');
    await user.type(confirm, 'NoDigitsHere');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    await expectInlineError(/Must contain a number/i);
  });

  it('rejects a mismatched confirmation', async () => {
    const user = userEvent.setup();
    renderPage(<ChangePasswordPage />, { route: '/change-password' });
    await mounted();

    const { current, next, confirm } = fields();
    await user.type(current, 'OldPass@1');
    await user.type(next, 'NewPass@1');
    await user.type(confirm, 'Different@1');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    await expectInlineError(/Passwords do not match/i);
  });

  it('requires the current password', async () => {
    const user = userEvent.setup();
    renderPage(<ChangePasswordPage />, { route: '/change-password' });
    await mounted();

    const { next, confirm } = fields();
    await user.type(next, 'NewPass@1');
    await user.type(confirm, 'NewPass@1');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    await expectInlineError(/Required/i);
  });
});

// ─── Regression guard for the render-phase navigate() loop ────────────────────

describe('ChangePassword — unauthenticated visitor', () => {
  it('redirects to /login instead of navigating during render', async () => {
    // This is THE guard for the bug fixed alongside these tests. The page used to do
    //     if (!isLoading && !isAuthenticated) { navigate('/login'); return null; }
    // which ran a side effect during the render phase: navigating re-rendered, which
    // re-entered the branch, which navigated again — an infinite loop that hung the
    // whole worker. It now returns <Navigate/>, which React Router applies declaratively.
    //
    // Rendering inside real <Routes> so the redirect has somewhere to land. If the page
    // ever reverts to imperative navigate-during-render, this fails FAST (~56ms), not by
    // timing out: React emits "Cannot update a component (MemoryRouter) while rendering a
    // different component", and failOnConsoleError() catches it. Verified by reverting.
    renderPage(
      <Routes>
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route path="/login" element={<h1>Login page</h1>} />
      </Routes>,
      { route: '/change-password', handlers: anonHandlers() },
    );

    expect(await screen.findByRole('heading', { level: 1, name: /login page/i }))
      .toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /change password/i })).toBeNull();
  });
});
