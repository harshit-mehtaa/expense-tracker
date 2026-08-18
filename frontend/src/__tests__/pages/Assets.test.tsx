/**
 * Assets page — smoke.
 *
 * The one asset kind with no dedicated page before this — a vehicle or any unsecured
 * item could only ever be created inline from the Loans page's collateral picker.
 * `assetsApi` already had full CRUD end-to-end; this page is the first place to reach
 * it standalone.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import AssetsPage from '@/pages/investments/Assets';
import { renderPage, failOnConsoleError } from '../support/renderPage';
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

const assetHandlers = (assets: unknown[] = [VEHICLE, LINKED_PROPERTY_ASSET]) => [
  http.get(url('/assets'), () => HttpResponse.json({ data: assets })),
];

const VEHICLE_POLICY = {
  id: 'ip-1', userId: 'u-member', policyType: 'VEHICLE',
  providerName: 'HDFC Ergo', policyName: 'Honda City Cover', endDate: '2027-05-01T00:00:00.000Z',
};
const HEALTH_POLICY = { id: 'ip-2', userId: 'u-member', policyType: 'HEALTH', providerName: 'Star Health', policyName: 'Family Floater' };

const insuranceHandlers = (policies: unknown[] = [VEHICLE_POLICY, HEALTH_POLICY]) => [
  http.get(url('/insurance'), () => HttpResponse.json({ data: policies })),
];

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
      expect(screen.getByText(/no assets added yet/i)).toBeInTheDocument();
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

    await user.click(screen.getByRole('button', { name: /add asset/i }));
    await user.type(await screen.findByLabelText(/^name/i), 'Royal Enfield');
    await user.type(screen.getByLabelText(/current value/i), '250000');
    // Defaults to VEHICLE (see AssetsPage's defaultValues), which now requires a
    // vehicle type before it can be saved.
    await user.selectOptions(screen.getByLabelText(/vehicle type/i), 'TWO_WHEELER');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({ name: 'Royal Enfield', value: 250000, vehicleType: 'TWO_WHEELER' });
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

    await user.click(screen.getByRole('button', { name: /add asset/i }));
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

    await user.click(screen.getByRole('button', { name: /add asset/i }));
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

    await user.click(screen.getByTitle(/edit asset/i));

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
    await user.click(screen.getByTitle(/edit asset/i));

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
    await user.click(screen.getByTitle(/edit asset/i));

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
