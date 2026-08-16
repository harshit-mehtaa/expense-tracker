/**
 * Insurance page — smoke. Full bar applies: this page has a real loading state
 * ("Loading policies…") distinct from its empty state, so the loading -> loaded
 * transition is genuinely observable.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import InsurancePage from '@/pages/insurance/Insurance';
import { renderPage, failOnConsoleError } from '../support/renderPage';
import { url } from '../support/handlers';
import { MONEY_FORMATTED, MEMBER_USER } from '../support/fixtures';

failOnConsoleError();

const POLICY = {
  id: 'p-1',
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

const insuranceHandlers = (policies: unknown[] = [POLICY], d80: unknown = { total: 25000 }) => [
  http.get(url('/insurance'), () => HttpResponse.json({ data: policies })),
  http.get(url('/insurance/80d-summary'), () => HttpResponse.json({ data: d80 })),
];

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
