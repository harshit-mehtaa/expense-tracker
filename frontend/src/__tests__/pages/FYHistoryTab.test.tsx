/**
 * FYHistoryTab — no dedicated test file existed before the chip-color-consistency task
 * (createChipColors.ts, VQ2). Scope: just the regime chip's color, which previously
 * disagreed with ITR2Summary.tsx's (see ITR2Summary.test.tsx for the matching half).
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import FYHistoryTab from '@/pages/tax/FYHistoryTab';
import { renderPage, failOnConsoleError } from '../support/renderPage';
import { url } from '../support/handlers';

failOnConsoleError();

function makeSummary(regime: 'OLD' | 'NEW') {
  const elected = { tax: 100000, taxableIncome: 900000, refund: 0, taxAfterPaid: 5000 };
  return {
    grossSalary: 1000000,
    electedRegime: regime,
    oldRegime: elected,
    newRegime: elected,
  };
}

describe('FYHistoryTab — regime chip color', () => {
  it('renders the OLD regime with REGIME_COLORS.OLD (blue, with dark-mode classes)', async () => {
    renderPage(<FYHistoryTab fyOptions={['2025-26']} />, {
      handlers: [http.get(url('/tax/summary'), () => HttpResponse.json({ data: makeSummary('OLD') }))],
    });
    const chip = await screen.findByText('Old');
    expect(chip.className).toMatch(/bg-blue-100/);
    expect(chip.className).toMatch(/dark:bg-blue-900/);
  });

  it('renders the NEW regime with REGIME_COLORS.NEW (purple, with dark-mode classes)', async () => {
    renderPage(<FYHistoryTab fyOptions={['2025-26']} />, {
      handlers: [http.get(url('/tax/summary'), () => HttpResponse.json({ data: makeSummary('NEW') }))],
    });
    const chip = await screen.findByText('New');
    expect(chip.className).toMatch(/bg-purple-100/);
    expect(chip.className).toMatch(/dark:bg-purple-900/);
  });
});
