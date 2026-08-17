import api from '@/lib/api';

export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'CANCELLED';
export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

export const SUBSCRIPTION_STATUSES: Record<SubscriptionStatus, string> = {
  TRIALING: 'Trial',
  ACTIVE: 'Active',
  CANCELLED: 'Cancelled',
};

export const FREQUENCIES: Record<Frequency, string> = {
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  YEARLY: 'Yearly',
};

export interface SubscriptionPrice {
  id: string;
  amount: number;
  effectiveFrom: string;
  note?: string | null;
}

export interface SubscriptionUsage {
  chargeCount: number;
  totalPaid: number;
  averageCharge: number;
  firstChargeDate: string | null;
  lastChargeDate: string | null;
  /** A real charge that disagrees with the recorded price — usually an unrecorded rise. */
  priceMismatch: { date: string; charged: number; expected: number } | null;
}

export interface Subscription {
  id: string;
  userId: string;
  name: string;
  vendor?: string | null;
  status: SubscriptionStatus;
  cancellationUrl?: string | null;
  startDate: string;
  trialEndDate?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  notes?: string | null;
  prices: SubscriptionPrice[];
  currentPrice: number | null;
  annualisedCost: number | null;
  nextRenewalDate: string | null;
  recurringRule?: {
    id: string;
    frequency: Frequency;
    nextRunDate: string;
    isActive: boolean;
    /** How each generated charge is paid. Stored on the rule because the rule is the
     *  spec every generated transaction is built from. */
    paymentMode?: string | null;
    bankAccountId?: string | null;
    categoryId?: string | null;
    bankAccount?: {
      id: string;
      bankName: string;
      accountType: string;
      accountNumberLast4?: string | null;
    } | null;
    category?: { id: string; name: string; icon?: string | null; color?: string | null } | null;
  } | null;
  usage: SubscriptionUsage;
}

const unwrap = <T>(res: { data: { data: T } }): T => res.data.data;

const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Prisma Decimals arrive as strings; coerce at the API boundary. */
export function normalizeSubscription(s: Subscription): Subscription {
  return {
    ...s,
    currentPrice: numOrNull(s.currentPrice),
    annualisedCost: numOrNull(s.annualisedCost),
    prices: (s.prices ?? []).map((p) => ({ ...p, amount: Number(p.amount) })),
    usage: {
      ...s.usage,
      chargeCount: Number(s.usage?.chargeCount ?? 0),
      totalPaid: Number(s.usage?.totalPaid ?? 0),
      averageCharge: Number(s.usage?.averageCharge ?? 0),
      priceMismatch: s.usage?.priceMismatch
        ? {
            ...s.usage.priceMismatch,
            charged: Number(s.usage.priceMismatch.charged),
            expected: Number(s.usage.priceMismatch.expected),
          }
        : null,
    },
  };
}

export const subscriptionsApi = {
  getAll: (targetUserId?: string) =>
    api.get<{ data: Subscription[] }>('/subscriptions', {
      params: targetUserId ? { targetUserId } : {},
    }).then(unwrap).then((rows) => rows.map(normalizeSubscription)),

  getOne: (id: string) =>
    api.get<{ data: Subscription }>(`/subscriptions/${id}`).then(unwrap).then(normalizeSubscription),

  create: (data: object, opts?: { targetUserId?: string }) =>
    api.post<{ data: Subscription }>('/subscriptions', data, {
      params: opts?.targetUserId ? { targetUserId: opts.targetUserId } : {},
    }).then(unwrap).then(normalizeSubscription),

  update: (id: string, data: object) =>
    api.put<{ data: Subscription }>(`/subscriptions/${id}`, data).then(unwrap).then(normalizeSubscription),

  recordPrice: (id: string, data: { amount: number; effectiveFrom: string; note?: string | null }) =>
    api.post<{ data: Subscription }>(`/subscriptions/${id}/price`, data).then(unwrap).then(normalizeSubscription),

  cancel: (id: string, reason?: string | null) =>
    api.post<{ data: Subscription }>(`/subscriptions/${id}/cancel`, { reason }).then(unwrap).then(normalizeSubscription),

  resume: (id: string, nextRunDate: string) =>
    api.post<{ data: Subscription }>(`/subscriptions/${id}/resume`, { nextRunDate }).then(unwrap).then(normalizeSubscription),

  delete: (id: string) => api.delete(`/subscriptions/${id}`),
};
