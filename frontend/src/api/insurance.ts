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

// Prisma Decimal fields serialize as strings in JSON; coerce to number at the API boundary.
export function normalizePolicy(p: InsurancePolicy): InsurancePolicy {
  return { ...p, sumAssured: Number(p.sumAssured), premiumAmount: Number(p.premiumAmount) };
}

export const insuranceApi = {
  getAll: (opts?: { targetUserId?: string }) =>
    api.get<{ data: InsurancePolicy[] }>('/insurance', {
      params: opts?.targetUserId ? { userId: opts.targetUserId } : {},
    }).then(unwrap).then((policies) => policies.map(normalizePolicy)),
  getPremiumCalendar: () => api.get<{ data: Record<string, InsurancePolicy[]> }>('/insurance/premium-calendar').then(unwrap)
    .then((cal) => Object.fromEntries(Object.entries(cal).map(([k, ps]) => [k, ps.map(normalizePolicy)]))),
  get80D: (opts?: { targetUserId?: string }) =>
    api.get<{ data: any }>('/insurance/80d-summary', {
      params: opts?.targetUserId ? { userId: opts.targetUserId } : {},
    }).then(unwrap),
  create: (data: object) => api.post<{ data: InsurancePolicy }>('/insurance', data).then(unwrap).then(normalizePolicy),
  update: (id: string, data: object) => api.put<{ data: InsurancePolicy }>(`/insurance/${id}`, data).then(unwrap).then(normalizePolicy),
  delete: (id: string) => api.delete(`/insurance/${id}`),
};
