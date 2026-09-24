/**
 * AddTransactionModal — extracted from Transactions.tsx (Task 6 of the Dashboard
 * improvement series) so Dashboard's new quick-add buttons and Transactions.tsx's
 * existing "Add Transaction" flow share one implementation, not two copies.
 *
 * The `defaultType` prop is the actual new behavior this extraction adds — omitting it
 * (as Transactions.tsx's own call site does) must still default to EXPENSE, unchanged
 * from before the extraction.
 *
 * Amount/Type/Payment-Mode/Bank-Account fields have no htmlFor/id label association
 * (pre-existing, unchanged by this extraction — out of scope to fix here), so tests
 * query by the `name` attribute react-hook-form's `register()` sets, via `container`,
 * rather than `getByLabelText`.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { AddTransactionModal } from '@/components/transactions/AddTransactionModal';
import { renderPage, failOnConsoleError } from '../../support/renderPage';
import { url } from '../../support/handlers';
import { CATEGORIES, ACCOUNTS } from '../../support/fixtures';
import type { BudgetActualItem } from '@/hooks/useBudgetsVsActuals';

failOnConsoleError();

const formHandlers = () => [
  http.get(url('/categories'), () => HttpResponse.json({ data: CATEGORIES })),
  http.get(url('/accounts'), () => HttpResponse.json({ data: ACCOUNTS })),
  http.get(url('/loans'), () => HttpResponse.json({ data: [] })),
];

async function fillMinimalForm(user: ReturnType<typeof userEvent.setup>, container: HTMLElement) {
  await user.type(screen.getByPlaceholderText(/swiggy order/i), 'Test transaction');
  const amountInput = container.querySelector('input[name="amount"]') as HTMLInputElement;
  await user.type(amountInput, '500');
}

describe('AddTransactionModal', () => {
  it('defaults to EXPENSE when defaultType is omitted (Transactions.tsx\'s own call site)', async () => {
    const { container } = renderPage(<AddTransactionModal onClose={vi.fn()} budgetActuals={[]} />, {
      route: '/', handlers: formHandlers(),
    });
    await screen.findByPlaceholderText(/swiggy order/i);

    const typeSelect = container.querySelector('select[name="type"]') as HTMLSelectElement;
    expect(typeSelect.value).toBe('EXPENSE');
  });

  it('pre-selects INCOME when defaultType="INCOME" (Dashboard\'s new "Add Income" shortcut)', async () => {
    const { container } = renderPage(<AddTransactionModal onClose={vi.fn()} budgetActuals={[]} defaultType="INCOME" />, {
      route: '/', handlers: formHandlers(),
    });
    await screen.findByPlaceholderText(/swiggy order/i);

    const typeSelect = container.querySelector('select[name="type"]') as HTMLSelectElement;
    expect(typeSelect.value).toBe('INCOME');
    // Category list is filtered to INCOME categories once the /categories query settles.
    expect(await screen.findByRole('option', { name: 'Salary' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Food' })).toBeNull();
  });

  it('category dropdown re-filters when the type is switched', async () => {
    const user = userEvent.setup();
    const { container } = renderPage(<AddTransactionModal onClose={vi.fn()} budgetActuals={[]} defaultType="INCOME" />, {
      route: '/', handlers: formHandlers(),
    });
    await screen.findByPlaceholderText(/swiggy order/i);

    const typeSelect = container.querySelector('select[name="type"]') as HTMLSelectElement;
    await screen.findByRole('option', { name: 'Salary' }); // wait for /categories to settle first
    await user.selectOptions(typeSelect, 'EXPENSE');

    expect(screen.getByRole('option', { name: 'Food' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Rent' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Salary' })).toBeNull();
  });

  it('invalidates dashboard/report-spending/profit-and-loss on success, not just transactions/loans/budgets', async () => {
    const user = userEvent.setup();
    const { container, queryClient } = renderPage(
      <AddTransactionModal onClose={vi.fn()} budgetActuals={[]} defaultType="INCOME" />,
      {
        route: '/',
        handlers: [...formHandlers(), http.post(url('/transactions'), () => HttpResponse.json({ data: {} }))],
      },
    );
    await screen.findByPlaceholderText(/swiggy order/i);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await fillMinimalForm(user, container);
    await user.click(screen.getByRole('button', { name: 'Add Transaction' }));

    await waitFor(() => {
      for (const key of ['transactions', 'loans', 'budgets', 'budgets-actuals', 'dashboard', 'profit-and-loss', 'report-spending', 'accounts']) {
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [key] });
      }
    });
  });

  it('sends targetUserId as a query param when provided', async () => {
    const user = userEvent.setup();
    let seenParams: URLSearchParams | null = null;
    const { container } = renderPage(
      <AddTransactionModal onClose={vi.fn()} budgetActuals={[]} targetUserId="u-member" />,
      {
        route: '/',
        handlers: [
          ...formHandlers(),
          http.post(url('/transactions'), ({ request }) => {
            seenParams = new URL(request.url).searchParams;
            return HttpResponse.json({ data: {} });
          }),
        ],
      },
    );
    await screen.findByPlaceholderText(/swiggy order/i);

    await fillMinimalForm(user, container);
    await user.click(screen.getByRole('button', { name: 'Add Transaction' }));

    await waitFor(() => expect(seenParams?.get('targetUserId')).toBe('u-member'));
  });

  it('the minimal quick-add path (description + amount only) never sends empty-string cuid/enum fields', async () => {
    // The backend's Zod schema types categoryId/bankAccountId/transferToAccountId as
    // `.cuid().optional()` and paymentMode as `.enum().optional()` — all four accept
    // `undefined` but reject `''`. The <select>s' "— None —"/"— Select —" options have
    // value="", so submitting the FASTEST possible path (the whole point of a quick-add
    // button) without touching any dropdown must not send those as empty strings, or
    // the backend 422s and the feature's primary use case is broken.
    const user = userEvent.setup();
    let seenBody: Record<string, unknown> | null = null;
    const { container } = renderPage(
      <AddTransactionModal onClose={vi.fn()} budgetActuals={[]} />,
      {
        route: '/',
        handlers: [
          ...formHandlers(),
          http.post(url('/transactions'), async ({ request }) => {
            seenBody = (await request.json()) as Record<string, unknown>;
            return HttpResponse.json({ data: {} });
          }),
        ],
      },
    );
    await screen.findByPlaceholderText(/swiggy order/i);

    await fillMinimalForm(user, container);
    await user.click(screen.getByRole('button', { name: 'Add Transaction' }));

    await waitFor(() => expect(seenBody).not.toBeNull());
    expect(seenBody!.categoryId).toBeUndefined();
    expect(seenBody!.bankAccountId).toBeUndefined();
    expect(seenBody!.paymentMode).toBeUndefined();
    expect(seenBody!.transferToAccountId).toBeUndefined();
  });

  describe('rule-based auto-categorization (category left blank)', () => {
    const FOOD_BUDGET: BudgetActualItem = {
      id: 'b-1', categoryId: 'cat-food', amount: 1000, period: 'MONTHLY', fyYear: null,
      category: { id: 'cat-food', name: 'Food', color: null, icon: null },
      actual: 900, remaining: 100, pctUsed: 90,
    };

    function renderWithServerCategory(created: Record<string, unknown>, budgetActuals: BudgetActualItem[] = []) {
      return renderPage(<AddTransactionModal onClose={vi.fn()} budgetActuals={budgetActuals} />, {
        route: '/',
        handlers: [...formHandlers(), http.post(url('/transactions'), () => HttpResponse.json({ data: created }))],
      });
    }

    it('shows a hint that a blank category may be auto-assigned', async () => {
      renderWithServerCategory({});
      expect(await screen.findByText('Leave blank to auto-assign using matching rules.')).toBeInTheDocument();
    });

    it('hides that hint for a TRANSFER, which is never categorized', async () => {
      const user = userEvent.setup();
      const { container } = renderWithServerCategory({});
      await screen.findByText('Leave blank to auto-assign using matching rules.');
      await user.selectOptions(container.querySelector('select[name="type"]') as HTMLSelectElement, 'TRANSFER');
      expect(screen.queryByText('Leave blank to auto-assign using matching rules.')).toBeNull();
    });

    it('names the category the server auto-assigned in the success toast', async () => {
      const user = userEvent.setup();
      const { container } = renderWithServerCategory({ categoryId: 'cat-food', category: { name: 'Food' } });
      await screen.findByPlaceholderText(/swiggy order/i);

      await fillMinimalForm(user, container);
      await user.click(screen.getByRole('button', { name: 'Add Transaction' }));

      expect(await screen.findByText('Auto-categorized as Food')).toBeInTheDocument();
    });

    it('runs the budget check against the auto-assigned category (the server response, not the empty form value)', async () => {
      const user = userEvent.setup();
      const { container } = renderWithServerCategory(
        { categoryId: 'cat-food', category: { name: 'Food' } },
        [FOOD_BUDGET],
      );
      await screen.findByPlaceholderText(/swiggy order/i);

      await fillMinimalForm(user, container); // ₹500 on top of ₹900 of a ₹1000 budget
      await user.click(screen.getByRole('button', { name: 'Add Transaction' }));

      expect(await screen.findByText('Budget exceeded: Food')).toBeInTheDocument();
    });

    it('says nothing about auto-categorization when no rule matched', async () => {
      const user = userEvent.setup();
      const { container } = renderWithServerCategory({ categoryId: null, category: null });
      await screen.findByPlaceholderText(/swiggy order/i);

      await fillMinimalForm(user, container);
      await user.click(screen.getByRole('button', { name: 'Add Transaction' }));

      expect(await screen.findByText('Transaction added')).toBeInTheDocument();
      expect(screen.queryByText(/Auto-categorized as/)).toBeNull();
    });

    it('does not claim auto-categorization when the user picked the category themselves', async () => {
      const user = userEvent.setup();
      const { container } = renderWithServerCategory({ categoryId: 'cat-rent', category: { name: 'Rent' } });
      await screen.findByRole('option', { name: 'Rent' });

      await fillMinimalForm(user, container);
      await user.selectOptions(screen.getByLabelText('Category (optional)'), 'cat-rent');
      await user.click(screen.getByRole('button', { name: 'Add Transaction' }));

      expect(await screen.findByText('Transaction added')).toBeInTheDocument();
      expect(screen.queryByText(/Auto-categorized as/)).toBeNull();
    });
  });

  it('omits targetUserId entirely when none is provided (not even as an empty string)', async () => {
    const user = userEvent.setup();
    let seenParams: URLSearchParams | null = null;
    const { container } = renderPage(
      <AddTransactionModal onClose={vi.fn()} budgetActuals={[]} />,
      {
        route: '/',
        handlers: [
          ...formHandlers(),
          http.post(url('/transactions'), ({ request }) => {
            seenParams = new URL(request.url).searchParams;
            return HttpResponse.json({ data: {} });
          }),
        ],
      },
    );
    await screen.findByPlaceholderText(/swiggy order/i);

    await fillMinimalForm(user, container);
    await user.click(screen.getByRole('button', { name: 'Add Transaction' }));

    await waitFor(() => expect(seenParams).not.toBeNull());
    expect(seenParams!.has('targetUserId')).toBe(false);
  });
});
