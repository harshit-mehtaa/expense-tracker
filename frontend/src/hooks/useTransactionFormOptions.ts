import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { loansApi } from '@/api/loans';

export function useCategories() {
  return useQuery({
    queryKey: ['categories', 'all'],
    queryFn: () => api.get<{ data: any[] }>('/categories').then((r) => r.data.data),
  });
}

export function useAccounts(targetUserId?: string) {
  return useQuery({
    queryKey: ['accounts', targetUserId],
    queryFn: () => api.get<{ data: any[] }>('/accounts', {
      params: targetUserId ? { userId: targetUserId } : {},
    }).then((r) => r.data.data),
  });
}

export function useLoans(targetUserId?: string) {
  return useQuery({
    queryKey: ['loans', targetUserId],
    queryFn: () => loansApi.getAll(targetUserId),
  });
}
