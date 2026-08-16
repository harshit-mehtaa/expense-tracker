/**
 * Investments page — smoke.
 *
 * This page has NO loading state at all: every query defaults to `[]`/undefined and the
 * shell renders immediately. So there is no loading affordance to assert (leg 2 is
 * inapplicable and noted here rather than silently dropped), and the loaded sentinel
 * carries the whole transition assertion.
 *
 * Handler count: 6 page-specific + 5 base = 11. `/investments` is requested twice with
 * different pagination params (paged list and the all-rows aggregate), so one handler
 * serves both.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import InvestmentsPage from '@/pages/investments/Investments';
import { renderPage, failOnConsoleError } from '../support/renderPage';
import { url } from '../support/handlers';
import { MEMBER_USER } from '../support/fixtures';

failOnConsoleError();

const INVESTMENT = {
  id: 'inv-1',
  name: 'Axis Bluechip Fund',
  type: 'MUTUAL_FUND',
  currency: 'INR',
  unitsOrQuantity: '100',
  purchasePricePerUnit: '50',
  currentPricePerUnit: '75',
  purchaseDate: '2024-04-01',
  isTaxSaving: false,
  // Backend-derived fields, part of the Investment contract (api/investments.ts:22-25).
  // renderHoldingRow calls inv.gainPct.toFixed(2) with no null guard, so omitting them
  // crashes the row rather than degrading — the fixture must model the real payload.
  investedINR: 5000,
  currentValueINR: 7500,
  gainINR: 2500,
  gainPct: 50,
};

const FD = {
  id: 'fd-1',
  bankName: 'HDFC Bank',
  principalAmount: '100000',
  maturityAmount: '110000',
  interestRate: '7.1',
  tenureMonths: 12,
  startDate: '2025-01-01',
  maturityDate: '2026-01-01',
  status: 'ACTIVE',
  interestPayoutType: 'CUMULATIVE',
};

const RD = {
  id: 'rd-1',
  bankName: 'ICICI Bank',
  monthlyInstallment: '5000',
  maturityAmount: '62000',
  totalDeposited: '60000',
  interestRate: '6.5',
  tenureMonths: 12,
  startDate: '2025-01-01',
  maturityDate: '2026-01-01',
  status: 'ACTIVE',
};

const SIP = {
  id: 'sip-1',
  fundName: 'Axis Bluechip SIP',
  monthlyAmount: '5000',
  sipDate: 5,
  startDate: '2025-01-01',
  status: 'ACTIVE',
  investment: INVESTMENT,
};

const PORTFOLIO = {
  totalInvested: 5000,
  totalCurrentValue: 7500,
  absoluteGain: 2500,
  absoluteReturnPct: 50,
  xirr: 0.1234,
  byType: {},
};

function investmentHandlers(over: Partial<{
  investments: unknown[]; fds: unknown[]; rds: unknown[]; sips: unknown[];
}> = {}) {
  const invs = over.investments ?? [INVESTMENT];
  return [
    http.get(url('/investments/portfolio-summary'), () =>
      HttpResponse.json({ data: PORTFOLIO })),
    http.get(url('/investments/80c-summary'), () =>
      HttpResponse.json({ data: { total: 0, limit: 150000, items: [] } })),
    // Serves both the paged list and the all-rows aggregate.
    http.get(url('/investments'), () =>
      HttpResponse.json({
        data: invs,
        pagination: { total: invs.length, page: 1, pageSize: 25, hasMore: false },
      })),
    http.get(url('/investments/fd'), () => HttpResponse.json({ data: over.fds ?? [FD] })),
    http.get(url('/investments/rd'), () => HttpResponse.json({ data: over.rds ?? [RD] })),
    http.get(url('/investments/sip'), () => HttpResponse.json({ data: over.sips ?? [SIP] })),
  ];
}

/** Mirrors the literal `tabs` array at Investments.tsx:321-326. Labels carry counts. */
const TABS = [
  { id: 'portfolio', name: /^Portfolio$/ },
  { id: 'fd', name: /^FD \(\d+\)$/ },
  { id: 'rd', name: /^RD \(\d+\)$/ },
  { id: 'sip', name: /^SIP Mandates \(\d+\)$/ },
] as const;

describe('Investments page — smoke', () => {
  it('renders holdings once data lands (the loading->loaded transition)', async () => {
    renderPage(<InvestmentsPage />, { route: '/investments', handlers: investmentHandlers() });

    // No loading affordance exists on this page — queries default to [] and the shell
    // renders immediately, so the sentinel alone carries the transition.
    expect(await screen.findByText(/Axis Bluechip Fund/)).toBeInTheDocument();
  });

  it('renders the page heading', async () => {
    renderPage(<InvestmentsPage />, { route: '/investments', handlers: investmentHandlers() });
    expect(
      await screen.findByRole('heading', { level: 1, name: /portfolio command center/i }),
    ).toBeInTheDocument();
  });

  it('renders the XIRR derived from the portfolio summary', async () => {
    renderPage(<InvestmentsPage />, { route: '/investments', handlers: investmentHandlers() });
    // xirr 0.1234 -> "XIRR 12.34%"
    expect(await screen.findByText(/XIRR 12\.34%/)).toBeInTheDocument();
  });

  it('renders the empty state when there are no holdings', async () => {
    renderPage(<InvestmentsPage />, {
      route: '/investments', handlers: investmentHandlers({ investments: [] }),
    });
    expect(await screen.findByText(/No investments yet/i)).toBeInTheDocument();
  });

  it.each(TABS)('mounts the $id tab body without crashing', async ({ name }) => {
    const user = userEvent.setup();
    renderPage(<InvestmentsPage />, { route: '/investments', handlers: investmentHandlers() });
    await screen.findByText(/Axis Bluechip Fund/);

    await user.click(await screen.findByRole('button', { name }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    });
  });

  it('shows deposit counts in the tab labels, derived from the API', async () => {
    renderPage(<InvestmentsPage />, { route: '/investments', handlers: investmentHandlers() });
    // One FD, one RD, one SIP in the fixtures.
    expect(await screen.findByRole('button', { name: 'FD (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'RD (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SIP Mandates (1)' })).toBeInTheDocument();
  });

  it('an ADMIN viewing family-wide gets no add-FD control', async () => {
    const user = userEvent.setup();
    renderPage(<InvestmentsPage />, { route: '/investments', handlers: investmentHandlers() });
    await screen.findByText(/Axis Bluechip Fund/);

    await user.click(await screen.findByRole('button', { name: /^FD \(\d+\)$/ }));

    // Gated on !isViewingFamilyWide (:760), same pattern as Budgets and Accounts.
    expect(screen.queryByRole('button', { name: /add fd/i })).toBeNull();
  });

  it('a MEMBER gets the add-FD control on the FD tab', async () => {
    const user = userEvent.setup();
    renderPage(<InvestmentsPage />, {
      route: '/investments', handlers: investmentHandlers(), user: MEMBER_USER,
    });
    await screen.findByText(/Axis Bluechip Fund/);

    await user.click(await screen.findByRole('button', { name: /^FD \(\d+\)$/ }));

    expect(await screen.findByRole('button', { name: /add fd/i })).toBeInTheDocument();
  });

  it('surfaces an error toast when the portfolio request fails', async () => {
    renderPage(<InvestmentsPage />, {
      route: '/investments',
      handlers: [
        http.get(url('/investments/portfolio-summary'), () =>
          HttpResponse.json({ message: 'Server exploded' }, { status: 500 })),
        ...investmentHandlers(),
      ],
    });

    await waitFor(() => {
      expect(screen.getByText(/Server exploded/i)).toBeInTheDocument();
    });
  });
});
