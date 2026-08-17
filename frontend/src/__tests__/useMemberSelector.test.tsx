/**
 * Tests for useMemberSelector hook.
 *
 * Every role now reads /users/members. It used to fetch /admin/users with
 * `enabled: isAdmin`, which left a MEMBER with an empty list — and so a co-owner dropdown
 * containing only themselves, making a jointly-owned loan impossible to record.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import React from 'react';
import { server } from './mswServer';

// ── Mock AuthContext before importing the hook ────────────────────────────────
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

import { useMemberSelector } from '@/hooks/useMemberSelector';
import { useAuth } from '@/contexts/AuthContext';

const useAuthMock = useAuth as ReturnType<typeof vi.fn>;

const MOCK_MEMBERS = [
  { id: 'u1', name: 'Alice', isActive: true },
  { id: 'u2', name: 'Bob', isActive: true },
  { id: 'u3', name: 'Charlie', isActive: false },
];

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useMemberSelector — ADMIN', () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({ user: { role: 'ADMIN', id: 'u1' } });
    server.use(
      http.get('http://localhost:3000/users/members', () =>
        HttpResponse.json({ data: MOCK_MEMBERS }),
      ),
    );
  });

  it('isAdmin is true for ADMIN role', () => {
    const { result } = renderHook(() => useMemberSelector(), { wrapper: wrapper() });
    expect(result.current.isAdmin).toBe(true);
  });

  it('fetches and returns only active members', async () => {
    const { result } = renderHook(() => useMemberSelector(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isMembersLoading).toBe(false));
    // Active members: Alice + Bob (Charlie is inactive)
    expect(result.current.members).toHaveLength(2);
    expect(result.current.members.map((m) => m.name)).toContain('Alice');
    expect(result.current.members.map((m) => m.name)).not.toContain('Charlie');
  });

  it('viewUserId starts as undefined', async () => {
    const { result } = renderHook(() => useMemberSelector(), { wrapper: wrapper() });
    expect(result.current.viewUserId).toBeUndefined();
  });

  it('setViewUserId updates viewUserId', async () => {
    const { result } = renderHook(() => useMemberSelector(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isMembersLoading).toBe(false));
    act(() => result.current.setViewUserId('u2'));
    expect(result.current.viewUserId).toBe('u2');
  });
});

describe('useMemberSelector — MEMBER', () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({ user: { role: 'MEMBER', id: 'u2' } });
    server.use(
      http.get('http://localhost:3000/users/members', () =>
        HttpResponse.json({ data: MOCK_MEMBERS }),
      ),
    );
  });

  it('isAdmin is false for MEMBER role', () => {
    const { result } = renderHook(() => useMemberSelector(), { wrapper: wrapper() });
    expect(result.current.isAdmin).toBe(false);
  });

  it('DOES fetch members, so a co-owner can be chosen', async () => {
    // Previously disabled for non-admins, which left the dropdown containing only
    // themselves and made co-ownership unusable for the household it exists for.
    const { result } = renderHook(() => useMemberSelector(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isMembersLoading).toBe(false));
    expect(result.current.members.map((m) => m.name)).toContain('Alice');
  });

  it('still excludes inactive members', async () => {
    const { result } = renderHook(() => useMemberSelector(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isMembersLoading).toBe(false));
    expect(result.current.members.map((m) => m.name)).not.toContain('Charlie');
  });

  it('gets NO ability to view another member — viewUserId stays undefined', async () => {
    // The list is for picking co-owners. Viewing another member's data is admin-only, and
    // the server refuses a targetUserId from a non-admin regardless of what is sent.
    const { result } = renderHook(() => useMemberSelector(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isMembersLoading).toBe(false));
    expect(result.current.viewUserId).toBeUndefined();
    expect(result.current.isAdmin).toBe(false);
  });
});

