/**
 * Subscriptions page.
 *
 * Includes POST/PUT handlers that capture the request body. The loans feature shipped a
 * pair of HTTP 500s precisely because no frontend test ever completed a submit — 100%
 * backend coverage and 694 green frontend tests could not see that the form sent `""`
 * for cleared fields. These tests exist so that cannot happen twice.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import SubscriptionsPage from '@/pages/subscriptions/Subscriptions';
import { renderPage, failOnConsoleError } from '../support/renderPage';
import { url } from '../support/handlers';
import { MEMBER_USER, ADMIN_USER } from '../support/fixtures';

failOnConsoleError();

const NETFLIX = {
  id: 'sub-1',
  userId: 'u-member',
  name: 'Netflix',
  vendor: 'Netflix India',
  status: 'ACTIVE',
  cancellationUrl: 'https://netflix.com/cancelplan',
  startDate: '2025-01-01T00:00:00.000Z',
  trialEndDate: null,
  cancelledAt: null,
  cancelReason: null,
  notes: null,
  prices: [
    { id: 'p-2', amount: 649, effectiveFrom: '2026-07-01T00:00:00.000Z', note: null },
    { id: 'p-1', amount: 499, effectiveFrom: '2025-01-01T00:00:00.000Z', note: null },
  ],
  currentPrice: 649,
  annualisedCost: 7788,
  nextRenewalDate: '2026-09-01T00:00:00.000Z',
  recurringRule: {
    id: 'rule-1', frequency: 'MONTHLY', nextRunDate: '2026-09-01T00:00:00.000Z', isActive: true,
    paymentMode: 'UPI',
    bankAccountId: 'acct-1',
    categoryId: 'cat-1',
    bankAccount: {
      id: 'acct-1', bankName: 'HDFC Bank', accountType: 'CREDIT_CARD', accountNumberLast4: '4821',
    },
    category: { id: 'cat-1', name: 'Streaming', icon: null, color: null },
  },
  usage: {
    chargeCount: 3, totalPaid: 1947, averageCharge: 649,
    firstChargeDate: '2026-05-01T00:00:00.000Z',
    lastChargeDate: '2026-08-01T00:00:00.000Z',
    priceMismatch: null,
  },
};

const ACCOUNTS = [
  { id: 'acct-1', bankName: 'HDFC Bank', accountType: 'CREDIT_CARD', accountNumberLast4: '4821' },
  { id: 'acct-2', bankName: 'ICICI Bank', accountType: 'SAVINGS', accountNumberLast4: '9003' },
];

const CATEGORIES = [
  { id: 'cat-1', name: 'Streaming', parentId: null, icon: null, color: null },
  { id: 'cat-2', name: 'Utilities', parentId: null, icon: null, color: null },
];

const handlers = (subscriptions: unknown[] = [NETFLIX]) => [
  http.get(url('/subscriptions'), () => HttpResponse.json({ data: subscriptions })),
  http.get(url('/accounts'), () => HttpResponse.json({ data: ACCOUNTS })),
  http.get(url('/categories'), () => HttpResponse.json({ data: CATEGORIES })),
];

describe('Subscriptions page — smoke', () => {
  it('shows loading, then the subscription', async () => {
    renderPage(<SubscriptionsPage />, { route: '/subscriptions', handlers: handlers() });

    expect(screen.getByText(/Loading subscriptions/i)).toBeInTheDocument();
    expect(await screen.findByText('Netflix')).toBeInTheDocument();
    expect(screen.queryByText(/Loading subscriptions/i)).not.toBeInTheDocument();
  });

  it('shows a distinct empty state, not a loading state', async () => {
    renderPage(<SubscriptionsPage />, { route: '/subscriptions', handlers: handlers([]) });

    expect(await screen.findByText(/No subscriptions yet/i)).toBeInTheDocument();
  });

  it('surfaces price, annual cost and next renewal', async () => {
    renderPage(<SubscriptionsPage />, { route: '/subscriptions', handlers: handlers() });
    await screen.findByText('Netflix');

    // Annualised: 649 x 12 = 7,788 — the number that decides whether it is worth
    // keeping. Appears twice with a single subscription: the page total and the card.
    expect(screen.getAllByText(/7,788/)).toHaveLength(2);
    expect(screen.getByText(/1 active/i)).toBeInTheDocument();
    expect(screen.getByText('01/09/2026')).toBeInTheDocument();
  });

  it('renders dates as dd/mm/yyyy', async () => {
    renderPage(<SubscriptionsPage />, { route: '/subscriptions', handlers: handlers() });
    await screen.findByText('Netflix');

    expect(screen.getByText('01/09/2026')).toBeInTheDocument();
  });

  it('links to the cancellation page', async () => {
    renderPage(<SubscriptionsPage />, { route: '/subscriptions', handlers: handlers() });
    await screen.findByText('Netflix');

    const link = screen.getByRole('link', { name: /how to cancel/i });
    expect(link).toHaveAttribute('href', 'https://netflix.com/cancelplan');
    // Opening a third-party page from an app must not hand it window.opener.
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('shows the trial end date instead of a renewal while trialing', async () => {
    renderPage(<SubscriptionsPage />, {
      route: '/subscriptions',
      handlers: handlers([{
        ...NETFLIX,
        status: 'TRIALING',
        trialEndDate: '2026-09-15T00:00:00.000Z',
      }]),
    });
    await screen.findByText('Netflix');

    expect(screen.getByText(/Trial ends/i)).toBeInTheDocument();
    expect(screen.getByText('15/09/2026')).toBeInTheDocument();
  });

  it('warns when a real charge exceeds the recorded price', async () => {
    renderPage(<SubscriptionsPage />, {
      route: '/subscriptions',
      handlers: handlers([{
        ...NETFLIX,
        usage: {
          ...NETFLIX.usage,
          priceMismatch: { date: '2026-08-01T00:00:00.000Z', charged: 799, expected: 649 },
        },
      }]),
    });
    await screen.findByText('Netflix');

    expect(screen.getByText(/Charged more than expected/i)).toBeInTheDocument();
  });

  it('offers Resume rather than Cancel once cancelled', async () => {
    renderPage(<SubscriptionsPage />, {
      route: '/subscriptions',
      handlers: handlers([{ ...NETFLIX, status: 'CANCELLED' }]),
    });
    await screen.findByText('Netflix');

    expect(screen.getByRole('button', { name: /^resume$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^cancel$/i })).not.toBeInTheDocument();
  });
});

describe('Subscriptions page — submitted payload', () => {
  it('sends null, not an empty string, for cleared optional fields', async () => {
    // The exact shape that produced an Invalid Date and a dangling FK in loans.
    const user = userEvent.setup();
    let body: any = null;

    renderPage(<SubscriptionsPage />, {
      route: '/subscriptions',
      user: MEMBER_USER,
      handlers: [
        ...handlers([]),
        http.post(url('/subscriptions'), async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ data: NETFLIX }, { status: 201 });
        }),
      ],
    });

    await screen.findByText(/No subscriptions yet/i);
    await user.click(screen.getByRole('button', { name: /add subscription/i }));
    await screen.findByRole('heading', { name: /add subscription/i });

    await user.type(screen.getByLabelText(/^Name/i), 'Spotify');
    await user.type(screen.getByLabelText(/^Amount/i), '119');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => expect(body).not.toBeNull());

    expect(body.name).toBe('Spotify');
    expect(body.amount).toBe(119);
    expect(body.trialEndDate).toBeNull();
    expect(body.cancellationUrl).toBeNull();
    expect(body.vendor).toBeNull();
  });

  it('records a price change against the dedicated endpoint, not the update route', async () => {
    // Price must append to history. Sending it through PUT would overwrite silently and
    // past charges would be repriced.
    const user = userEvent.setup();
    let priceBody: any = null;
    let putCalled = false;

    renderPage(<SubscriptionsPage />, {
      route: '/subscriptions',
      user: MEMBER_USER,
      handlers: [
        ...handlers(),
        http.post(url('/subscriptions/sub-1/price'), async ({ request }) => {
          priceBody = await request.json();
          return HttpResponse.json({ data: NETFLIX });
        }),
        http.put(url('/subscriptions/sub-1'), () => {
          putCalled = true;
          return HttpResponse.json({ data: NETFLIX });
        }),
      ],
    });

    await screen.findByText('Netflix');
    await user.click(screen.getByRole('button', { name: /price change/i }));
    await screen.findByRole('heading', { name: /price change/i });

    const amount = screen.getByLabelText(/New amount/i);
    await user.clear(amount);
    await user.type(amount, '799');
    await user.click(screen.getByRole('button', { name: /^record$/i }));

    await waitFor(() => expect(priceBody).not.toBeNull());

    expect(priceBody.amount).toBe(799);
    expect(priceBody.effectiveFrom).toBeTruthy();
    expect(putCalled).toBe(false);
  });

  it('edit pre-fills the current price without rewriting history on save', async () => {
    const user = userEvent.setup();
    let body: any = null;

    renderPage(<SubscriptionsPage />, {
      route: '/subscriptions',
      user: MEMBER_USER,
      handlers: [
        ...handlers(),
        http.put(url('/subscriptions/sub-1'), async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ data: NETFLIX });
        }),
      ],
    });

    await screen.findByText('Netflix');
    await user.click(screen.getByRole('button', { name: /edit subscription/i }));
    await screen.findByRole('heading', { name: /edit subscription/i });

    expect(screen.getByLabelText(/^Amount/i)).toHaveValue(649);

    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(body).not.toBeNull());

    // trialEndDate was empty on this record and must not go out as ''.
    expect(body.trialEndDate).toBeNull();
  });

  it('cancels through the cancel endpoint', async () => {
    const user = userEvent.setup();
    let cancelled = false;

    renderPage(<SubscriptionsPage />, {
      route: '/subscriptions',
      user: MEMBER_USER,
      handlers: [
        ...handlers(),
        http.post(url('/subscriptions/sub-1/cancel'), () => {
          cancelled = true;
          return HttpResponse.json({ data: { ...NETFLIX, status: 'CANCELLED' } });
        }),
      ],
    });

    await screen.findByText('Netflix');
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    await waitFor(() => expect(cancelled).toBe(true));
  });
});

describe('Subscriptions page — destructive and misleading actions', () => {
  it('requires confirmation before deleting', async () => {
    // Deleting removes the subscription and its price history from view. The Recurring
    // tab uses two steps for a lighter action; this must not be weaker.
    const user = userEvent.setup();
    let deleted = false;

    renderPage(<SubscriptionsPage />, {
      route: '/subscriptions',
      user: MEMBER_USER,
      handlers: [
        http.delete(url('/subscriptions/sub-1'), () => { deleted = true; return new HttpResponse(null, { status: 204 }); }),
        ...handlers(),
      ],
    });

    await screen.findByText('Netflix');
    await user.click(screen.getByRole('button', { name: /delete subscription/i }));

    expect(deleted).toBe(false);
    expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(deleted).toBe(true));
  });

  it('does not let the edit form pretend the amount is editable', async () => {
    // It renders Amount, but updateSchema has no `amount` — Zod strips it, so the user
    // typed a new price, saw a success, and nothing changed. Start date is NOT the same
    // case — it is metadata, now genuinely editable; see "editing the start date" below.
    const user = userEvent.setup();

    renderPage(<SubscriptionsPage />, {
      route: '/subscriptions', user: MEMBER_USER, handlers: handlers(),
    });

    await screen.findByText('Netflix');
    await user.click(screen.getByRole('button', { name: /edit subscription/i }));
    await screen.findByRole('heading', { name: /edit subscription/i });

    expect(screen.getByLabelText(/^Amount/i)).toBeDisabled();
  });

  it('resumes from tomorrow, so it does not bill the instant you click', async () => {
    // Today's date satisfies `nextRunDate <= now`, so the next hourly scheduler tick
    // would charge immediately.
    const user = userEvent.setup();
    let body: any = null;

    renderPage(<SubscriptionsPage />, {
      route: '/subscriptions',
      user: MEMBER_USER,
      handlers: [
        http.post(url('/subscriptions/sub-1/resume'), async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ data: NETFLIX });
        }),
        ...handlers([{ ...NETFLIX, status: 'CANCELLED' }]),
      ],
    });

    await screen.findByText('Netflix');
    await user.click(screen.getByRole('button', { name: /^resume$/i }));
    await waitFor(() => expect(body).not.toBeNull());

    const todayLocal = new Date();
    expect(new Date(body.nextRunDate).getTime()).toBeGreaterThan(todayLocal.getTime() - 86400000);
    expect(body.nextRunDate).not.toBe(
      `${todayLocal.getFullYear()}-${String(todayLocal.getMonth() + 1).padStart(2, '0')}-${String(todayLocal.getDate()).padStart(2, '0')}`,
    );
  });

  it('surfaces a backend error instead of failing silently', async () => {
    // The service writes user-facing 409s that nothing was showing.
    const user = userEvent.setup();

    renderPage(<SubscriptionsPage />, {
      route: '/subscriptions',
      user: MEMBER_USER,
      handlers: [
        http.post(url('/subscriptions/sub-1/cancel'), () =>
          HttpResponse.json(
            { success: false, message: 'This subscription is already cancelled' },
            { status: 409 },
          )),
        ...handlers(),
      ],
    });

    await screen.findByText('Netflix');
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    // Rendered in the toast and mirrored into the aria-live region, so more than one
    // node matches — what matters is that the backend's own wording reaches the user.
    await waitFor(() => expect(screen.getAllByText(/already cancelled/i).length).toBeGreaterThan(0));
  });
});

// ─── Adding one as an ADMIN ──────────────────────────────────────────────────

/**
 * A subscription needs exactly one owner, so the family-wide view cannot create one —
 * and family-wide is an admin's DEFAULT view. The page had the read-only guard copied
 * from Loans but not the member selector that makes it escapable, so an admin saw no Add
 * button and had no way to get one. Every test here rendered as a MEMBER, which is how
 * that shipped.
 */
describe('Subscriptions page — as an ADMIN', () => {
  it('offers a member selector, so the family-wide view is escapable', async () => {
    renderPage(<SubscriptionsPage />, {
      route: '/subscriptions', user: ADMIN_USER, handlers: handlers(),
    });

    await screen.findByText('Netflix');
    expect(await screen.findByLabelText(/view:/i)).toBeInTheDocument();
  });

  it('explains why there is no Add button while viewing the whole family', async () => {
    // Silently omitting the button left the page with no way to act and no reason given.
    renderPage(<SubscriptionsPage />, {
      route: '/subscriptions', user: ADMIN_USER, handlers: handlers(),
    });

    await screen.findByText('Netflix');
    expect(screen.getByText(/choose a member above/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add subscription/i })).not.toBeInTheDocument();
  });

  it('shows the Add button once a member is chosen', async () => {
    const user = userEvent.setup();
    renderPage(<SubscriptionsPage />, {
      route: '/subscriptions', user: ADMIN_USER, handlers: handlers(),
    });

    await screen.findByText('Netflix');
    await user.selectOptions(await screen.findByLabelText(/view:/i), 'u-member');

    expect(await screen.findByRole('button', { name: /add subscription/i })).toBeInTheDocument();
  });

  it('a MEMBER gets the Add button immediately, with no selector to worry about', async () => {
    renderPage(<SubscriptionsPage />, {
      route: '/subscriptions', user: MEMBER_USER, handlers: handlers(),
    });

    await screen.findByText('Netflix');
    expect(screen.getByRole('button', { name: /add subscription/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/view:/i)).not.toBeInTheDocument();
  });
});

// ─── How it is paid ──────────────────────────────────────────────────────────

/**
 * The form collected a name, amount and schedule but never how the charge is paid, even
 * though the owned rule has carried paymentMode, bankAccountId and categoryId all along.
 * A subscription therefore generated an uncategorised transaction attached to no account
 * — invisible to every budget.
 */
describe('Subscriptions page — payment method', () => {
  const openForm = async (user: ReturnType<typeof userEvent.setup>) => {
    await screen.findByText('Netflix');
    await user.click(screen.getByRole('button', { name: /add subscription/i }));
  };

  it('offers a payment type, including netbanking', async () => {
    const user = userEvent.setup();
    renderPage(<SubscriptionsPage />, {
      route: '/subscriptions', user: MEMBER_USER, handlers: handlers(),
    });
    await openForm(user);

    const select = screen.getByLabelText(/payment type/i);
    expect(select).toBeInTheDocument();
    // The enum had no netbanking value at all until this change.
    expect(within(select).getByRole('option', { name: 'Netbanking' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'UPI' })).toBeInTheDocument();
  });

  it('offers the accounts to pay from, named as they are elsewhere', async () => {
    const user = userEvent.setup();
    renderPage(<SubscriptionsPage />, {
      route: '/subscriptions', user: MEMBER_USER, handlers: handlers(),
    });
    await openForm(user);

    const select = await screen.findByLabelText(/paid from/i);
    expect(
      within(select).getByRole('option', { name: 'HDFC Bank ····4821 (Credit Card)' }),
    ).toBeInTheDocument();
  });

  it('sends the payment method when creating', async () => {
    const user = userEvent.setup();
    let body: any;
    renderPage(<SubscriptionsPage />, {
      route: '/subscriptions',
      user: MEMBER_USER,
      handlers: [
        ...handlers(),
        http.post(url('/subscriptions'), async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ data: NETFLIX }, { status: 201 });
        }),
      ],
    });
    await openForm(user);

    await user.type(screen.getByLabelText(/^name$/i), 'Spotify');
    await user.type(screen.getByLabelText(/amount/i), '199');
    await user.selectOptions(screen.getByLabelText(/payment type/i), 'NETBANKING');
    await user.selectOptions(await screen.findByLabelText(/paid from/i), 'acct-1');
    await user.selectOptions(await screen.findByLabelText(/^category$/i), 'cat-1');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({
      paymentMode: 'NETBANKING', bankAccountId: 'acct-1', categoryId: 'cat-1',
    });
  });

  it('shows how an existing subscription is paid', async () => {
    renderPage(<SubscriptionsPage />, {
      route: '/subscriptions', user: MEMBER_USER, handlers: handlers(),
    });

    await screen.findByText('Netflix');
    expect(screen.getByText(/UPI · HDFC Bank ····4821 · Streaming/)).toBeInTheDocument();
  });

  it('says so plainly when the payment method is not set', async () => {
    renderPage(<SubscriptionsPage />, {
      route: '/subscriptions',
      user: MEMBER_USER,
      handlers: handlers([{
        ...NETFLIX,
        recurringRule: {
          id: 'rule-1', frequency: 'MONTHLY',
          nextRunDate: '2026-09-01T00:00:00.000Z', isActive: true,
        },
      }]),
    });

    await screen.findByText('Netflix');
    expect(screen.getByText('Not set')).toBeInTheDocument();
  });

  it('prefills the payment method when editing, rather than silently clearing it', async () => {
    // The three fields live on the rule, not the subscription. Reading them from the
    // wrong place would blank the card on every unrelated edit.
    const user = userEvent.setup();
    renderPage(<SubscriptionsPage />, {
      route: '/subscriptions', user: MEMBER_USER, handlers: handlers(),
    });

    await screen.findByText('Netflix');
    await user.click(screen.getByRole('button', { name: /edit/i }));

    expect(await screen.findByLabelText(/payment type/i)).toHaveValue('UPI');
    expect(await screen.findByLabelText(/paid from/i)).toHaveValue('acct-1');
    expect(await screen.findByLabelText(/^category$/i)).toHaveValue('cat-1');
  });
});

// ─── Editing the start date ──────────────────────────────────────────────────

/**
 * The date input was hard-disabled during edit, grouped with amount under "fixed here on
 * purpose" — but the reason (protecting price history) only actually applies to amount.
 * startDate is metadata; the backend now moves the opening price row's date along with
 * it, so unlocking the field here does not weaken that guarantee.
 */
describe('Subscriptions page — editing the start date', () => {
  it('is editable when editing an existing subscription', async () => {
    const user = userEvent.setup();
    renderPage(<SubscriptionsPage />, {
      route: '/subscriptions', user: MEMBER_USER, handlers: handlers(),
    });

    await screen.findByText('Netflix');
    await user.click(screen.getByRole('button', { name: /edit/i }));

    const startDate = await screen.findByLabelText(/start date/i);
    expect(startDate).not.toBeDisabled();
    expect(startDate).not.toHaveAttribute('readonly');
  });

  it('amount stays locked, unlike start date', async () => {
    const user = userEvent.setup();
    renderPage(<SubscriptionsPage />, {
      route: '/subscriptions', user: MEMBER_USER, handlers: handlers(),
    });

    await screen.findByText('Netflix');
    await user.click(screen.getByRole('button', { name: /edit/i }));

    expect(await screen.findByLabelText(/amount/i)).toBeDisabled();
    // The old copy said BOTH were fixed — now only amount should read that way.
    expect(screen.getByText(/amount is fixed here on purpose/i)).toBeInTheDocument();
    expect(screen.queryByText(/amount and start date are fixed/i)).not.toBeInTheDocument();
  });

  it('sends the edited start date on save', async () => {
    const user = userEvent.setup();
    let body: any;
    renderPage(<SubscriptionsPage />, {
      route: '/subscriptions',
      user: MEMBER_USER,
      handlers: [
        ...handlers(),
        http.put(url('/subscriptions/sub-1'), async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ data: NETFLIX });
        }),
      ],
    });

    await screen.findByText('Netflix');
    await user.click(screen.getByRole('button', { name: /edit/i }));

    const startDate = await screen.findByLabelText(/start date/i);
    await user.clear(startDate);
    await user.type(startDate, '2024-06-01');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body.startDate).toBe('2024-06-01');
  });

  it('surfaces the backend\'s "before the next price change" rejection as a toast', async () => {
    const user = userEvent.setup();
    renderPage(<SubscriptionsPage />, {
      route: '/subscriptions',
      user: MEMBER_USER,
      handlers: [
        ...handlers(),
        http.put(url('/subscriptions/sub-1'), () => HttpResponse.json(
          { message: 'Start date must be before the next recorded price change on 2026-07-01' },
          { status: 400 },
        )),
      ],
    });

    await screen.findByText('Netflix');
    await user.click(screen.getByRole('button', { name: /edit/i }));
    const startDate = await screen.findByLabelText(/start date/i);
    await user.clear(startDate);
    await user.type(startDate, '2026-08-01');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/before the next recorded price change/i).length).toBeGreaterThan(0);
    });
  });
});
