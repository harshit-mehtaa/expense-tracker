import api from '@/lib/api';

export interface LoanOwner {
  userId: string;
  sharePercent: number;
  userName?: string;
}

export interface LoanAsset {
  id: string;
  assetType: string;
  name: string;
  value: number;
}

export interface Loan {
  id: string;
  /** The loan's primary owner. A prepayment is always attributed to this user's ledger
   *  and accounts, even when a co-owner is the one recording it. */
  userId: string;
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
  /** Set exactly once, when a prepayment brings outstandingBalance to 0. Null means
   *  still active. Compare against endDate (the ORIGINAL schedule, never overwritten by
   *  closure) to say how early: closedAt < endDate. */
  closedAt?: string | null;
  /** When full EMIs begin. The gap from disbursementDate is the pre-EMI period. */
  firstEmiDate?: string | null;
  /** Interest accruing across that gap. */
  preEmiAmount?: number | null;
  isTaxDeductible: boolean;
  section24bEligible: boolean;
  /** A flat rupee amount, not a percentage. */
  prepaymentChargesAmount: number;
  assetId?: string | null;
  asset?: LoanAsset | null;
  owners?: LoanOwner[];
  /** The requesting user's share, and their proportion of the money figures. */
  sharePercent?: number;
  outstandingBalanceShare?: number;
  emiAmountShare?: number;
  userName?: string;
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

/** What POST /loans/derive returns. Every field may be null when inputs are incomplete. */
export interface DerivedLoanFields {
  emiAmount: number | null;
  endDate: string | null;
  preEmiAmount: number | null;
  monthlyPreEmiAmount: number | null;
  outstandingBalance: number | null;
}

export interface DeriveLoanInput {
  principalAmount: number;
  interestRate: number;
  tenureMonths: number;
  disbursementDate?: string;
  firstEmiDate?: string;
}

export interface LoanPrepayment {
  id: string;
  amount: number;
  date: string;
  notes?: string | null;
  /** Set only when recorded with mode='reduce_emi'. */
  reducedEmi?: number | null;
  /** Months saved; set only when recorded with mode='reduce_tenure'. */
  tenureReduced?: number | null;
  createdAt: string;
}

export interface RecordPrepaymentInput {
  amount: number;
  date: string;
  mode: 'reduce_tenure' | 'reduce_emi';
  notes?: string;
  bankAccountId?: string | null;
  categoryId?: string | null;
}

const unwrap = <T>(res: { data: { data: T } }): T => res.data.data;

/** Coerce a Decimal-or-null field without turning null into 0. */
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

// Prisma Decimal fields serialize as strings in JSON; coerce to number at the API boundary.
export function normalizeLoan(l: Loan): Loan {
  return {
    ...l,
    principalAmount: Number(l.principalAmount),
    outstandingBalance: Number(l.outstandingBalance),
    interestRate: Number(l.interestRate),
    emiAmount: Number(l.emiAmount),
    prepaymentChargesAmount: Number(l.prepaymentChargesAmount ?? 0),
    preEmiAmount: numOrNull(l.preEmiAmount),
    sharePercent: numOrNull(l.sharePercent) ?? undefined,
    outstandingBalanceShare: numOrNull(l.outstandingBalanceShare) ?? undefined,
    emiAmountShare: numOrNull(l.emiAmountShare) ?? undefined,
    owners: l.owners?.map((o) => ({ ...o, sharePercent: Number(o.sharePercent) })),
    asset: l.asset ? { ...l.asset, value: Number(l.asset.value) } : l.asset,
  };
}

export const loansApi = {
  getAll: (targetUserId?: string) => api.get<{ data: Loan[] }>('/loans', { params: targetUserId ? { targetUserId } : {} }).then(unwrap).then((loans) => loans.map(normalizeLoan)),
  create: (data: object, opts?: { targetUserId?: string }) =>
    api.post<{ data: Loan }>('/loans', data, { params: opts?.targetUserId ? { targetUserId: opts.targetUserId } : {} }).then(unwrap).then(normalizeLoan),
  update: (id: string, data: object) => api.put<{ data: Loan }>(`/loans/${id}`, data).then(unwrap).then(normalizeLoan),
  delete: (id: string) => api.delete(`/loans/${id}`),
  getAmortization: (id: string) => api.get<{ data: { loan: Loan; schedule: AmortizationRow[]; summary: any } }>(`/loans/${id}/amortization-schedule`).then(unwrap).then((r) => ({ ...r, loan: normalizeLoan(r.loan) })),
  simulatePrepayment: (id: string, data: { prepaymentAmount: number; mode: string }) =>
    api.post<{ data: any }>(`/loans/${id}/prepayment-simulation`, data).then(unwrap),
  /** Records a prepayment that actually happened — as opposed to simulatePrepayment's
   *  what-if. Returns the updated loan, so callers can refresh without a second fetch. */
  recordPrepayment: (id: string, data: RecordPrepaymentInput) =>
    api.post<{ data: { transaction: unknown; prepayment: LoanPrepayment; loan: Loan } }>(
      `/loans/${id}/prepayments`, data,
    ).then(unwrap).then((r) => ({ ...r, loan: normalizeLoan(r.loan) })),
  getPrepayments: (id: string) =>
    api.get<{ data: LoanPrepayment[] }>(`/loans/${id}/prepayments`).then(unwrap)
      .then((rows) => rows.map((r) => ({
        ...r,
        amount: Number(r.amount),
        reducedEmi: numOrNull(r.reducedEmi),
      }))),
  /**
   * Ask the backend for the fields a user shouldn't have to compute.
   * The formulas live server-side only — duplicating financial maths across two
   * codebases that must agree was deliberately rejected.
   */
  derive: (input: DeriveLoanInput) =>
    api.post<{ data: DerivedLoanFields }>('/loans/derive', input).then(unwrap).then((d) => ({
      ...d,
      emiAmount: numOrNull(d.emiAmount),
      preEmiAmount: numOrNull(d.preEmiAmount),
      monthlyPreEmiAmount: numOrNull(d.monthlyPreEmiAmount),
      outstandingBalance: numOrNull(d.outstandingBalance),
    })),
};
