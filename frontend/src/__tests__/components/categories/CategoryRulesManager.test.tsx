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
import { useState } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CategoryRulesManager,
  MAX_PATTERN_LENGTH,
  MAX_RULES,
  REGEX_LITERAL_WITH_FLAGS,
  StagedCategoryRules,
  validateRuleInput,
  type CategoryRule,
  type RuleDraft,
} from '@/components/categories/CategoryRulesManager';
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
          HttpResponse.json({ message: 'A keyword rule for "zepto" already exists' }, { status: 409 })),
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

    await fillForm(user, { pattern: 'zepto' });
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

describe('validateRuleInput — mirrors the server so a staged rule can\'t fail after its category is created', () => {
  const EXISTING: RuleDraft[] = [
    { matchType: 'KEYWORD', pattern: 'swiggy' },
    { matchType: 'REGEX', pattern: '^upi/.*zomato' },
  ];

  it.each([
    ['KEYWORD', '   ', 'Pattern is required'],
    ['KEYWORD', 'x'.repeat(201), 'Pattern must be at most 200 characters'],
    ['REGEX', '/swiggy/i', 'Enter the pattern without the surrounding slashes and flags — matching is already case-insensitive'],
    ['REGEX', '.*', 'This pattern matches empty text, so it would match every transaction'],
    ['KEYWORD', '  SWIGGY ', 'A keyword rule for "swiggy" already exists'],
    ['REGEX', '^upi/.*zomato', 'A regex rule for "^upi/.*zomato" already exists'],
  ] as const)('%s %j → %s', (matchType, pattern, message) => {
    expect(validateRuleInput(matchType, pattern, EXISTING)).toBe(message);
  });

  it('reports a regex syntax error the way the server does', () => {
    expect(validateRuleInput('REGEX', '(a+', [])).toMatch(/^Invalid regular expression: /);
  });

  it.each([
    ['KEYWORD', 'amazon (pay'], // "(" is a literal character in a text rule
    ['REGEX', '/upi/.*/gym'], // a bare slash pattern is a real UPI segment, not a literal
    ['REGEX', 'Swiggy'], // regexes aren't case-folded, so this isn't the keyword "swiggy"
    ['REGEX', 'swiggy'], // same text as a KEYWORD rule is a different rule
    ['KEYWORD', 'x'.repeat(200)],
  ] as const)('accepts %s %j', (matchType, pattern) => {
    expect(validateRuleInput(matchType, pattern, EXISTING)).toBeNull();
  });
});

describe('CategoryRulesManager — scoped to one category (Edit Category dialog)', () => {
  function renderScoped(categoryId = 'cat-food', handlers = [rulesHandler()]) {
    return renderPage(<CategoryRulesManager categories={CATEGORIES} categoryId={categoryId} />, { route: '/', handlers });
  }

  it('lists only that category\'s rules, with no category picker, defaulting to regex', async () => {
    renderScoped('cat-food');
    const list = await screen.findByRole('list', { name: 'Rules for this category' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(list).toHaveTextContent('swiggy');
    expect(list).not.toHaveTextContent('NEFT');
    expect(screen.queryByLabelText('Category')).toBeNull();
    expect(screen.getByLabelText('Match type')).toHaveValue('REGEX');
  });

  it('shows a scoped empty state', async () => {
    renderScoped('cat-rent');
    expect(await screen.findByText('No rules for this category yet.')).toBeInTheDocument();
  });

  it('saves straight away against the fixed category', async () => {
    const user = userEvent.setup();
    let body: any = null;
    renderScoped('cat-food', [rulesHandler(), http.post(url('/category-rules'), async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ data: {} }, { status: 201 });
    })]);
    await screen.findByRole('list', { name: 'Rules for this category' });

    await user.type(screen.getByLabelText('Pattern'), '^UPI/.*BLINKIT');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(body).toEqual({ matchType: 'REGEX', pattern: '^UPI/.*BLINKIT', categoryId: 'cat-food' }));
  });

  it('never submits a surrounding form — Add, Enter or delete', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: any) => e.preventDefault());
    renderPage(
      <form onSubmit={onSubmit}><CategoryRulesManager categories={CATEGORIES} categoryId="cat-food" /></form>,
      {
        route: '/',
        handlers: [
          rulesHandler(),
          http.post(url('/category-rules'), () => HttpResponse.json({ data: {} }, { status: 201 })),
          http.delete(url('/category-rules/:id'), () => new HttpResponse(null, { status: 204 })),
        ],
      },
    );
    await screen.findByRole('list', { name: 'Rules for this category' });

    await user.type(screen.getByLabelText('Pattern'), 'blinkit');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.type(screen.getByLabelText('Pattern'), 'zepto{Enter}');
    await user.click(screen.getByRole('button', { name: 'Delete rule swiggy' }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('CategoryRulesManager — no double submit', () => {
  it('ignores a second Enter while the first add is still saving', async () => {
    const user = userEvent.setup();
    let posts = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    renderPage(<CategoryRulesManager categories={CATEGORIES} categoryId="cat-food" />, {
      route: '/',
      handlers: [rulesHandler(), http.post(url('/category-rules'), async () => {
        posts++;
        await gate;
        return HttpResponse.json({ data: {} }, { status: 201 });
      })],
    });
    await screen.findByRole('list', { name: 'Rules for this category' });

    await user.type(screen.getByLabelText('Pattern'), 'blinkit{Enter}{Enter}');
    release();
    await waitFor(() => expect(screen.getByLabelText('Pattern')).toHaveValue(''));
    expect(posts).toBe(1);
  });
});

describe('client/server rule limits stay in sync', () => {
  // The frontend image can't import backend code, so pin the mirrored constants against
  // the backend source (both are in the same checkout in CI).
  const read = (rel: string) => readFileSync(resolve(__dirname, '../../../../../backend/src', rel), 'utf8');

  it('uses the same rules-per-user cap as categoryRuleService', () => {
    expect(read('services/categoryRuleService.ts')).toContain(`MAX_RULES_PER_USER = ${MAX_RULES};`);
  });

  it('uses the same /pattern/flags detector as safeRegex', () => {
    expect(read('utils/safeRegex.ts')).toContain(`REGEX_LITERAL_WITH_FLAGS = ${REGEX_LITERAL_WITH_FLAGS.toString()};`);
  });

  it('uses the same pattern length cap as the category-rules route', () => {
    expect(read('routes/categoryRules.ts')).toContain(`.max(${MAX_PATTERN_LENGTH})`);
  });
});

describe('CategoryRulesManager — unscoped (dedicated section) keeps its behavior', () => {
  it('defaults to "Contains text" and offers the category picker', async () => {
    renderManager();
    expect(await screen.findByLabelText('Match type')).toHaveValue('KEYWORD');
    expect(screen.getByLabelText('Category')).toBeInTheDocument();
  });

  it('blocks a new rule at the 100-rule cap without a request', async () => {
    const user = userEvent.setup();
    const many: CategoryRule[] = Array.from({ length: 100 }, (_, i) => ({
      id: `r-${i}`, matchType: 'KEYWORD', pattern: `kw${i}`, categoryId: 'cat-food', category: FOOD,
    }));
    const onBody = vi.fn();
    renderManager({ handlers: [rulesHandler(many), http.post(url('/category-rules'), () => { onBody(); return HttpResponse.json({}); })] });
    await screen.findByRole('list', { name: 'Auto-categorization rules' });

    await fillForm(user, { pattern: 'another' });
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('You can have at most 100 auto-categorization rules')).toBeInTheDocument();
    expect(onBody).not.toHaveBeenCalled();
  });
});

describe('StagedCategoryRules (Add Category dialog — nothing is saved until the category is)', () => {
  function Harness({ existing = [] as RuleDraft[], initial = [] as RuleDraft[], rulesUnavailable = false, onValue = (_: RuleDraft[]) => {} }) {
    const [value, setValue] = useState<RuleDraft[]>(initial);
    return (
      <form onSubmit={(e) => { e.preventDefault(); throw new Error('the category form must not submit'); }}>
        <StagedCategoryRules
          value={value}
          onChange={(v) => { setValue(v); onValue(v); }}
          existingRules={existing}
          rulesUnavailable={rulesUnavailable}
        />
      </form>
    );
  }

  it('stages rules locally (regex by default) without any request, and removes them', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    // No MSW handler for /category-rules POST: any request would fail the test.
    renderPage(<Harness onValue={onValue} />, { route: '/' });

    expect(screen.getByLabelText('Match type')).toHaveValue('REGEX');
    expect(screen.getByText('Rules are saved when you add the category.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Pattern'), '^upi/.*swiggy{Enter}');
    await user.selectOptions(screen.getByLabelText('Match type'), 'KEYWORD');
    await user.type(screen.getByLabelText('Pattern'), 'zomato');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    const list = screen.getByRole('list', { name: 'Rules to add' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(onValue).toHaveBeenLastCalledWith([
      { matchType: 'REGEX', pattern: '^upi/.*swiggy' },
      { matchType: 'KEYWORD', pattern: 'zomato' },
    ]);

    await user.click(screen.getByRole('button', { name: 'Remove rule ^upi/.*swiggy' }));
    expect(onValue).toHaveBeenLastCalledWith([{ matchType: 'KEYWORD', pattern: 'zomato' }]);
  });

  it('rejects a duplicate of an existing rule or of another staged one', async () => {
    const user = userEvent.setup();
    renderPage(<Harness existing={[{ matchType: 'REGEX', pattern: '^neft' }]} initial={[{ matchType: 'REGEX', pattern: 'blinkit' }]} />, { route: '/' });

    await user.type(screen.getByLabelText('Pattern'), '^neft{Enter}');
    expect(screen.getByText('A regex rule for "^neft" already exists')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Pattern'));
    await user.type(screen.getByLabelText('Pattern'), 'blinkit{Enter}');
    expect(screen.getByText('A regex rule for "blinkit" already exists')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Rules to add' })).getAllByRole('listitem')).toHaveLength(1);
  });

  it('counts staged rules toward the 100-rule cap', async () => {
    const user = userEvent.setup();
    const existing = Array.from({ length: 99 }, (_, i) => ({ matchType: 'KEYWORD' as const, pattern: `kw${i}` }));
    renderPage(<Harness existing={existing} initial={[{ matchType: 'REGEX', pattern: 'one' }]} />, { route: '/' });

    await user.type(screen.getByLabelText('Pattern'), 'two{Enter}');
    expect(screen.getByText('You can have at most 100 auto-categorization rules')).toBeInTheDocument();
  });

  it('says when existing rules could not be checked (loading or failed)', () => {
    renderPage(<Harness rulesUnavailable />, { route: '/' });
    expect(screen.getByText(/your existing rules aren't loaded/i)).toBeInTheDocument();
  });

  it('ignores an empty pattern', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    renderPage(<Harness onValue={onValue} />, { route: '/' });
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(onValue).not.toHaveBeenCalled();
  });
});
