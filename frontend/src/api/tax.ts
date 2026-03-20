import api from '@/lib/api';
import type {
  CapitalGainEntry, CapitalGainSummary,
  OtherSourceIncome, OtherIncomeSummary,
  HousePropertyDetail, HousePropertyIncomeSummary,
  ForeignAssetDisclosure, ForeignAssetSummary,
  ITR2Summary,
} from '@/types/tax';

const unwrap = <T>(res: { data: { data: T } }): T => res.data.data;

export const taxApi = {
  getProfile: (fy: string) => api.get<{ data: any }>(`/tax/profile?fy=${fy}`).then(unwrap),
  saveProfile: (fy: string, data: object) => api.post<{ data: any }>(`/tax/profile?fy=${fy}`, data).then(unwrap),
  getSummary: (fy: string) => api.get<{ data: any }>(`/tax/summary?fy=${fy}`).then(unwrap),
  get80CTracker: (fy: string) => api.get<{ data: any }>(`/tax/80c-tracker?fy=${fy}`).then(unwrap),
  getAdvanceTaxCalendar: (fy: string) => api.get<{ data: any[] }>(`/tax/advance-tax-calendar?fy=${fy}`).then(unwrap),
  calcHRA: (params: { basicSalary: number; hraReceived: number; rentPaid: number; city: string }) =>
    api.get<{ data: { exempt: number; taxable: number } }>('/tax/hra-calculator', { params }).then(unwrap),

  // ─── Capital Gains ─────────────────────────────────────────────────────────
  listCapitalGains: (fy: string) =>
    api.get<{ data: CapitalGainEntry[] }>(`/tax/capital-gains?fy=${fy}`).then(unwrap),
  createCapitalGain: (data: object) =>
    api.post<{ data: CapitalGainEntry }>('/tax/capital-gains', data).then(unwrap),
  updateCapitalGain: (id: string, data: object) =>
    api.put<{ data: CapitalGainEntry }>(`/tax/capital-gains/${id}`, data).then(unwrap),
  deleteCapitalGain: (id: string) =>
    api.delete<{ data: { deleted: boolean } }>(`/tax/capital-gains/${id}`).then(unwrap),
  getCapitalGainsSummary: (fy: string) =>
    api.get<{ data: CapitalGainSummary }>(`/tax/capital-gains/summary?fy=${fy}`).then(unwrap),

  // ─── Other Income ──────────────────────────────────────────────────────────
  listOtherIncome: (fy: string) =>
    api.get<{ data: OtherSourceIncome[] }>(`/tax/other-income?fy=${fy}`).then(unwrap),
  createOtherIncome: (data: object) =>
    api.post<{ data: OtherSourceIncome }>('/tax/other-income', data).then(unwrap),
  updateOtherIncome: (id: string, data: object) =>
    api.put<{ data: OtherSourceIncome }>(`/tax/other-income/${id}`, data).then(unwrap),
  deleteOtherIncome: (id: string) =>
    api.delete<{ data: { deleted: boolean } }>(`/tax/other-income/${id}`).then(unwrap),
  getOtherIncomeSummary: (fy: string) =>
    api.get<{ data: OtherIncomeSummary }>(`/tax/other-income/summary?fy=${fy}`).then(unwrap),

  // ─── House Property ────────────────────────────────────────────────────────
  listHouseProperty: (fy: string) =>
    api.get<{ data: HousePropertyDetail[] }>(`/tax/house-property?fy=${fy}`).then(unwrap),
  createHouseProperty: (data: object) =>
    api.post<{ data: HousePropertyDetail }>('/tax/house-property', data).then(unwrap),
  updateHouseProperty: (id: string, data: object) =>
    api.put<{ data: HousePropertyDetail }>(`/tax/house-property/${id}`, data).then(unwrap),
  deleteHouseProperty: (id: string) =>
    api.delete<{ data: { deleted: boolean } }>(`/tax/house-property/${id}`).then(unwrap),
  getHousePropertySummary: (fy: string) =>
    api.get<{ data: HousePropertyIncomeSummary }>(`/tax/house-property/summary?fy=${fy}`).then(unwrap),

  // ─── Foreign Assets (Schedule FA) ──────────────────────────────────────────
  listForeignAssets: (fy: string) =>
    api.get<{ data: ForeignAssetDisclosure[] }>(`/tax/foreign-assets?fy=${fy}`).then(unwrap),
  createForeignAsset: (data: object) =>
    api.post<{ data: ForeignAssetDisclosure }>('/tax/foreign-assets', data).then(unwrap),
  updateForeignAsset: (id: string, data: object) =>
    api.put<{ data: ForeignAssetDisclosure }>(`/tax/foreign-assets/${id}`, data).then(unwrap),
  deleteForeignAsset: (id: string) =>
    api.delete<{ data: { deleted: boolean } }>(`/tax/foreign-assets/${id}`).then(unwrap),
  getForeignAssetSummary: (fy: string) =>
    api.get<{ data: ForeignAssetSummary }>(`/tax/foreign-assets/summary?fy=${fy}`).then(unwrap),

  // ─── ITR-2 Overview ────────────────────────────────────────────────────────
  getITR2Summary: (fy: string) =>
    api.get<{ data: ITR2Summary }>(`/tax/itr2-summary?fy=${fy}`).then(unwrap),
};
