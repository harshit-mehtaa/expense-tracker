import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export interface BudgetActualItem {
  id: string;
  categoryId: string;
  amount: number;
  period: string;
  fyYear: string | null;
  category: {
    id: string;
    name: string;
    color: string | null;
    icon: string | null;
  };
  actual: number;
  remaining: number;
  pctUsed: number;
}

async function fetchBudgetsVsActuals(fy: string, targetUserId?: string): Promise<BudgetActualItem[]> {
  const params: Record<string, string> = { fy };
  if (targetUserId) params.targetUserId = targetUserId;
  const res = await api.get<{ data: BudgetActualItem[] }>('/budgets/vs-actuals', { params });
  return res.data.data;
}

export function useBudgetsVsActuals(fy: string, targetUserId?: string) {
  return useQuery({
    queryKey: ['budgets', 'vs-actuals', fy, targetUserId],
    queryFn: () => fetchBudgetsVsActuals(fy, targetUserId),
  });
}
