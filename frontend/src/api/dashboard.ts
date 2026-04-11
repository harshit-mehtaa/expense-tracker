import api from '@/lib/api';

export interface DashboardSummary {
  fyYear: string;
  netWorth: number;
  netWorthChange: number;
  netWorthChangePct: number;
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
  type: 'EMI' | 'SIP' | 'INSURANCE_PREMIUM' | 'FD_MATURITY' | 'ADVANCE_TAX' | 'BUDGET_ALERT';
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

export async function fetchDashboardSummary(fy?: string): Promise<DashboardSummary> {
  const params = fy ? { fy } : {};
  const res = await api.get<{ data: DashboardSummary }>('/dashboard/summary', { params });
  return res.data.data;
}

export async function fetchCashflow(fy?: string): Promise<CashflowMonth[]> {
  const params = fy ? { fy } : {};
  const res = await api.get<{ data: CashflowMonth[] }>('/dashboard/cashflow', { params });
  return res.data.data;
}

export async function fetchUpcomingAlerts(): Promise<UpcomingAlert[]> {
  const res = await api.get<{ data: UpcomingAlert[] }>('/dashboard/upcoming-alerts');
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
