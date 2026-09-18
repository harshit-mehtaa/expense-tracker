/**
 * ITR2Summary — no dedicated test file existed before the chip-color-consistency task.
 * Scope: the regime chip's color, which previously disagreed with FYHistoryTab.tsx's own
 * regime chip (blue/amber here vs blue/purple there, for the same OLD/NEW value) — now
 * unified via the shared REGIME_COLORS map (see FYHistoryTab.test.tsx for the other half).
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import ITR2Summary from '@/pages/tax/ITR2Summary';
import { renderPage, failOnConsoleError } from '../support/renderPage';
import { url } from '../support/handlers';

failOnConsoleError();

function makeSummary(regime: 'OLD' | 'NEW') {
  return {
    regime,
    scheduleCG: {
      stcg: { total: 0, equity15Pct: 0, other: 0 },
      ltcg: { total: 0, equity10Pct: 0, withIndexation: 0, debtMFSlab: 0, foreign20Pct: 0 },
      totalTaxableGain: 0,
      entryCount: 0,
    },
    scheduleOS: {
      taxableTotal: 0,
      deduction80TTA: 0,
      foreignDividend: 0,
      breakdown: { fdInterest: 0, rdInterest: 0, savingsInterest: 0, dividend: 0, gift: 0, other: 0 },
    },
    scheduleHP: { taxableHPIncome: 0, hpLossSetOff: 0, totalHPIncome: 0 },
  };
}

describe('ITR2Summary — regime chip color', () => {
  it('renders the OLD regime matching FYHistoryTab\'s REGIME_COLORS.OLD (blue, dark-mode)', async () => {
    renderPage(<ITR2Summary fy="2025-26" />, {
      handlers: [http.get(url('/tax/itr2-summary'), () => HttpResponse.json({ data: makeSummary('OLD') }))],
    });
    const chip = await screen.findByText('OLD Regime');
    expect(chip.className).toMatch(/bg-blue-100/);
    expect(chip.className).toMatch(/dark:bg-blue-900/);
  });

  it('renders the NEW regime matching FYHistoryTab\'s REGIME_COLORS.NEW (purple, dark-mode) — previously amber here', async () => {
    renderPage(<ITR2Summary fy="2025-26" />, {
      handlers: [http.get(url('/tax/itr2-summary'), () => HttpResponse.json({ data: makeSummary('NEW') }))],
    });
    const chip = await screen.findByText('NEW Regime');
    expect(chip.className).toMatch(/bg-purple-100/);
    expect(chip.className).toMatch(/dark:bg-purple-900/);
    expect(chip.className).not.toMatch(/amber/);
  });
});
