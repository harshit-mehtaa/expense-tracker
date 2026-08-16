import api from '@/lib/api';

export type AssetType = 'PROPERTY' | 'VEHICLE' | 'GOLD' | 'OTHER';

export const ASSET_TYPES: Record<AssetType, string> = {
  PROPERTY: 'Property',
  VEHICLE: 'Vehicle',
  GOLD: 'Gold',
  OTHER: 'Other',
};

export interface AssetLoanRef {
  id: string;
  lenderName: string;
  loanType: string;
  outstandingBalance: number;
}

export interface Asset {
  id: string;
  userId: string;
  assetType: AssetType;
  name: string;
  value: number;
  realEstateId?: string | null;
  notes?: string | null;
  /** Loans this asset secures — a non-empty list blocks deletion (409). */
  loans?: AssetLoanRef[];
}

const unwrap = <T>(res: { data: { data: T } }): T => res.data.data;

// Prisma Decimals arrive as strings; coerce at the API boundary.
export function normalizeAsset(a: Asset): Asset {
  return {
    ...a,
    value: Number(a.value),
    loans: a.loans?.map((l) => ({ ...l, outstandingBalance: Number(l.outstandingBalance) })),
  };
}

export const assetsApi = {
  getAll: (targetUserId?: string) =>
    api.get<{ data: Asset[] }>('/assets', { params: targetUserId ? { targetUserId } : {} })
      .then(unwrap).then((assets) => assets.map(normalizeAsset)),
  getOne: (id: string) => api.get<{ data: Asset }>(`/assets/${id}`).then(unwrap).then(normalizeAsset),
  create: (data: object, opts?: { targetUserId?: string }) =>
    api.post<{ data: Asset }>('/assets', data, { params: opts?.targetUserId ? { targetUserId: opts.targetUserId } : {} })
      .then(unwrap).then(normalizeAsset),
  update: (id: string, data: object) =>
    api.put<{ data: Asset }>(`/assets/${id}`, data).then(unwrap).then(normalizeAsset),
  delete: (id: string) => api.delete(`/assets/${id}`),
};
