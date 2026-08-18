import api from '@/lib/api';

export type AssetType = 'PROPERTY' | 'VEHICLE' | 'GOLD' | 'OTHER';

export const ASSET_TYPES: Record<AssetType, string> = {
  PROPERTY: 'Property',
  VEHICLE: 'Vehicle',
  GOLD: 'Gold',
  OTHER: 'Other',
};

export type VehicleType = 'TWO_WHEELER' | 'FOUR_WHEELER' | 'OTHER';

export const VEHICLE_TYPES: Record<VehicleType, string> = {
  TWO_WHEELER: '2-Wheeler',
  FOUR_WHEELER: '4-Wheeler',
  OTHER: 'Other',
};

export type FuelType = 'PETROL' | 'DIESEL' | 'ELECTRIC' | 'HYBRID' | 'CNG' | 'OTHER';

export const FUEL_TYPES: Record<FuelType, string> = {
  PETROL: 'Petrol',
  DIESEL: 'Diesel',
  ELECTRIC: 'Electric',
  HYBRID: 'Hybrid',
  CNG: 'CNG',
  OTHER: 'Other',
};

export interface AssetLoanRef {
  id: string;
  lenderName: string;
  loanType: string;
  outstandingBalance: number;
}

/** Deliberately minimal — matches assetService's assetInclude on the backend. Financially
 *  sensitive fields (sumAssured, premiumAmount, policyNumber, nomineeName, ...) belong to
 *  the Insurance page, not every asset fetch. */
export interface AssetInsuranceRef {
  id: string;
  policyType: string;
  providerName: string;
  policyName: string;
  endDate?: string | null;
}

export interface Asset {
  id: string;
  userId: string;
  assetType: AssetType;
  name: string;
  value: number;
  realEstateId?: string | null;
  goldHoldingId?: string | null;
  notes?: string | null;
  purchaseDate?: string | null;
  /** Meaningful only when assetType === 'VEHICLE'; required by the backend in that case. */
  vehicleType?: VehicleType | null;
  /** Vehicle-only detail — same convention as vehicleType but none of these are
   *  required; the backend nulls all of them server-side whenever assetType isn't
   *  VEHICLE. */
  registrationNumber?: string | null;
  make?: string | null;
  model?: string | null;
  fuelType?: FuelType | null;
  insurancePolicyId?: string | null;
  insurancePolicy?: AssetInsuranceRef | null;
  /** Loans this asset secures — a non-empty list blocks deletion (409). */
  loans?: AssetLoanRef[];
  /** Set once, by recording a sale. Null means still owned. For a property/gold-linked
   *  asset, the primary sale record is the RealEstate/GoldHolding row, but this field is
   *  mirrored at sale time too — the "Secured Against" picker filters on THIS field, not
   *  a join through the link, so a sold property/holding's asset stops looking
   *  available for a new loan. */
  soldAt?: string | null;
  salePrice?: number | null;
}

const unwrap = <T>(res: { data: { data: T } }): T => res.data.data;

// Prisma Decimals arrive as strings; coerce at the API boundary.
export function normalizeAsset(a: Asset): Asset {
  return {
    ...a,
    value: Number(a.value),
    loans: a.loans?.map((l) => ({ ...l, outstandingBalance: Number(l.outstandingBalance) })),
    salePrice: a.salePrice != null ? Number(a.salePrice) : a.salePrice,
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
  sell: (id: string, data: { salePrice: number; date: string }) =>
    api.post<{ data: Asset }>(`/assets/${id}/sell`, data).then(unwrap).then(normalizeAsset),
};
