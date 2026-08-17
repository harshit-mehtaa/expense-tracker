import api from '@/lib/api';

export type RecurringFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

export interface RecurringRule {
  id: string;
  userId: string;
  frequency: RecurringFrequency;
  nextRunDate: string;
  isActive: boolean;
  /** Set when a Subscription owns this rule. The backend refuses direct edits/deletes
   *  (409) so a subscription's money has one source of truth — manage it on
   *  /subscriptions instead. */
  subscriptionId?: string | null;
  createdAt: string;
  updatedAt: string;

  /**
   * The specification, flat on the rule.
   *
   * This used to be a nested `templateTransaction` — a real row in the ledger, which
   * meant every aggregate in the app counted a charge that never happened. A rule is a
   * specification, not money that moved, so it no longer has a Transaction at all.
   */
  amount: number;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  description: string;
  categoryId: string | null;
  bankAccountId: string | null;
  paymentMode?: string | null;
  tags: string[];
  gstAmount?: number | null;
  category: {
    id: string;
    name: string;
    color: string | null;
    icon: string | null;
    parentId?: string | null;
    parent?: { id: string; name: string; icon?: string | null; parentId?: string | null } | null;
  } | null;
  bankAccount: { bankName: string; accountNumberLast4: string | null } | null;
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

export async function createRecurringRule(data: CreateRecurringRuleInput, viewUserId?: string): Promise<RecurringRule> {
  const res = await api.post<{ data: RecurringRule }>('/recurring', data, {
    params: viewUserId ? { targetUserId: viewUserId } : {},
  });
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

export async function triggerGenerate(viewUserId?: string): Promise<{ generated: number }> {
  const res = await api.post<{ data: { generated: number } }>('/recurring/generate', undefined, {
    params: viewUserId ? { targetUserId: viewUserId } : {},
  });
  return res.data.data;
}
