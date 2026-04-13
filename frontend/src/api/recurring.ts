import api from '@/lib/api';

export type RecurringFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

export interface RecurringRule {
  id: string;
  userId: string;
  templateTransactionId: string;
  frequency: RecurringFrequency;
  nextRunDate: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  templateTransaction: {
    id: string;
    amount: number;
    type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
    description: string;
    categoryId: string | null;
    bankAccountId: string | null;
    tags: string[];
    category: { id: string; name: string; color: string | null; icon: string | null } | null;
    bankAccount: { bankName: string; accountNumberLast4: string | null } | null;
  };
}

export interface CreateRecurringRuleInput {
  bankAccountId?: string;
  categoryId?: string;
  amount: number;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  paymentMode?: string;
  description: string;
  tags?: string[];
  gstAmount?: number;
  frequency: RecurringFrequency;
  nextRunDate?: string;
}

export async function fetchRecurringRules(viewUserId?: string): Promise<RecurringRule[]> {
  const uid = viewUserId ? `?targetUserId=${viewUserId}` : '';
  const res = await api.get<{ data: RecurringRule[] }>(`/recurring${uid}`);
  return res.data.data;
}

export async function createRecurringRule(data: CreateRecurringRuleInput): Promise<RecurringRule> {
  const res = await api.post<{ data: RecurringRule }>('/recurring', data);
  return res.data.data;
}

export async function updateRecurringRule(
  id: string,
  data: Partial<{ frequency: RecurringFrequency; nextRunDate: string; isActive: boolean }>,
): Promise<RecurringRule> {
  const res = await api.put<{ data: RecurringRule }>(`/recurring/${id}`, data);
  return res.data.data;
}

export async function deleteRecurringRule(id: string): Promise<void> {
  await api.delete(`/recurring/${id}`);
}

export async function triggerGenerate(): Promise<{ generated: number }> {
  const res = await api.post<{ data: { generated: number } }>('/recurring/generate');
  return res.data.data;
}
