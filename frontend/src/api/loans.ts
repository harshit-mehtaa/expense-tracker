import api from '@/lib/api';

export interface Loan {
  id: string;
  lenderName: string;
  loanType: string;
  loanAccountNumber?: string;
  principalAmount: number;
  outstandingBalance: number;
  interestRate: number;
  emiAmount: number;
  emiDate: number;
  tenureMonths: number;
  disbursementDate: string;
  endDate: string;
  isTaxDeductible: boolean;
  section24bEligible: boolean;
  prepaymentChargesPct: number;
}

export interface AmortizationRow {
  month: number;
  date: string;
  openingBalance: number;
  emi: number;
  principal: number;
  interest: number;
  closingBalance: number;
  totalInterestPaid: number;
}

const unwrap = <T>(res: { data: { data: T } }): T => res.data.data;

export const loansApi = {
  getAll: (targetUserId?: string) => api.get<{ data: Loan[] }>('/loans', { params: targetUserId ? { targetUserId } : {} }).then(unwrap),
  create: (data: object) => api.post<{ data: Loan }>('/loans', data).then(unwrap),
  update: (id: string, data: object) => api.put<{ data: Loan }>(`/loans/${id}`, data).then(unwrap),
  delete: (id: string) => api.delete(`/loans/${id}`),
  getAmortization: (id: string) => api.get<{ data: { loan: Loan; schedule: AmortizationRow[]; summary: any } }>(`/loans/${id}/amortization-schedule`).then(unwrap),
  simulatePrepayment: (id: string, data: { prepaymentAmount: number; mode: string }) =>
    api.post<{ data: any }>(`/loans/${id}/prepayment-simulation`, data).then(unwrap),
};
