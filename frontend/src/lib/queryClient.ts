import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';

function dispatchApiError(error: unknown) {
  // Only fire for network-level errors not already handled by the Axios interceptor
  // (Axios interceptor covers errors with a response; this catches network timeouts etc.)
  const axiosErr = error as AxiosError<{ message?: string }>;
  if (!axiosErr?.response) {
    const message = axiosErr?.message ?? 'Network error. Please check your connection.';
    window.dispatchEvent(new CustomEvent('api:error', { detail: { message } }));
  }
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: dispatchApiError,
  }),
  mutationCache: new MutationCache({
    onError: dispatchApiError,
  }),
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000,   // 10 minutes (formerly cacheTime)
      retry: (failureCount, error: unknown) => {
        // Don't retry on 4xx errors
        if (error instanceof Error && 'status' in error) {
          const status = (error as { status: number }).status;
          if (status >= 400 && status < 500) return false;
        }
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
