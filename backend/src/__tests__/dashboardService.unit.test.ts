/**
 * Unit tests for dashboardService.ts
 *
 * dashboardService uses:
 * - default import `prisma from '../config/prisma'`
 * - named import from './recurringService' (generateDueRecurringTransactions)
 * - utils from financialYear (not mocked — run as real with fake system time)
 *
 * $queryRaw is included in the vi.mock factory via the prismaObj literal
 * (setting it inside the factory is required for ESM mock hoisting safety).
 *
 * Fake timers are used in getUpcomingAlerts tests, scoped to their own
 * describe block with beforeAll/afterAll to avoid leaking timer state.
 * Anchored at 2025-04-15T12:00:00.000Z (April 15, 2025, noon UTC).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';

vi.mock('../config/prisma', () => {
  const prismaObj: Record<string, any> = {
    // raw SQL — must be in factory for ESM hoisting safety
    $queryRaw: vi.fn().mockResolvedValue([]),
    transaction: {
      aggregate: vi.fn(),
      groupBy: vi.fn(),
    },
    bankAccount: { findMany: vi.fn() },
    fixedDeposit: { findMany: vi.fn() },
    recurringDeposit: { findMany: vi.fn() },
    investment: { findMany: vi.fn() },
    goldHolding: { findMany: vi.fn() },
    realEstate: { findMany: vi.fn() },
    exchangeRate: { findMany: vi.fn() },
    loan: { findMany: vi.fn(), aggregate: vi.fn() },
    netWorthSnapshot: { upsert: vi.fn(), findMany: vi.fn() },
    user: { findMany: vi.fn() },
    category: { findMany: vi.fn() },
    sIP: { findMany: vi.fn() },
    insurancePolicy: { findMany: vi.fn() },
    advanceTaxEvent: { findMany: vi.fn() },
    budget: { findMany: vi.fn() },
  };
  return { default: prismaObj, prisma: prismaObj };
});

vi.mock('../services/recurringService', () => ({
  generateDueRecurringTransactions: vi.fn().mockResolvedValue({ created: 0, errors: [] }),
}));

import prisma from '../config/prisma';
import { generateDueRecurringTransactions } from '../services/recurringService';
import {
  getDashboardSummary,
  getCashflow,
  getUpcomingAlerts,
  computeNetWorthStatement,
  upsertNetWorthSnapshot,
  getFamilyOverview,
  getProfitAndLoss,
  getNetWorthHistory,
} from '../services/dashboardService';

const txMock = (prisma as any).transaction;
const bankMock = (prisma as any).bankAccount;
const fdMock = (prisma as any).fixedDeposit;
const rdMock = (prisma as any).recurringDeposit;
const invMock = (prisma as any).investment;
const goldMock = (prisma as any).goldHolding;
const reMock = (prisma as any).realEstate;
const fxMock = (prisma as any).exchangeRate;
const loanMock = (prisma as any).loan;
const snapshotMock = (prisma as any).netWorthSnapshot;
const userMock = (prisma as any).user;
const catMock = (prisma as any).category;
const sipMock = (prisma as any).sIP;
const insMock = (prisma as any).insurancePolicy;
const taxEventMock = (prisma as any).advanceTaxEvent;
const budgetMock = (prisma as any).budget;
const queryRawMock = (prisma as any).$queryRaw as ReturnType<typeof vi.fn>;
const generateRecurringMock = generateDueRecurringTransactions as ReturnType<typeof vi.fn>;

const ZERO_AGGREGATE = { _sum: { amount: null } };
const ZERO_LOAN_AGGREGATE = { _sum: { outstandingBalance: null } };

function resetAllMocks() {
  vi.clearAllMocks();
  queryRawMock.mockResolvedValue([]);
  txMock.aggregate.mockResolvedValue(ZERO_AGGREGATE);
  txMock.groupBy.mockResolvedValue([]);
  bankMock.findMany.mockResolvedValue([]);
  fdMock.findMany.mockResolvedValue([]);
  rdMock.findMany.mockResolvedValue([]);
  invMock.findMany.mockResolvedValue([]);
  goldMock.findMany.mockResolvedValue([]);
  reMock.findMany.mockResolvedValue([]);
  fxMock.findMany.mockResolvedValue([]);
  loanMock.findMany.mockResolvedValue([]);
  loanMock.aggregate.mockResolvedValue(ZERO_LOAN_AGGREGATE);
  snapshotMock.upsert.mockResolvedValue({});
  snapshotMock.findMany.mockResolvedValue([]);
  userMock.findMany.mockResolvedValue([]);
  catMock.findMany.mockResolvedValue([]);
  sipMock.findMany.mockResolvedValue([]);
  insMock.findMany.mockResolvedValue([]);
  taxEventMock.findMany.mockResolvedValue([]);
  budgetMock.findMany.mockResolvedValue([]);
}

beforeEach(resetAllMocks);

// ─────────────────────────────────────────────────────────────────────────────
// getDashboardSummary
// ─────────────────────────────────────────────────────────────────────────────

describe('getDashboardSummary', () => {
  it('MEMBER role: calls generateDueRecurringTransactions for that user', async () => {
    await getDashboardSummary('u1', 'MEMBER');
    expect(generateRecurringMock).toHaveBeenCalledWith('u1');
  });

  it('ADMIN role: does NOT call generateDueRecurringTransactions', async () => {
    await getDashboardSummary('admin-1', 'ADMIN');
    expect(generateRecurringMock).not.toHaveBeenCalled();
  });

  it('returns expected shape with fyYear, netWorth, totalIncome, totalExpense, savingsRate', async () => {
    txMock.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 100000 } }) // current income
      .mockResolvedValueOnce({ _sum: { amount: 60000 } })  // current expense
      .mockResolvedValueOnce({ _sum: { amount: 80000 } })  // prev income
      .mockResolvedValueOnce({ _sum: { amount: 50000 } }); // prev expense
    const r = await getDashboardSummary('u1', 'MEMBER', '2025-26');
    expect(r.fyYear).toBe('2025-26');
    expect(r.totalIncome).toBe(100000);
    expect(r.totalExpense).toBe(60000);
    expect(r.savingsRate).toBe(40); // (100000-60000)/100000 * 100
  });

  it('ADMIN with targetUserId: scopes queries to targetUserId, no recurring generation', async () => {
    await getDashboardSummary('admin-1', 'ADMIN', undefined, 'u2');
    expect(generateRecurringMock).not.toHaveBeenCalled();
    // effectiveUserId = 'u2', transaction.aggregate should have been called
    expect(txMock.aggregate).toHaveBeenCalled();
  });

  it('ADMIN without targetUserId: effectiveUserId = undefined (family-wide queries)', async () => {
    // No error expected — family-wide means userFilter is empty
    await getDashboardSummary('admin-1', 'ADMIN');
    expect(generateRecurringMock).not.toHaveBeenCalled();
  });

  it('recurring generation failure is swallowed — summary still resolves', async () => {
    generateRecurringMock.mockRejectedValue(new Error('RD generation crashed'));
    const r = await getDashboardSummary('u1', 'MEMBER', '2025-26');
    expect(r).toBeDefined(); // did not throw
    expect(r.fyYear).toBeDefined();
  });

  it('zero income → savingsRate = 0 (no division by zero)', async () => {
    // all aggregates return zero
    const r = await getDashboardSummary('u1', 'MEMBER', '2025-26');
    expect(r.savingsRate).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getCashflow
// ─────────────────────────────────────────────────────────────────────────────

describe('getCashflow', () => {
  it('returns 12-element array (one per month, Apr to Mar)', async () => {
    const r = await getCashflow('u1', 'MEMBER', '2025-26');
    expect(r).toHaveLength(12);
    expect(r[0].month).toBe('Apr');
    expect(r[11].month).toBe('Mar');
  });

  it('fills zeros for months with no data', async () => {
    queryRawMock.mockResolvedValue([]); // no rows
    const r = await getCashflow('u1', 'MEMBER', '2025-26');
    r.forEach((m) => {
      expect(m.income).toBe(0);
      expect(m.expense).toBe(0);
      expect(m.net).toBe(0);
    });
  });

  it('populates correct month when $queryRaw returns a row', async () => {
    // April 2025 = month 4, year 2025 (FY 2025-26 starts Apr)
    queryRawMock.mockResolvedValue([{ month: 4, year: 2025, income: 50000, expense: 30000 }]);
    const r = await getCashflow('u1', 'MEMBER', '2025-26');
    const april = r.find((m) => m.month === 'Apr')!;
    expect(april.income).toBe(50000);
    expect(april.expense).toBe(30000);
    expect(april.net).toBe(20000);
    // Other months stay zero
    const may = r.find((m) => m.month === 'May')!;
    expect(may.income).toBe(0);
  });

  it('ADMIN with targetUserId does not throw', async () => {
    await expect(getCashflow('admin-1', 'ADMIN', undefined, 'u2')).resolves.toHaveLength(12);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getNetWorthHistory
// ─────────────────────────────────────────────────────────────────────────────

describe('getNetWorthHistory', () => {
  it('queries netWorthSnapshot with userId, take 24, orderBy asc', async () => {
    await getNetWorthHistory('u1');
    expect(snapshotMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1' },
        take: 24,
        orderBy: { snapshotDate: 'asc' },
      }),
    );
  });

  it('returns snapshot list', async () => {
    snapshotMock.findMany.mockResolvedValue([{ snapshotDate: new Date('2025-04-01'), netWorth: 1000000 }]);
    const r = await getNetWorthHistory('u1');
    expect(r).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeNetWorthStatement
// ─────────────────────────────────────────────────────────────────────────────

describe('computeNetWorthStatement', () => {
  it('returns zero netWorth when all assets and loans are zero', async () => {
    const r = await computeNetWorthStatement('u1');
    expect(r.netWorth).toBe(0);
    expect(r.totalAssets).toBe(0);
    expect(r.totalLiabilities).toBe(0);
  });

  it('includes bank balance in totalAssets', async () => {
    bankMock.findMany.mockResolvedValue([{ currentBalance: 100000 }]);
    const r = await computeNetWorthStatement('u1');
    expect(r.assets.bankBalances).toBe(100000);
    expect(r.totalAssets).toBe(100000);
    expect(r.netWorth).toBe(100000);
  });

  it('includes loan outstanding balance in totalLiabilities', async () => {
    loanMock.aggregate.mockResolvedValue({ _sum: { outstandingBalance: 500000 } });
    const r = await computeNetWorthStatement('u1');
    expect(r.totalLiabilities).toBe(500000);
    expect(r.netWorth).toBe(-500000);
  });

  it('applies exchange rate for non-INR investments', async () => {
    invMock.findMany.mockResolvedValue([{ unitsOrQuantity: 10, currentPricePerUnit: 100, currency: 'USD' }]);
    fxMock.findMany.mockResolvedValue([{ fromCurrency: 'USD', toCurrency: 'INR', rate: 84 }]);
    const r = await computeNetWorthStatement('u1');
    // 10 * 100 * 84 = 84000
    expect(r.assets.investments).toBe(84000);
  });

  it('INR investment uses rate=1 (no FX lookup needed)', async () => {
    invMock.findMany.mockResolvedValue([{ unitsOrQuantity: 5, currentPricePerUnit: 200, currency: 'INR' }]);
    const r = await computeNetWorthStatement('u1');
    expect(r.assets.investments).toBe(1000); // 5 * 200 * 1
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// upsertNetWorthSnapshot
// ─────────────────────────────────────────────────────────────────────────────

describe('upsertNetWorthSnapshot', () => {
  it('calls netWorthSnapshot.upsert with correct shape', async () => {
    bankMock.findMany.mockResolvedValue([{ currentBalance: 200000 }]);
    await upsertNetWorthSnapshot('u1');
    expect(snapshotMock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId_snapshotDate: expect.objectContaining({ userId: 'u1' }) }),
        create: expect.objectContaining({ userId: 'u1', totalAssets: 200000 }),
        update: expect.objectContaining({ totalAssets: 200000 }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getFamilyOverview
// ─────────────────────────────────────────────────────────────────────────────

describe('getFamilyOverview', () => {
  it('returns 12-element chartData array', async () => {
    const r = await getFamilyOverview('2025-26');
    expect(r.chartData).toHaveLength(12);
  });

  it('includes members from user.findMany', async () => {
    userMock.findMany.mockResolvedValue([{ id: 'u1', name: 'Alice', colorTag: '#ff0000' }]);
    const r = await getFamilyOverview('2025-26');
    expect(r.members).toHaveLength(1);
    expect(r.members[0].name).toBe('Alice');
  });

  it('uses default colorTag #6366f1 when colorTag is null', async () => {
    userMock.findMany.mockResolvedValue([{ id: 'u1', name: 'Bob', colorTag: null }]);
    const r = await getFamilyOverview('2025-26');
    expect(r.members[0].colorTag).toBe('#6366f1');
  });

  it('populates member expense data in chartData from $queryRaw results', async () => {
    userMock.findMany.mockResolvedValue([{ id: 'u1', name: 'Alice', colorTag: '#f00' }]);
    queryRawMock.mockResolvedValue([{ userId: 'u1', month: 4, year: 2025, expense: 25000 }]);
    const r = await getFamilyOverview('2025-26');
    const aprilRow = r.chartData.find((d: any) => d.month === 'Apr')!;
    expect(aprilRow['u1']).toBe(25000);
  });

  it('empty members → members: [], chartData has 12 entries', async () => {
    const r = await getFamilyOverview('2025-26');
    expect(r.members).toHaveLength(0);
    expect(r.chartData).toHaveLength(12);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getProfitAndLoss
// ─────────────────────────────────────────────────────────────────────────────

describe('getProfitAndLoss', () => {
  it('returns correct shape: fy, summary, monthly (12), expenseCategories, incomeCategories', async () => {
    const r = await getProfitAndLoss('u1', 'MEMBER', '2025-26');
    expect(r.fy).toBe('2025-26');
    expect(r.summary).toBeDefined();
    expect(r.monthly).toHaveLength(12);
    expect(r.expenseCategories).toBeDefined();
    expect(r.incomeCategories).toBeDefined();
  });

  it('zero income → savingsRate = 0', async () => {
    const r = await getProfitAndLoss('u1', 'MEMBER', '2025-26');
    expect(r.summary.savingsRate).toBe(0);
  });

  it('resolves category names from category.findMany', async () => {
    txMock.groupBy
      .mockResolvedValueOnce([{ categoryId: 'cat-1', _sum: { amount: 5000 } }]) // expense
      .mockResolvedValueOnce([]); // income
    catMock.findMany.mockResolvedValue([{ id: 'cat-1', name: 'Food' }]);
    const r = await getProfitAndLoss('u1', 'MEMBER', '2025-26');
    expect(r.expenseCategories[0].categoryName).toBe('Food');
    expect(r.expenseCategories[0].total).toBe(5000);
  });

  it('null categoryId maps to "Uncategorized"', async () => {
    txMock.groupBy
      .mockResolvedValueOnce([{ categoryId: null, _sum: { amount: 3000 } }])
      .mockResolvedValueOnce([]);
    const r = await getProfitAndLoss('u1', 'MEMBER', '2025-26');
    expect(r.expenseCategories[0].categoryName).toBe('Uncategorized');
  });

  it('ADMIN with targetUserId does not throw', async () => {
    await expect(getProfitAndLoss('admin-1', 'ADMIN', '2025-26', 'u2')).resolves.toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getUpcomingAlerts — requires fake timers anchored at 2025-04-15 (April 15)
// today=15, thirtyDaysOut=May 15 2025
// ─────────────────────────────────────────────────────────────────────────────

describe('getUpcomingAlerts', () => {
  const PINNED_DATE = new Date('2025-04-15T12:00:00.000Z');

  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(PINNED_DATE);
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(resetAllMocks);

  it('returns empty array when no alerts pending', async () => {
    const r = await getUpcomingAlerts('u1', 'MEMBER');
    expect(r).toEqual([]);
  });

  it('FD maturing in 5 days → FD_MATURITY alert', async () => {
    const maturityDate = new Date('2025-04-20T12:00:00.000Z'); // 5 days from pinned date
    fdMock.findMany.mockResolvedValue([{
      id: 'fd-1', bankName: 'SBI', maturityDate, maturityAmount: 200000,
    }]);
    const r = await getUpcomingAlerts('u1', 'MEMBER');
    const alert = r.find((a: any) => a.type === 'FD_MATURITY');
    expect(alert).toBeDefined();
    expect(alert!.daysUntilDue).toBe(5);
    expect(alert!.amount).toBe(200000);
  });

  it('RD maturing soon → RD_MATURITY alert', async () => {
    const maturityDate = new Date('2025-04-20T12:00:00.000Z');
    rdMock.findMany.mockResolvedValue([{
      id: 'rd-1', bankName: 'HDFC', maturityDate, maturityAmount: 50000,
    }]);
    const r = await getUpcomingAlerts('u1', 'MEMBER');
    const alert = r.find((a: any) => a.type === 'RD_MATURITY');
    expect(alert).toBeDefined();
  });

  it('SIP due today (sipDate=15) → included (daysUntil=0 ≤ 7)', async () => {
    sipMock.findMany.mockResolvedValue([{
      id: 'sip-1', fundName: 'HDFC Mid Cap', monthlyAmount: 5000, sipDate: 15,
    }]);
    const r = await getUpcomingAlerts('u1', 'MEMBER');
    const alert = r.find((a: any) => a.type === 'SIP');
    expect(alert).toBeDefined();
    expect(alert!.daysUntilDue).toBe(0);
  });

  it('SIP with sipDate=22 (7 days away) → included (boundary)', async () => {
    sipMock.findMany.mockResolvedValue([{
      id: 'sip-2', fundName: 'Axis Bluechip', monthlyAmount: 3000, sipDate: 22,
    }]);
    const r = await getUpcomingAlerts('u1', 'MEMBER');
    const alert = r.find((a: any) => a.type === 'SIP');
    expect(alert).toBeDefined();
    expect(alert!.daysUntilDue).toBe(7);
  });

  it('SIP with sipDate=23 (8 days away) → excluded', async () => {
    sipMock.findMany.mockResolvedValue([{
      id: 'sip-3', fundName: 'ICICI Value', monthlyAmount: 2000, sipDate: 23,
    }]);
    const r = await getUpcomingAlerts('u1', 'MEMBER');
    const sipAlert = r.find((a: any) => a.type === 'SIP');
    expect(sipAlert).toBeUndefined();
  });

  it('Loan EMI on day 15 (today) → included', async () => {
    loanMock.findMany.mockResolvedValue([{
      id: 'loan-1', lenderName: 'HDFC Bank', emiAmount: 25000, emiDate: 15, loanType: 'HOME',
    }]);
    const r = await getUpcomingAlerts('u1', 'MEMBER');
    const alert = r.find((a: any) => a.type === 'EMI');
    expect(alert).toBeDefined();
    expect(alert!.daysUntilDue).toBe(0);
  });

  it('Loan EMI on day 23 (8 days away) → excluded', async () => {
    loanMock.findMany.mockResolvedValue([{
      id: 'loan-2', lenderName: 'SBI', emiAmount: 15000, emiDate: 23, loanType: 'PERSONAL',
    }]);
    const r = await getUpcomingAlerts('u1', 'MEMBER');
    const emiAlert = r.find((a: any) => a.type === 'EMI');
    expect(emiAlert).toBeUndefined();
  });

  it('Insurance with premiumDueDate=20 (within 30 days) → INSURANCE_PREMIUM alert', async () => {
    insMock.findMany.mockResolvedValue([{
      id: 'ins-1', policyName: 'Term Life', providerName: 'LIC',
      premiumAmount: 12000, premiumDueDate: 20, premiumFrequency: 'MONTHLY',
    }]);
    const r = await getUpcomingAlerts('u1', 'MEMBER');
    const alert = r.find((a: any) => a.type === 'INSURANCE_PREMIUM');
    expect(alert).toBeDefined();
    expect(alert!.entityId).toBe('ins-1');
  });

  it('Insurance with premiumDueDate=null → skipped', async () => {
    insMock.findMany.mockResolvedValue([{
      id: 'ins-2', policyName: 'Health Plan', providerName: 'Star Health',
      premiumAmount: 8000, premiumDueDate: null, premiumFrequency: 'ANNUAL',
    }]);
    const r = await getUpcomingAlerts('u1', 'MEMBER');
    const insAlert = r.find((a: any) => a.type === 'INSURANCE_PREMIUM');
    expect(insAlert).toBeUndefined();
  });

  it('Insurance with invalid premiumDueDate=0 → skipped', async () => {
    insMock.findMany.mockResolvedValue([{
      id: 'ins-3', policyName: 'Old Policy', providerName: 'HDFC',
      premiumAmount: 5000, premiumDueDate: 0, premiumFrequency: 'MONTHLY',
    }]);
    const r = await getUpcomingAlerts('u1', 'MEMBER');
    const insAlert = r.find((a: any) => a.type === 'INSURANCE_PREMIUM');
    expect(insAlert).toBeUndefined();
  });

  it('AdvanceTax event due in 10 days → ADVANCE_TAX alert', async () => {
    const dueDate = new Date('2025-04-25T12:00:00.000Z'); // 10 days from pinned
    taxEventMock.findMany.mockResolvedValue([{
      id: 'tax-1', description: 'Q1 Advance Tax', dueDate,
    }]);
    const r = await getUpcomingAlerts('u1', 'MEMBER');
    const alert = r.find((a: any) => a.type === 'ADVANCE_TAX');
    expect(alert).toBeDefined();
    expect(alert!.daysUntilDue).toBe(10);
  });

  it('ADMIN role: budget alerts section skipped entirely', async () => {
    // Even if budgets exist, ADMIN path skips budget alert computation
    budgetMock.findMany.mockResolvedValue([{
      id: 'b-1', userId: 'u1', amount: 10000, period: 'MONTHLY', categoryId: 'cat-1',
      category: { name: 'Food' },
    }]);
    const r = await getUpcomingAlerts('admin-1', 'ADMIN');
    const budgetAlert = r.find((a: any) => a.type === 'BUDGET_ALERT');
    expect(budgetAlert).toBeUndefined();
  });

  it('MEMBER with budget ≥80% spent → BUDGET_ALERT', async () => {
    budgetMock.findMany.mockResolvedValue([{
      id: 'b-1', userId: 'u1', amount: 10000, period: 'MONTHLY', categoryId: 'cat-1',
      category: { name: 'Food' },
    }]);
    // Actual spending = 9000 → 90% of 10000
    txMock.groupBy.mockResolvedValue([{ categoryId: 'cat-1', _sum: { amount: 9000 } }]);
    const r = await getUpcomingAlerts('u1', 'MEMBER');
    const alert = r.find((a: any) => a.type === 'BUDGET_ALERT');
    expect(alert).toBeDefined();
    expect(alert!.entityId).toBe('b-1');
  });

  it('MEMBER with budget <80% spent → no BUDGET_ALERT', async () => {
    budgetMock.findMany.mockResolvedValue([{
      id: 'b-2', userId: 'u1', amount: 10000, period: 'MONTHLY', categoryId: 'cat-2',
      category: { name: 'Entertainment' },
    }]);
    // Actual spending = 7000 → 70% < 80%
    txMock.groupBy.mockResolvedValue([{ categoryId: 'cat-2', _sum: { amount: 7000 } }]);
    const r = await getUpcomingAlerts('u1', 'MEMBER');
    const budgetAlert = r.find((a: any) => a.type === 'BUDGET_ALERT');
    expect(budgetAlert).toBeUndefined();
  });

  it('alerts are sorted by daysUntilDue ascending', async () => {
    const date10 = new Date('2025-04-25T12:00:00.000Z'); // 10 days
    const date3 = new Date('2025-04-18T12:00:00.000Z');  // 3 days
    fdMock.findMany.mockResolvedValue([{ id: 'fd-1', bankName: 'SBI', maturityDate: date10, maturityAmount: 100000 }]);
    rdMock.findMany.mockResolvedValue([{ id: 'rd-1', bankName: 'HDFC', maturityDate: date3, maturityAmount: 50000 }]);
    const r = await getUpcomingAlerts('u1', 'MEMBER');
    const alertTypes = r.map((a: any) => a.type);
    // RD (3 days) should come before FD (10 days)
    expect(r[0].daysUntilDue).toBeLessThanOrEqual(r[1].daysUntilDue);
  });

  it('budget with no categoryId is skipped (null categoryId check)', async () => {
    budgetMock.findMany.mockResolvedValue([{
      id: 'b-3', userId: 'u1', amount: 5000, period: 'MONTHLY', categoryId: null,
      category: null,
    }]);
    // Should not throw
    await expect(getUpcomingAlerts('u1', 'MEMBER')).resolves.toBeDefined();
  });

  it('budget with limit=0 is skipped (zero-amount check)', async () => {
    budgetMock.findMany.mockResolvedValue([{
      id: 'b-4', userId: 'u1', amount: 0, period: 'MONTHLY', categoryId: 'cat-3',
      category: { name: 'Test' },
    }]);
    const r = await getUpcomingAlerts('u1', 'MEMBER');
    expect(r.find((a: any) => a.type === 'BUDGET_ALERT')).toBeUndefined();
  });
});
