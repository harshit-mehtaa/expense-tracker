import api from '@/lib/api';

export interface Investment {
  id: string;
  type: string;
  name: string;
  currency: string;
  exchange?: string;
  folioNumber?: string;
  isin?: string;
  tickerSymbolNSE?: string;
  tickerSymbolBSE?: string;
  tickerSymbolForeign?: string;
  unitsOrQuantity: number;
  purchasePricePerUnit: number;
  purchaseNav?: number;
  purchaseExchangeRate?: number;
  currentPricePerUnit: number;
  currentNav?: number;
  purchaseDate: string;
  isTaxSaving: boolean;
  investedINR: number;
  currentValueINR: number;
  gainINR: number;
  gainPct: number;
  xirr?: number;
  notes?: string;
  userName?: string;
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
  tdsApplicable?: boolean;
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
  notes?: string;
  userName?: string;
}

export interface SIP {
  id: string;
  fundName: string;
  monthlyAmount: number;
  sipDate: number;
  startDate: string;
  endDate?: string | null;
  folioNumber?: string | null;
  status: string;
  bankAccountId?: string | null;
  bankAccount?: { id: string; bankName: string; accountNumberLast4?: string | null } | null;
  investment: Investment;
  nextDate?: string;
  userName?: string;
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
  /** Set once, by recording a sale. Null means still held. */
  soldAt?: string | null;
  salePrice?: number | null;
}

export interface RealEstateOwner {
  id?: string;
  userId: string;
  name: string;
  email?: string;
  colorTag?: string | null;
  sharePercent: number;
}

export interface RealEstateProperty {
  id: string;
  userId: string;
  propertyType: string;
  propertyName: string;
  location: string;
  purchasePrice: number;
  currentValue: number;
  purchaseDate: string;
  rentalIncomeMonthly?: number | null;
  notes?: string;
  owners: RealEstateOwner[];
  userName?: string;
  sharePercent?: number;
  purchasePriceShare?: number;
  currentValueShare?: number;
  rentalIncomeMonthlyShare?: number;
  loan?: { lenderName: string; outstandingBalance: number } | null;
  /** Set once, by recording a sale. Null means still owned. */
  soldAt?: string | null;
  salePrice?: number | null;
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
  return {
    ...inv,
    unitsOrQuantity: Number(inv.unitsOrQuantity),
    purchasePricePerUnit: Number(inv.purchasePricePerUnit),
    currentPricePerUnit: Number(inv.currentPricePerUnit),
    ...(inv.purchaseNav != null ? { purchaseNav: Number(inv.purchaseNav) } : {}),
    ...(inv.currentNav != null ? { currentNav: Number(inv.currentNav) } : {}),
    ...(inv.purchaseExchangeRate != null ? { purchaseExchangeRate: Number(inv.purchaseExchangeRate) } : {}),
  };
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
  return {
    ...h,
    quantityGrams: Number(h.quantityGrams),
    purchasePricePerGram: Number(h.purchasePricePerGram),
    currentPricePerGram: Number(h.currentPricePerGram),
    salePrice: h.salePrice != null ? Number(h.salePrice) : h.salePrice,
  };
}

export function normalizeRealEstateProperty(p: any): any {
  return {
    ...p,
    purchasePrice: Number(p.purchasePrice),
    currentValue: Number(p.currentValue),
    owners: (p.owners ?? []).map((owner: any) => ({ ...owner, sharePercent: Number(owner.sharePercent) })),
    ...(p.rentalIncomeMonthly != null ? { rentalIncomeMonthly: Number(p.rentalIncomeMonthly) } : {}),
    ...(p.sharePercent != null ? { sharePercent: Number(p.sharePercent) } : {}),
    ...(p.purchasePriceShare != null ? { purchasePriceShare: Number(p.purchasePriceShare) } : {}),
    ...(p.currentValueShare != null ? { currentValueShare: Number(p.currentValueShare) } : {}),
    ...(p.rentalIncomeMonthlyShare != null ? { rentalIncomeMonthlyShare: Number(p.rentalIncomeMonthlyShare) } : {}),
    ...(p.salePrice != null ? { salePrice: Number(p.salePrice) } : {}),
    ...(p.loan ? { loan: { ...p.loan, outstandingBalance: Number(p.loan.outstandingBalance) } } : {}),
  };
}

export const investmentsApi = {
  getPortfolioSummary: (opts?: { targetUserId?: string }) =>
    api.get<{ data: PortfolioSummary }>('/investments/portfolio-summary', {
      params: opts?.targetUserId ? { userId: opts.targetUserId } : {},
    }).then(unwrap),
  get80CSummary: (fy: string, opts?: { targetUserId?: string }) =>
    api.get<{ data: any }>('/investments/80c-summary', {
      params: { fy, ...(opts?.targetUserId ? { userId: opts.targetUserId } : {}) },
    }).then(unwrap),
  getAll: (params?: { type?: string; page?: number; pageSize?: number; targetUserId?: string }): Promise<InvestmentPage> =>
    api.get<{ data: Investment[]; pagination: InvestmentPaginationMeta }>('/investments', {
      params: {
        ...(params?.type ? { type: params.type } : {}),
        ...(params?.targetUserId ? { userId: params.targetUserId } : {}),
        page: params?.page ?? 1,
        pageSize: params?.pageSize ?? 25,
      },
    }).then((res) => ({ items: res.data.data.map(normalizeInvestment), pagination: res.data.pagination })),
  create: (data: object, opts?: { targetUserId?: string }) =>
    api.post<{ data: Investment }>('/investments', data, { params: opts?.targetUserId ? { targetUserId: opts.targetUserId } : {} }).then(unwrap).then(normalizeInvestment),
  update: (id: string, data: object) => api.put<{ data: Investment }>(`/investments/${id}`, data).then(unwrap).then(normalizeInvestment),
  delete: (id: string) => api.delete(`/investments/${id}`),
  getFDs: (opts?: { status?: string; targetUserId?: string }) =>
    api.get<{ data: FD[] }>('/investments/fd', {
      params: { ...(opts?.status ? { status: opts.status } : {}), ...(opts?.targetUserId ? { userId: opts.targetUserId } : {}) },
    }).then(unwrap).then((fds) => fds.map(normalizeFD)),
  createFD: (data: object, opts?: { targetUserId?: string }) =>
    api.post<{ data: FD }>('/investments/fd', data, { params: opts?.targetUserId ? { targetUserId: opts.targetUserId } : {} }).then(unwrap).then(normalizeFD),
  updateFD: (id: string, data: object) => api.put<{ data: FD }>(`/investments/fd/${id}`, data).then(unwrap).then(normalizeFD),
  deleteFD: (id: string) => api.delete(`/investments/fd/${id}`),
  getRDs: (opts?: { status?: string; targetUserId?: string }) =>
    api.get<{ data: RD[] }>('/investments/rd', {
      params: { ...(opts?.status ? { status: opts.status } : {}), ...(opts?.targetUserId ? { userId: opts.targetUserId } : {}) },
    }).then(unwrap).then((rds) => rds.map(normalizeRD)),
  createRD: (data: object, opts?: { targetUserId?: string }) =>
    api.post<{ data: RD }>('/investments/rd', data, { params: opts?.targetUserId ? { targetUserId: opts.targetUserId } : {} }).then(unwrap).then(normalizeRD),
  updateRD: (id: string, data: object) => api.put<{ data: RD }>(`/investments/rd/${id}`, data).then(unwrap).then(normalizeRD),
  deleteRD: (id: string) => api.delete(`/investments/rd/${id}`),
  getSIPs: (opts?: { targetUserId?: string }) =>
    api.get<{ data: SIP[] }>('/investments/sip', {
      params: opts?.targetUserId ? { userId: opts.targetUserId } : {},
    }).then(unwrap).then((sips) => sips.map(normalizeSIP)),
  createSIP: (data: object, opts?: { targetUserId?: string }) =>
    api.post<{ data: SIP }>('/investments/sip', data, { params: opts?.targetUserId ? { targetUserId: opts.targetUserId } : {} }).then(unwrap).then(normalizeSIP),
  updateSIP: (id: string, data: object) => api.put<{ data: SIP }>(`/investments/sip/${id}`, data).then(unwrap).then(normalizeSIP),
  deleteSIP: (id: string) => api.delete(`/investments/sip/${id}`),
  getGold: (opts?: { targetUserId?: string }) =>
    api.get<{ data: { holdings: GoldHolding[]; summary: any } }>('/investments/gold', {
      params: opts?.targetUserId ? { userId: opts.targetUserId } : {},
    }).then(unwrap).then((r) => ({ ...r, holdings: r.holdings.map(normalizeGoldHolding) })),
  createGold: (data: object, opts?: { targetUserId?: string }) =>
    api.post('/investments/gold', data, { params: opts?.targetUserId ? { targetUserId: opts.targetUserId } : {} }).then((r) => normalizeGoldHolding(r.data.data)),
  updateGold: (id: string, data: object) => api.put(`/investments/gold/${id}`, data).then((r) => normalizeGoldHolding(r.data.data)),
  deleteGold: (id: string) => api.delete(`/investments/gold/${id}`),
  sellGold: (id: string, data: { salePrice: number; date: string }) =>
    api.post(`/investments/gold/${id}/sell`, data).then((r) => normalizeGoldHolding(r.data.data)),
  getRealEstate: (opts?: { targetUserId?: string }) =>
    api.get<{ data: any }>('/investments/real-estate', {
      params: opts?.targetUserId ? { userId: opts.targetUserId } : {},
    }).then(unwrap).then((r) => ({ ...r, properties: r.properties.map(normalizeRealEstateProperty) })),
  createRealEstate: (data: object, opts?: { targetUserId?: string }) =>
    api.post('/investments/real-estate', data, { params: opts?.targetUserId ? { targetUserId: opts.targetUserId } : {} }).then((r) => normalizeRealEstateProperty(r.data.data)),
  updateRealEstate: (id: string, data: object) => api.put(`/investments/real-estate/${id}`, data).then((r) => normalizeRealEstateProperty(r.data.data)),
  deleteRealEstate: (id: string) => api.delete(`/investments/real-estate/${id}`),
  sellRealEstate: (id: string, data: { salePrice: number; date: string }) =>
    api.post(`/investments/real-estate/${id}/sell`, data).then((r) => normalizeRealEstateProperty(r.data.data)),
  getExchangeRates: () => api.get<{ data: ExchangeRate[] }>('/investments/exchange-rates').then(unwrap),
  updateExchangeRate: (currency: string, rate: number) => api.put(`/investments/exchange-rates/${currency}`, { rate }),
};
