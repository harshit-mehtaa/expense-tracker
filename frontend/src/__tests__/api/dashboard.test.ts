/**
 * Tests for the dashboard/reports API wrappers.
 *
 * Every fetcher here builds its params conditionally (`if (fy) params.fy = fy`), so both
 * arms of each condition need exercising — a wrapper that silently dropped `targetUserId`
 * would return a perfectly well-formed response for the WRONG member, and no assertion on
 * the resolved value alone would notice. So each test asserts the outgoing query string.
 */
import { describe, it, expect } from 'vitest';
import {
  fetchDashboardSummary,
  fetchCashflow,
  fetchUpcomingAlerts,
  fetchNetWorthHistory,
  upsertNetWorthSnapshot,
  fetchFamilyOverview,
  fetchProfitAndLoss,
  fetchTrialBalance,
} from '@/api/dashboard';
import { capture } from './captureRequest';

const FY = '2025-26';
const TARGET = 'clm1234567890abcdefghij';

/** Fetchers taking (fy?, targetUserId?) — the same conditional-params shape. */
const FY_AND_TARGET: Array<[string, string, (fy?: string, t?: string) => Promise<unknown>]> = [
  ['fetchDashboardSummary', '/dashboard/summary', fetchDashboardSummary],
  ['fetchCashflow', '/dashboard/cashflow', fetchCashflow],
  ['fetchProfitAndLoss', '/reports/profit-and-loss', fetchProfitAndLoss],
  ['fetchTrialBalance', '/reports/trial-balance', fetchTrialBalance],
];

describe('dashboard API — fy and targetUserId params', () => {
  it.each(FY_AND_TARGET)('%s sends both when both are supplied', async (_n, path, call) => {
    const c = capture('get', path, { data: {} });
    await call(FY, TARGET);

    expect(c.seen?.params.get('fy')).toBe(FY);
    expect(c.seen?.params.get('targetUserId')).toBe(TARGET);
  });

  it.each(FY_AND_TARGET)('%s sends neither when both are omitted', async (_n, path, call) => {
    const c = capture('get', path, { data: {} });
    await call(undefined, undefined);

    expect(c.seen?.params.has('fy')).toBe(false);
    expect(c.seen?.params.has('targetUserId')).toBe(false);
  });

  it.each(FY_AND_TARGET)('%s sends fy alone when no member is selected', async (_n, path, call) => {
    const c = capture('get', path, { data: {} });
    await call(FY, undefined);

    expect(c.seen?.params.get('fy')).toBe(FY);
    expect(c.seen?.params.has('targetUserId')).toBe(false);
  });

  it.each(FY_AND_TARGET)('%s sends targetUserId alone when fy is omitted', async (_n, path, call) => {
    const c = capture('get', path, { data: {} });
    await call(undefined, TARGET);

    expect(c.seen?.params.has('fy')).toBe(false);
    expect(c.seen?.params.get('targetUserId')).toBe(TARGET);
  });
});

describe('fetchUpcomingAlerts', () => {
  it('sends targetUserId when supplied', async () => {
    const c = capture('get', '/dashboard/upcoming-alerts', { data: [] });
    await fetchUpcomingAlerts(TARGET);
    expect(c.seen?.params.get('targetUserId')).toBe(TARGET);
  });

  it('sends no params when omitted', async () => {
    const c = capture('get', '/dashboard/upcoming-alerts', { data: [] });
    await fetchUpcomingAlerts();
    expect(c.seen?.params.has('targetUserId')).toBe(false);
  });

  it('returns the alert list unwrapped', async () => {
    const alerts = [
      { type: 'EMI', title: 'HDFC EMI', amount: 25000, dueDate: '2026-05-01', daysUntilDue: 3, entityId: 'l1' },
    ];
    capture('get', '/dashboard/upcoming-alerts', { data: alerts });
    expect(await fetchUpcomingAlerts()).toEqual(alerts);
  });
});

describe('fetchFamilyOverview', () => {
  it('sends fy when supplied', async () => {
    const c = capture('get', '/dashboard/family-overview', { data: { members: [], chartData: [] } });
    await fetchFamilyOverview(FY);
    expect(c.seen?.params.get('fy')).toBe(FY);
  });

  it('sends no params when fy is omitted', async () => {
    const c = capture('get', '/dashboard/family-overview', { data: { members: [], chartData: [] } });
    await fetchFamilyOverview();
    expect(c.seen?.params.has('fy')).toBe(false);
  });
});

describe('net-worth snapshots', () => {
  it('fetchNetWorthHistory GETs the snapshot list with no params', async () => {
    const c = capture('get', '/snapshots/net-worth', { data: [] });
    await fetchNetWorthHistory();

    expect(c.seen?.method).toBe('GET');
    expect([...c.seen!.params.keys()]).toEqual([]);
  });

  it('upsertNetWorthSnapshot POSTs — this fires on Dashboard mount', async () => {
    const snapshot = { snapshotDate: '2026-04-01', netWorth: 125000, totalAssets: 200000, totalLiabilities: 75000 };
    const c = capture('post', '/snapshots/net-worth', { data: snapshot });
    const result = await upsertNetWorthSnapshot();

    expect(c.seen?.method).toBe('POST');
    expect(result).toEqual(snapshot);
  });

  it('preserves null net-worth fields rather than coercing them to 0', async () => {
    // A brand-new family has no history; null must survive so the UI can show "—"
    // instead of a misleading ₹0.00.
    capture('get', '/snapshots/net-worth', {
      data: [{ snapshotDate: '2026-04-01', netWorth: null, totalAssets: null, totalLiabilities: null }],
    });
    const [row] = await fetchNetWorthHistory();
    expect(row.netWorth).toBeNull();
    expect(row.totalAssets).toBeNull();
  });
});

describe('dashboard API — payload unwrapping', () => {
  it('fetchDashboardSummary returns res.data.data', async () => {
    const summary = {
      fyYear: FY, netWorth: 125000, netWorthChange: 5000, netWorthChangePct: 4,
      totalIncome: 500000, totalExpense: 375000, savingsRate: 25,
      totalAssets: 200000, totalLiabilities: 75000,
    };
    capture('get', '/dashboard/summary', { data: summary });
    expect(await fetchDashboardSummary(FY)).toEqual(summary);
  });

  it('fetchTrialBalance returns entries and totals intact', async () => {
    const tb = {
      fy: FY,
      entries: [{ accountName: 'Salary', type: 'CREDIT', debit: 0, credit: 500000 }],
      totals: { totalDebits: 375000, totalCredits: 500000, netSavings: 125000, rawTotalIncome: 500000, rawTotalExpenses: 375000 },
    };
    capture('get', '/reports/trial-balance', { data: tb });
    expect(await fetchTrialBalance(FY)).toEqual(tb);
  });
});
