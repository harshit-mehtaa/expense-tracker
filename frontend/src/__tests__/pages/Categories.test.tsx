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
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import CategoriesPage from '@/pages/admin/Categories';
import { renderPage, failOnConsoleError } from '../support/renderPage';
import { url } from '../support/handlers';
import { CATEGORIES } from '../support/fixtures';

failOnConsoleError();

// Category names also appear as <option>s in the auto-categorization rules form, so
// assertions about the category LIST must skip those.
const NOT_OPTION = { ignore: 'option, script, style' };

const categoryHandlers = (data: unknown = CATEGORIES) => [
  http.get(url('/categories'), () => HttpResponse.json({ data })),
];

describe('Categories page — smoke', () => {
  it('shows loading, then renders categories (the loading->loaded transition)', async () => {
    renderPage(<CategoriesPage />, { route: '/categories', handlers: categoryHandlers() });

    expect(screen.getByText(/Loading categories/i)).toBeInTheDocument();

    expect(await screen.findByText('Food', NOT_OPTION)).toBeInTheDocument();
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
    expect(await screen.findByText('Food', NOT_OPTION)).toBeInTheDocument();
    expect(screen.getByText('Rent', NOT_OPTION)).toBeInTheDocument();
    expect(screen.getByText('Salary', NOT_OPTION)).toBeInTheDocument();
  });

  it('hosts the signed-in user\'s auto-categorization rules', async () => {
    renderPage(<CategoriesPage />, {
      route: '/categories',
      handlers: [
        ...categoryHandlers(),
        http.get(url('/category-rules'), () => HttpResponse.json({
          data: [{
            id: 'r-1', matchType: 'REGEX', pattern: '^upi/.*swiggy', categoryId: 'cat-food',
            category: { id: 'cat-food', name: 'Food', type: 'EXPENSE', parentId: null },
          }],
        })),
      ],
    });

    expect(await screen.findByRole('heading', { level: 2, name: 'Auto-categorization rules' })).toBeInTheDocument();
    expect(await screen.findByText('/^upi/.*swiggy/')).toBeInTheDocument();
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
    await screen.findByText('Food', NOT_OPTION);

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

    expect(await screen.findByText(/no transactions are filed under it/i)).toBeInTheDocument();
    // Deleting a category also deletes the auto-categorization rules that assign it (Cascade)
    expect(screen.getByText(/auto-categorization rules that assign it.*will be deleted/i)).toBeInTheDocument();
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

  it('refreshes the rules list after a merge — the merge re-points rules at the target', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderPage(<CategoriesPage />, {
      route: '/categories',
      handlers: [
        http.post(url('/categories/groceries/merge'), () => HttpResponse.json({ data: TREE[2] })),
        ...categoryHandlers(TREE),
      ],
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await screen.findByText('Groceries');
    await user.click(screen.getByRole('button', { name: /actions for groceries/i }));
    await user.click(screen.getByRole('button', { name: /merge into/i }));
    await user.selectOptions(await screen.findByLabelText(/merge into/i), 'fuel');
    await user.click(screen.getByRole('button', { name: /^merge$/i }));

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['category-rules'] }));
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

describe('Categories page — auto-categorization rules in the Add/Edit dialogs', () => {
  const FOOD_CAT = { id: 'food', name: 'Food', type: 'EXPENSE', parentId: null, isDefault: false, userId: null };
  const GOLD_CAT = { id: 'gold', name: 'Gold', type: 'ASSET', parentId: null, isDefault: false, userId: null };
  const NEW_CAT = { id: 'cat-new', name: 'Quick Commerce', type: 'EXPENSE', parentId: null, isDefault: false, userId: null, icon: null, color: null };

  /** A stateful fake of /category-rules, so both lists on the page read one server truth. */
  function rulesApi(initial: any[] = [], { failPatterns = [] as string[] } = {}) {
    let rules = [...initial];
    const calls: string[] = [];
    const handlers = [
      http.get(url('/category-rules'), () => HttpResponse.json({ data: rules })),
      http.post(url('/category-rules'), async ({ request }) => {
        const body = await request.json() as any;
        calls.push(`POST rule ${body.pattern} → ${body.categoryId}`);
        if (failPatterns.includes(body.pattern)) {
          return HttpResponse.json({ message: 'A regex rule for "x" already exists' }, { status: 409 });
        }
        const rule = { id: `r-${rules.length + 1}`, ...body, category: { id: body.categoryId, name: 'Cat', type: 'EXPENSE' } };
        rules.push(rule);
        return HttpResponse.json({ data: rule }, { status: 201 });
      }),
      http.delete(url('/category-rules/:id'), ({ params }) => {
        calls.push(`DELETE rule ${params.id}`);
        rules = rules.filter((r) => r.id !== params.id);
        return new HttpResponse(null, { status: 204 });
      }),
    ];
    return { handlers, calls };
  }

  const createCategory = (calls: string[], status = 201) =>
    http.post(url('/categories'), async ({ request }) => {
      calls.push('POST category');
      const body = await request.json() as any;
      return status === 201
        ? HttpResponse.json({ data: { ...NEW_CAT, type: body.type } }, { status: 201 })
        : HttpResponse.json({ message: 'A EXPENSE category named "Quick Commerce" already exists' }, { status });
    });

  const dialog = (name: string) => within(screen.getByRole('heading', { name }).parentElement!);

  async function openAdd(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByText('Food', { ignore: 'option, script, style' });
    await user.click(screen.getByRole('button', { name: /add category/i }));
    const d = dialog('Add Category');
    await user.type(d.getByLabelText(/^name/i), 'Quick Commerce');
    return d;
  }

  it('creates the category, then its staged rules one at a time in order, and shows them in the dedicated section', async () => {
    const user = userEvent.setup();
    const api = rulesApi();
    renderPage(<CategoriesPage />, {
      route: '/categories',
      handlers: [...categoryHandlers([FOOD_CAT]), createCategory(api.calls), ...api.handlers],
    });
    const d = await openAdd(user);

    expect(d.getByLabelText('Match type')).toHaveValue('REGEX');
    await user.type(d.getByLabelText('Pattern'), '^upi/.*blinkit{Enter}');
    await user.selectOptions(d.getByLabelText('Match type'), 'KEYWORD');
    await user.type(d.getByLabelText('Pattern'), 'zepto');
    await user.click(d.getByRole('button', { name: 'Add' }));
    // Staging never submits the category form
    expect(api.calls).toEqual([]);

    await user.click(d.getByRole('button', { name: /^add category$/i }));

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Add Category' })).toBeNull());
    expect(api.calls).toEqual([
      'POST category',
      'POST rule ^upi/.*blinkit → cat-new',
      'POST rule zepto → cat-new',
    ]);
    const section = within(await screen.findByRole('list', { name: 'Auto-categorization rules' }));
    expect(section.getByText('/^upi/.*blinkit/')).toBeInTheDocument();
    expect(section.getByText('zepto')).toBeInTheDocument();
  });

  it('only creates the category when no rules are staged', async () => {
    const user = userEvent.setup();
    const api = rulesApi();
    renderPage(<CategoriesPage />, {
      route: '/categories',
      handlers: [...categoryHandlers([FOOD_CAT]), createCategory(api.calls), ...api.handlers],
    });
    const d = await openAdd(user);
    await user.click(d.getByRole('button', { name: /^add category$/i }));

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Add Category' })).toBeNull());
    expect(api.calls).toEqual(['POST category']);
  });

  it('keeps the dialog busy until the last rule is saved', async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const calls: string[] = [];
    renderPage(<CategoriesPage />, {
      route: '/categories',
      handlers: [
        ...categoryHandlers([FOOD_CAT]),
        createCategory(calls),
        http.get(url('/category-rules'), () => HttpResponse.json({ data: [] })),
        http.post(url('/category-rules'), async () => {
          await gate;
          return HttpResponse.json({ data: {} }, { status: 201 });
        }),
      ],
    });
    const d = await openAdd(user);
    await user.type(d.getByLabelText('Pattern'), 'blinkit{Enter}');
    await user.click(d.getByRole('button', { name: /^add category$/i }));

    await waitFor(() => expect(calls).toEqual(['POST category']));
    expect(d.getByRole('button', { name: /saving/i })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Add Category' })).toBeNull());
  });

  it('locks the staged rules (and Cancel) while saving, so what is saved is what was shown', async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const calls: string[] = [];
    renderPage(<CategoriesPage />, {
      route: '/categories',
      handlers: [
        ...categoryHandlers([FOOD_CAT]),
        createCategory(calls),
        http.get(url('/category-rules'), () => HttpResponse.json({ data: [] })),
        http.post(url('/category-rules'), async () => { await gate; return HttpResponse.json({ data: {} }, { status: 201 }); }),
      ],
    });
    const d = await openAdd(user);
    await user.type(d.getByLabelText('Pattern'), 'blinkit{Enter}');
    await user.click(d.getByRole('button', { name: /^add category$/i }));
    await waitFor(() => expect(calls).toEqual(['POST category']));

    expect(d.getByLabelText('Pattern')).toBeDisabled();
    expect(d.getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(d.getByRole('button', { name: 'Remove rule blinkit' })).toBeDisabled();
    expect(d.getByRole('button', { name: /cancel/i })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Add Category' })).toBeNull());
  });

  it('if a rule still fails after the category is created, opens the new category\'s Edit dialog saying which', async () => {
    const user = userEvent.setup();
    const api = rulesApi([], { failPatterns: ['zepto'] });
    renderPage(<CategoriesPage />, {
      route: '/categories',
      handlers: [...categoryHandlers([FOOD_CAT]), createCategory(api.calls), ...api.handlers],
    });
    const d = await openAdd(user);
    await user.type(d.getByLabelText('Pattern'), 'blinkit{Enter}');
    await user.type(d.getByLabelText('Pattern'), 'zepto{Enter}');
    await user.click(d.getByRole('button', { name: /^add category$/i }));

    const edit = await screen.findByRole('heading', { name: 'Edit Category' });
    expect(within(edit.parentElement!).getByText(
      'Category created, but 1 rule could not be saved: "zepto" (A regex rule for "x" already exists)',
    )).toBeInTheDocument();
    expect(within(edit.parentElement!).getByLabelText(/^name/i)).toHaveValue('Quick Commerce');
  });

  it('does not post rules when the category itself is rejected, and keeps them staged', async () => {
    const user = userEvent.setup();
    const api = rulesApi();
    renderPage(<CategoriesPage />, {
      route: '/categories',
      handlers: [...categoryHandlers([FOOD_CAT]), createCategory(api.calls, 409), ...api.handlers],
    });
    const d = await openAdd(user);
    await user.type(d.getByLabelText('Pattern'), 'blinkit{Enter}');
    await user.click(d.getByRole('button', { name: /^add category$/i }));

    expect(await d.findByText(/already exists/)).toBeInTheDocument();
    expect(api.calls).toEqual(['POST category']);
    expect(within(d.getByRole('list', { name: 'Rules to add' })).getAllByRole('listitem')).toHaveLength(1);
  });

  it('hides rules for asset/liability categories and never saves staged ones for them', async () => {
    const user = userEvent.setup();
    const api = rulesApi();
    renderPage(<CategoriesPage />, {
      route: '/categories',
      handlers: [...categoryHandlers([FOOD_CAT]), createCategory(api.calls), ...api.handlers],
    });
    const d = await openAdd(user);
    await user.type(d.getByLabelText('Pattern'), 'blinkit{Enter}');
    await user.selectOptions(d.getByLabelText(/^type/i), 'ASSET');

    expect(d.queryByLabelText('Pattern')).toBeNull();
    expect(d.getByText("1 staged rule won't be saved — rules can only assign income or expense categories.")).toBeInTheDocument();
    await user.click(d.getByRole('button', { name: /^add category$/i }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Add Category' })).toBeNull());
    expect(api.calls).toEqual(['POST category']);
  });

  it('starts every Add dialog with no staged rules (cancel discards them)', async () => {
    const user = userEvent.setup();
    const api = rulesApi();
    renderPage(<CategoriesPage />, {
      route: '/categories',
      handlers: [...categoryHandlers([FOOD_CAT]), ...api.handlers],
    });
    let d = await openAdd(user);
    await user.type(d.getByLabelText('Pattern'), 'blinkit{Enter}');
    await user.click(d.getByRole('button', { name: /cancel/i }));
    await user.click(screen.getByRole('button', { name: /add category/i }));
    d = dialog('Add Category');
    expect(d.queryByRole('list', { name: 'Rules to add' })).toBeNull();
  });

  it('Edit: lists, adds and removes this category\'s rules straight away — reflected in the dedicated section', async () => {
    const user = userEvent.setup();
    const api = rulesApi([
      { id: 'r-1', matchType: 'REGEX', pattern: '^upi/.*swiggy', categoryId: 'food', category: FOOD_CAT },
      { id: 'r-2', matchType: 'KEYWORD', pattern: 'salary', categoryId: 'sal', category: { id: 'sal', name: 'Salary', type: 'INCOME' } },
    ]);
    const puts: string[] = [];
    renderPage(<CategoriesPage />, {
      route: '/categories',
      handlers: [
        ...categoryHandlers([FOOD_CAT]),
        http.put(url('/categories/:id'), () => { puts.push('PUT'); return HttpResponse.json({ data: FOOD_CAT }); }),
        ...api.handlers,
      ],
    });
    await screen.findByText('Food', { ignore: 'option, script, style' });
    await user.click(screen.getByRole('button', { name: /actions for food/i }));
    await user.click(screen.getByRole('button', { name: /^edit$/i }));
    const d = dialog('Edit Category');

    const scoped = await d.findByRole('list', { name: 'Rules for this category' });
    expect(within(scoped).getAllByRole('listitem')).toHaveLength(1);
    expect(d.getByText(/changes are saved right away/i)).toBeInTheDocument();

    await user.type(d.getByLabelText('Pattern'), 'blinkit{Enter}');
    await waitFor(() => expect(within(d.getByRole('list', { name: 'Rules for this category' })).getAllByRole('listitem')).toHaveLength(2));
    const section = () => within(screen.getByRole('list', { name: 'Auto-categorization rules' }));
    await waitFor(() => expect(section().getByText('/blinkit/')).toBeInTheDocument());

    await user.click(d.getByRole('button', { name: 'Delete rule ^upi/.*swiggy' }));
    await waitFor(() => expect(section().queryByText('/^upi/.*swiggy/')).toBeNull());

    expect(screen.getByRole('heading', { name: 'Edit Category' })).toBeInTheDocument(); // still open
    expect(puts).toEqual([]); // rule changes never save the category form
    expect(api.calls).toEqual(['POST rule blinkit → food', 'DELETE rule r-1']);
  });

  it('Edit: warns that rules block a type change', async () => {
    const user = userEvent.setup();
    const api = rulesApi([{ id: 'r-1', matchType: 'REGEX', pattern: 'swiggy', categoryId: 'food', category: FOOD_CAT }]);
    renderPage(<CategoriesPage />, {
      route: '/categories',
      handlers: [...categoryHandlers([FOOD_CAT]), ...api.handlers],
    });
    await screen.findByText('Food', { ignore: 'option, script, style' });
    await user.click(screen.getByRole('button', { name: /actions for food/i }));
    await user.click(screen.getByRole('button', { name: /^edit$/i }));
    const d = dialog('Edit Category');

    expect(d.queryByText(/can't change type/i)).toBeNull();
    await user.selectOptions(d.getByLabelText(/^type/i), 'INCOME');
    expect(d.getByText("A category with auto-categorization rules can't change type — remove its rules first.")).toBeInTheDocument();
  });

  it('Edit: no retype warning for a category without rules', async () => {
    const user = userEvent.setup();
    renderPage(<CategoriesPage />, {
      route: '/categories',
      handlers: [...categoryHandlers([FOOD_CAT]), ...rulesApi().handlers],
    });
    await screen.findByText('Food', { ignore: 'option, script, style' });
    await user.click(screen.getByRole('button', { name: /actions for food/i }));
    await user.click(screen.getByRole('button', { name: /^edit$/i }));
    const d = dialog('Edit Category');
    await d.findByText('No rules for this category yet.');
    await user.selectOptions(d.getByLabelText(/^type/i), 'INCOME');
    expect(d.queryByText(/can't change type/i)).toBeNull();
  });

  it('Edit: no rules section for an asset category', async () => {
    const user = userEvent.setup();
    renderPage(<CategoriesPage />, {
      route: '/categories',
      handlers: [...categoryHandlers([FOOD_CAT, GOLD_CAT]), ...rulesApi().handlers],
    });
    await screen.findByText('Gold', { ignore: 'option, script, style' });
    await user.click(screen.getByRole('button', { name: /actions for gold/i }));
    await user.click(screen.getByRole('button', { name: /^edit$/i }));
    expect(dialog('Edit Category').queryByRole('list', { name: 'Rules for this category' })).toBeNull();
    expect(dialog('Edit Category').queryByLabelText('Pattern')).toBeNull();
  });
});
