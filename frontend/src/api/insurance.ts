import api from '@/lib/api';

export interface InsurancePolicy {
  id: string;
  policyType: string;
  providerName: string;
  policyNumber: string;
  policyName: string;
  sumAssured: number;
  premiumAmount: number;
  premiumFrequency: string;
  premiumDueDate?: number;
  startDate: string;
  endDate?: string;
  nomineeName?: string;
  agentName?: string;
  agentContact?: string;
  is80cEligible: boolean;
  is80dEligible: boolean;
  isForParents: boolean;
  notes?: string;
  userName?: string;
}

const unwrap = <T>(res: { data: { data: T } }): T => res.data.data;

export const insuranceApi = {
  getAll: (opts?: { targetUserId?: string }) =>
    api.get<{ data: InsurancePolicy[] }>('/insurance', {
      params: opts?.targetUserId ? { userId: opts.targetUserId } : {},
    }).then(unwrap),
  getPremiumCalendar: () => api.get<{ data: Record<string, InsurancePolicy[]> }>('/insurance/premium-calendar').then(unwrap),
  get80D: (opts?: { targetUserId?: string }) =>
    api.get<{ data: any }>('/insurance/80d-summary', {
      params: opts?.targetUserId ? { userId: opts.targetUserId } : {},
    }).then(unwrap),
  create: (data: object) => api.post<{ data: InsurancePolicy }>('/insurance', data).then(unwrap),
  update: (id: string, data: object) => api.put<{ data: InsurancePolicy }>(`/insurance/${id}`, data).then(unwrap),
  delete: (id: string) => api.delete(`/insurance/${id}`),
};
