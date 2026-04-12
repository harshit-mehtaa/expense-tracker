/**
 * Tests for useBudgetsVsActuals hook.
 * MSW v2 intercepts axios calls at the network layer.
 * Handlers must use the full baseURL: http://localhost:3000/...
 */
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import React from 'react';
import { server } from './mswServer';
import { useBudgetsVsActuals } from '@/hooks/useBudgetsVsActuals';

const MOCK_ITEMS = [
  {
    id: 'bud-1',
    categoryId: 'cat-1',
    amount: 5000,
    period: 'MONTHLY',
    fyYear: null,
    category: { id: 'cat-1', name: 'Food', color: '#ff0000', icon: null },
    actual: 3000,
    remaining: 2000,
    pctUsed: 60,
  },
];

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useBudgetsVsActuals', () => {
  it('returns data on successful fetch', async () => {
    server.use(
      http.get('http://localhost:3000/budgets/vs-actuals', () =>
        HttpResponse.json({ data: MOCK_ITEMS }),
      ),
    );

    const { result } = renderHook(() => useBudgetsVsActuals('2025-26'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].pctUsed).toBe(60);
  });

  it('is loading initially', () => {
    server.use(
      http.get('http://localhost:3000/budgets/vs-actuals', async () => {
        await new Promise(() => {}); // never resolves
        return HttpResponse.json({ data: [] });
      }),
    );

    const { result } = renderHook(() => useBudgetsVsActuals('2025-26'), { wrapper: wrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it('sets isError on server error', async () => {
    server.use(
      http.get('http://localhost:3000/budgets/vs-actuals', () =>
        new HttpResponse(null, { status: 500 }),
      ),
    );

    const { result } = renderHook(() => useBudgetsVsActuals('2025-26'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('includes targetUserId in query params when provided', async () => {
    let capturedUrl = '';
    server.use(
      http.get('http://localhost:3000/budgets/vs-actuals', ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ data: [] });
      }),
    );

    const { result } = renderHook(
      () => useBudgetsVsActuals('2025-26', 'user-target-id'),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedUrl).toContain('targetUserId=user-target-id');
  });

  it('uses fy query param', async () => {
    let capturedUrl = '';
    server.use(
      http.get('http://localhost:3000/budgets/vs-actuals', ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ data: [] });
      }),
    );

    const { result } = renderHook(
      () => useBudgetsVsActuals('2024-25'),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedUrl).toContain('fy=2024-25');
  });
});
