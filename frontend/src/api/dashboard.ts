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
  type: 'EMI' | 'SIP' | 'INSURANCE_PREMIUM' | 'FD_MATURITY' | 'ADVANCE_TAX';
  title: string;
  amount?: number;
  dueDate: string;
  daysUntilDue: number;
  entityId: string;
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
