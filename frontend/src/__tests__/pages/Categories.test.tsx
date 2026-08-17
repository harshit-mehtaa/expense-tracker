/**
 * Categories page — smoke.
 *
 * The ONE page in the app with a real query-error branch (:254-256), so this is the
 * only smoke test that can assert an error MESSAGE rather than an error toast. Every
 * other page renders a failed load identically to empty data.
 *
 * Leg 4 (money) is skipped: this page renders no monetary values.
 *
 * Handler count: 1 page-specific (/categories, already in base) + 5 base.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import CategoriesPage from '@/pages/admin/Categories';
import { renderPage, failOnConsoleError } from '../support/renderPage';
import { url } from '../support/handlers';
import { CATEGORIES } from '../support/fixtures';

failOnConsoleError();

const categoryHandlers = (data: unknown = CATEGORIES) => [
  http.get(url('/categories'), () => HttpResponse.json({ data })),
];

describe('Categories page — smoke', () => {
  it('shows loading, then renders categories (the loading->loaded transition)', async () => {
    renderPage(<CategoriesPage />, { route: '/categories', handlers: categoryHandlers() });

    expect(screen.getByText(/Loading categories/i)).toBeInTheDocument();

    expect(await screen.findByText('Food')).toBeInTheDocument();
    expect(screen.queryByText(/Loading categories/i)).toBeNull();
  });

  it('renders the page heading', async () => {
    renderPage(<CategoriesPage />, { route: '/categories', handlers: categoryHandlers() });
    expect(
      await screen.findByRole('heading', { level: 1, name: /categories/i }),
    ).toBeInTheDocument();
  });

  it('renders every category from the API', async () => {
    renderPage(<CategoriesPage />, { route: '/categories', handlers: categoryHandlers() });
    expect(await screen.findByText('Food')).toBeInTheDocument();
    expect(screen.getByText('Rent')).toBeInTheDocument();
    expect(screen.getByText('Salary')).toBeInTheDocument();
  });

  it('renders the real error branch when the request fails', async () => {
    // Unique in the app: an actual isError branch with its own copy, so this asserts the
    // literal message rather than falling back to the toast.
    renderPage(<CategoriesPage />, {
      route: '/categories',
      handlers: [
        http.get(url('/categories'), () =>
          HttpResponse.json({ message: 'Server exploded' }, { status: 500 })),
      ],
    });

    expect(
      await screen.findByText('Failed to load categories. Please refresh the page.'),
    ).toBeInTheDocument();
  });

  it('opens the add-category form when the primary action is clicked', async () => {
    const user = userEvent.setup();
    renderPage(<CategoriesPage />, { route: '/categories', handlers: categoryHandlers() });
    await screen.findByText('Food');

    await user.click(screen.getByRole('button', { name: /add category/i }));

    // The form's submit button reuses the "Add Category" label, so match the modal
    // heading (h2) rather than a button name that is deliberately ambiguous.
    expect(
      await screen.findByRole('heading', { level: 2, name: /add category/i }),
    ).toBeInTheDocument();
  });
});

// ─── Tree, usage, merge and safe delete ──────────────────────────────────────

/** Food › Groceries, plus an unused Fuel. */
const TREE = [
  {
    id: 'food', name: 'Food', type: 'EXPENSE', icon: '🍔', color: '#ff0000',
    parentId: null, isDefault: false, userId: null, _count: { children: 1 },
    // A grouping parent: nothing filed against it directly, plenty underneath.
    usage: { directCount: 0, directTotal: 0, rollupCount: 4, rollupTotal: 4000, lastUsed: '2026-08-01T00:00:00.000Z' },
  },
  {
    id: 'groceries', name: 'Groceries', type: 'EXPENSE', icon: '🛒', color: '#00ff00',
    parentId: 'food', isDefault: false, userId: null, _count: { children: 0 },
    usage: { directCount: 4, directTotal: 4000, rollupCount: 4, rollupTotal: 4000, lastUsed: '2026-08-01T00:00:00.000Z' },
  },
  {
    id: 'fuel', name: 'Fuel', type: 'EXPENSE', icon: '⛽', color: '#0000ff',
    parentId: null, isDefault: false, userId: null, _count: { children: 0 },
    usage: { directCount: 0, directTotal: 0, rollupCount: 0, rollupTotal: 0, lastUsed: null },
  },
];

describe('Categories page — usage and hierarchy', () => {
  it('marks a never-used category so dead ones are findable', async () => {
    renderPage(<CategoriesPage />, { route: '/categories', handlers: categoryHandlers(TREE) });

    await screen.findByText('Fuel');
    expect(screen.getByText(/never used/i)).toBeInTheDocument();
  });

  it('rolls a child up into its parent instead of showing the parent as dead', async () => {
    // Food has no transactions of its own; without the rollup it would read as unused.
    renderPage(<CategoriesPage />, { route: '/categories', handlers: categoryHandlers(TREE) });

    await screen.findByText('Food');
    expect(screen.getAllByText(/4 txns/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/via sub-categories/i)).toBeInTheDocument();
  });

  it('nests a child under its parent and can collapse it', async () => {
    const user = userEvent.setup();
    renderPage(<CategoriesPage />, { route: '/categories', handlers: categoryHandlers(TREE) });

    await screen.findByText('Food');
    expect(screen.getByText('Groceries')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /collapse food/i }));
    expect(screen.queryByText('Groceries')).not.toBeInTheDocument();
  });
});

describe('Categories page — safe delete', () => {
  it('will not delete a used category without somewhere to move its transactions', async () => {
    // The FK is SET NULL, so this used to silently strip the category from every
    // transaction filed under it.
    const user = userEvent.setup();
    renderPage(<CategoriesPage />, { route: '/categories', handlers: categoryHandlers(TREE) });

    await screen.findByText('Groceries');
    await user.click(screen.getByRole('button', { name: /actions for groceries/i }));
    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(await screen.findByText(/4 transactions use this category/i)).toBeInTheDocument();
    const confirm = screen.getAllByRole('button', { name: /^delete$/i }).slice(-1)[0];
    expect(confirm).toBeDisabled();
  });

  it('sends the reassignment target once one is chosen', async () => {
    const user = userEvent.setup();
    let deleteUrl = '';

    renderPage(<CategoriesPage />, {
      route: '/categories',
      handlers: [
        http.delete(url('/categories/groceries'), ({ request }) => {
          deleteUrl = request.url;
          return new HttpResponse(null, { status: 204 });
        }),
        ...categoryHandlers(TREE),
      ],
    });

    await screen.findByText('Groceries');
    await user.click(screen.getByRole('button', { name: /actions for groceries/i }));
    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    await user.selectOptions(await screen.findByLabelText(/move transactions to/i), 'fuel');
    await user.click(screen.getAllByRole('button', { name: /^delete$/i }).slice(-1)[0]);

    await waitFor(() => expect(deleteUrl).toContain('reassignTo=fuel'));
  });

  it('deletes an unused category without asking anything', async () => {
    const user = userEvent.setup();
    renderPage(<CategoriesPage />, { route: '/categories', handlers: categoryHandlers(TREE) });

    await screen.findByText('Fuel');
    await user.click(screen.getByRole('button', { name: /actions for fuel/i }));
    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(await screen.findByText(/nothing will be lost/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^delete$/i }).slice(-1)[0]).toBeEnabled();
  });
});

describe('Categories page — merge', () => {
  it('states exactly what moves before merging, and posts the target', async () => {
    const user = userEvent.setup();
    let body: any = null;

    renderPage(<CategoriesPage />, {
      route: '/categories',
      handlers: [
        http.post(url('/categories/groceries/merge'), async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ data: TREE[2] });
        }),
        ...categoryHandlers(TREE),
      ],
    });

    await screen.findByText('Groceries');
    await user.click(screen.getByRole('button', { name: /actions for groceries/i }));
    await user.click(screen.getByRole('button', { name: /merge into/i }));

    // A merge cannot be undone, so the count has to be visible before confirming.
    expect(await screen.findByText(/4 transactions/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/merge into/i), 'fuel');
    await user.click(screen.getByRole('button', { name: /^merge$/i }));

    await waitFor(() => expect(body).toEqual({ targetId: 'fuel' }));
  });

  it('cannot merge until a target is chosen', async () => {
    const user = userEvent.setup();
    renderPage(<CategoriesPage />, { route: '/categories', handlers: categoryHandlers(TREE) });

    await screen.findByText('Groceries');
    await user.click(screen.getByRole('button', { name: /actions for groceries/i }));
    await user.click(screen.getByRole('button', { name: /merge into/i }));

    expect(await screen.findByRole('button', { name: /^merge$/i })).toBeDisabled();
  });
});

describe('Categories page — an unused category is still fully manageable', () => {
  // The row used to render at 60% opacity, which reads as "disabled" — but every action
  // works, and an unused category is the likeliest one to need editing or removing.

  it('offers the same actions as a used one', async () => {
    const user = userEvent.setup();
    renderPage(<CategoriesPage />, { route: '/categories', handlers: categoryHandlers(TREE) });

    await screen.findByText('Fuel');
    await user.click(screen.getByRole('button', { name: /actions for fuel/i }));

    expect(screen.getByRole('button', { name: /^edit$/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /merge into/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeEnabled();
  });

  it('can be edited', async () => {
    const user = userEvent.setup();
    let body: any = null;

    renderPage(<CategoriesPage />, {
      route: '/categories',
      handlers: [
        http.put(url('/categories/fuel'), async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ data: { ...TREE[2], name: 'Petrol' } });
        }),
        ...categoryHandlers(TREE),
      ],
    });

    await screen.findByText('Fuel');
    await user.click(screen.getByRole('button', { name: /actions for fuel/i }));
    await user.click(screen.getByRole('button', { name: /^edit$/i }));

    const name = await screen.findByLabelText(/name/i);
    await user.clear(name);
    await user.type(name, 'Petrol');
    await user.click(screen.getByRole('button', { name: /save|update/i }));

    await waitFor(() => expect(body?.name).toBe('Petrol'));
  });

  it('can be merged into another category', async () => {
    const user = userEvent.setup();
    let merged = false;

    renderPage(<CategoriesPage />, {
      route: '/categories',
      handlers: [
        http.post(url('/categories/fuel/merge'), () => {
          merged = true;
          return HttpResponse.json({ data: TREE[0] });
        }),
        ...categoryHandlers(TREE),
      ],
    });

    await screen.findByText('Fuel');
    await user.click(screen.getByRole('button', { name: /actions for fuel/i }));
    await user.click(screen.getByRole('button', { name: /merge into/i }));
    await user.selectOptions(await screen.findByLabelText(/merge into/i), 'groceries');
    await user.click(screen.getByRole('button', { name: /^merge$/i }));

    await waitFor(() => expect(merged).toBe(true));
  });

  it('is not visually marked as disabled', async () => {
    renderPage(<CategoriesPage />, { route: '/categories', handlers: categoryHandlers(TREE) });

    const label = await screen.findByText(/never used/i);
    const row = label.closest('div.rounded-lg')!;
    expect(row.className).not.toContain('opacity');
  });
});

describe('Categories page — a new category is not forced to a default colour', () => {
  it('sends no colour, so the backend applies the one it computes for the name', async () => {
    // The form preselected COLOR_PRESETS[0], and createCategory only applies its own
    // styling when no colour is sent — so every new category was created green and the
    // whole name-to-colour map was dead for anything added through the UI.
    const user = userEvent.setup();
    let body: any = null;

    renderPage(<CategoriesPage />, {
      route: '/categories',
      handlers: [
        http.post(url('/categories'), async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ data: TREE[0] }, { status: 201 });
        }),
        ...categoryHandlers(TREE),
      ],
    });

    await screen.findByText('Food');
    await user.click(screen.getByRole('button', { name: /add category/i }));
    await user.type(await screen.findByLabelText(/^name/i), 'Hotstar');
    // The dialog's submit shares its label with the toolbar trigger that opened it.
    const submit = screen.getAllByRole('button', { name: /^add category$/i })
      .find((b) => b.getAttribute('type') === 'submit')!;
    await user.click(submit);

    await waitFor(() => expect(body).not.toBeNull());
    expect(body.color === '' || body.color === undefined).toBe(true);
  });
});
