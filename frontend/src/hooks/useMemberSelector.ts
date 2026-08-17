import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import api from '@/lib/api';

interface Member {
  id: string;
  name: string;
  colorTag?: string | null;
  isActive?: boolean;
}

/**
 * Family members, plus the admin-only "view as member" state.
 *
 * The member list used to come from `/admin/users` with `enabled: isAdmin`, so a MEMBER
 * got an empty list — and their co-owner dropdown contained only themselves, making a
 * jointly-owned loan or property impossible to record.
 *
 * Everyone now reads `/api/users/members`, which returns only id, name and colour. An
 * ADMIN needs no more than that here either; the richer `/admin/users` payload (email,
 * PAN, last login, counts) belongs to the admin screens that actually use it.
 *
 * `viewUserId` remains admin-only. It is gated on `isAdmin` in every consumer, and
 * `resolveTargetUserId` on the server refuses a targetUserId from a non-admin regardless
 * — so a populated member list cannot become a way to read someone else's data.
 */
export function useMemberSelector() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [viewUserId, setViewUserId] = useState<string | undefined>(undefined);

  const { data: members = [], isLoading: isMembersLoading, isError: isMembersError } = useQuery<Member[]>({
    queryKey: ['family-members'],
    queryFn: () => api.get<{ data: Member[] }>('/users/members').then((r) => r.data.data),
  });

  return {
    isAdmin,
    viewUserId,
    setViewUserId,
    // The endpoint already filters to active users; the guard stays for any caller
    // that seeds this from a richer payload.
    members: members.filter((m) => m.isActive !== false),
    isMembersLoading,
    isMembersError,
  };
}
