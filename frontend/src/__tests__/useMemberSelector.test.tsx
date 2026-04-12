/**
 * Tests for useMemberSelector hook.
 * Uses vi.mock for AuthContext and MSW for the /admin/users API.
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
      http.get('http://localhost:3000/admin/users', () =>
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
  });

  it('isAdmin is false for MEMBER role', () => {
    const { result } = renderHook(() => useMemberSelector(), { wrapper: wrapper() });
    expect(result.current.isAdmin).toBe(false);
  });

  it('does not fetch members (query disabled)', async () => {
    let fetchCalled = false;
    server.use(
      http.get('http://localhost:3000/admin/users', () => {
        fetchCalled = true;
        return HttpResponse.json({ data: [] });
      }),
    );

    const { result } = renderHook(() => useMemberSelector(), { wrapper: wrapper() });
    // Give it a moment to potentially fire
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchCalled).toBe(false);
    expect(result.current.members).toHaveLength(0);
  });
});
