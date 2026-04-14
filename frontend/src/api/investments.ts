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
  userName?: string;
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
  userName?: string;
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
  userName?: string;
}

export interface ExchangeRate {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  updatedAt: string;
}

export interface InvestmentPaginationMeta {
  total: number;
  limit: number;
  hasMore: boolean;
}

export interface InvestmentPage {
  items: Investment[];
  pagination: InvestmentPaginationMeta;
}

const unwrap = <T>(res: { data: { data: T } }): T => res.data.data;

// Prisma Decimal fields serialize as strings in JSON; coerce to number at the API boundary.
export function normalizeInvestment(inv: Investment): Investment {
  return { ...inv, unitsOrQuantity: Number(inv.unitsOrQuantity), purchasePricePerUnit: Number(inv.purchasePricePerUnit), currentPricePerUnit: Number(inv.currentPricePerUnit) };
}

export function normalizeSIP(sip: SIP): SIP {
  return { ...sip, monthlyAmount: Number(sip.monthlyAmount), investment: normalizeInvestment(sip.investment) };
}

export function normalizeFD(fd: FD): FD {
  return { ...fd, principalAmount: Number(fd.principalAmount), maturityAmount: Number(fd.maturityAmount), interestRate: Number(fd.interestRate) };
}

export function normalizeRD(rd: RD): RD {
  return { ...rd, monthlyInstallment: Number(rd.monthlyInstallment), maturityAmount: Number(rd.maturityAmount), totalDeposited: Number(rd.totalDeposited), interestRate: Number(rd.interestRate) };
}

export function normalizeGoldHolding(h: GoldHolding): GoldHolding {
  return { ...h, quantityGrams: Number(h.quantityGrams), purchasePricePerGram: Number(h.purchasePricePerGram), currentPricePerGram: Number(h.currentPricePerGram) };
}

export function normalizeRealEstateProperty(p: any): any {
  return {
    ...p,
    purchasePrice: Number(p.purchasePrice),
    currentValue: Number(p.currentValue),
    ...(p.rentalIncomeMonthly != null ? { rentalIncomeMonthly: Number(p.rentalIncomeMonthly) } : {}),
    ...(p.loan ? { loan: { ...p.loan, outstandingBalance: Number(p.loan.outstandingBalance) } } : {}),
  };
}

export const investmentsApi = {
  getPortfolioSummary: () => api.get<{ data: PortfolioSummary }>('/investments/portfolio-summary').then(unwrap),
  get80CSummary: (fy: string) => api.get<{ data: any }>(`/investments/80c-summary?fy=${fy}`).then(unwrap),
  getAll: (params?: { type?: string; page?: number; pageSize?: number }): Promise<InvestmentPage> =>
    api.get<{ data: Investment[]; pagination: InvestmentPaginationMeta }>('/investments', {
      params: {
        ...(params?.type ? { type: params.type } : {}),
        page: params?.page ?? 1,
        pageSize: params?.pageSize ?? 25,
      },
    }).then((res) => ({ items: res.data.data.map(normalizeInvestment), pagination: res.data.pagination })),
  create: (data: object) => api.post<{ data: Investment }>('/investments', data).then(unwrap).then(normalizeInvestment),
  update: (id: string, data: object) => api.put<{ data: Investment }>(`/investments/${id}`, data).then(unwrap).then(normalizeInvestment),
  delete: (id: string) => api.delete(`/investments/${id}`),
  getFDs: (opts?: { status?: string; targetUserId?: string }) =>
    api.get<{ data: FD[] }>('/investments/fd', {
      params: { ...(opts?.status ? { status: opts.status } : {}), ...(opts?.targetUserId ? { userId: opts.targetUserId } : {}) },
    }).then(unwrap).then((fds) => fds.map(normalizeFD)),
  createFD: (data: object) => api.post<{ data: FD }>('/investments/fd', data).then(unwrap).then(normalizeFD),
  updateFD: (id: string, data: object) => api.put<{ data: FD }>(`/investments/fd/${id}`, data).then(unwrap).then(normalizeFD),
  deleteFD: (id: string) => api.delete(`/investments/fd/${id}`),
  getRDs: (opts?: { status?: string; targetUserId?: string }) =>
    api.get<{ data: RD[] }>('/investments/rd', {
      params: { ...(opts?.status ? { status: opts.status } : {}), ...(opts?.targetUserId ? { userId: opts.targetUserId } : {}) },
    }).then(unwrap).then((rds) => rds.map(normalizeRD)),
  createRD: (data: object) => api.post<{ data: RD }>('/investments/rd', data).then(unwrap).then(normalizeRD),
  updateRD: (id: string, data: object) => api.put<{ data: RD }>(`/investments/rd/${id}`, data).then(unwrap).then(normalizeRD),
  deleteRD: (id: string) => api.delete(`/investments/rd/${id}`),
  getSIPs: () => api.get<{ data: SIP[] }>('/investments/sip').then(unwrap).then((sips) => sips.map(normalizeSIP)),
  createSIP: (data: object) => api.post<{ data: SIP }>('/investments/sip', data).then(unwrap).then(normalizeSIP),
  updateSIP: (id: string, data: object) => api.put<{ data: SIP }>(`/investments/sip/${id}`, data).then(unwrap).then(normalizeSIP),
  deleteSIP: (id: string) => api.delete(`/investments/sip/${id}`),
  getGold: (opts?: { targetUserId?: string }) =>
    api.get<{ data: { holdings: GoldHolding[]; summary: any } }>('/investments/gold', {
      params: opts?.targetUserId ? { userId: opts.targetUserId } : {},
    }).then(unwrap).then((r) => ({ ...r, holdings: r.holdings.map(normalizeGoldHolding) })),
  createGold: (data: object) => api.post('/investments/gold', data).then((r) => normalizeGoldHolding(r.data.data)),
  updateGold: (id: string, data: object) => api.put(`/investments/gold/${id}`, data).then((r) => normalizeGoldHolding(r.data.data)),
  deleteGold: (id: string) => api.delete(`/investments/gold/${id}`),
  getRealEstate: (opts?: { targetUserId?: string }) =>
    api.get<{ data: any }>('/investments/real-estate', {
      params: opts?.targetUserId ? { userId: opts.targetUserId } : {},
    }).then(unwrap).then((r) => ({ ...r, properties: r.properties.map(normalizeRealEstateProperty) })),
  createRealEstate: (data: object) => api.post('/investments/real-estate', data).then((r) => normalizeRealEstateProperty(r.data.data)),
  updateRealEstate: (id: string, data: object) => api.put(`/investments/real-estate/${id}`, data).then((r) => normalizeRealEstateProperty(r.data.data)),
  deleteRealEstate: (id: string) => api.delete(`/investments/real-estate/${id}`),
  getExchangeRates: () => api.get<{ data: ExchangeRate[] }>('/investments/exchange-rates').then(unwrap),
  updateExchangeRate: (currency: string, rate: number) => api.put(`/investments/exchange-rates/${currency}`, { rate }),
};
