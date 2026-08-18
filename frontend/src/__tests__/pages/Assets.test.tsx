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
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({ name: 'Royal Enfield', value: 250000 });
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
