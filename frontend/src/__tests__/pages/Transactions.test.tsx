/**
 * Transactions page — the file this coverage task exists for.
 *
 * This is one of only TWO pages in the app with a real `if (isLoading) return
 * <PageLoader/>` (Transactions.tsx:2303; Reports is the other). That matters: the
 * historical hook-order bug (commit aad140d) put a `useMemo` BELOW that early return,
 * so React threw "Rendered more hooks than during the previous render" the instant
 * loading completed. A test that only saw the loaded state, or only the loading state,
 * would have missed it entirely — the failure lives strictly on the transition.
 * The first test below traverses that transition deliberately.
 *
 * Scope note: most of this file's statements sit inside modals that only open on click
 * (Edit, Import, Delete, ConvertToTransfer, ConvertToSIP, LinkPolicy, LinkRefund,
 * Documents). Deep UI-detail tests for those (field layouts, exact copy, validation
 * messages) are still out of scope — brittle, cosmetic-change-breaking, and rejected.
 * The "Cache invalidation" describe block below is a deliberate, narrow exception: it
 * opens Edit/Delete/Import/Convert-to-Transfer specifically to assert on
 * `invalidateQueries` calls, not on DOM structure or copy — click an already-reachable
 * button, assert a spy was called with certain query keys. Judged low-brittleness
 * (2026-09-08) because it doesn't touch the assertions the original rejection was about.
 */
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import TransactionsPage from '@/pages/Transactions';
import { renderPage, failOnConsoleError, SearchParamsProbe } from '../support/renderPage';
import { url } from '../support/handlers';
import { MONEY, MEMBER_USER, ACCOUNTS, CATEGORIES } from '../support/fixtures';

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

const RULE = {
  id: 'rule-1', userId: 'u-member',
  frequency: 'MONTHLY', nextRunDate: '2026-09-01T00:00:00.000Z', isActive: true,
  subscriptionId: null,
  createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
  amount: 500, type: 'EXPENSE', description: 'Gym membership',
  categoryId: null, category: null, bankAccountId: null, bankAccount: null,
  paymentMode: null, tags: [], gstAmount: null,
};

// `recurringRequests`, when given, records each /recurring GET's `targetUserId` param
// (present or absent, as MSW sees it — fetchRecurringRules string-concats it onto the
// path rather than using axios `params`, so it must be read via
// `new URL(...).searchParams`, not a `params`-object match, to catch that call shape too).
const txHandlers = (opts: {
  transactions?: unknown[];
  recurringRequests?: (string | null)[];
  rules?: unknown[];
} = {}) => {
  const { transactions = [TX], recurringRequests, rules = [] } = opts;
  return [
    http.get(url('/transactions'), () =>
      HttpResponse.json({ data: transactions, pagination: PAGINATION })),
    http.get(url('/budgets/vs-actuals'), () => HttpResponse.json({ data: [] })),
    http.get(url('/category-rules'), () => HttpResponse.json({ data: [] })),
    http.get(url('/recurring'), ({ request }) => {
      recurringRequests?.push(new URL(request.url).searchParams.get('targetUserId'));
      return HttpResponse.json({ data: rules });
    }),
    // The Add modal fetches these for its link pickers.
    http.get(url('/loans'), () => HttpResponse.json({ data: [] })),
    http.get(url('/investments/sip'), () => HttpResponse.json({ data: [] })),
    http.get(url('/insurance'), () => HttpResponse.json({ data: [] })),
  ];
};

describe('Transactions page — smoke', () => {
  it('goes loading -> loaded (the transition that would catch a conditional hook)', async () => {
    renderPage(<TransactionsPage />, { route: '/transactions', handlers: txHandlers() });

    // Leg 2: the early return at :2303 means the page is genuinely a loader on first
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
    renderPage(<TransactionsPage />, { route: '/transactions', handlers: txHandlers({ transactions: [] }) });
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

/**
 * A cash withdrawal is a TRANSFER leg whose destination account is the user's
 * system-managed cash account. It should read as "Cash Withdrawal", not the generic
 * "Transfer Debit" label used for an ordinary account-to-account transfer.
 */
const WITHDRAWAL_TX = {
  ...TX,
  id: 'tx-withdrawal',
  description: 'ATM withdrawal',
  type: 'EXPENSE',
  transferPairId: 'pair-cash-1',
  bankAccount: { id: 'acc-1', bankName: 'HDFC Bank', accountNumberMasked: 'XXXX1234', accountType: 'SAVINGS' },
  transferCounterpartyAccount: { bankName: 'Cash', accountNumberLast4: null, accountType: 'CASH' },
};

// The other leg of the same withdrawal: an INCOME row sitting directly on the cash
// account. Both legs describe the SAME event and must agree on the label — this is the
// leg a naive `type === 'EXPENSE' ? Withdrawal : Deposit` rule gets backwards.
const WITHDRAWAL_CREDIT_LEG_TX = {
  ...TX,
  id: 'tx-withdrawal-credit',
  description: 'ATM withdrawal',
  type: 'INCOME',
  transferPairId: 'pair-cash-1',
  bankAccount: { id: 'acc-cash', bankName: 'Cash', accountNumberMasked: null, accountType: 'CASH' },
  transferCounterpartyAccount: { bankName: 'HDFC Bank', accountNumberLast4: '1234', accountType: 'SAVINGS' },
};

// A deposit is the reverse movement: cash account is the SOURCE, not the destination.
const DEPOSIT_DEBIT_LEG_TX = {
  ...TX,
  id: 'tx-deposit-debit',
  description: 'Deposit to bank',
  type: 'EXPENSE',
  transferPairId: 'pair-cash-2',
  bankAccount: { id: 'acc-cash', bankName: 'Cash', accountNumberMasked: null, accountType: 'CASH' },
  transferCounterpartyAccount: { bankName: 'HDFC Bank', accountNumberLast4: '1234', accountType: 'SAVINGS' },
};

const DEPOSIT_CREDIT_LEG_TX = {
  ...TX,
  id: 'tx-deposit-credit',
  description: 'Deposit to bank',
  type: 'INCOME',
  transferPairId: 'pair-cash-2',
  bankAccount: { id: 'acc-1', bankName: 'HDFC Bank', accountNumberMasked: 'XXXX1234', accountType: 'SAVINGS' },
  transferCounterpartyAccount: { bankName: 'Cash', accountNumberLast4: null, accountType: 'CASH' },
};

const ORDINARY_TRANSFER_TX = {
  ...TX,
  id: 'tx-transfer',
  description: 'Move to savings',
  type: 'EXPENSE',
  transferPairId: 'pair-ordinary-1',
  bankAccount: { id: 'acc-1', bankName: 'HDFC Bank', accountNumberMasked: 'XXXX1234', accountType: 'SAVINGS' },
  transferCounterpartyAccount: { bankName: 'SBI', accountNumberLast4: '9999', accountType: 'SAVINGS' },
};

describe('Transactions page — category chip color (mobile card) and Refunded chip parity (desktop)', () => {
  it('colors the mobile category chip from the category\'s own color, not a flat gray', async () => {
    renderPage(<TransactionsPage />, {
      route: '/transactions',
      handlers: [
        http.get(url('/categories'), () => HttpResponse.json({
          data: [{ id: 'cat-food', name: 'Food', type: 'EXPENSE', parentId: null, color: '#ff0000', icon: null }],
        })),
        ...txHandlers(),
      ],
    });
    await screen.findByRole('heading', { level: 1, name: 'Transactions' });

    const chips = (await screen.findAllByText('Food')).filter((el) => el.tagName === 'SPAN');
    expect(chips.length).toBeGreaterThan(0);
    // jsdom normalizes #ff000022 (hex+alpha) to an rgba() string — assert the translucent
    // red made it through, not the exact serialization format.
    expect(chips[0].style.backgroundColor).toMatch(/rgba\(255,\s*0,\s*0,/i);
  });

  it('falls back to flat gray when the category has no color set', async () => {
    renderPage(<TransactionsPage />, {
      route: '/transactions',
      handlers: [
        http.get(url('/categories'), () => HttpResponse.json({
          data: [{ id: 'cat-food', name: 'Food', type: 'EXPENSE', parentId: null, color: null, icon: null }],
        })),
        ...txHandlers(),
      ],
    });
    await screen.findByRole('heading', { level: 1, name: 'Transactions' });

    const chips = (await screen.findAllByText('Food')).filter((el) => el.tagName === 'SPAN');
    expect(chips.length).toBeGreaterThan(0);
    expect(chips[0].className).toMatch(/bg-muted/);
  });

  it('gives the desktop "Refunded" indicator the same chip styling mobile already has, not plain text', async () => {
    const REFUNDED_TX = { ...TX, refunds: [{ id: 'refund-1', amount: 500 }] };
    renderPage(<TransactionsPage />, { route: '/transactions', handlers: txHandlers({ transactions: [REFUNDED_TX] }) });
    await screen.findByRole('heading', { level: 1, name: 'Transactions' });

    // "Refunded" text is split across elements (INRDisplay renders the amount as a
    // sibling node) — wait for it to land, then find every chip-styled element whose
    // full textContent includes it (desktop's wrapping span + mobile's).
    await screen.findAllByText('Grocery run');
    const refundedChips = Array.from(document.querySelectorAll('span.rounded-full'))
      .filter((el) => el.textContent?.includes('Refunded'));
    // Both the desktop and mobile renderings should now be proper dark-mode-aware chips.
    expect(refundedChips.length).toBeGreaterThanOrEqual(2);
    refundedChips.forEach((chip) => {
      expect(chip.className).toMatch(/rounded-full/);
      expect(chip.className).toMatch(/dark:/);
    });
  });
});

describe('Transactions page — cash withdrawal labeling', () => {
  it('labels the debit leg (bank account) of a withdrawal as "Cash Withdrawal"', async () => {
    renderPage(<TransactionsPage />, { route: '/transactions', handlers: txHandlers({ transactions: [WITHDRAWAL_TX] }) });
    await screen.findByRole('heading', { level: 1, name: 'Transactions' });

    expect((await screen.findAllByText(/Cash Withdrawal/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Transfer Debit$/)).toBeNull();
    expect(screen.queryByText(/Cash Deposit/)).toBeNull();
  });

  it('labels the credit leg (cash account itself) of the SAME withdrawal as "Cash Withdrawal" too, not "Cash Deposit"', async () => {
    renderPage(<TransactionsPage />, { route: '/transactions', handlers: txHandlers({ transactions: [WITHDRAWAL_CREDIT_LEG_TX] }) });
    await screen.findByRole('heading', { level: 1, name: 'Transactions' });

    expect((await screen.findAllByText(/Cash Withdrawal/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Cash Deposit/)).toBeNull();
  });

  it('labels the debit leg (cash account itself) of a deposit as "Cash Deposit", not "Cash Withdrawal"', async () => {
    renderPage(<TransactionsPage />, { route: '/transactions', handlers: txHandlers({ transactions: [DEPOSIT_DEBIT_LEG_TX] }) });
    await screen.findByRole('heading', { level: 1, name: 'Transactions' });

    expect((await screen.findAllByText(/Cash Deposit/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Cash Withdrawal/)).toBeNull();
  });

  it('labels the credit leg (bank account) of the SAME deposit as "Cash Deposit" too', async () => {
    renderPage(<TransactionsPage />, { route: '/transactions', handlers: txHandlers({ transactions: [DEPOSIT_CREDIT_LEG_TX] }) });
    await screen.findByRole('heading', { level: 1, name: 'Transactions' });

    expect((await screen.findAllByText(/Cash Deposit/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Cash Withdrawal/)).toBeNull();
  });

  it('keeps the generic "Transfer Debit" label for an ordinary account-to-account transfer', async () => {
    renderPage(<TransactionsPage />, { route: '/transactions', handlers: txHandlers({ transactions: [ORDINARY_TRANSFER_TX] }) });
    await screen.findByRole('heading', { level: 1, name: 'Transactions' });

    expect((await screen.findAllByText(/Transfer Debit/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Cash Withdrawal/)).toBeNull();
  });

  it('offers "Delete transaction" for a transfer-pair row (e.g. an import-created cash withdrawal) — softDeleteTransaction cascades to the paired leg correctly, so this must not be permanently locked', async () => {
    const user = userEvent.setup();
    renderPage(<TransactionsPage />, { route: '/transactions', handlers: txHandlers({ transactions: [WITHDRAWAL_TX] }) });
    await screen.findByRole('heading', { level: 1, name: 'Transactions' });
    await screen.findAllByText(/Cash Withdrawal/);

    const actionsButtons = await screen.findAllByRole('button', { name: /transaction actions/i });
    await user.click(actionsButtons[0]);

    expect(await screen.findByText(/delete transaction/i)).toBeInTheDocument();
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
describe('Recurring tab — category picker follows the rule type', () => {
  async function openAddRule(user: ReturnType<typeof userEvent.setup>) {
    renderPage(<TransactionsPage />, {
      route: '/transactions?tab=recurring',
      handlers: [http.get(url('/recurring'), () => HttpResponse.json({ data: [] })), ...txHandlers()],
    });
    await user.click(await screen.findByRole('button', { name: /add rule/i }));
    return screen.findByLabelText('Category (optional)');
  }

  it('offers only categories of the selected type, none for a transfer, and resets on a type change', async () => {
    const user = userEvent.setup();
    const category = await openAddRule(user);
    const type = screen.getByLabelText(/^type/i);

    await within(category).findByRole('option', { name: 'Food' });
    expect(within(category).queryByRole('option', { name: 'Salary' })).toBeNull();
    await user.selectOptions(category, 'cat-food');

    await user.selectOptions(type, 'INCOME');
    expect(category).toHaveValue('');
    expect(within(category).getByRole('option', { name: 'Salary' })).toBeInTheDocument();
    expect(within(category).queryByRole('option', { name: 'Food' })).toBeNull();

    await user.selectOptions(type, 'TRANSFER');
    expect(within(category).getAllByRole('option')).toHaveLength(1); // just "— None —"
  });
});

describe('Subscriptions tab', () => {
  const SUB = {
    id: 'sub-1', userId: 'u-member', name: 'Netflix', status: 'ACTIVE', category: null, cancelledAt: null,
    trialEndDate: null, startDate: '2025-01-01T00:00:00.000Z', cancelReason: null, notes: null,
    prices: [{ id: 'p-1', amount: 649, effectiveFrom: '2025-01-01T00:00:00.000Z', note: null }],
    currentPrice: 649, annualisedCost: 7788, nextRenewalDate: '2026-09-01T00:00:00.000Z',
    recurringRule: { id: 'rule-1', frequency: 'MONTHLY', nextRunDate: '2026-09-01T00:00:00.000Z', isActive: true, paymentMode: null, bankAccountId: null, categoryId: null, bankAccount: null, category: null },
    usage: { chargeCount: 0, totalPaid: 0, averageCharge: 0, firstChargeDate: null, lastChargeDate: null, priceMismatch: null },
  };
  const subsHandler = (seen: (string | null)[] = []) => http.get(url('/subscriptions'), ({ request }) => {
    seen.push(new URL(request.url).searchParams.get('targetUserId'));
    return HttpResponse.json({ data: [SUB] });
  });

  it('mounts Subscriptions under Transactions with ONE member selector, whose empty option means the whole family', async () => {
    renderPage(<TransactionsPage />, { route: '/transactions?tab=subscriptions', handlers: [subsHandler(), ...txHandlers()] });

    expect(await screen.findByRole('heading', { level: 1, name: /subscriptions/i })).toBeInTheDocument();
    expect(await screen.findByText('Netflix')).toBeInTheDocument();
    expect(screen.getAllByLabelText(/view:/i)).toHaveLength(1);
    expect(within(screen.getByLabelText(/view:/i)).getByRole('option', { name: 'All Family' })).toHaveValue('');
    expect(screen.getByText(/choose a member above/i)).toBeInTheDocument();
  });

  it('scopes the list to the member chosen on Transactions, and then allows adding', async () => {
    const user = userEvent.setup();
    const seen: (string | null)[] = [];
    renderPage(<TransactionsPage />, { route: '/transactions?tab=subscriptions', handlers: [subsHandler(seen), ...txHandlers()] });
    await screen.findByText('Netflix');

    await user.selectOptions(screen.getByLabelText(/view:/i), 'u-member');

    await waitFor(() => expect(seen).toContain('u-member'));
    expect(await screen.findByRole('button', { name: /add subscription/i })).toBeInTheDocument();
  });

  it('is not blanked while the (unrelated) transactions list is still loading', async () => {
    renderPage(<TransactionsPage />, {
      route: '/transactions?tab=subscriptions',
      handlers: [
        subsHandler(),
        http.get(url('/transactions'), () => new Promise<never>(() => {})), // never resolves
        ...txHandlers(),
      ],
    });
    expect(await screen.findByText('Netflix')).toBeInTheDocument();
  });

  it('does not claim "0 transactions" while the list is still loading', async () => {
    renderPage(<TransactionsPage />, {
      route: '/transactions',
      handlers: [http.get(url('/transactions'), () => new Promise<never>(() => {})), ...txHandlers()],
    });
    expect(await screen.findByText(/… transactions/)).toBeInTheDocument();
    expect(screen.queryByText(/\b0 transactions/)).toBeNull();
  });

  it('"Manage subscription" on a subscription-owned recurring rule switches to this tab in place', async () => {
    const user = userEvent.setup();
    renderPage(<><TransactionsPage /><SearchParamsProbe /></>, {
      route: '/transactions?tab=recurring',
      handlers: [
        http.get(url('/recurring'), () => HttpResponse.json({ data: [SUBSCRIPTION_RULE] })),
        subsHandler(),
        ...txHandlers(),
      ],
    });
    await user.click(await screen.findByRole('link', { name: /manage subscription/i }));

    expect(await screen.findByRole('heading', { level: 1, name: /subscriptions/i })).toBeInTheDocument();
    expect(screen.getByTestId('search-params')).toHaveTextContent('tab=subscriptions');
  });
});

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
    expect(link).toHaveAttribute('href', '/transactions?tab=subscriptions');

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

  it('an unknown ?tab value falls back to Transactions, never a blank page', async () => {
    renderPage(<TransactionsPage />, { route: '/transactions?tab=bogus', handlers: txHandlers() });
    expect((await screen.findAllByText('Grocery run')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { level: 1, name: 'Recurring Transactions' })).not.toBeInTheDocument();
    // "Recurring" also appears as the tab-switcher button's own label, so absence of
    // that heading (not absence of the text "recurring") is the real signal here.
    expect(screen.getByRole('button', { name: /^transactions$/i })).toHaveClass('border-primary');
  });

  it('?tab=constructor also falls back — an object-key lookup would wrongly accept it', async () => {
    // The reason the tab guard is TABS.includes(v), not TAB_META[v]: a plain object's
    // inherited keys (constructor, toString, __proto__, ...) are truthy lookups too.
    renderPage(<TransactionsPage />, { route: '/transactions?tab=constructor', handlers: txHandlers() });
    expect((await screen.findAllByText('Grocery run')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { level: 1, name: 'Recurring Transactions' })).not.toBeInTheDocument();
  });

  it('?tab=bogus&add=1 still opens the Add modal, over the (fallback) Transactions tab, and the bogus tab survives in the URL', async () => {
    // The one path where this fix intersects the ?add=1 mount effect's own documented
    // ordering-bug history: the effect strips `add`/`startDate`/`endDate` from the URL
    // but deliberately re-writes the RAW (unvalidated) tab value back in.
    renderPage(<><TransactionsPage /><SearchParamsProbe /></>, {
      route: '/transactions?tab=bogus&add=1',
      handlers: txHandlers(),
    });

    expect((await screen.findAllByText('Grocery run')).length).toBeGreaterThan(0);
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Add Transaction' }),
    ).toBeInTheDocument();
    // Exact final state, not just "doesn't contain add=1" — pins both that `tab`
    // survives AND that every other param (add, or some other value like add=0) is gone.
    await waitFor(() => {
      expect(screen.getByTestId('search-params')).toHaveTextContent(/^tab=bogus$/);
    });
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
    // 'Add Transaction' is both the modal's h2 and its submit button
    // (components/transactions/AddTransactionModal.tsx:130,215), so match the heading
    // specifically.
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

describe('Transactions page — member filter persists across tabs', () => {
  it('a selection made on Transactions survives Recurring -> back to Transactions, sent as the real outgoing param on each', async () => {
    const user = userEvent.setup();
    const txRequests: (string | null)[] = [];
    const recurringRequests: (string | null)[] = [];
    renderPage(<TransactionsPage />, {
      route: '/transactions',
      handlers: [
        http.get(url('/transactions'), ({ request }) => {
          txRequests.push(new URL(request.url).searchParams.get('targetUserId'));
          return HttpResponse.json({ data: [TX], pagination: PAGINATION });
        }),
        http.get(url('/budgets/vs-actuals'), () => HttpResponse.json({ data: [] })),
        http.get(url('/category-rules'), () => HttpResponse.json({ data: [] })),
        http.get(url('/recurring'), ({ request }) => {
          recurringRequests.push(new URL(request.url).searchParams.get('targetUserId'));
          return HttpResponse.json({ data: [] });
        }),
        http.get(url('/loans'), () => HttpResponse.json({ data: [] })),
        http.get(url('/investments/sip'), () => HttpResponse.json({ data: [] })),
        http.get(url('/insurance'), () => HttpResponse.json({ data: [] })),
      ],
    });
    await screen.findByRole('heading', { level: 1, name: 'Transactions' });
    await waitFor(() => expect(txRequests).toEqual([null]));

    await user.selectOptions(screen.getByLabelText(/view:/i), 'u-member');
    await waitFor(() => expect(txRequests).toEqual([null, 'u-member']));

    await user.click(screen.getByRole('button', { name: /^recurring$/i }));
    await screen.findByRole('heading', { level: 1, name: 'Recurring Transactions' });
    // The regression this guards: before the fix, RecurringRulesPage held its own
    // independent viewUserId state and this request would carry no targetUserId param
    // at all (null). Asserting the full array, not just the last entry.
    await waitFor(() => expect(recurringRequests).toEqual(['u-member']));
    expect((screen.getByLabelText(/view:/i) as HTMLSelectElement).value).toBe('u-member');

    await user.click(screen.getByRole('button', { name: /^transactions$/i }));
    expect((await screen.findAllByText('Grocery run')).length).toBeGreaterThan(0);
    // Unlike Assets.tsx's `assets` query, the transactions query has no `enabled` gate
    // on activeTab — it's always mounted with the always-visible parent, so it was
    // already re-fetched at the point of selection above and switching tabs triggers no
    // further request. Asserted once, after the DOM has settled on the returned tab
    // (a waitFor here would only prove the array reaches this shape, not that it stays
    // there — it resolves on the first passing check).
    expect(txRequests).toEqual([null, 'u-member']);
    expect((screen.getByLabelText(/view:/i) as HTMLSelectElement).value).toBe('u-member');
  });

  it('changing the member while on the Recurring tab immediately re-scopes it', async () => {
    const user = userEvent.setup();
    const recurringRequests: (string | null)[] = [];
    renderPage(<TransactionsPage />, {
      route: '/transactions?tab=recurring',
      handlers: txHandlers({ recurringRequests }),
    });
    await screen.findByRole('heading', { level: 1, name: 'Recurring Transactions' });
    await waitFor(() => expect(recurringRequests).toEqual([null]));

    await user.selectOptions(screen.getByLabelText(/view:/i), 'u-member');

    await waitFor(() => expect(recurringRequests).toEqual([null, 'u-member']));
  });

  it('the selector is absent for a MEMBER role on both tabs', async () => {
    renderPage(<TransactionsPage />, {
      route: '/transactions', user: MEMBER_USER, handlers: txHandlers(),
    });
    await screen.findByRole('heading', { level: 1, name: 'Transactions' });
    expect(screen.queryByLabelText(/view:/i)).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^recurring$/i }));
    await screen.findByRole('heading', { level: 1, name: 'Recurring Transactions' });
    expect(screen.queryByLabelText(/view:/i)).not.toBeInTheDocument();
  });

  it('the empty option reads "My Data" on Recurring but "All Family" on Transactions', async () => {
    const user = userEvent.setup();
    renderPage(<TransactionsPage />, { route: '/transactions', handlers: txHandlers() });
    await screen.findByRole('heading', { level: 1, name: 'Transactions' });
    expect(screen.getByLabelText(/view:/i)).toHaveTextContent('All Family');

    await user.click(screen.getByRole('button', { name: /^recurring$/i }));
    await screen.findByRole('heading', { level: 1, name: 'Recurring Transactions' });
    // Recurring can't express true family-wide scope (backend falls back to the
    // admin's own data when unselected) — the label must say so, not lie.
    expect(screen.getByLabelText(/view:/i)).toHaveTextContent('My Data');
    expect(screen.getByLabelText(/view:/i)).not.toHaveTextContent('All Family');
  });
});

describe('Transactions page — Recurring tab mutations carry the selected member', () => {
  it('Generate Now carries the selected member as targetUserId', async () => {
    const user = userEvent.setup();
    let capturedParam: string | null = null;
    renderPage(<TransactionsPage />, {
      route: '/transactions?tab=recurring',
      handlers: [
        ...txHandlers({ rules: [RULE] }),
        http.post(url('/recurring/generate'), ({ request }) => {
          capturedParam = new URL(request.url).searchParams.get('targetUserId');
          return HttpResponse.json({ data: { generated: 1 } });
        }),
      ],
    });
    await screen.findByText('Gym membership');
    await user.selectOptions(screen.getByLabelText(/view:/i), 'u-member');

    await user.click(screen.getByRole('button', { name: /generate now/i }));

    await waitFor(() => expect(capturedParam).toBe('u-member'));
  });

  it('creating a rule carries the selected member as targetUserId', async () => {
    const user = userEvent.setup();
    let capturedParam: string | null = null;
    renderPage(<TransactionsPage />, {
      route: '/transactions?tab=recurring',
      handlers: [
        ...txHandlers({ transactions: [] }),
        http.post(url('/recurring'), ({ request }) => {
          capturedParam = new URL(request.url).searchParams.get('targetUserId');
          return HttpResponse.json({ data: { ...RULE, id: 'rule-new' } }, { status: 201 });
        }),
      ],
    });
    await screen.findByRole('heading', { level: 1, name: 'Recurring Transactions' });
    await user.selectOptions(screen.getByLabelText(/view:/i), 'u-member');

    await user.click(screen.getByRole('button', { name: /add rule/i }));
    await user.type(screen.getByLabelText(/description/i), 'Netflix');
    await user.type(screen.getByLabelText(/amount/i), '499');
    // nextRunDate already has a valid default (toDateInputValue(new Date())) — typing
    // into it would append onto the prefilled value instead of replacing it.
    await user.click(screen.getByRole('button', { name: /create rule/i }));

    await waitFor(() => expect(capturedParam).toBe('u-member'));
  });

  it('applying (Zap) a rule targets the rule owner, not the current viewUserId selection', async () => {
    const user = userEvent.setup();
    let capturedParam: string | null = null;
    renderPage(<TransactionsPage />, {
      route: '/transactions?tab=recurring',
      handlers: [
        ...txHandlers({ rules: [RULE] }),
        http.post(url('/transactions'), ({ request }) => {
          capturedParam = new URL(request.url).searchParams.get('targetUserId');
          return HttpResponse.json({ data: { ...TX, id: 'tx-applied' } }, { status: 201 });
        }),
      ],
    });
    await screen.findByText('Gym membership');
    // Deliberately select a DIFFERENT member than the rule's own owner (u-member) to
    // prove apply targets rule.userId, not the shared selector's current value.
    await user.selectOptions(screen.getByLabelText(/view:/i), 'u-admin');

    await user.click(screen.getByTitle(/apply now/i));

    await waitFor(() => expect(capturedParam).toBe('u-member'));
  });

  // Both mutations create transactions server-side (generate bulk-creates, apply POSTs
  // /transactions directly — the same endpoint AddTransactionModal's create mutation
  // uses) so both need the same invalidation contract, not just ['transactions'].
  it('Generate Now invalidates the full key set on success', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderPage(<TransactionsPage />, {
      route: '/transactions?tab=recurring',
      handlers: [
        ...txHandlers({ rules: [RULE] }),
        http.post(url('/recurring/generate'), () => HttpResponse.json({ data: { generated: 1 } })),
      ],
    });
    await screen.findByText('Gym membership');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await user.click(screen.getByRole('button', { name: /generate now/i }));

    await waitFor(() => {
      for (const key of FULL_INVALIDATION_KEYS) expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [key] });
    });
  });

  it('Apply Now invalidates the full key set on success', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderPage(<TransactionsPage />, {
      route: '/transactions?tab=recurring',
      handlers: [
        ...txHandlers({ rules: [RULE] }),
        http.post(url('/transactions'), () => HttpResponse.json({ data: { ...TX, id: 'tx-applied' } }, { status: 201 })),
      ],
    });
    await screen.findByText('Gym membership');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await user.click(screen.getByTitle(/apply now/i));

    await waitFor(() => {
      for (const key of FULL_INVALIDATION_KEYS) expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [key] });
    });
  });

  it('a selection made on Transactions is inherited by Recurring — Generate Now and Create Rule both carry it', async () => {
    const user = userEvent.setup();
    let generateParam: string | null = null;
    renderPage(<TransactionsPage />, {
      route: '/transactions',
      handlers: [
        ...txHandlers({ rules: [RULE] }),
        http.post(url('/recurring/generate'), ({ request }) => {
          generateParam = new URL(request.url).searchParams.get('targetUserId');
          return HttpResponse.json({ data: { generated: 1 } });
        }),
      ],
    });
    await screen.findByRole('heading', { level: 1, name: 'Transactions' });
    // Selection made on the TRANSACTIONS tab — never touching the Recurring tab's own
    // selector at all, since it's the same shared control now.
    await user.selectOptions(screen.getByLabelText(/view:/i), 'u-member');

    await user.click(screen.getByRole('button', { name: /^recurring$/i }));
    await screen.findByText('Gym membership');
    expect((screen.getByLabelText(/view:/i) as HTMLSelectElement).value).toBe('u-member');

    await user.click(screen.getByRole('button', { name: /generate now/i }));
    await waitFor(() => expect(generateParam).toBe('u-member'));
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

// ─── Cache invalidation: edit/delete/import/bulk/convert must keep Dashboard, Reports,
// and Accounts in sync, not just the transactions list itself ───────────────────────
//
// staleTime is 5 minutes and refetchOnWindowFocus is off (lib/queryClient.ts), so
// without invalidation these views would silently show stale data for up to 5 minutes
// after any of these mutations. Desktop table + mobile card both render every
// transaction row (Tailwind's responsive classes don't hide either in jsdom), so every
// query below reaches for the FIRST match via getAllBy*.
const FULL_INVALIDATION_KEYS = ['transactions', 'loans', 'budgets', 'budgets-actuals', 'accounts', 'dashboard', 'profit-and-loss', 'report-spending'];

describe('Transactions page — category ↔ type (edit + bulk re-categorize)', () => {
  const INCOME_TX = {
    ...TX, id: 'tx-2', description: 'Salary credit', type: 'INCOME',
    categoryId: 'cat-sal', category: { id: 'cat-sal', name: 'Salary', type: 'INCOME' },
  };

  async function openEdit(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getAllByTitle('Transaction actions')[0]);
    await user.click(await screen.findByText('Edit transaction'));
    await screen.findByRole('heading', { name: 'Edit Transaction' });
  }

  function capturePut(id: string, onBody: (body: any) => void, status = 200, message?: string) {
    return http.put(url(`/transactions/${id}`), async ({ request }) => {
      onBody(await request.json());
      return status === 200
        ? HttpResponse.json({ data: TX })
        : HttpResponse.json({ message }, { status });
    });
  }

  it('choosing "Uncategorized" actually clears the category (sends null, not "unchanged")', async () => {
    const user = userEvent.setup();
    let body: any = null;
    renderPage(<TransactionsPage />, {
      route: '/transactions',
      handlers: [...txHandlers(), capturePut('tx-1', (b) => { body = b; })],
    });
    await screen.findAllByText('Grocery run');
    await openEdit(user);

    await user.selectOptions(await screen.findByLabelText('Category (optional)'), '');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body.categoryId).toBeNull();
  });

  it('resends the unchanged category on an ordinary save', async () => {
    const user = userEvent.setup();
    let body: any = null;
    renderPage(<TransactionsPage />, {
      route: '/transactions',
      handlers: [...txHandlers(), capturePut('tx-1', (b) => { body = b; })],
    });
    await screen.findAllByText('Grocery run');
    await openEdit(user);
    await screen.findByRole('option', { name: 'Food' });

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(body?.categoryId).toBe('cat-food'));
  });

  it('switching the type away and back restores the original category', async () => {
    const user = userEvent.setup();
    renderPage(<TransactionsPage />, { route: '/transactions', handlers: txHandlers() });
    await screen.findAllByText('Grocery run');
    await openEdit(user);
    const category = await screen.findByLabelText('Category (optional)');
    await screen.findByRole('option', { name: 'Food' });
    const type = screen.getByDisplayValue('Expense');

    await user.selectOptions(type, 'INCOME');
    expect(category).toHaveValue('');
    await user.selectOptions(type, 'EXPENSE');
    expect(category).toHaveValue('cat-food');
  });

  it('bulk: only offers income/expense categories', async () => {
    renderPage(<TransactionsPage />, {
      route: '/transactions',
      handlers: [
        ...txHandlers(),
        http.get(url('/categories'), () => HttpResponse.json({
          data: [...CATEGORIES, { id: 'cat-gold', name: 'Gold', type: 'ASSET', parentId: null }],
        })),
      ],
    });
    await screen.findAllByText('Grocery run');
    const user = userEvent.setup();
    await user.click(within(screen.getAllByRole('row')[1]).getByRole('checkbox'));
    const picker = screen.getByDisplayValue(/assign category/i);
    await within(picker).findByRole('option', { name: 'Rent' });
    expect(within(picker).queryByRole('option', { name: 'Gold' })).toBeNull();
  });

  it('bulk: skips rows whose type does not fit the chosen category, and says why', async () => {
    const user = userEvent.setup();
    const puts: string[] = [];
    renderPage(<TransactionsPage />, {
      route: '/transactions',
      handlers: [
        ...txHandlers({ transactions: [TX, INCOME_TX] }),
        http.get(url('/categories'), () => HttpResponse.json({ data: CATEGORIES })),
        http.put(url('/transactions/:id'), ({ params }) => {
          puts.push(params.id as string);
          return HttpResponse.json({ data: TX });
        }),
      ],
    });
    await screen.findAllByText('Grocery run');

    await user.click(within(screen.getAllByRole('row')[1]).getByRole('checkbox'));
    await user.click(within(screen.getAllByRole('row')[2]).getByRole('checkbox'));
    await user.selectOptions(screen.getByDisplayValue(/assign category/i), 'cat-rent');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));

    expect(await screen.findByText('Categorized 1 · skipped 1')).toBeInTheDocument();
    expect(screen.getByText('Rent is an expense category, so transactions of other types were skipped.')).toBeInTheDocument();
    expect(puts).toEqual(['tx-1']);
  });

  it('bulk: still reports skipped rows when others fail', async () => {
    const user = userEvent.setup();
    renderPage(<TransactionsPage />, {
      route: '/transactions',
      handlers: [
        ...txHandlers({ transactions: [TX, INCOME_TX] }),
        http.get(url('/categories'), () => HttpResponse.json({ data: CATEGORIES })),
        capturePut('tx-1', () => {}, 400, 'Transfers cannot be categorized'),
      ],
    });
    await screen.findAllByText('Grocery run');

    await user.click(within(screen.getAllByRole('row')[1]).getByRole('checkbox'));
    await user.click(within(screen.getAllByRole('row')[2]).getByRole('checkbox'));
    await user.selectOptions(screen.getByDisplayValue(/assign category/i), 'cat-rent');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));

    expect(await screen.findByText('Categorized 0/1 — 1 failed · skipped 1')).toBeInTheDocument();
  });

  it('bulk: shows the server\'s reason when a row is rejected', async () => {
    const user = userEvent.setup();
    renderPage(<TransactionsPage />, {
      route: '/transactions',
      handlers: [
        ...txHandlers(),
        http.get(url('/categories'), () => HttpResponse.json({ data: CATEGORIES })),
        capturePut('tx-1', () => {}, 400, 'Transfers cannot be categorized'),
      ],
    });
    await screen.findAllByText('Grocery run');

    await user.click(within(screen.getAllByRole('row')[1]).getByRole('checkbox'));
    await user.selectOptions(screen.getByDisplayValue(/assign category/i), 'cat-rent');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));

    expect(await screen.findByText('Categorized 0/1 — 1 failed')).toBeInTheDocument();
    expect((await screen.findAllByText('Transfers cannot be categorized')).length).toBeGreaterThan(0);
  });
});

describe('Transactions page — edit/delete/import/bulk/convert cache invalidation', () => {
  it('editMutation invalidates the full key set on success', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderPage(<TransactionsPage />, {
      route: '/transactions',
      handlers: [...txHandlers(), http.put(url('/transactions/tx-1'), () => HttpResponse.json({ data: TX }))],
    });
    await screen.findAllByText('Grocery run');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await user.click(screen.getAllByTitle('Transaction actions')[0]);
    await user.click(await screen.findByText('Edit transaction'));
    await screen.findByRole('heading', { name: 'Edit Transaction' });
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      for (const key of FULL_INVALIDATION_KEYS) expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [key] });
    });
  });

  it('deleteMutation invalidates the full key set on success', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderPage(<TransactionsPage />, {
      route: '/transactions',
      handlers: [...txHandlers(), http.delete(url('/transactions/tx-1'), () => HttpResponse.json({ success: true }))],
    });
    await screen.findAllByText('Grocery run');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await user.click(screen.getAllByTitle('Transaction actions')[0]);
    await user.click(await screen.findByText('Delete transaction'));
    await screen.findByRole('heading', { name: 'Delete Transaction' });
    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => {
      for (const key of FULL_INVALIDATION_KEYS) expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [key] });
    });
  });

  it('importMutation invalidates the full key set on success', async () => {
    const user = userEvent.setup();
    const { container, queryClient } = renderPage(<TransactionsPage />, {
      route: '/transactions',
      handlers: [
        ...txHandlers(),
        http.get(url('/accounts'), () => HttpResponse.json({ data: ACCOUNTS })),
        http.get(url('/categories'), () => HttpResponse.json({ data: CATEGORIES })),
        http.get(url('/category-rules'), () => HttpResponse.json({ data: [] })),
        http.post(url('/transactions/import'), () => HttpResponse.json({ data: { imported: 1, skipped: 0, errors: [] } })),
      ],
    });
    await screen.findAllByText('Grocery run');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await user.click(screen.getByRole('button', { name: /import csv/i }));
    await screen.findByRole('heading', { name: 'Import Bank Statement' });
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['date,amount\n2025-06-01,100'], 'statement.csv', { type: 'text/csv' });
    await user.upload(fileInput, file);
    await user.click(screen.getByRole('button', { name: /^import$/i }));

    await waitFor(() => {
      for (const key of FULL_INVALIDATION_KEYS) expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [key] });
    });
  });

  it('handleBulkDelete invalidates the full key set on success', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderPage(<TransactionsPage />, {
      route: '/transactions',
      handlers: [...txHandlers(), http.delete(url('/transactions/tx-1'), () => HttpResponse.json({ success: true }))],
    });
    await screen.findAllByText('Grocery run');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    // Row 0 is the desktop table's header ('Select all'); row 1 is the first (only)
    // data row in this fixture — scoping avoids accidentally clicking select-all.
    await user.click(within(screen.getAllByRole('row')[1]).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() => {
      for (const key of FULL_INVALIDATION_KEYS) expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [key] });
    });
  });

  it('handleBulkCategorize invalidates transactions/budgets/dashboard/financial-reports but NOT accounts/loans (categoryId-only PUT cannot touch balances)', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderPage(<TransactionsPage />, {
      route: '/transactions',
      handlers: [
        ...txHandlers(),
        http.get(url('/categories'), () => HttpResponse.json({ data: CATEGORIES })),
        http.put(url('/transactions/tx-1'), () => HttpResponse.json({ data: TX })),
      ],
    });
    await screen.findAllByText('Grocery run');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    // Row 0 is the desktop table's header ('Select all'); row 1 is the first (only)
    // data row in this fixture — scoping avoids accidentally clicking select-all.
    await user.click(within(screen.getAllByRole('row')[1]).getByRole('checkbox'));
    await user.selectOptions(screen.getByDisplayValue(/assign category/i), 'cat-rent');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));

    await waitFor(() => {
      for (const key of ['transactions', 'budgets', 'budgets-actuals', 'dashboard', 'profit-and-loss', 'report-spending']) {
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [key] });
      }
    });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['accounts'] });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['loans'] });
  });

  it('convertMutation (Mark as Transfer) invalidates dashboard/financial-reports in addition to its existing transactions/accounts/budgets', async () => {
    const user = userEvent.setup();
    // canConvertToTransfer requires a truthy bankAccountId (the txn's OWN source
    // account); set it to an id NOT in ACCOUNTS so 'acc-1' remains a valid, distinct
    // destination option in the modal's "To Account" select.
    const TRANSFERABLE_TX = { ...TX, bankAccountId: 'acc-source' };
    const { queryClient } = renderPage(<TransactionsPage />, {
      route: '/transactions',
      handlers: [
        ...txHandlers({ transactions: [TRANSFERABLE_TX] }),
        http.get(url('/accounts'), () => HttpResponse.json({ data: ACCOUNTS })),
        http.get(url('/transactions/tx-1/transfer-counterpart-candidates'), () => HttpResponse.json({ data: [] })),
        http.post(url('/transactions/tx-1/convert-to-transfer'), () => HttpResponse.json({ data: TX })),
      ],
    });
    await screen.findAllByText('Grocery run');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await user.click(screen.getAllByTitle('Transaction actions')[0]);
    await user.click(await screen.findByText('Mark as transfer'));
    const heading = await screen.findByRole('heading', { name: 'Mark as Transfer' });
    const modal = heading.closest('div.space-y-4') as HTMLElement;
    // The destination-account <select> has no htmlFor/id pairing with its <Label> —
    // scope to the modal since the background page still has its own "View:" combobox.
    await user.selectOptions(within(modal).getByRole('combobox'), 'acc-1');
    await waitFor(() => expect(within(modal).getByRole('button', { name: /mark as transfer/i })).toBeEnabled());
    await user.click(within(modal).getByRole('button', { name: /^mark as transfer$/i }));

    await waitFor(() => {
      for (const key of FULL_INVALIDATION_KEYS.filter((k) => k !== 'loans')) {
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [key] });
      }
    });
  });
});
