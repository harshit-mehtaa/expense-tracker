/**
 * Insurance page — smoke. Full bar applies: this page has a real loading state
 * ("Loading policies…") distinct from its empty state, so the loading -> loaded
 * transition is genuinely observable.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import InsurancePage from '@/pages/insurance/Insurance';
import { renderPage, failOnConsoleError } from '../support/renderPage';
import { url } from '../support/handlers';
import { MONEY_FORMATTED, MEMBER_USER, ADMIN_USER } from '../support/fixtures';
import { formatDate } from '@/lib/dateFormat';

failOnConsoleError();

const POLICY = {
  id: 'p-1',
  userId: 'u-member',
  policyName: 'Family Floater',
  policyType: 'HEALTH',
  insurer: 'Star Health',
  policyNumber: 'SH-001',
  sumAssured: 1000000,
  premiumAmount: 125000, // -> ₹1,25,000.00
  premiumFrequency: 'ANNUAL',
  premiumDueDate: 15,
  startDate: '2024-04-01T00:00:00.000Z',
  endDate: '2034-04-01T00:00:00.000Z',
  userName: 'Asha',
};

// providerName (not `insurer`, which POLICY above uses) — matches what the component
// actually reads via register('providerName'); startEdit's blanket setValue loop only
// populates fields present on the fixture, so an edit-and-submit test needs the real shape.
const VEHICLE_POLICY = {
  ...POLICY, id: 'p-2', policyType: 'VEHICLE', policyName: 'Two Wheeler Cover', providerName: 'HDFC Ergo',
};

const insuranceHandlers = (policies: unknown[] = [POLICY], d80: unknown = { total: 25000 }) => [
  http.get(url('/insurance'), () => HttpResponse.json({ data: policies })),
  http.get(url('/insurance/80d-summary'), () => HttpResponse.json({ data: d80 })),
];

const VEHICLE_A = { id: 'a-1', assetType: 'VEHICLE', name: 'Honda City', registrationNumber: 'KA01AB1234', insurancePolicyId: null };
const VEHICLE_B = { id: 'a-2', assetType: 'VEHICLE', name: 'Activa', registrationNumber: null, insurancePolicyId: null };

const assetHandlers = (assets: unknown[] = [VEHICLE_A, VEHICLE_B]) => [
  http.get(url('/assets'), () => HttpResponse.json({ data: assets })),
];

/** The card's Edit button has no accessible name (icon-only) — it's the FIRST of the
 *  card's two icon buttons (Edit2 before Trash2 in Insurance.tsx's JSX). */
async function openEditForm(user: ReturnType<typeof userEvent.setup>, policyName: string) {
  await screen.findByText(policyName);
  const card = screen.getByText(policyName).closest('div.rounded-lg') as HTMLElement;
  await user.click(within(card).getAllByRole('button')[0]);
}

/** Fills every field policySchema requires, so a create/update actually validates and submits. */
async function fillRequiredPolicyFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText(/LIC, HDFC Life/i), 'HDFC Ergo');
  await user.type(screen.getByLabelText(/policy number/i), 'PN-001');
  await user.type(screen.getByLabelText(/policy name/i), 'Bike Cover');
  await user.type(screen.getByLabelText(/sum assured/i), '100000');
  await user.type(screen.getByLabelText(/premium amount/i), '2000');
  await user.type(screen.getByLabelText(/start date/i), '2024-01-01');
}

describe('Insurance page — smoke', () => {
  it('shows loading, then renders policy data (the loading->loaded transition)', async () => {
    renderPage(<InsurancePage />, { route: '/insurance', handlers: insuranceHandlers() });

    // Leg 2: a genuine loading affordance, distinct from the empty state.
    expect(screen.getByText(/Loading policies/i)).toBeInTheDocument();

    // Leg 3: sentinel appears only once data lands; loading is gone.
    expect(await screen.findByText('Family Floater')).toBeInTheDocument();
    expect(screen.queryByText(/Loading policies/i)).toBeNull();

    // Leg 4: exact Indian formatting with lakh grouping.
    expect(screen.getAllByText(MONEY_FORMATTED).length).toBeGreaterThan(0);
  });

  it('renders the page heading', async () => {
    renderPage(<InsurancePage />, { route: '/insurance', handlers: insuranceHandlers() });
    expect(
      await screen.findByRole('heading', { level: 1, name: /insurance/i }),
    ).toBeInTheDocument();
  });

  it('renders the empty state when there are no policies', async () => {
    renderPage(<InsurancePage />, { route: '/insurance', handlers: insuranceHandlers([]) });
    expect(await screen.findByText(/No insurance policies added yet/i)).toBeInTheDocument();
  });

  it('renders the 80D deduction from its own query', async () => {
    renderPage(<InsurancePage />, {
      route: '/insurance',
      handlers: insuranceHandlers([POLICY], { total: 50000 }),
    });
    await screen.findByText('Family Floater');
    expect(screen.getByText('₹50,000.00')).toBeInTheDocument();
  });

  it('falls back to an em dash when 80D has no total', async () => {
    renderPage(<InsurancePage />, {
      route: '/insurance',
      handlers: insuranceHandlers([POLICY], {}),
    });
    await screen.findByText('Family Floater');
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('a MEMBER can open the add-policy form', async () => {
    // MEMBER: create controls are gated on !isViewingFamilyWide.
    const user = userEvent.setup();
    renderPage(<InsurancePage />, {
      route: '/insurance', handlers: insuranceHandlers(), user: MEMBER_USER,
    });
    await screen.findByText('Family Floater');

    await user.click(await screen.findByRole('button', { name: /add policy/i }));

    expect(await screen.findByRole('heading', { name: /add.*polic/i })).toBeInTheDocument();
  });

  it('renders nothing extra when a policy has no linked vehicles (assets field absent)', async () => {
    renderPage(<InsurancePage />, { route: '/insurance', handlers: insuranceHandlers() });
    await screen.findByText('Family Floater');
    expect(screen.queryByText(/covers:/i)).toBeNull();
  });

  it('shows a single linked vehicle with its registration number', async () => {
    const withOneVehicle = { ...POLICY, assets: [{ id: 'a-1', name: 'Honda City', registrationNumber: 'KA01AB1234', soldAt: null }] };
    renderPage(<InsurancePage />, { route: '/insurance', handlers: insuranceHandlers([withOneVehicle]) });
    await screen.findByText('Family Floater');
    expect(screen.getByText(/covers:/i)).toBeInTheDocument();
    expect(screen.getByText(/Honda City/)).toBeInTheDocument();
    expect(screen.getByText(/KA01AB1234/)).toBeInTheDocument();
  });

  it('shows multiple linked vehicles', async () => {
    const withTwoVehicles = {
      ...POLICY,
      assets: [
        { id: 'a-1', name: 'Honda City', registrationNumber: 'KA01AB1234', soldAt: null },
        { id: 'a-2', name: 'Activa', registrationNumber: null, soldAt: null },
      ],
    };
    renderPage(<InsurancePage />, { route: '/insurance', handlers: insuranceHandlers([withTwoVehicles]) });
    await screen.findByText('Family Floater');
    expect(screen.getByText(/Honda City/)).toBeInTheDocument();
    expect(screen.getByText('Activa')).toBeInTheDocument();
    // A comma separates entries but a trailing one after the last is a real regression
    // (index-based conditional — easy to get backwards in a future edit).
    expect(screen.getByText('Covers:').parentElement?.textContent).toMatch(/Honda City.*KA01AB1234.*,\s*Activa$/);
  });

  it('shows the sold badge for a linked vehicle that has been sold, without hiding it', async () => {
    const soldAt = '2026-06-01T00:00:00.000Z';
    const withSoldVehicle = { ...POLICY, assets: [{ id: 'a-1', name: 'Honda City', registrationNumber: null, soldAt }] };
    renderPage(<InsurancePage />, { route: '/insurance', handlers: insuranceHandlers([withSoldVehicle]) });
    await screen.findByText('Family Floater');
    expect(screen.getByText(/Honda City/)).toBeInTheDocument();
    expect(screen.getByText(`Sold ${formatDate(soldAt)}`)).toBeInTheDocument();
  });

  it('surfaces an error toast when the policies request fails', async () => {
    renderPage(<InsurancePage />, {
      route: '/insurance',
      handlers: [
        http.get(url('/insurance'), () =>
          HttpResponse.json({ message: 'Server exploded' }, { status: 500 })),
        http.get(url('/insurance/80d-summary'), () => HttpResponse.json({ data: { total: 0 } })),
      ],
    });

    await waitFor(() => {
      expect(screen.getByText(/Server exploded/i)).toBeInTheDocument();
    });
  });
});

// ─── Vehicle picker on the VEHICLE-policy form ────────────────────────────────
//
// Asset.insurancePolicyId is the FK — InsurancePolicy doesn't own the link — so
// linking/unlinking goes through the existing, already-validated PUT /api/assets/:id,
// not a new endpoint. These tests assert request ORDER and per-request bodies, not
// just final rendered state, since that ordering is the entire point of this feature
// (avoiding a false 409 from insuranceService's policyType-change guard).
describe('Insurance page — vehicle picker', () => {
  // The header "Add Policy" button has no explicit `type` attribute, so its DOM
  // `.type` property also normalizes to "submit" (the HTML default) — disambiguating
  // by that property would match either button. Scoping to the <form> itself (the
  // header button lives outside it) is unambiguous regardless.
  const submitButton = () => within(document.querySelector('form') as HTMLFormElement)
    .getByRole('button', { name: /policy/i });

  it('editing a VEHICLE policy pre-selects its currently-linked vehicles', async () => {
    const user = userEvent.setup();
    const policyWithVehicles = { ...VEHICLE_POLICY, assets: [{ id: 'a-1', name: 'Honda City', registrationNumber: 'KA01AB1234', soldAt: null }] };
    renderPage(<InsurancePage />, {
      route: '/insurance', user: MEMBER_USER,
      handlers: [...insuranceHandlers([policyWithVehicles]), ...assetHandlers()],
    });
    await openEditForm(user, 'Two Wheeler Cover');

    expect(await screen.findByRole('checkbox', { name: /honda city/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /activa/i })).not.toBeChecked();
  });

  it('creating a new VEHICLE policy starts with no vehicles selected', async () => {
    const user = userEvent.setup();
    renderPage(<InsurancePage />, {
      route: '/insurance', user: MEMBER_USER,
      handlers: [...insuranceHandlers([]), ...assetHandlers()],
    });
    await user.click(await screen.findByRole('button', { name: /add policy/i }));
    await user.selectOptions(screen.getByLabelText(/policy type/i), 'VEHICLE');

    expect(await screen.findByRole('checkbox', { name: /honda city/i })).not.toBeChecked();
  });

  it('creates a VEHICLE policy and links both selected vehicles after the policy exists', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    renderPage(<InsurancePage />, {
      route: '/insurance', user: MEMBER_USER,
      handlers: [
        ...insuranceHandlers([]),
        ...assetHandlers(),
        http.post(url('/insurance'), () => {
          calls.push('POST /insurance');
          return HttpResponse.json({ data: { ...VEHICLE_POLICY, id: 'p-new' } }, { status: 201 });
        }),
        http.put(url('/assets/a-1'), async ({ request }) => {
          calls.push('PUT /assets/a-1');
          expect(await request.json()).toMatchObject({ insurancePolicyId: 'p-new' });
          return HttpResponse.json({ data: VEHICLE_A });
        }),
        http.put(url('/assets/a-2'), async ({ request }) => {
          calls.push('PUT /assets/a-2');
          expect(await request.json()).toMatchObject({ insurancePolicyId: 'p-new' });
          return HttpResponse.json({ data: VEHICLE_B });
        }),
      ],
    });
    await user.click(await screen.findByRole('button', { name: /add policy/i }));
    await user.selectOptions(screen.getByLabelText(/policy type/i), 'VEHICLE');
    await fillRequiredPolicyFields(user);
    await user.click(await screen.findByRole('checkbox', { name: /honda city/i }));
    await user.click(screen.getByRole('checkbox', { name: /activa/i }));
    await user.click(submitButton());

    // Both link PUTs fire concurrently (Promise.allSettled), so only their COMPLETION
    // order relative to each other is unordered — wait for all 3 before asserting.
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[0]).toBe('POST /insurance');
    expect(calls).toContain('PUT /assets/a-1');
    expect(calls).toContain('PUT /assets/a-2');
  });

  it('closes the modal after a successful save', async () => {
    const user = userEvent.setup();
    renderPage(<InsurancePage />, {
      route: '/insurance', user: MEMBER_USER,
      handlers: [
        ...insuranceHandlers([]),
        ...assetHandlers(),
        http.post(url('/insurance'), () => HttpResponse.json({ data: { ...VEHICLE_POLICY, id: 'p-new' } }, { status: 201 })),
      ],
    });
    await user.click(await screen.findByRole('button', { name: /add policy/i }));
    await user.selectOptions(screen.getByLabelText(/policy type/i), 'VEHICLE');
    await fillRequiredPolicyFields(user);
    await user.click(submitButton());

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /add insurance policy/i })).toBeNull();
    });
  });

  it('keeps the modal open with data intact when the policy save itself fails', async () => {
    const user = userEvent.setup();
    renderPage(<InsurancePage />, {
      route: '/insurance', user: MEMBER_USER,
      handlers: [
        ...insuranceHandlers([]),
        ...assetHandlers(),
        http.post(url('/insurance'), () => HttpResponse.json({ message: 'Server exploded' }, { status: 500 })),
      ],
    });
    await user.click(await screen.findByRole('button', { name: /add policy/i }));
    await user.selectOptions(screen.getByLabelText(/policy type/i), 'VEHICLE');
    await fillRequiredPolicyFields(user);
    await user.click(submitButton());

    // Both the mutation's own onError and the app-wide axios error interceptor toast
    // the same failure — pre-existing, unrelated to this change.
    await waitFor(() => {
      expect(screen.getAllByText(/server exploded/i).length).toBeGreaterThan(0);
    });
    expect(screen.getByRole('heading', { name: /add insurance policy/i })).toBeInTheDocument();
    expect(submitButton()).not.toBeDisabled();
  });

  it('deselecting one vehicle while staying VEHICLE unlinks it, and the policy still saves', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const policyWithVehicles = {
      ...VEHICLE_POLICY,
      assets: [{ id: 'a-1', name: 'Honda City', registrationNumber: null, soldAt: null }, { id: 'a-2', name: 'Activa', registrationNumber: null, soldAt: null }],
    };
    renderPage(<InsurancePage />, {
      route: '/insurance', user: MEMBER_USER,
      handlers: [
        ...insuranceHandlers([policyWithVehicles]),
        ...assetHandlers([{ ...VEHICLE_A, insurancePolicyId: 'p-2' }, { ...VEHICLE_B, insurancePolicyId: 'p-2' }]),
        http.put(url('/assets/a-2'), async ({ request }) => {
          calls.push('PUT /assets/a-2');
          expect(await request.json()).toMatchObject({ insurancePolicyId: '' });
          return HttpResponse.json({ data: VEHICLE_B });
        }),
        http.put(url('/insurance/p-2'), () => { calls.push('PUT /insurance/p-2'); return HttpResponse.json({ data: policyWithVehicles }); }),
      ],
    });
    await openEditForm(user, 'Two Wheeler Cover');
    await user.click(await screen.findByRole('checkbox', { name: /activa/i }));
    await user.click(submitButton());

    await waitFor(() => expect(calls).toContain('PUT /insurance/p-2'));
    expect(calls).toEqual(['PUT /assets/a-2', 'PUT /insurance/p-2']);
  });

  it('switching a VEHICLE policy away from VEHICLE unlinks every vehicle BEFORE the policy save, avoiding the 409', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const policyWithVehicles = {
      ...VEHICLE_POLICY,
      assets: [{ id: 'a-1', name: 'Honda City', registrationNumber: null, soldAt: null }, { id: 'a-2', name: 'Activa', registrationNumber: null, soldAt: null }],
    };
    renderPage(<InsurancePage />, {
      route: '/insurance', user: MEMBER_USER,
      handlers: [
        ...insuranceHandlers([policyWithVehicles]),
        ...assetHandlers([{ ...VEHICLE_A, insurancePolicyId: 'p-2' }, { ...VEHICLE_B, insurancePolicyId: 'p-2' }]),
        http.put(url('/assets/a-1'), () => { calls.push('PUT /assets/a-1'); return HttpResponse.json({ data: VEHICLE_A }); }),
        http.put(url('/assets/a-2'), () => { calls.push('PUT /assets/a-2'); return HttpResponse.json({ data: VEHICLE_B }); }),
        http.put(url('/insurance/p-2'), () => { calls.push('PUT /insurance/p-2'); return HttpResponse.json({ data: policyWithVehicles }); }),
      ],
    });
    await openEditForm(user, 'Two Wheeler Cover');
    await user.selectOptions(screen.getByLabelText(/policy type/i), 'HEALTH');
    await user.click(screen.getByRole('button', { name: /^update policy$/i }));

    await waitFor(() => expect(calls).toContain('PUT /insurance/p-2'));
    expect(calls.indexOf('PUT /insurance/p-2')).toBeGreaterThan(calls.indexOf('PUT /assets/a-1'));
    expect(calls.indexOf('PUT /insurance/p-2')).toBeGreaterThan(calls.indexOf('PUT /assets/a-2'));
  });

  it('aborts the whole submit if an unlink fails while leaving VEHICLE — policy is not saved', async () => {
    const user = userEvent.setup();
    let policyPutCalled = false;
    const policyWithVehicles = { ...VEHICLE_POLICY, assets: [{ id: 'a-1', name: 'Honda City', registrationNumber: null, soldAt: null }] };
    renderPage(<InsurancePage />, {
      route: '/insurance', user: MEMBER_USER,
      handlers: [
        ...insuranceHandlers([policyWithVehicles]),
        ...assetHandlers([{ ...VEHICLE_A, insurancePolicyId: 'p-2' }]),
        http.put(url('/assets/a-1'), () => HttpResponse.json({ message: 'Server exploded' }, { status: 500 })),
        http.put(url('/insurance/p-2'), () => { policyPutCalled = true; return HttpResponse.json({ data: policyWithVehicles }); }),
      ],
    });
    await openEditForm(user, 'Two Wheeler Cover');
    await user.selectOptions(screen.getByLabelText(/policy type/i), 'HEALTH');
    await user.click(screen.getByRole('button', { name: /^update policy$/i }));

    await waitFor(() => {
      expect(screen.getByText(/could not unlink.*policy not saved/i)).toBeInTheDocument();
    });
    expect(policyPutCalled).toBe(false);
  });

  it('reports an unlink failure while staying VEHICLE but still saves the policy', async () => {
    const user = userEvent.setup();
    let policyPutCalled = false;
    const policyWithVehicles = {
      ...VEHICLE_POLICY,
      assets: [{ id: 'a-1', name: 'Honda City', registrationNumber: null, soldAt: null }, { id: 'a-2', name: 'Activa', registrationNumber: null, soldAt: null }],
    };
    renderPage(<InsurancePage />, {
      route: '/insurance', user: MEMBER_USER,
      handlers: [
        ...insuranceHandlers([policyWithVehicles]),
        ...assetHandlers([{ ...VEHICLE_A, insurancePolicyId: 'p-2' }, { ...VEHICLE_B, insurancePolicyId: 'p-2' }]),
        http.put(url('/assets/a-1'), () => HttpResponse.json({ message: 'Server exploded' }, { status: 500 })),
        http.put(url('/assets/a-2'), () => HttpResponse.json({ data: VEHICLE_B })),
        http.put(url('/insurance/p-2'), () => { policyPutCalled = true; return HttpResponse.json({ data: policyWithVehicles }); }),
      ],
    });
    await openEditForm(user, 'Two Wheeler Cover');
    // Deselect BOTH — a-1's unlink will fail, a-2's will succeed, policyType stays VEHICLE.
    await user.click(await screen.findByRole('checkbox', { name: /honda city/i }));
    await user.click(screen.getByRole('checkbox', { name: /activa/i }));
    await user.click(screen.getByRole('button', { name: /^update policy$/i }));

    await waitFor(() => {
      expect(screen.getByText(/could not unlink 1 of 2 vehicle/i)).toBeInTheDocument();
    });
    expect(policyPutCalled).toBe(true);
  });

  it('reports a partial link failure with a count, after the policy is already saved', async () => {
    const user = userEvent.setup();
    renderPage(<InsurancePage />, {
      route: '/insurance', user: MEMBER_USER,
      handlers: [
        ...insuranceHandlers([]),
        ...assetHandlers(),
        http.post(url('/insurance'), () => HttpResponse.json({ data: { ...VEHICLE_POLICY, id: 'p-new' } }, { status: 201 })),
        http.put(url('/assets/a-1'), () => HttpResponse.json({ data: VEHICLE_A })),
        http.put(url('/assets/a-2'), () => HttpResponse.json({ message: 'Server exploded' }, { status: 500 })),
      ],
    });
    await user.click(await screen.findByRole('button', { name: /add policy/i }));
    await user.selectOptions(screen.getByLabelText(/policy type/i), 'VEHICLE');
    await fillRequiredPolicyFields(user);
    await user.click(await screen.findByRole('checkbox', { name: /honda city/i }));
    await user.click(screen.getByRole('checkbox', { name: /activa/i }));
    await user.click(submitButton());

    await waitFor(() => {
      expect(screen.getByText(/policy saved, but 1 of 2 vehicle link\(s\) failed/i)).toBeInTheDocument();
    });
  });

  it('shows a hint when a candidate vehicle is already linked to a different policy', async () => {
    const user = userEvent.setup();
    renderPage(<InsurancePage />, {
      route: '/insurance', user: MEMBER_USER,
      handlers: [
        ...insuranceHandlers([]),
        ...assetHandlers([
          { ...VEHICLE_A, insurancePolicyId: 'p-other', insurancePolicy: { id: 'p-other', policyType: 'VEHICLE', providerName: 'ICICI Lombard', policyName: 'Old Cover' } },
          VEHICLE_B,
        ]),
      ],
    });
    await user.click(await screen.findByRole('button', { name: /add policy/i }));
    await user.selectOptions(screen.getByLabelText(/policy type/i), 'VEHICLE');

    expect(await screen.findByText(/currently linked to ICICI Lombard/i)).toBeInTheDocument();
  });

  it('scopes the candidate list to the policy owner when an ADMIN edits another member from family-wide view', async () => {
    const user = userEvent.setup();
    let requestedTargetUserId: string | null = null;
    const otherMembersPolicy = { ...VEHICLE_POLICY, userId: 'u-other-member' };
    renderPage(<InsurancePage />, {
      route: '/insurance', user: ADMIN_USER,
      handlers: [
        ...insuranceHandlers([otherMembersPolicy]),
        http.get(url('/assets'), ({ request }) => {
          requestedTargetUserId = new URL(request.url).searchParams.get('targetUserId');
          return HttpResponse.json({ data: [VEHICLE_A, VEHICLE_B] });
        }),
      ],
    });
    await openEditForm(user, 'Two Wheeler Cover');

    await waitFor(() => expect(requestedTargetUserId).toBe('u-other-member'));
  });

  it('shows a fallback message when the vehicle list fails to load', async () => {
    const user = userEvent.setup();
    renderPage(<InsurancePage />, {
      route: '/insurance', user: MEMBER_USER,
      handlers: [
        ...insuranceHandlers([]),
        http.get(url('/assets'), () => HttpResponse.json({ message: 'Server exploded' }, { status: 500 })),
      ],
    });
    await user.click(await screen.findByRole('button', { name: /add policy/i }));
    await user.selectOptions(screen.getByLabelText(/policy type/i), 'VEHICLE');

    expect(await screen.findByText(/couldn't load vehicles/i)).toBeInTheDocument();
  });

  it('shows an empty-state hint when there are no vehicle assets yet', async () => {
    const user = userEvent.setup();
    renderPage(<InsurancePage />, {
      route: '/insurance', user: MEMBER_USER,
      handlers: [...insuranceHandlers([]), ...assetHandlers([])],
    });
    await user.click(await screen.findByRole('button', { name: /add policy/i }));
    await user.selectOptions(screen.getByLabelText(/policy type/i), 'VEHICLE');

    expect(await screen.findByText(/no vehicle assets yet/i)).toBeInTheDocument();
  });

  it('hides a sold vehicle from new candidates, but keeps an already-linked one selectable', async () => {
    const user = userEvent.setup();
    const soldUnlinked = { ...VEHICLE_A, soldAt: '2026-01-01T00:00:00.000Z' };
    const soldButLinked = { ...VEHICLE_B, soldAt: '2026-01-01T00:00:00.000Z' };
    const policyWithSoldVehicle = { ...VEHICLE_POLICY, assets: [{ id: 'a-2', name: 'Activa', registrationNumber: null, soldAt: soldButLinked.soldAt }] };
    renderPage(<InsurancePage />, {
      route: '/insurance', user: MEMBER_USER,
      handlers: [...insuranceHandlers([policyWithSoldVehicle]), ...assetHandlers([soldUnlinked, soldButLinked])],
    });
    await openEditForm(user, 'Two Wheeler Cover');

    expect(screen.queryByRole('checkbox', { name: /honda city/i })).toBeNull();
    expect(await screen.findByRole('checkbox', { name: /activa/i })).toBeChecked();
  });

  it('sends an explicit null when premiumDueDate is cleared, not omitted', async () => {
    const user = userEvent.setup();
    const policyWithDueDate = { ...VEHICLE_POLICY, premiumDueDate: 15 };
    let body: any = null;
    renderPage(<InsurancePage />, {
      route: '/insurance', user: MEMBER_USER,
      handlers: [
        ...insuranceHandlers([policyWithDueDate]),
        ...assetHandlers(),
        http.put(url('/insurance/p-2'), async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ data: policyWithDueDate });
        }),
      ],
    });
    await openEditForm(user, 'Two Wheeler Cover');
    const dueDateInput = screen.getByLabelText(/premium due day/i);
    await user.clear(dueDateInput);
    await user.click(screen.getByRole('button', { name: /^update policy$/i }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toHaveProperty('premiumDueDate', null);
  });

  it('invalidates the assets cache once the full link reconciliation completes', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderPage(<InsurancePage />, {
      route: '/insurance', user: MEMBER_USER,
      handlers: [
        ...insuranceHandlers([]),
        ...assetHandlers(),
        http.post(url('/insurance'), () => HttpResponse.json({ data: { ...VEHICLE_POLICY, id: 'p-new' } }, { status: 201 })),
        http.put(url('/assets/a-1'), () => HttpResponse.json({ data: VEHICLE_A })),
      ],
    });
    await user.click(await screen.findByRole('button', { name: /add policy/i }));
    await user.selectOptions(screen.getByLabelText(/policy type/i), 'VEHICLE');
    await fillRequiredPolicyFields(user);
    await user.click(await screen.findByRole('checkbox', { name: /honda city/i }));
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    await user.click(submitButton());

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['insurance'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['assets'] });
    });
  });
});
