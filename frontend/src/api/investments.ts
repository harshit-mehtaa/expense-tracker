import api from '@/lib/api';

export interface Investment {
  id: string;
  type: string;
  name: string;
  currency: string;
  exchange?: string;
  unitsOrQuantity: number;
  purchasePricePerUnit: number;
  currentPricePerUnit: number;
  purchaseDate: string;
  isTaxSaving: boolean;
  investedINR: number;
  currentValueINR: number;
  gainINR: number;
  gainPct: number;
  xirr?: number;
  notes?: string;
}

export interface PortfolioSummary {
  totalInvested: number;
  totalCurrentValue: number;
  absoluteGain: number;
  absoluteReturnPct: number;
  xirr?: number;
  byType: Record<string, { invested: number; current: number }>;
}

export interface FD {
  id: string;
  bankName: string;
  principalAmount: number;
  interestRate: number;
  tenureMonths: number;
  startDate: string;
  maturityDate: string;
  maturityAmount: number;
  interestPayoutType: string;
  isTaxSaver: boolean;
  status: 'ACTIVE' | 'MATURED' | 'BROKEN';
  notes?: string;
}

export interface RD {
  id: string;
  bankName: string;
  monthlyInstallment: number;
  interestRate: number;
  tenureMonths: number;
  startDate: string;
  maturityDate: string;
  maturityAmount: number;
  totalDeposited: number;
  installmentsPaid: number;
  status: 'ACTIVE' | 'MATURED' | 'CLOSED';
}

export interface SIP {
  id: string;
  fundName: string;
  monthlyAmount: number;
  sipDate: number;
  startDate: string;
  status: string;
  investment: Investment;
  nextDate?: string;
}

export interface GoldHolding {
  id: string;
  type: string;
  description?: string;
  quantityGrams: number;
  purchasePricePerGram: number;
  currentPricePerGram: number;
  purchaseDate: string;
  notes?: string;
}

export interface ExchangeRate {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  updatedAt: string;
}

const unwrap = <T>(res: { data: { data: T } }): T => res.data.data;

export const investmentsApi = {
  getPortfolioSummary: () => api.get<{ data: PortfolioSummary }>('/investments/portfolio-summary').then(unwrap),
  get80CSummary: (fy: string) => api.get<{ data: any }>(`/investments/80c-summary?fy=${fy}`).then(unwrap),
  getAll: (type?: string) => api.get<{ data: Investment[] }>('/investments', { params: type ? { type } : {} }).then(unwrap),
  create: (data: object) => api.post<{ data: Investment }>('/investments', data).then(unwrap),
  update: (id: string, data: object) => api.put<{ data: Investment }>(`/investments/${id}`, data).then(unwrap),
  delete: (id: string) => api.delete(`/investments/${id}`),
  getFDs: (status?: string) => api.get<{ data: FD[] }>('/investments/fd', { params: status ? { status } : {} }).then(unwrap),
  createFD: (data: object) => api.post<{ data: FD }>('/investments/fd', data).then(unwrap),
  updateFD: (id: string, data: object) => api.put<{ data: FD }>(`/investments/fd/${id}`, data).then(unwrap),
  deleteFD: (id: string) => api.delete(`/investments/fd/${id}`),
  getRDs: (status?: string) => api.get<{ data: RD[] }>('/investments/rd', { params: status ? { status } : {} }).then(unwrap),
  createRD: (data: object) => api.post<{ data: RD }>('/investments/rd', data).then(unwrap),
  updateRD: (id: string, data: object) => api.put<{ data: RD }>(`/investments/rd/${id}`, data).then(unwrap),
  deleteRD: (id: string) => api.delete(`/investments/rd/${id}`),
  getSIPs: () => api.get<{ data: SIP[] }>('/investments/sip').then(unwrap),
  createSIP: (data: object) => api.post<{ data: SIP }>('/investments/sip', data).then(unwrap),
  updateSIP: (id: string, data: object) => api.put<{ data: SIP }>(`/investments/sip/${id}`, data).then(unwrap),
  deleteSIP: (id: string) => api.delete(`/investments/sip/${id}`),
  getGold: () => api.get<{ data: { holdings: GoldHolding[]; summary: any } }>('/investments/gold').then(unwrap),
  createGold: (data: object) => api.post('/investments/gold', data).then((r) => r.data.data),
  updateGold: (id: string, data: object) => api.put(`/investments/gold/${id}`, data).then((r) => r.data.data),
  deleteGold: (id: string) => api.delete(`/investments/gold/${id}`),
  getRealEstate: () => api.get<{ data: any }>('/investments/real-estate').then(unwrap),
  createRealEstate: (data: object) => api.post('/investments/real-estate', data).then((r) => r.data.data),
  updateRealEstate: (id: string, data: object) => api.put(`/investments/real-estate/${id}`, data).then((r) => r.data.data),
  deleteRealEstate: (id: string) => api.delete(`/investments/real-estate/${id}`),
  getExchangeRates: () => api.get<{ data: ExchangeRate[] }>('/investments/exchange-rates').then(unwrap),
  updateExchangeRate: (currency: string, rate: number) => api.put(`/investments/exchange-rates/${currency}`, { rate }),
};
