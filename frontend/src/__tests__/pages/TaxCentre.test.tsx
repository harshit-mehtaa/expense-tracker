/**
 * Tax Centre — page smoke tests.
 *
 * The most query-heavy page in the app: 8 useQuery calls fire on mount, plus per-tab
 * queries, plus FYHistoryTab's useQueries fanned over 5 FY options. With MSW in
 * onUnhandledRequest:'error' mode every one of those needs a handler, which is the
 * point — a forgotten endpoint fails loudly instead of rendering an empty state that
 * looks like success.
 *
 * Two <h1>s exist on this page: "Tax Centre" (TaxCentre.tsx:237) and a print-only
 * "Tax Summary — FY …" (:284). Headings are therefore ALWAYS matched by name.
 *
 * The h1 renders unconditionally above the loading switch, so awaiting it proves
 * nothing about loading completing. Every test here awaits a real loaded sentinel.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import TaxCentrePage from '@/pages/tax/TaxCentre';
import { renderPage, failOnConsoleError } from '../support/renderPage';
import { url } from '../support/handlers';
import { MONEY, MONEY_FORMATTED } from '../support/fixtures';

failOnConsoleError();

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const REGIME = {
  tax: 40000,
  taxableIncome: 100000,
  taxAfterPaid: 5000,
  refund: 1000,
};

const TAX_SUMMARY = {
  grossSalary: MONEY, // renders as ₹1,25,000.00
  electedRegime: 'OLD',
  recommendedRegime: 'OLD',
  savings: 2500,
  oldRegime: REGIME,
  newRegime: { ...REGIME, tax: 45000 },
  deductions: {
    standardDeduction: 50000,
    hraExempt: 20000,
    s80C: 150000,
    s80D: 25000,
    section24B: 200000,
    other: 10000,
  },
};

const TRACKER_80C = {
  limit: 150000,
  utilized: 100000,
  remaining: 50000,
  pctUtilized: 66.7,
  breakdown: { 'EPF': 60000, 'ELSS': 40000 },
};

const ADVANCE_TAX = [
  { id: 'q1', description: 'Q1 Installment', percentageDue: 15, dueDate: '2025-06-15' },
];

/** Shapes match what each Schedule component destructures — thin fixtures crash them. */
const CG_SUMMARY = {
  totalTaxableGain: 0,
  stcg: { equity15Pct: 0, other: 0, total: 0 },
  ltcg: { equity10Pct: 0, debtMFSlab: 0, foreign20Pct: 0, withIndexation: 0, total: 0 },
  entryCount: 0,
};

const OS_SUMMARY = {
  grossTotal: 0,
  taxableTotal: 0,
  deduction80TTA: 0,
  foreignDividend: 0,
  totalTdsDeducted: 0,
  totalForeignWithholdingTax: 0,
  breakdown: { fdInterest: 0, savingsInterest: 0 },
};

const HP_SUMMARY = {
  taxableHPIncome: 0,
  totalHPIncome: 0,
  hpLossSetOff: 0,
  properties: [],
};

const FA_SUMMARY = { count: 0, totalClosingValueINR: 0, totalIncomeAccruedINR: 0, byCategory: {} };

const ITR2 = {
  regime: 'OLD',
  scheduleCG: CG_SUMMARY,
  scheduleOS: OS_SUMMARY,
  scheduleHP: HP_SUMMARY,
};

const TRACKER_80D = { selfFamily: 0, parents: 0, total: 0, policies: [] };

/** InsightsTab early-returns unless summary, tracker80C AND profile are all present. */
const TAX_PROFILE = { id: 'prof-1', regime: 'OLD', grossSalary: MONEY, hraReceived: 0, rentPaidMonthly: 0, cityType: 'METRO' };

/**
 * Every endpoint TaxCentre and its 13 tabs can touch.
 *
 * Registered as one bundle rather than per-tab: the tab loop below mounts the page
 * fresh for each tab, and scoping handlers per tab would mean 13 near-identical
 * arrays. The base-vs-page split still holds — none of these are in baseHandlers.
 */
const taxHandlers = () => [
  // Fired on mount
  http.get(url('/tax/summary'), () => HttpResponse.json({ data: TAX_SUMMARY })),
  http.get(url('/tax/80c-tracker'), () => HttpResponse.json({ data: TRACKER_80C })),
  http.get(url('/tax/advance-tax-calendar'), () => HttpResponse.json({ data: ADVANCE_TAX })),
  http.get(url('/tax/profile'), () => HttpResponse.json({ data: TAX_PROFILE })),
  http.get(url('/loans'), () => HttpResponse.json({ data: [] })),
  // Summary tab (enabled: activeTab === 'summary')
  http.get(url('/tax/capital-gains/summary'), () => HttpResponse.json({ data: CG_SUMMARY })),
  http.get(url('/tax/other-income/summary'), () => HttpResponse.json({ data: OS_SUMMARY })),
  http.get(url('/tax/house-property/summary'), () => HttpResponse.json({ data: HP_SUMMARY })),
  // Schedule tabs
  http.get(url('/tax/capital-gains'), () => HttpResponse.json({ data: [] })),
  http.get(url('/tax/other-income'), () => HttpResponse.json({ data: [] })),
  http.get(url('/tax/house-property'), () => HttpResponse.json({ data: [] })),
  http.get(url('/tax/foreign-assets'), () => HttpResponse.json({ data: [] })),
  http.get(url('/tax/foreign-assets/summary'), () => HttpResponse.json({ data: FA_SUMMARY })),
  http.get(url('/tax/itr2-summary'), () => HttpResponse.json({ data: ITR2 })),
  // 80D tracker tab
  http.get(url('/insurance/80d-summary'), () => HttpResponse.json({ data: TRACKER_80D })),
  // HRA calculator (on demand)
  http.get(url('/tax/hra-calculator'), () =>
    HttpResponse.json({ data: { exempt: 20000, taxable: 5000 } })),
];

const mount = (extra: ReturnType<typeof taxHandlers> = []) =>
  renderPage(<TaxCentrePage />, { route: '/tax', handlers: [...extra, ...taxHandlers()] });

// ─── The bar ──────────────────────────────────────────────────────────────────

describe('TaxCentre — smoke', () => {
  it('renders the page heading, matched by name (two h1s exist)', async () => {
    mount();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Tax Centre' }),
    ).toBeInTheDocument();
  });

  it('loads the tax summary and renders money in Indian format', async () => {
    mount();

    // Loaded sentinel: this heading only renders once `summary` resolves.
    expect(await screen.findByText('Gross Income Components')).toBeInTheDocument();

    // Leg 4: exact lakh-grouped formatting from summary.grossSalary.
    expect(screen.getAllByText(MONEY_FORMATTED).length).toBeGreaterThan(0);
  });

  it('shows the member selector for an ADMIN', async () => {
    mount();
    await screen.findByText('Gross Income Components');
    // The /admin/users query is `enabled: isAdmin`, so it only starts once the auth
    // restore resolves — the selector appears a tick after the summary does.
    await waitFor(() => {
      expect(document.querySelector('#tax-member-select')).toBeInTheDocument();
    });
  });

  it('surfaces an error toast when the summary request fails', async () => {
    mount([
      http.get(url('/tax/summary'), () =>
        HttpResponse.json({ message: 'Tax service exploded' }, { status: 500 })),
    ]);

    // The page renders its shell regardless, so the toast is the only failure signal.
    await waitFor(() => {
      expect(screen.getByText(/Tax service exploded/i)).toBeInTheDocument();
    });
  });
});

// ─── Profile editing ────────────────────────────────────────────────────────────

/**
 * Regression suite for a real, reachable bug: a profile whose `cityType` is `null`
 * (legitimate — the DB column is nullable with no default, and the <select> that sets
 * it only renders under the OLD regime, so a first save under NEW regime omits it)
 * permanently locked the ENTIRE form from saving, with zero visible feedback — zod's
 * `.optional()` rejects `null` (only `undefined`), object parsing is all-or-nothing,
 * and the form had no `formState.errors` rendering anywhere. Fixed by hydrating via a
 * null-coalescing mapper (matching every other edit form in this repo) instead of
 * feeding the raw server row into RHF, plus a form-level error banner so this class of
 * failure can no longer be silent for any field, present or future.
 */
describe('TaxCentre — profile editing', () => {
  it('round-trips a real cityType value in the save payload (the positive path)', async () => {
    // All the other new tests assert absence/rejection of cityType — none of them would
    // fail if a regression silently dropped cityType from every payload. This is the one
    // that would.
    const user = userEvent.setup();
    const calls: any[] = [];
    mount([
      http.post(url('/tax/profile'), async ({ request }) => {
        calls.push(await request.json());
        return HttpResponse.json({ data: TAX_PROFILE });
      }),
    ]);
    await screen.findByText('Gross Income Components');

    await user.selectOptions(screen.getByLabelText(/city type/i), 'NON_METRO');
    await user.click(screen.getByRole('button', { name: /calculate & save/i }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].cityType).toBe('NON_METRO');
  });

  it('saves a profile whose cityType is null from the server (the core lockout bug)', async () => {
    const user = userEvent.setup();
    const calls: any[] = [];
    mount([
      http.get(url('/tax/profile'), () => HttpResponse.json({ data: { ...TAX_PROFILE, cityType: null } })),
      http.post(url('/tax/profile'), async ({ request }) => {
        calls.push(await request.json());
        return HttpResponse.json({ data: { ...TAX_PROFILE, cityType: null } });
      }),
    ]);
    await screen.findByText('Gross Income Components');

    // Genuinely red before the fix: this assertion is on the desired behaviour (the
    // POST actually firing), not on the absence of one — "no POST fires" would pass
    // vacuously against the broken code (or for an unrelated reason, e.g. a bad
    // selector), proving nothing.
    await user.clear(screen.getByLabelText(/gross salary/i));
    await user.type(screen.getByLabelText(/gross salary/i), '600000');
    await user.click(screen.getByRole('button', { name: /calculate & save/i }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).not.toHaveProperty('cityType');
    expect(calls[0]).toMatchObject({ grossSalary: 600000 });
  });

  it('still rejects a corrupted enum value from the server, and shows the error banner', async () => {
    const user = userEvent.setup();
    const calls: any[] = [];
    mount([
      http.get(url('/tax/profile'), () => HttpResponse.json({ data: { ...TAX_PROFILE, cityType: 'PLUTO' } })),
      http.post(url('/tax/profile'), async ({ request }) => {
        calls.push(await request.json());
        return HttpResponse.json({ data: TAX_PROFILE });
      }),
    ]);
    await screen.findByText('Gross Income Components');

    await user.click(screen.getByRole('button', { name: /calculate & save/i }));

    await screen.findByText(/fix the following before saving/i);
    expect(calls).toHaveLength(0);
  });

  it('blocks save when HRA is claimed under OLD regime with no city type selected', async () => {
    const user = userEvent.setup();
    const calls: any[] = [];
    mount([
      // No prior profile — the create path, same as a brand-new user.
      http.get(url('/tax/profile'), () => HttpResponse.json({ data: null })),
      http.post(url('/tax/profile'), async ({ request }) => {
        calls.push(await request.json());
        return HttpResponse.json({ data: TAX_PROFILE });
      }),
    ]);
    await screen.findByText('Gross Income Components');

    // Regime defaults to OLD (the <select>'s first option); claim HRA without picking
    // a city — the blank "Select…" option is exactly the state a null-cityType profile
    // renders as post-fix, so this proves that state can no longer be silently saved.
    await user.type(screen.getByLabelText(/hra received/i), '20000');
    await user.click(screen.getByRole('button', { name: /calculate & save/i }));

    // Appears twice by design: inline next to the (visible) City Type field, and in
    // the form-level banner — the latter is what makes hidden-field failures visible.
    await waitFor(() => {
      expect(screen.getAllByText(/required to compute the hra exemption/i).length).toBeGreaterThan(0);
    });
    expect(calls).toHaveLength(0);
  });

  it('rejects a negative gross salary — the reachable case for the new error banner', async () => {
    const user = userEvent.setup();
    const calls: any[] = [];
    mount([
      http.post(url('/tax/profile'), async ({ request }) => {
        calls.push(await request.json());
        return HttpResponse.json({ data: TAX_PROFILE });
      }),
    ]);
    await screen.findByText('Gross Income Components');

    // No native `min` on the input, so a negative number passes the browser and is
    // only caught by zod — exactly the always-visible field a real user can hit.
    await user.clear(screen.getByLabelText(/gross salary/i));
    await user.type(screen.getByLabelText(/gross salary/i), '-5');
    await user.click(screen.getByRole('button', { name: /calculate & save/i }));

    await screen.findByText(/fix the following before saving/i);
    expect(calls).toHaveLength(0);
  });

  it('first save under NEW regime omits cityType, and the resulting profile stays editable', async () => {
    const user = userEvent.setup();
    const calls: any[] = [];
    const first = mount([
      http.get(url('/tax/profile'), () => HttpResponse.json({ data: null })),
      http.post(url('/tax/profile'), async ({ request }) => {
        calls.push(await request.json());
        return HttpResponse.json({ data: { id: 'prof-new', regime: 'NEW', cityType: null } });
      }),
    ]);
    await screen.findByText('Gross Income Components');

    await user.selectOptions(screen.getByLabelText(/tax regime/i), 'NEW');
    await user.click(screen.getByRole('button', { name: /calculate & save/i }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).not.toHaveProperty('cityType');
    first.unmount();

    // The full round trip: re-mount as if the invalidated query refetched the
    // now-null-cityType profile, and confirm it is still editable (the original bug's
    // reproduction path, not just its symptom in isolation).
    const calls2: any[] = [];
    mount([
      http.get(url('/tax/profile'), () => HttpResponse.json({ data: { id: 'prof-new', regime: 'NEW', cityType: null } })),
      http.post(url('/tax/profile'), async ({ request }) => {
        calls2.push(await request.json());
        return HttpResponse.json({ data: { id: 'prof-new', regime: 'NEW', cityType: null } });
      }),
    ]);
    await screen.findByText('Gross Income Components');
    await user.click(screen.getByRole('button', { name: /calculate & save/i }));
    await waitFor(() => expect(calls2).toHaveLength(1));
  });

  it('does not leak an unsaved edit onto a different member after switching the selector', async () => {
    // Regression for a real bug found in review: `resetOptions:{keepDirtyValues:true}`
    // (tried as a fix for a different, narrower problem) preserves dirty state by FIELD
    // NAME, not by "whose profile this is" — an edited-but-unsaved grossSalary for self
    // survived a member-selector switch and was both DISPLAYED as and POSTED for a
    // different family member, PROVIDED both profiles were already cached (a fresh
    // gcTime:0 client masks this — the query-key change is then a genuine cache miss,
    // and the resulting loading transition incidentally clears dirty state as a side
    // effect). Reproducing it for real needs production-like cache retention; see the
    // gcTime/staleTime override on renderPage. Fixed by dropping keepDirtyValues —
    // `values` alone resets fully on every change, including an identity switch.
    const user = userEvent.setup();
    const calls: any[] = [];
    const SELF = { ...TAX_PROFILE, grossSalary: 111111 };
    const OTHER = { ...TAX_PROFILE, id: 'prof-other', grossSalary: 222222 };
    renderPage(<TaxCentrePage />, {
      route: '/tax',
      gcTime: 10 * 60 * 1000,
      staleTime: 5 * 60 * 1000,
      handlers: [
        http.get(url('/tax/profile'), ({ request }) => {
          const target = new URL(request.url).searchParams.get('targetUserId');
          return HttpResponse.json({ data: target === 'u-member' ? OTHER : SELF });
        }),
        http.post(url('/tax/profile'), async ({ request }) => {
          const target = new URL(request.url).searchParams.get('targetUserId');
          calls.push({ target, body: await request.json() });
          return HttpResponse.json({ data: SELF });
        }),
        ...taxHandlers(),
      ],
    });
    await screen.findByText('Gross Income Components');
    await waitFor(() => expect(document.querySelector('#tax-member-select')).toBeInTheDocument());

    // Warm BOTH profiles into cache before dirtying anything (switch to the other
    // member and back), matching the exact conditions that reproduce the bug.
    await user.selectOptions(document.querySelector('#tax-member-select') as HTMLSelectElement, 'u-member');
    await waitFor(() => expect(screen.getByLabelText(/gross salary/i)).toHaveValue(222222));
    await user.selectOptions(document.querySelector('#tax-member-select') as HTMLSelectElement, '');
    await waitFor(() => expect(screen.getByLabelText(/gross salary/i)).toHaveValue(111111));

    // Dirty self's grossSalary without saving, then switch to the other member.
    const salaryInput = screen.getByLabelText(/gross salary/i) as HTMLInputElement;
    await user.clear(salaryInput);
    await user.type(salaryInput, '999999');

    await user.selectOptions(document.querySelector('#tax-member-select') as HTMLSelectElement, 'u-member');
    // Must show the OTHER member's real value, not the leaked dirty one.
    await waitFor(() => expect(screen.getByLabelText(/gross salary/i)).toHaveValue(222222));

    await user.click(screen.getByRole('button', { name: /calculate & save/i }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].target).toBe('u-member');
    expect(calls[0].body.grossSalary).toBe(222222);
  });
});

// ─── Tab loop ─────────────────────────────────────────────────────────────────

/**
 * All 13 tabs from TaxCentre.tsx's `tabs` array, each with a marker that only
 * appears once that tab's body has mounted. Nine render separate components; four
 * render inline. Driving them from a table keeps this one consistent standard
 * rather than 13 improvised assertions.
 */
const TABS: Array<{ label: string; marker: RegExp }> = [
  { label: 'Tax Summary', marker: /Gross Income Components/i },
  { label: '80C Tracker', marker: /80C Deduction Tracker/i },
  { label: '80D Tracker', marker: /80D Health Insurance Tracker/i },
  { label: 'Insights', marker: /Regime Optimizer/i },
  { label: 'Advance Tax', marker: /Advance tax installments/i },
  { label: 'Tax Calendar', marker: /ITR Filing Deadline/i },
  { label: 'FY History', marker: /Gross Salary|No profile saved/i },
  { label: 'HRA Calculator', marker: /HRA Exemption Calculator/i },
  { label: 'Capital Gains', marker: /Schedule CG/i },
  { label: 'Other Sources', marker: /Schedule OS/i },
  { label: 'House Property', marker: /Schedule HP/i },
  { label: 'Foreign Assets (FA)', marker: /Schedule FA/i },
  { label: 'ITR-2 Overview', marker: /ITR-2 Schedule Overview/i },
];

describe('TaxCentre — every tab mounts', () => {
  it.each(TABS)('$label tab renders its body', async ({ label, marker }) => {
    const user = userEvent.setup();
    mount();
    await screen.findByText('Gross Income Components');

    await user.click(screen.getByRole('button', { name: label }));

    await waitFor(() => {
      expect(screen.getAllByText(marker).length).toBeGreaterThan(0);
    });
  });
});
