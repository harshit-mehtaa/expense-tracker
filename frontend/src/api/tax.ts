import api from '@/lib/api';

const unwrap = <T>(res: { data: { data: T } }): T => res.data.data;

export const taxApi = {
  getProfile: (fy: string) => api.get<{ data: any }>(`/tax/profile?fy=${fy}`).then(unwrap),
  saveProfile: (fy: string, data: object) => api.post<{ data: any }>(`/tax/profile?fy=${fy}`, data).then(unwrap),
  getSummary: (fy: string) => api.get<{ data: any }>(`/tax/summary?fy=${fy}`).then(unwrap),
  get80CTracker: (fy: string) => api.get<{ data: any }>(`/tax/80c-tracker?fy=${fy}`).then(unwrap),
  getAdvanceTaxCalendar: (fy: string) => api.get<{ data: any[] }>(`/tax/advance-tax-calendar?fy=${fy}`).then(unwrap),
  calcHRA: (params: { basicSalary: number; hraReceived: number; rentPaid: number; city: string }) =>
    api.get<{ data: { exempt: number; taxable: number } }>('/tax/hra-calculator', { params }).then(unwrap),
};
