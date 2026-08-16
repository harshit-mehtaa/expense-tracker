/**
 * Transactions page — the file this coverage task exists for.
 *
 * This is one of only TWO pages in the app with a real `if (isLoading) return
 * <PageLoader/>` (Transactions.tsx:2504; Reports is the other). That matters: the
 * historical hook-order bug (commit aad140d) put a `useMemo` BELOW that early return,
 * so React threw "Rendered more hooks than during the previous render" the instant
 * loading completed. A test that only saw the loaded state, or only the loading state,
 * would have missed it entirely — the failure lives strictly on the transition.
 * The first test below traverses that transition deliberately.
 *
 * Scope note: ~2,000 of this file's 3,058 statements sit inside modals that only open
 * on click (Edit, Import, Delete, ConvertToTransfer, ConvertToSIP, LinkPolicy,
 * LinkRefund, Documents). Chasing those was explicitly out of scope — they are the
 * brittle, cosmetic-change-breaking tests that were rejected. This file mounts the
 * page three ways and stops there.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import TransactionsPage from '@/pages/Transactions';
import { renderPage, failOnConsoleError } from '../support/renderPage';
import { url } from '../support/handlers';
import { MONEY, MEMBER_USER } from '../support/fixtures';

failOnConsoleError();

const TX = {
  id: 'tx-1',
  description: 'Grocery run',
  amount: MONEY, // ₹1,25,000.00
  type: 'EXPENSE',
  date: '2025-06-01T00:00:00.000Z',
  userId: 'u-admin',
  userName: 'Asha',
  remark: null,
  paymentMode: 'UPI',
  categoryId: 'cat-food',
  category: { id: 'cat-food', name: 'Food', type: 'EXPENSE' },
  bankAccount: { id: 'acc-1', bankName: 'HDFC Bank', accountNumberMasked: 'XXXX1234' },
  transferPairId: null,
  sipId: null,
  sipTransactionId: null,
  insurancePolicyId: null,
  refundForTransactionId: null,
  balanceImpactApplied: true,
};

const PAGINATION = { total: 1, hasMore: false, nextCursor: null };

const txHandlers = (transactions: unknown[] = [TX]) => [
  http.get(url('/transactions'), () =>
    HttpResponse.json({ data: transactions, pagination: PAGINATION })),
  http.get(url('/budgets/vs-actuals'), () => HttpResponse.json({ data: [] })),
  http.get(url('/category-rules'), () => HttpResponse.json({ data: [] })),
  http.get(url('/recurring'), () => HttpResponse.json({ data: [] })),
  // The Add modal fetches these for its link pickers.
  http.get(url('/loans'), () => HttpResponse.json({ data: [] })),
  http.get(url('/investments/sip'), () => HttpResponse.json({ data: [] })),
  http.get(url('/insurance'), () => HttpResponse.json({ data: [] })),
];

describe('Transactions page — smoke', () => {
  it('goes loading -> loaded (the transition that would catch a conditional hook)', async () => {
    renderPage(<TransactionsPage />, { route: '/transactions', handlers: txHandlers() });

    // Leg 2: the early return at :2504 means the page is genuinely a loader on first
    // paint. Queried SYNCHRONOUSLY — an async findBy would retry past the transition
    // and find nothing, which is exactly the no-op this bar is designed to avoid.
    expect(screen.getByRole('status')).toBeInTheDocument();

    // Leg 3: crossing the transition. A hook called conditionally around the early
    // return throws HERE, not on first paint — which is why this await is the point
    // of the whole file.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Transactions' }),
    ).toBeInTheDocument();

    // Leg 4: real data rendered, in Indian format.
    expect((await screen.findAllByText('Grocery run')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1,25,000\.00/).length).toBeGreaterThan(0);
  });

  it('renders an empty state when there are no transactions', async () => {
    renderPage(<TransactionsPage />, { route: '/transactions', handlers: txHandlers([]) });
    await screen.findByRole('heading', { level: 1, name: 'Transactions' });
    expect(screen.queryByText('Grocery run')).toBeNull();
  });

  it('surfaces an error toast when the transactions request fails', async () => {
    renderPage(<TransactionsPage />, {
      route: '/transactions',
      handlers: [
        http.get(url('/transactions'), () =>
          HttpResponse.json({ message: 'Ledger exploded' }, { status: 500 })),
        ...txHandlers().slice(1),
      ],
    });

    await waitFor(() => {
      expect(screen.getByText(/Ledger exploded/i)).toBeInTheDocument();
    });
  });
});

describe('Transactions page — URL-driven tabs', () => {
  it('?tab=recurring mounts the RecurringRules page (a second file)', async () => {
    renderPage(<TransactionsPage />, {
      route: '/transactions?tab=recurring',
      handlers: txHandlers(),
    });

    // TWO <h1>s exist on this mount — 'Transactions' from the parent and 'Recurring
    // Transactions' from the child — so findByRole({level:1}) alone would throw on
    // multiple matches. Match by name.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Recurring Transactions' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Transactions' }),
    ).toBeInTheDocument();
  });

  it('?add=1 opens the add modal for a MEMBER', async () => {
    renderPage(<TransactionsPage />, {
      route: '/transactions?add=1',
      handlers: txHandlers(),
      user: MEMBER_USER,
    });

    await screen.findByRole('heading', { level: 1, name: 'Transactions' });

    // A MEMBER is never "viewing family-wide", so canCreateForView is true and the
    // mount effect's first branch fires.
    // 'Add Transaction' is both the modal's h2 (:2190) and its submit button (:2275),
    // so match the heading specifically.
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Add Transaction' }),
    ).toBeInTheDocument();
  });

  it('?add=1 opens the Add modal for an ADMIN, self-selecting them as the target', async () => {
    // Regression guard for a fixed bug. The mount effect used to run BEFORE `user`
    // resolved: isAdmin was false, so canCreateForView was misleadingly true, the first
    // branch fired, and the same pass stripped `add` from the URL. Once the user resolved
    // as ADMIN, canCreateForView flipped false and the render gate hid the modal — the
    // deep link silently did nothing and the ADMIN fallback was unreachable code.
    // The effect now waits for `user`, so the fallback runs and self-selects the admin.
    renderPage(<TransactionsPage />, {
      route: '/transactions?add=1',
      handlers: txHandlers(),
    });

    await screen.findByRole('heading', { level: 1, name: 'Transactions' });
    await screen.findByLabelText(/View:/i);

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Add Transaction' }),
    ).toBeInTheDocument();
  });
});
