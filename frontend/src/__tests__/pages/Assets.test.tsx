/**
 * Assets page — smoke.
 *
 * The one asset kind with no dedicated page before this — a vehicle or any unsecured
 * item could only ever be created inline from the Loans page's collateral picker.
 * `assetsApi` already had full CRUD end-to-end; this page is the first place to reach
 * it standalone.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import AssetsPage from '@/pages/investments/Assets';
import { renderPage, failOnConsoleError, SearchParamsProbe } from '../support/renderPage';
import { url } from '../support/handlers';
import { MEMBER_USER } from '../support/fixtures';

failOnConsoleError();

const VEHICLE = {
  id: 'a-1',
  userId: 'u-member',
  assetType: 'VEHICLE',
  name: 'Honda City',
  value: 800000,
  realEstateId: null,
  goldHoldingId: null,
  notes: 'Reg: KA-01-AB-1234',
  loans: [],
};

// Represents a property tracked via RealEstate — must NOT appear on this page, or the
// same property would show twice with two different edit forms.
const LINKED_PROPERTY_ASSET = {
  id: 'a-2',
  userId: 'u-member',
  assetType: 'PROPERTY',
  name: 'Flat 3B',
  value: 8500000,
  realEstateId: 're-1',
  goldHoldingId: null,
  loans: [],
};

const assetHandlers = (assets: unknown[] = [VEHICLE, LINKED_PROPERTY_ASSET], captured?: (string | null)[]) => [
  http.get(url('/assets'), ({ request }) => {
    captured?.push(new URL(request.url).searchParams.get('targetUserId'));
    return HttpResponse.json({ data: assets });
  }),
];

const VEHICLE_POLICY = {
  id: 'ip-1', userId: 'u-member', policyType: 'VEHICLE',
  providerName: 'HDFC Ergo', policyName: 'Honda City Cover', endDate: '2027-05-01T00:00:00.000Z',
};
const HEALTH_POLICY = { id: 'ip-2', userId: 'u-member', policyType: 'HEALTH', providerName: 'Star Health', policyName: 'Family Floater' };

const insuranceHandlers = (policies: unknown[] = [VEHICLE_POLICY, HEALTH_POLICY]) => [
  http.get(url('/insurance'), () => HttpResponse.json({ data: policies })),
];

// Legitimately exists: created via the Loans page's inline collateral creator without
// linking it to a real GoldHolding (Loans.tsx's picker is optional). Renders on this
// page because Assets.tsx:70 only filters out goldHoldingId-LINKED rows.
const UNLINKED_GOLD_ASSET = {
  id: 'a-3',
  userId: 'u-member',
  assetType: 'GOLD',
  name: 'Loose gold coins',
  value: 150000,
  realEstateId: null,
  goldHoldingId: null,
  loans: [],
};

const HOLDING = {
  id: 'g-1',
  type: 'PHYSICAL',
  description: 'Wedding bangles',
  quantityGrams: 20,
  purchasePricePerGram: 5000,
  currentPricePerGram: 6250,
  purchaseDate: '2024-05-01T00:00:00.000Z',
  notes: 'Locker A',
};

// `userId`, not `targetUserId` — investmentsApi.getGold sends a differently-named param
// than assetsApi.getAll/create; the persistence tests below rely on this being right.
const goldHandlers = (holdings: unknown[] = [HOLDING], captured?: (string | null)[]) => [
  http.get(url('/investments/gold'), ({ request }) => {
    captured?.push(new URL(request.url).searchParams.get('userId'));
    return HttpResponse.json({
      data: { holdings, summary: { totalGrams: 20, totalCurrentValue: 125000, totalPurchaseValue: 100000, gain: 25000, gainPct: 25 } },
    });
  }),
];

const PROPERTY = {
  id: 're-1',
  propertyName: 'Koramangala Flat',
  location: 'Bengaluru',
  propertyType: 'RESIDENTIAL',
  purchasePrice: 5000000,
  currentValue: 8000000,
  purchaseDate: '2020-06-01T00:00:00.000Z',
  currentValueShare: 8000000,
  owners: [{ userId: 'u-member', userName: 'Member', sharePercent: 100 }],
};

const reHandlers = (properties: unknown[] = [PROPERTY], captured?: (string | null)[]) => [
  http.get(url('/investments/real-estate'), ({ request }) => {
    captured?.push(new URL(request.url).searchParams.get('userId'));
    return HttpResponse.json({
      data: { properties, summary: { totalCurrent: 8000000, totalPurchase: 5000000, unrealisedGain: 3000000, totalMonthlyRental: 0 } },
    });
  }),
];

describe('Assets page — Gold tab', () => {
  it('defaults to the assets tab: shows the vehicle grid, not gold holdings', async () => {
    renderPage(<AssetsPage />, { route: '/assets', handlers: [...assetHandlers(), ...goldHandlers()] });
    await screen.findByText('Honda City');
    expect(screen.queryByText(/gold holdings/i)).not.toBeInTheDocument();
  });

  it('?tab=gold mounts the Gold page', async () => {
    renderPage(<AssetsPage />, { route: '/assets?tab=gold', handlers: [...assetHandlers(), ...goldHandlers()] });
    expect(await screen.findByText('Wedding bangles')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add item/i })).not.toBeInTheDocument();
  });

  it('clicking the Gold tab swaps the content and the URL', async () => {
    const user = userEvent.setup();
    renderPage(<><AssetsPage /><SearchParamsProbe /></>, { route: '/assets', handlers: [...assetHandlers(), ...goldHandlers()] });
    await screen.findByText('Honda City');
    expect(screen.getByTestId('search-params')).toHaveTextContent('');

    await user.click(screen.getByRole('button', { name: /^gold$/i }));

    expect(await screen.findByText('Wedding bangles')).toBeInTheDocument();
    expect(screen.queryByText('Honda City')).not.toBeInTheDocument();
    expect(screen.getByTestId('search-params')).toHaveTextContent('tab=gold');
  });

  it('the Add-Asset form offers no GOLD option', async () => {
    const user = userEvent.setup();
    renderPage(<AssetsPage />, {
      route: '/assets', user: MEMBER_USER, handlers: [...assetHandlers(), ...insuranceHandlers(), ...goldHandlers()],
    });
    await screen.findByText('Honda City');
    await user.click(screen.getByRole('button', { name: /add item/i }));

    const typeSelect = await screen.findByLabelText(/^type/i);
    const options = Array.from(typeSelect.querySelectorAll('option')).map((o) => o.getAttribute('value'));
    expect(options).not.toContain('GOLD');
  });

  it('editing an existing unlinked GOLD asset keeps GOLD selected, not silently rewritten', async () => {
    const user = userEvent.setup();
    let body: any;
    renderPage(<AssetsPage />, {
      route: '/assets',
      user: MEMBER_USER,
      handlers: [
        ...assetHandlers([VEHICLE, UNLINKED_GOLD_ASSET]),
        ...insuranceHandlers(),
        ...goldHandlers(),
        http.put(url('/assets/a-3'), async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ data: { ...UNLINKED_GOLD_ASSET, ...body } });
        }),
      ],
    });
    await screen.findByText('Loose gold coins');
    const editButtons = screen.getAllByTitle(/edit item/i);
    await user.click(editButtons[1]);

    const typeSelect = (await screen.findByLabelText(/^type/i)) as HTMLSelectElement;
    expect(typeSelect.value).toBe('GOLD');

    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(body).toBeDefined());
    // Must round-trip unchanged — the regression this guards is a silent fallback to
    // the dropdown's first option (PROPERTY) when GOLD isn't among its <option>s.
    expect(body.assetType).toBe('GOLD');
  });

  it('resets modal state on tab switch — does not silently reappear on return', async () => {
    const user = userEvent.setup();
    renderPage(<AssetsPage />, {
      route: '/assets', user: MEMBER_USER, handlers: [...assetHandlers(), ...insuranceHandlers(), ...goldHandlers()],
    });
    await screen.findByText('Honda City');
    await user.click(screen.getByRole('button', { name: /add item/i }));
    await screen.findByRole('heading', { name: /add item/i });

    await user.click(screen.getByRole('button', { name: /^gold$/i }));
    await screen.findByText('Wedding bangles');
    expect(screen.queryByRole('heading', { name: /add item/i })).not.toBeInTheDocument();

    // The round trip is the actual test: the fragment-unmount alone would already hide
    // the modal on the gold tab, but only the reset effect prevents it reappearing here.
    await user.click(screen.getByRole('button', { name: /vehicles & other/i }));
    await screen.findByText('Honda City');
    expect(screen.queryByRole('heading', { name: /add item/i })).not.toBeInTheDocument();
  });
});

describe('Assets page — Real Estate tab', () => {
  it('?tab=real-estate mounts the property grid', async () => {
    renderPage(<AssetsPage />, { route: '/assets?tab=real-estate', handlers: [...assetHandlers(), ...reHandlers()] });
    expect(await screen.findByText('Koramangala Flat')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add item/i })).not.toBeInTheDocument();
  });

  it('does not fetch /assets while landing directly on the real-estate tab', async () => {
    // Deliberately NO assetHandlers() — under MSW onUnhandledRequest:'error', a stray
    // GET /assets while landing directly on the real-estate tab would fail the test.
    // This is the actual proof of the `enabled: activeTab === 'assets'` gate, not just
    // a passing render that could hide a broken gate behind a registered handler.
    renderPage(<><AssetsPage /><SearchParamsProbe /></>, { route: '/assets?tab=real-estate', handlers: reHandlers() });

    expect(await screen.findByText('Koramangala Flat')).toBeInTheDocument();
    expect(screen.getByTestId('search-params')).toHaveTextContent('tab=real-estate');
  });

  it('from the Gold tab, clicking Real Estate swaps the URL param rather than appending it', async () => {
    const user = userEvent.setup();
    renderPage(<><AssetsPage /><SearchParamsProbe /></>, {
      route: '/assets?tab=gold', handlers: [...assetHandlers(), ...goldHandlers(), ...reHandlers()],
    });
    await screen.findByText('Wedding bangles');

    await user.click(screen.getByRole('button', { name: /real estate/i }));

    expect(await screen.findByText('Koramangala Flat')).toBeInTheDocument();
    expect(screen.queryByText('Wedding bangles')).not.toBeInTheDocument();
    expect(screen.getByTestId('search-params')).toHaveTextContent('tab=real-estate');
    // The bug this catches: appending instead of replacing would leave the stale
    // tab=gold param alongside the new one.
    expect(screen.getByTestId('search-params').textContent).not.toContain('gold');
  });

  it('an unknown ?tab value falls back to Vehicles & Other, never a blank page', async () => {
    renderPage(<AssetsPage />, { route: '/assets?tab=bogus', handlers: [...assetHandlers(), ...goldHandlers(), ...reHandlers()] });
    await screen.findByText('Honda City');
    expect(screen.queryByText('Koramangala Flat')).not.toBeInTheDocument();
    expect(screen.queryByText(/gold holdings/i)).not.toBeInTheDocument();
  });

  it('?tab=constructor also falls back — an object-key lookup would wrongly accept it', async () => {
    // The reason the tab guard is TABS.includes(v), not TAB_META[v]: a plain object's
    // inherited keys (constructor, toString, __proto__, ...) are truthy lookups too.
    renderPage(<AssetsPage />, { route: '/assets?tab=constructor', handlers: [...assetHandlers(), ...goldHandlers(), ...reHandlers()] });
    await screen.findByText('Honda City');
    expect(screen.queryByText('Koramangala Flat')).not.toBeInTheDocument();
    expect(screen.queryByText(/gold holdings/i)).not.toBeInTheDocument();
  });

  it('discards RealEstatePage modal state on tab switch — unmount, not a reset effect', async () => {
    const user = userEvent.setup();
    renderPage(<AssetsPage />, {
      route: '/assets?tab=real-estate', user: MEMBER_USER, handlers: [...assetHandlers(), ...reHandlers()],
    });
    await screen.findByText('Koramangala Flat');
    await user.click(screen.getByRole('button', { name: /add property/i }));
    await screen.findByRole('heading', { name: /add property/i });

    await user.click(screen.getByRole('button', { name: /vehicles & other/i }));
    await screen.findByText('Honda City');

    await user.click(screen.getByRole('button', { name: /real estate/i }));
    await screen.findByText('Koramangala Flat');
    expect(screen.queryByRole('heading', { name: /add property/i })).not.toBeInTheDocument();
  });
});

describe('Assets page — member filter persists across tabs', () => {
  it('a selection made on Vehicles survives Gold -> Real Estate -> back to Vehicles, sent as the real outgoing param on each', async () => {
    const user = userEvent.setup();
    const assetRequests: (string | null)[] = [];
    const goldRequests: (string | null)[] = [];
    const reRequests: (string | null)[] = [];
    renderPage(<AssetsPage />, {
      route: '/assets',
      handlers: [
        ...assetHandlers(undefined, assetRequests),
        ...goldHandlers(undefined, goldRequests),
        ...reHandlers(undefined, reRequests),
      ],
    });
    await screen.findByText('Honda City');

    // Initial mount fetches family-wide (targetUserId absent, captured as null) before
    // any selection is made.
    await waitFor(() => expect(assetRequests).toEqual([null]));
    await user.selectOptions(screen.getByLabelText(/view:/i), 'u-member');
    await waitFor(() => expect(assetRequests).toEqual([null, 'u-member']));

    await user.click(screen.getByRole('button', { name: /^gold$/i }));
    await screen.findByText('Wedding bangles');
    // The regression this guards: before the fix, GoldPage held its own independent
    // viewUserId state and this request would carry no userId param at all (null).
    // Asserting the full array, not just the last entry, so a spurious unscoped fetch
    // sneaking in ahead of the scoped one can't hide behind an `.at(-1)` check.
    expect(goldRequests).toEqual(['u-member']);
    expect((screen.getByLabelText(/view:/i) as HTMLSelectElement).value).toBe('u-member');

    await user.click(screen.getByRole('button', { name: /real estate/i }));
    await screen.findByText('Koramangala Flat');
    expect(reRequests).toEqual(['u-member']);
    expect((screen.getByLabelText(/view:/i) as HTMLSelectElement).value).toBe('u-member');

    await user.click(screen.getByRole('button', { name: /vehicles & other/i }));
    await screen.findByText('Honda City');
    // Returning to Vehicles re-triggers the (now re-enabled) assets query — assert the
    // actual refetch carried the selection, not just that the parent-owned <select>
    // DOM value (which cannot change across a tab switch) still reads correctly.
    await waitFor(() => expect(assetRequests).toEqual([null, 'u-member', 'u-member']));
    expect((screen.getByLabelText(/view:/i) as HTMLSelectElement).value).toBe('u-member');
  });

  it('changing the member while on the Gold tab immediately re-scopes it, not just the tab switched from', async () => {
    const user = userEvent.setup();
    const goldRequests: (string | null)[] = [];
    renderPage(<AssetsPage />, {
      route: '/assets?tab=gold',
      handlers: [...assetHandlers(), ...goldHandlers(undefined, goldRequests)],
    });
    await screen.findByText('Wedding bangles');
    await waitFor(() => expect(goldRequests).toEqual([null]));

    await user.selectOptions(screen.getByLabelText(/view:/i), 'u-member');

    await waitFor(() => expect(goldRequests).toEqual([null, 'u-member']));
  });

  it('the selector is absent for a MEMBER role on all three tabs', async () => {
    renderPage(<AssetsPage />, {
      route: '/assets', user: MEMBER_USER, handlers: [...assetHandlers(), ...goldHandlers(), ...reHandlers()],
    });
    await screen.findByText('Honda City');
    expect(screen.queryByLabelText(/view:/i)).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^gold$/i }));
    await screen.findByText('Wedding bangles');
    expect(screen.queryByLabelText(/view:/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /real estate/i }));
    await screen.findByText('Koramangala Flat');
    expect(screen.queryByLabelText(/view:/i)).not.toBeInTheDocument();
  });
});

describe('Assets page — smoke', () => {
  it('renders the page heading', async () => {
    renderPage(<AssetsPage />, { route: '/assets', handlers: assetHandlers() });
    expect(await screen.findByRole('heading', { level: 1, name: /assets/i })).toBeInTheDocument();
  });

  it('shows an unsecured vehicle but NOT a property already tracked via RealEstate', async () => {
    renderPage(<AssetsPage />, { route: '/assets', handlers: assetHandlers() });
    await screen.findByText('Honda City');
    expect(screen.queryByText('Flat 3B')).not.toBeInTheDocument();
  });

  it('shows the empty state when there are no unsecured assets', async () => {
    renderPage(<AssetsPage />, { route: '/assets', handlers: assetHandlers([LINKED_PROPERTY_ASSET]) });
    await waitFor(() => {
      expect(screen.getByText(/no items added yet/i)).toBeInTheDocument();
    });
  });

  it('a MEMBER can open the add-asset form and create one', async () => {
    const user = userEvent.setup();
    let body: any;
    renderPage(<AssetsPage />, {
      route: '/assets',
      user: MEMBER_USER,
      handlers: [
        ...assetHandlers(),
        ...insuranceHandlers(),
        http.post(url('/assets'), async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ data: { ...VEHICLE, id: 'a-new', name: body.name } }, { status: 201 });
        }),
      ],
    });
    await screen.findByText('Honda City');

    await user.click(screen.getByRole('button', { name: /add item/i }));
    await user.type(await screen.findByLabelText(/^name/i), 'Royal Enfield');
    await user.type(screen.getByLabelText(/current value/i), '250000');
    // Defaults to VEHICLE (see AssetsPage's defaultValues), which now requires a
    // vehicle type before it can be saved.
    await user.selectOptions(screen.getByLabelText(/vehicle type/i), 'TWO_WHEELER');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({ name: 'Royal Enfield', value: 250000, vehicleType: 'TWO_WHEELER' });
  });

  // A create/update/delete/sell here can change what a linked policy's "Covers:" list
  // shows on the Insurance page — without this, that page would stay stale for up to
  // the 5-minute staleTime.
  it('invalidates the insurance cache after creating an asset, so a newly-linked policy shows it', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderPage(<AssetsPage />, {
      route: '/assets',
      user: MEMBER_USER,
      handlers: [
        ...assetHandlers(),
        ...insuranceHandlers(),
        http.post(url('/assets'), () => HttpResponse.json({ data: { ...VEHICLE, id: 'a-new' } }, { status: 201 })),
      ],
    });
    await screen.findByText('Honda City');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await user.click(screen.getByRole('button', { name: /add item/i }));
    await user.type(await screen.findByLabelText(/^name/i), 'Royal Enfield');
    await user.type(screen.getByLabelText(/current value/i), '250000');
    await user.selectOptions(screen.getByLabelText(/vehicle type/i), 'TWO_WHEELER');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['insurance'] });
    });
  });

  it('the insurance picker lists only VEHICLE-type policies, and posts the selected one', async () => {
    const user = userEvent.setup();
    let body: any;
    renderPage(<AssetsPage />, {
      route: '/assets',
      user: MEMBER_USER,
      handlers: [
        ...assetHandlers(),
        ...insuranceHandlers(),
        http.post(url('/assets'), async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ data: { ...VEHICLE, id: 'a-new' } }, { status: 201 });
        }),
      ],
    });
    await screen.findByText('Honda City');

    await user.click(screen.getByRole('button', { name: /add item/i }));
    await user.type(await screen.findByLabelText(/^name/i), 'Royal Enfield');
    await user.type(screen.getByLabelText(/current value/i), '250000');
    await user.selectOptions(screen.getByLabelText(/vehicle type/i), 'TWO_WHEELER');

    const insuranceSelect = await screen.findByLabelText(/insurance policy/i);
    expect(screen.getByText(/HDFC Ergo/i)).toBeInTheDocument();
    expect(screen.queryByText(/Star Health/i)).not.toBeInTheDocument();
    await user.selectOptions(insuranceSelect, 'ip-1');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({ insurancePolicyId: 'ip-1' });
  });

  it('cannot save a VEHICLE without a vehicle type', async () => {
    const user = userEvent.setup();
    renderPage(<AssetsPage />, {
      route: '/assets', user: MEMBER_USER, handlers: [...assetHandlers(), ...insuranceHandlers()],
    });
    await screen.findByText('Honda City');

    await user.click(screen.getByRole('button', { name: /add item/i }));
    await user.type(await screen.findByLabelText(/^name/i), 'Royal Enfield');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => {
      expect(screen.getByText(/required for a vehicle/i)).toBeInTheDocument();
    });
  });

  it('shows purchase date and vehicle type on the card', async () => {
    const vehicleWithDetail = { ...VEHICLE, purchaseDate: '2022-05-01T00:00:00.000Z', vehicleType: 'FOUR_WHEELER' };
    renderPage(<AssetsPage />, { route: '/assets', handlers: assetHandlers([vehicleWithDetail]) });
    await screen.findByText('Honda City');

    expect(screen.getByText(/4-wheeler/i)).toBeInTheDocument();
    expect(screen.getByText('Bought 01/05/2022')).toBeInTheDocument();
  });

  it('edit form repopulates purchase date and vehicle type, and saves changes to both', async () => {
    const user = userEvent.setup();
    const vehicleWithDetail = { ...VEHICLE, purchaseDate: '2022-05-01T00:00:00.000Z', vehicleType: 'FOUR_WHEELER' };
    let body: any;
    renderPage(<AssetsPage />, {
      route: '/assets',
      user: MEMBER_USER,
      handlers: [
        ...assetHandlers([vehicleWithDetail]),
        ...insuranceHandlers(),
        http.put(url('/assets/a-1'), async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ data: { ...vehicleWithDetail, ...body } });
        }),
      ],
    });
    await screen.findByText('Honda City');

    await user.click(screen.getByTitle(/edit item/i));

    const dateInput = (await screen.findByLabelText(/purchase date/i)) as HTMLInputElement;
    expect(dateInput.value).toBe('2022-05-01');
    const vehicleTypeSelect = screen.getByLabelText(/vehicle type/i) as HTMLSelectElement;
    expect(vehicleTypeSelect.value).toBe('FOUR_WHEELER');

    await user.selectOptions(vehicleTypeSelect, 'TWO_WHEELER');
    await user.clear(dateInput);
    await user.type(dateInput, '2023-08-15');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({ vehicleType: 'TWO_WHEELER', purchaseDate: '2023-08-15' });
  });

  it('edit form pre-selects an already-linked insurance policy once the async picker loads, not "Not linked"', async () => {
    const user = userEvent.setup();
    const linkedVehicle = {
      ...VEHICLE, vehicleType: 'FOUR_WHEELER', insurancePolicyId: 'ip-1',
      insurancePolicy: { id: 'ip-1', policyType: 'VEHICLE', providerName: 'HDFC Ergo', policyName: 'Honda City Cover' },
    };
    let body: any;
    renderPage(<AssetsPage />, {
      route: '/assets',
      user: MEMBER_USER,
      handlers: [
        ...assetHandlers([linkedVehicle]),
        ...insuranceHandlers(),
        http.put(url('/assets/a-1'), async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ data: { ...linkedVehicle, ...body } });
        }),
      ],
    });
    await screen.findByText('Honda City');
    await user.click(screen.getByTitle(/edit item/i));

    const insuranceSelect = (await screen.findByLabelText(/insurance policy/i)) as HTMLSelectElement;
    // The regression this guards: the picker's options arrive from an async query gated
    // on the form being open, so an uncontrolled select applies the reset value before
    // the matching <option> exists and silently settles on "Not linked" once it does.
    await waitFor(() => expect(insuranceSelect.value).toBe('ip-1'));

    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(body).toBeDefined());
    // Untouched by the user — the pre-selected link must round-trip, not silently drop.
    expect(body).toMatchObject({ insurancePolicyId: 'ip-1' });
  });

  it('clearing the purchase date on edit actually clears it, not silently ignored', async () => {
    const user = userEvent.setup();
    const vehicleWithDetail = { ...VEHICLE, purchaseDate: '2022-05-01T00:00:00.000Z', vehicleType: 'FOUR_WHEELER' };
    let body: any;
    renderPage(<AssetsPage />, {
      route: '/assets',
      user: MEMBER_USER,
      handlers: [
        ...assetHandlers([vehicleWithDetail]),
        ...insuranceHandlers(),
        http.put(url('/assets/a-1'), async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ data: { ...vehicleWithDetail, ...body } });
        }),
      ],
    });
    await screen.findByText('Honda City');
    await user.click(screen.getByTitle(/edit item/i));

    const dateInput = (await screen.findByLabelText(/purchase date/i)) as HTMLInputElement;
    await user.clear(dateInput);
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body.purchaseDate).toBe('');
  });

  it('records a sale — stops counting toward net worth, stays on the record', async () => {
    const user = userEvent.setup();
    let body: any;
    renderPage(<AssetsPage />, {
      route: '/assets',
      user: MEMBER_USER,
      handlers: [
        ...assetHandlers(),
        http.post(url('/assets/a-1/sell'), async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ data: { ...VEHICLE, soldAt: '2026-06-01T00:00:00.000Z', salePrice: 600000 } });
        }),
      ],
    });
    await screen.findByText('Honda City');
    await user.click(screen.getByRole('button', { name: /^sell$/i }));

    const priceInput = await screen.findByLabelText(/sale price/i);
    await user.clear(priceInput);
    await user.type(priceInput, '600000');
    await user.click(screen.getByRole('button', { name: /confirm sale/i }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({ salePrice: 600000 });
    await waitFor(() => {
      expect(screen.getByText(/sale recorded/i)).toBeInTheDocument();
    });
  });

  it('surfaces the loan-collateral guard as a toast when the vehicle secures a loan', async () => {
    const user = userEvent.setup();
    const SECURED = { ...VEHICLE, loans: [{ id: 'loan-1', lenderName: 'HDFC Bank', loanType: 'AUTO', outstandingBalance: 300000 }] };
    renderPage(<AssetsPage />, {
      route: '/assets',
      user: MEMBER_USER,
      handlers: [
        ...assetHandlers([SECURED]),
        http.post(url('/assets/a-1/sell'), () => HttpResponse.json(
          { message: 'This still secures an active loan (HDFC Bank). Close or pay off the loan before recording a sale.' },
          { status: 409 },
        )),
      ],
    });
    await screen.findByText('Honda City');
    expect(screen.getByText(/secures: hdfc bank/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^sell$/i }));
    await user.click(screen.getByRole('button', { name: /confirm sale/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/active loan/i).length).toBeGreaterThan(0);
    });
  });

  it('deletes an asset, and surfaces the loan-collateral 409 when blocked', async () => {
    const user = userEvent.setup();
    renderPage(<AssetsPage />, {
      route: '/assets',
      user: MEMBER_USER,
      handlers: [
        ...assetHandlers(),
        http.delete(url('/assets/a-1'), () => HttpResponse.json(
          { message: 'This asset secures 1 loan(s). Unlink or delete them first.' },
          { status: 409 },
        )),
      ],
    });
    await screen.findByText('Honda City');
    await user.click(screen.getByTitle(/delete/i));

    await waitFor(() => {
      expect(screen.getAllByText(/secures 1 loan/i).length).toBeGreaterThan(0);
    });
  });

  it('surfaces an error toast when the assets request fails', async () => {
    renderPage(<AssetsPage />, {
      route: '/assets',
      handlers: [
        http.get(url('/assets'), () => HttpResponse.json({ message: 'Server exploded' }, { status: 500 })),
      ],
    });
    await waitFor(() => {
      expect(screen.getByText(/Server exploded/i)).toBeInTheDocument();
    });
  });
});
