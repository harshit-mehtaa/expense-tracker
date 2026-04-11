import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import api from '@/lib/api';

interface Member {
  id: string;
  name: string;
  isActive: boolean;
}

/**
 * Shared hook for the admin member-selector pattern.
 * Returns `viewUserId` (undefined = all family) and the active member list.
 * Query is disabled for non-admin users.
 */
export function useMemberSelector() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [viewUserId, setViewUserId] = useState<string | undefined>(undefined);

  const { data: members = [], isLoading: isMembersLoading, isError: isMembersError } = useQuery<Member[]>({
    queryKey: ['admin-users'],
    queryFn: () => api.get<{ data: Member[] }>('/admin/users').then((r) => r.data.data),
    enabled: isAdmin,
  });

  return {
    isAdmin,
    viewUserId,
    setViewUserId,
    members: members.filter((m) => m.isActive),
    isMembersLoading,
    isMembersError,
  };
}
