/**
 * CategoryRulesManager — the shared auto-categorization rules editor (Categories page +
 * statement-import dialog).
 *
 * Key test focus: rules render in the order the API returns them (= evaluation order,
 * decided server-side), regex rules are visibly distinct, REGEX patterns are sent
 * exactly as typed (lowercasing would turn \D into \d), invalid regex syntax is caught
 * client-side without a request, and every server error surfaces inline (in addition
 * to the app-wide api:error toast, which is why error assertions select the inline <p>).
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { CategoryRulesManager, type CategoryRule } from '@/components/categories/CategoryRulesManager';
import { renderPage, failOnConsoleError } from '../../support/renderPage';
import { url } from '../../support/handlers';
import { CATEGORIES } from '../../support/fixtures';

failOnConsoleError();

const FOOD = { id: 'cat-food', name: 'Food', type: 'EXPENSE' as const, parentId: null };
const SALARY = { id: 'cat-sal', name: 'Salary', type: 'INCOME' as const, parentId: null };

// In evaluation order, as the API returns them: regex rules first, then keywords.
const RULES: CategoryRule[] = [
  { id: 'r-2', matchType: 'REGEX', pattern: '^NEFT.*SALARY', categoryId: 'cat-sal', category: SALARY },
  { id: 'r-1', matchType: 'KEYWORD', pattern: 'swiggy', categoryId: 'cat-food', category: FOOD },
];

const rulesHandler = (data: CategoryRule[] = RULES) =>
  http.get(url('/category-rules'), () => HttpResponse.json({ data }));

function renderManager(
  opts: { handlers?: Parameters<typeof renderPage>[1]['handlers']; categories?: typeof CATEGORIES; targetUserId?: string } = {},
) {
  return renderPage(
    <CategoryRulesManager categories={opts.categories ?? CATEGORIES} targetUserId={opts.targetUserId} />,
    { route: '/', handlers: opts.handlers ?? [rulesHandler()] },
  );
}

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  { matchType, pattern, categoryId = 'cat-food' }: { matchType?: 'KEYWORD' | 'REGEX'; pattern: string; categoryId?: string },
) {
  if (matchType) await user.selectOptions(screen.getByLabelText('Match type'), matchType);
  await user.type(screen.getByLabelText('Pattern'), pattern);
  await user.selectOptions(screen.getByLabelText('Category'), categoryId);
}

describe('CategoryRulesManager — list', () => {
  it('renders rules in API (evaluation) order, marking regex rules distinctly', async () => {
    renderManager();
    const list = await screen.findByRole('list', { name: 'Auto-categorization rules' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('regex/^NEFT.*SALARY/ → Salary');
    expect(items[1]).toHaveTextContent('swiggy → Food');
    expect(items[1]).not.toHaveTextContent('regex');
  });

  it('explains the evaluation order: regex rules first, then text rules, first match wins', async () => {
    renderManager();
    expect(await screen.findByText(/Regex rules are checked first.*then text rules.*first match wins/i))
      .toBeInTheDocument();
  });

  it('shows an empty state when there are no rules', async () => {
    renderManager({ handlers: [rulesHandler([])] });
    expect(await screen.findByText('No rules saved yet.')).toBeInTheDocument();
  });

  it('shows an error when rules fail to load', async () => {
    renderManager({
      handlers: [http.get(url('/category-rules'), () => HttpResponse.json({ message: 'boom' }, { status: 500 }))],
    });
    expect(await screen.findByText('Could not load rules.')).toBeInTheDocument();
  });

  it('only offers INCOME/EXPENSE categories as rule targets', async () => {
    renderManager({
      categories: [...CATEGORIES, { id: 'cat-asset', name: 'Gold', type: 'ASSET', parentId: null, colorHex: null, iconKey: null }],
    });
    const select = await screen.findByLabelText('Category');
    expect(within(select).getByRole('option', { name: 'Food' })).toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: 'Gold' })).toBeNull();
  });

  it('disables the form and explains why when no rule-eligible categories exist', async () => {
    renderManager({ categories: [], handlers: [rulesHandler([])] });
    expect(await screen.findByText(/Create at least one income or expense category/)).toBeInTheDocument();
    expect(screen.getByLabelText('Pattern')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(screen.queryByText('No rules saved yet.')).toBeNull();
  });

  it('forwards targetUserId when listing rules', async () => {
    let seen: string | null = null;
    renderManager({
      targetUserId: 'u-member',
      handlers: [http.get(url('/category-rules'), ({ request }) => {
        seen = new URL(request.url).searchParams.get('targetUserId');
        return HttpResponse.json({ data: [] });
      })],
    });
    await waitFor(() => expect(seen).toBe('u-member'));
  });
});

describe('CategoryRulesManager — adding a rule', () => {
  function captureCreate(onBody: (body: any, params: URLSearchParams) => void) {
    return http.post(url('/category-rules'), async ({ request }) => {
      onBody(await request.json(), new URL(request.url).searchParams);
      return HttpResponse.json({ data: {} }, { status: 201 });
    });
  }

  it('switches the placeholder with the match type', async () => {
    const user = userEvent.setup();
    renderManager();
    const input = await screen.findByLabelText('Pattern');
    expect(input).toHaveAttribute('placeholder', 'text (e.g. swiggy)');
    await user.selectOptions(screen.getByLabelText('Match type'), 'REGEX');
    expect(input).toHaveAttribute('placeholder', 'regex (e.g. ^upi/.*swiggy)');
  });

  it('posts a KEYWORD rule (trimmed), then clears the form and refetches', async () => {
    const user = userEvent.setup();
    let body: any = null;
    let listCalls = 0;
    renderManager({
      handlers: [
        http.get(url('/category-rules'), () => { listCalls++; return HttpResponse.json({ data: [] }); }),
        captureCreate((b) => { body = b; }),
      ],
    });
    await screen.findByText('No rules saved yet.');

    await fillForm(user, { pattern: '  Swiggy  ' });
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(body).toEqual({ matchType: 'KEYWORD', pattern: 'Swiggy', categoryId: 'cat-food' }));
    await waitFor(() => expect(screen.getByLabelText('Pattern')).toHaveValue(''));
    expect(screen.getByLabelText('Category')).toHaveValue('');
    await waitFor(() => expect(listCalls).toBe(2));
  });

  it('posts a REGEX rule exactly as typed — case preserved', async () => {
    const user = userEvent.setup();
    let body: any = null;
    renderManager({ handlers: [rulesHandler(), captureCreate((b) => { body = b; })] });
    await screen.findByRole('list', { name: 'Auto-categorization rules' });

    await fillForm(user, { matchType: 'REGEX', pattern: '^UPI/\\D+' });
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(body).toEqual({ matchType: 'REGEX', pattern: '^UPI/\\D+', categoryId: 'cat-food' }));
  });

  it('submits on Enter and forwards targetUserId', async () => {
    const user = userEvent.setup();
    let params: URLSearchParams | null = null;
    renderManager({ targetUserId: 'u-member', handlers: [rulesHandler(), captureCreate((_, p) => { params = p; })] });
    await screen.findByRole('list', { name: 'Auto-categorization rules' });

    await user.selectOptions(screen.getByLabelText('Category'), 'cat-food');
    await user.type(screen.getByLabelText('Pattern'), 'zomato{Enter}');

    await waitFor(() => expect(params?.get('targetUserId')).toBe('u-member'));
  });

  it('does nothing without both a pattern and a category', async () => {
    const user = userEvent.setup();
    const onBody = vi.fn();
    renderManager({ handlers: [rulesHandler(), captureCreate(onBody)] });
    await screen.findByRole('list', { name: 'Auto-categorization rules' });

    await user.type(screen.getByLabelText('Pattern'), '   ');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.clear(screen.getByLabelText('Pattern'));
    await user.type(screen.getByLabelText('Pattern'), 'swiggy');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(onBody).not.toHaveBeenCalled();
  });

  it('rejects invalid regex syntax client-side without sending a request, and clears the error on edit', async () => {
    const user = userEvent.setup();
    const onBody = vi.fn();
    renderManager({ handlers: [rulesHandler(), captureCreate(onBody)] });
    await screen.findByRole('list', { name: 'Auto-categorization rules' });

    await fillForm(user, { matchType: 'REGEX', pattern: '(swiggy' });
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText(/^Invalid regular expression/)).toBeInTheDocument();
    expect(onBody).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Pattern'), ')');
    expect(screen.queryByText(/^Invalid regular expression/)).toBeNull();
  });

  it('clears a client-side regex error when the match type changes', async () => {
    const user = userEvent.setup();
    renderManager();
    await screen.findByRole('list', { name: 'Auto-categorization rules' });

    await fillForm(user, { matchType: 'REGEX', pattern: '(' });
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText(/^Invalid regular expression/);

    await user.selectOptions(screen.getByLabelText('Match type'), 'KEYWORD');
    expect(screen.queryByText(/^Invalid regular expression/)).toBeNull();
  });

  it('does not syntax-check KEYWORD patterns (a "(" is a literal character there)', async () => {
    const user = userEvent.setup();
    let body: any = null;
    renderManager({ handlers: [rulesHandler(), captureCreate((b) => { body = b; })] });
    await screen.findByRole('list', { name: 'Auto-categorization rules' });

    await fillForm(user, { pattern: 'amazon (pay' });
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(body?.pattern).toBe('amazon (pay'));
  });

  it('shows the server\'s message when a rule is rejected', async () => {
    const user = userEvent.setup();
    renderManager({
      handlers: [
        rulesHandler(),
        http.post(url('/category-rules'), () =>
          HttpResponse.json({ message: 'This pattern matches empty text, so it would match every transaction' }, { status: 400 })),
      ],
    });
    await screen.findByRole('list', { name: 'Auto-categorization rules' });

    await fillForm(user, { matchType: 'REGEX', pattern: 'x?' });
    await user.click(screen.getByRole('button', { name: 'Add' }));

    // Inline, next to the form (the global api:error toast also shows it)
    expect(await screen.findByText(/matches empty text/, { selector: 'p.text-destructive' })).toBeInTheDocument();
  });

  it('clears a server error once the user edits the pattern', async () => {
    const user = userEvent.setup();
    renderManager({
      handlers: [
        rulesHandler(),
        http.post(url('/category-rules'), () =>
          HttpResponse.json({ message: 'A keyword rule for "swiggy" already exists' }, { status: 409 })),
      ],
    });
    await screen.findByRole('list', { name: 'Auto-categorization rules' });

    await fillForm(user, { pattern: 'swiggy' });
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText(/already exists/, { selector: 'p.text-destructive' });

    await user.type(screen.getByLabelText('Pattern'), 'x');
    expect(screen.queryByText(/already exists/, { selector: 'p.text-destructive' })).toBeNull();
  });

  it('falls back to a generic message when the server gives none', async () => {
    const user = userEvent.setup();
    renderManager({
      handlers: [rulesHandler(), http.post(url('/category-rules'), () => new HttpResponse(null, { status: 500 }))],
    });
    await screen.findByRole('list', { name: 'Auto-categorization rules' });

    await fillForm(user, { pattern: 'swiggy' });
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('Could not save rule')).toBeInTheDocument();
  });
});

describe('CategoryRulesManager — deleting a rule', () => {
  it('deletes the chosen rule and refetches', async () => {
    const user = userEvent.setup();
    let deleted: string | null = null;
    let listCalls = 0;
    renderManager({
      handlers: [
        http.get(url('/category-rules'), () => { listCalls++; return HttpResponse.json({ data: RULES }); }),
        http.delete(url('/category-rules/:id'), ({ params }) => {
          deleted = params.id as string;
          return new HttpResponse(null, { status: 204 });
        }),
      ],
    });

    await user.click(await screen.findByRole('button', { name: 'Delete rule ^NEFT.*SALARY' }));

    await waitFor(() => expect(deleted).toBe('r-2'));
    await waitFor(() => expect(listCalls).toBe(2));
  });

  it('shows the server\'s message when a delete fails', async () => {
    const user = userEvent.setup();
    renderManager({
      handlers: [
        rulesHandler(),
        http.delete(url('/category-rules/:id'), () =>
          HttpResponse.json({ message: 'Category rule not found' }, { status: 404 })),
      ],
    });

    await user.click(await screen.findByRole('button', { name: 'Delete rule swiggy' }));

    expect(await screen.findByText('Category rule not found', { selector: 'p.text-destructive' })).toBeInTheDocument();
  });

  it('falls back to a generic message when a delete fails without one', async () => {
    const user = userEvent.setup();
    renderManager({
      handlers: [rulesHandler(), http.delete(url('/category-rules/:id'), () => new HttpResponse(null, { status: 500 }))],
    });

    await user.click(await screen.findByRole('button', { name: 'Delete rule swiggy' }));

    expect(await screen.findByText('Could not delete rule')).toBeInTheDocument();
  });
});
