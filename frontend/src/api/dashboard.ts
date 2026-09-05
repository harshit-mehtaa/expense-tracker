import api from '@/lib/api';

export interface DashboardSummary {
  fyYear: string;
  netWorth: number;
  /** Absent when there's no comparable snapshot before this FY (new user, or
   *  family-wide view, where no per-family snapshot concept exists). */
  netWorthChange?: number;
  netWorthChangePct?: number;
  totalIncome: number;
  totalExpense: number;
  savingsRate: number;
  totalAssets: number;
  totalLiabilities: number;
}

export interface CashflowMonth {
  month: string;
  monthIndex: number;
  year: number;
  income: number;
  expense: number;
  net: number;
}

export interface UpcomingAlert {
  type:
    | 'EMI' | 'SIP' | 'INSURANCE_PREMIUM' | 'FD_MATURITY' | 'RD_MATURITY'
    | 'ADVANCE_TAX' | 'BUDGET_ALERT' | 'SUBSCRIPTION_TRIAL' | 'SUBSCRIPTION_RENEWAL';
  title: string;
  amount?: number;
  dueDate: string;
  daysUntilDue: number;
  entityId: string;
  utilized?: number;
}

export interface NetWorthSnapshot {
  snapshotDate: string;
  netWorth: number | null;
  totalAssets: number | null;
  totalLiabilities: number | null;
}

export async function fetchDashboardSummary(fy?: string, targetUserId?: string): Promise<DashboardSummary> {
  const params: Record<string, string> = {};
  if (fy) params.fy = fy;
  if (targetUserId) params.targetUserId = targetUserId;
  const res = await api.get<{ data: DashboardSummary }>('/dashboard/summary', { params });
  return res.data.data;
}

export async function fetchCashflow(fy?: string, targetUserId?: string): Promise<CashflowMonth[]> {
  const params: Record<string, string> = {};
  if (fy) params.fy = fy;
  if (targetUserId) params.targetUserId = targetUserId;
  const res = await api.get<{ data: CashflowMonth[] }>('/dashboard/cashflow', { params });
  return res.data.data;
}

export async function fetchUpcomingAlerts(targetUserId?: string): Promise<UpcomingAlert[]> {
  const params = targetUserId ? { targetUserId } : {};
  const res = await api.get<{ data: UpcomingAlert[] }>('/dashboard/upcoming-alerts', { params });
  return res.data.data;
}

export async function fetchNetWorthHistory(): Promise<NetWorthSnapshot[]> {
  const res = await api.get<{ data: NetWorthSnapshot[] }>('/snapshots/net-worth');
  return res.data.data;
}

export async function upsertNetWorthSnapshot(): Promise<NetWorthSnapshot> {
  const res = await api.post<{ data: NetWorthSnapshot }>('/snapshots/net-worth');
  return res.data.data;
}

export interface FamilyOverview {
  members: { id: string; name: string; colorTag: string }[];
  chartData: Record<string, number | string>[];
}

export async function fetchFamilyOverview(fy?: string): Promise<FamilyOverview> {
  const params = fy ? { fy } : {};
  const res = await api.get<{ data: FamilyOverview }>('/dashboard/family-overview', { params });
  return res.data.data;
}

// ── Profit & Loss ─────────────────────────────────────────────────────────────

export interface PnLSummary {
  totalIncome: number;
  totalExpense: number;
  netSavings: number;
  savingsRate: number;
}

export interface PnLMonthRow {
  month: string;
  monthIndex: number;
  year: number;
  income: number;
  expense: number;
  net: number;
}

export interface PnLCategoryRow {
  categoryId: string | null;
  categoryName: string;
  total: number;
}

export interface ProfitAndLoss {
  fy: string;
  summary: PnLSummary;
  monthly: PnLMonthRow[];
  expenseCategories: PnLCategoryRow[];
  incomeCategories: PnLCategoryRow[];
}

export async function fetchProfitAndLoss(fy?: string, targetUserId?: string): Promise<ProfitAndLoss> {
  const params: Record<string, string> = {};
  if (fy) params.fy = fy;
  if (targetUserId) params.targetUserId = targetUserId;
  const res = await api.get<{ data: ProfitAndLoss }>('/reports/profit-and-loss', { params });
  return res.data.data;
}

export interface TrialBalanceEntry {
  accountName: string;
  type: 'DEBIT' | 'CREDIT';
  debit: number;
  credit: number;
}

export interface TrialBalanceTotals {
  totalDebits: number;
  totalCredits: number;
  netSavings: number;
  rawTotalIncome: number;
  rawTotalExpenses: number;
}

export interface TrialBalance {
  fy: string;
  entries: TrialBalanceEntry[];
  totals: TrialBalanceTotals;
}

export async function fetchTrialBalance(fy?: string, targetUserId?: string): Promise<TrialBalance> {
  const params: Record<string, string> = {};
  if (fy) params.fy = fy;
  if (targetUserId) params.targetUserId = targetUserId;
  const res = await api.get<{ data: TrialBalance }>('/reports/trial-balance', { params });
  return res.data.data;
}

/** Deliberately minimal — mirrors the backend's own select shape
 *  (backend/src/routes/reports.ts's /spending-by-category). `category` is
 *  `null` for a transaction with no category assigned ("Uncategorized"). */
export interface SpendingByCategoryRow {
  categoryId: string | null;
  category: { id: string; name: string } | null;
  total: number;
}

/** Shared by Reports.tsx's Spending Analysis tab and Dashboard.tsx's spend-by-
 *  category widget — both subscribe to the SAME query key
 *  (['report-spending', selectedFY, viewUserId]), so this function must be
 *  their only queryFn: identical fetch behavior by construction, not by
 *  convention. */
export async function fetchSpendingByCategory(fy?: string, targetUserId?: string): Promise<SpendingByCategoryRow[]> {
  const params: Record<string, string> = {};
  if (fy) params.fy = fy;
  if (targetUserId) params.targetUserId = targetUserId;
  const res = await api.get<{ data: SpendingByCategoryRow[] }>('/reports/spending-by-category', { params });
  return res.data.data;
}
