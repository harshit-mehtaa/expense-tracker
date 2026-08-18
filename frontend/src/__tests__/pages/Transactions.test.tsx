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
import userEvent from '@testing-library/user-event';
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

const SUBSCRIPTION_RULE = {
  id: 'rule-sub', userId: 'u-member',
  frequency: 'MONTHLY', nextRunDate: '2026-09-01T00:00:00.000Z', isActive: true,
  subscriptionId: 'sub-1',
  createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
  // The spec is flat on the rule: it is a specification, not a Transaction, so it never
  // appears in the ledger.
  amount: 649, type: 'EXPENSE', description: 'Netflix',
  categoryId: null, category: null, bankAccountId: null, bankAccount: null,
  paymentMode: null, tags: [], gstAmount: null,
};

/**
 * A subscription owns its rule, and the backend rejects direct edits and deletes with a
 * 409. The row still belongs in this list — it is real recurring money — but offering
 * buttons that can only fail is worse than pointing at the page that works.
 */
describe('Recurring tab — subscription-owned rules', () => {
  it('offers a link to the subscription instead of edit/delete controls', async () => {
    renderPage(<TransactionsPage />, {
      route: '/transactions?tab=recurring',
      handlers: [
        http.get(url('/recurring'), () => HttpResponse.json({ data: [SUBSCRIPTION_RULE] })),
        ...txHandlers(),
      ],
    });

    expect(await screen.findByText('Netflix')).toBeInTheDocument();

    const link = screen.getByRole('link', { name: /manage subscription/i });
    expect(link).toHaveAttribute('href', '/subscriptions');

    expect(screen.queryByTitle('Edit')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Delete')).not.toBeInTheDocument();
  });

  it('still shows the normal controls for an ordinary rule', async () => {
    renderPage(<TransactionsPage />, {
      route: '/transactions?tab=recurring',
      handlers: [
        http.get(url('/recurring'), () =>
          HttpResponse.json({ data: [{ ...SUBSCRIPTION_RULE, subscriptionId: null }] })),
        ...txHandlers(),
      ],
    });

    expect(await screen.findByText('Netflix')).toBeInTheDocument();
    expect(screen.getByTitle('Edit')).toBeInTheDocument();
    expect(screen.getByTitle('Delete')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /manage subscription/i })).not.toBeInTheDocument();
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

// ─── Category picker ordering ────────────────────────────────────────────────

/** Travel › {Auto, Cab}, deliberately out of order and interleaved with a root. */
const NESTED_CATEGORIES = [
  { id: 'cab', name: 'Cab', type: 'EXPENSE', parentId: 'travel', icon: '🚕' },
  { id: 'groceries', name: 'Groceries', type: 'EXPENSE', parentId: null, icon: '🛒' },
  { id: 'travel', name: 'Travel', type: 'EXPENSE', parentId: null, icon: '🧳' },
  { id: 'auto', name: 'Auto', type: 'EXPENSE', parentId: 'travel', icon: '🛺' },
];

describe('Transactions — the category picker is a tree', () => {
  it('lists each child directly under its parent, not alphabetically by leaf name', async () => {
    // Sorted by leaf name, "Cab" filed under C and "Travel" under T — a sub-category and
    // its parent could sit far apart with only the label to relate them.
    // ?add=1 opens the create dialog; there is no toolbar button for it.
    renderPage(<TransactionsPage />, {
      route: '/transactions?add=1',
      user: MEMBER_USER,
      handlers: [
        http.get(url('/categories'), () => HttpResponse.json({ data: NESTED_CATEGORIES })),
        ...txHandlers(),
      ],
    });

    const select = await screen.findByLabelText(/^Category/i);
    const labels = Array.from(select.querySelectorAll('option'))
      .map((o) => o.textContent ?? '')
      .filter((t) => !t.includes('Uncategorized'));

    const names = labels.map((l) => l.replace(/[\s\u00A0└]/g, '').replace(/[^\w]/g, ''));
    expect(names).toEqual(['Groceries', 'Travel', 'Auto', 'Cab']);
  });

  it('indents a child so the hierarchy is visible in the dropdown', async () => {
    renderPage(<TransactionsPage />, {
      route: '/transactions?add=1',
      user: MEMBER_USER,
      handlers: [
        http.get(url('/categories'), () => HttpResponse.json({ data: NESTED_CATEGORIES })),
        ...txHandlers(),
      ],
    });

    const select = await screen.findByLabelText(/^Category/i);
    const cab = Array.from(select.querySelectorAll('option')).find((o) => o.textContent?.includes('Cab'))!;

    expect(cab.textContent).toContain('└');
    // Non-breaking, because browsers collapse ordinary leading spaces in an <option>.
    expect(cab.textContent!.startsWith('\u00A0')).toBe(true);
  });
});

// ─── Search: the cursor bug ───────────────────────────────────────────────────

/**
 * `search` is server-side (fetchTransactions sends it as a query param) and it sat
 * inside the useInfiniteQuery key, so every keystroke produced a NEW key. With no
 * placeholderData, a new key has no cached data — status is `pending`, isLoading flips
 * true, and `if (isLoading) return <PageLoader />` replaced the WHOLE page, search input
 * included. A fresh, unfocused input mounted once the new results landed. One letter,
 * cursor gone.
 *
 * Real timers throughout — 300ms debounce, well inside findBy*'s default 1000ms budget.
 * See CommandPalette.test.tsx for the same call.
 */
describe('Transactions page — search', () => {
  const openFilters = async (user: ReturnType<typeof userEvent.setup>) => {
    await screen.findByRole('heading', { level: 1, name: 'Transactions' });
    await user.click(screen.getByRole('button', { name: /filters/i }));
    return screen.findByPlaceholderText(/search description or remark/i);
  };

  it('VQ1: keeps focus across a whole word, not just the second letter', async () => {
    const user = userEvent.setup();
    renderPage(<TransactionsPage />, { route: '/transactions', handlers: txHandlers() });

    const search = await openFilters(user);
    await user.type(search, 'grocer');

    // The old bug: the SECOND keystroke unmounted this element and a new one took its
    // place, unfocused. Asserting focus after typing more than one letter is the point.
    await waitFor(() => expect(search).toHaveFocus());
    expect(search).toHaveValue('grocer');
  });

  it('VQ2: fires exactly one request, for the settled term, not one per keystroke', async () => {
    const user = userEvent.setup();
    const seenSearchParams: string[] = [];
    renderPage(<TransactionsPage />, {
      route: '/transactions',
      handlers: [
        http.get(url('/transactions'), ({ request }) => {
          seenSearchParams.push(new URL(request.url).searchParams.get('search') ?? '');
          return HttpResponse.json({ data: [TX], pagination: PAGINATION });
        }),
        ...txHandlers().slice(1),
      ],
    });

    const search = await openFilters(user);
    await user.type(search, 'grocery');

    // Wait for the debounced request to land, then confirm nothing further arrives.
    await waitFor(() => expect(seenSearchParams).toContain('grocery'));
    await new Promise((r) => setTimeout(r, 350));

    // One request on mount (search=''), one for the settled term. Not one per letter.
    expect(seenSearchParams).toEqual(['', 'grocery']);
  });

  it('VQ3: a genuine first load still shows PageLoader (the guard is not dead)', async () => {
    renderPage(<TransactionsPage />, { route: '/transactions', handlers: txHandlers() });
    // Queried synchronously, same as the smoke test above — this is the transition, not
    // the settled state.
    expect(screen.getByRole('status')).toBeInTheDocument();
    await screen.findByRole('heading', { level: 1, name: 'Transactions' });
  });

  it('VQ4: a chip filter still refetches correctly alongside a debounced search', async () => {
    const user = userEvent.setup();
    const seenTypeParams: Array<string | null> = [];
    renderPage(<TransactionsPage />, {
      route: '/transactions',
      handlers: [
        http.get(url('/transactions'), ({ request }) => {
          seenTypeParams.push(new URL(request.url).searchParams.get('type'));
          return HttpResponse.json({ data: [TX], pagination: PAGINATION });
        }),
        ...txHandlers().slice(1),
      ],
    });

    await openFilters(user);
    // Chips are click-driven, not typed — they must not be debounced.
    await user.click(screen.getByRole('button', { name: /^expense$/i }));

    await waitFor(() => expect(seenTypeParams).toContain('EXPENSE'));
  });

  it('VQ5: infinite scroll still works after a search settles', async () => {
    const user = userEvent.setup();
    const PAGE_1 = { total: 2, hasMore: true, nextCursor: 'cursor-2' };
    const PAGE_2 = { total: 2, hasMore: false, nextCursor: null };
    renderPage(<TransactionsPage />, {
      route: '/transactions',
      handlers: [
        http.get(url('/transactions'), ({ request }) => {
          const cursor = new URL(request.url).searchParams.get('cursor');
          return HttpResponse.json(
            cursor === 'cursor-2'
              ? { data: [{ ...TX, id: 'tx-2', description: 'Grocery run 2' }], pagination: PAGE_2 }
              : { data: [TX], pagination: PAGE_1 },
          );
        }),
        ...txHandlers().slice(1),
      ],
    });

    const search = await openFilters(user);
    await user.type(search, 'grocery');
    await waitFor(() => expect(screen.getAllByText('Grocery run').length).toBeGreaterThan(0));
    // The debounce has to settle — Load-more is deliberately disabled while it has not
    // (VQ5 continued: paging a stale term must not append results for the new one).
    await waitFor(() => expect(screen.getByRole('button', { name: /load more/i })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: /load more/i }));
    await waitFor(() => {
      expect(screen.getAllByText('Grocery run 2').length).toBeGreaterThan(0);
    });
  });
});
