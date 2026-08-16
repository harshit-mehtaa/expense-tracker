/**
 * Tests for the shared queryClient — its network-error toast dispatch and its
 * retry predicate.
 *
 * dispatchApiError deliberately fires ONLY for errors with no `response`. Errors that
 * carry a response are already surfaced by the Axios interceptor in lib/api.ts, so
 * firing here too would show the user two toasts for one failure. Both sides of that
 * guard are asserted.
 *
 * The retry predicate is exercised as a pure function rather than by driving a real
 * query, so the 4xx short-circuit is checked directly instead of inferred from timing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosError } from 'axios';
import { queryClient } from '@/lib/queryClient';

type RetryFn = (failureCount: number, error: unknown) => boolean;

/** The configured retry predicate, read back off the client's defaults. */
const retry = queryClient.getDefaultOptions().queries?.retry as RetryFn;

let listener: ReturnType<typeof vi.fn>;

beforeEach(() => {
  listener = vi.fn();
  window.addEventListener('api:error', listener);
});

afterEach(() => {
  window.removeEventListener('api:error', listener);
  queryClient.clear();
});

/** Fire the cache's onError the same way React Query would. */
function fireQueryError(error: unknown) {
  // @ts-expect-error — invoking the configured handler directly with a minimal shape.
  queryClient.getQueryCache().config.onError?.(error, {});
}

function fireMutationError(error: unknown) {
  // @ts-expect-error — invoking the configured handler directly with a minimal shape.
  queryClient.getMutationCache().config.onError?.(error, {}, {}, {});
}

// ─── dispatchApiError ─────────────────────────────────────────────────────────

describe('queryClient error dispatch', () => {
  it('fires api:error with the error message when there is no response (network failure)', () => {
    fireQueryError(new AxiosError('Network Error'));

    expect(listener).toHaveBeenCalledTimes(1);
    const evt = listener.mock.calls[0][0] as CustomEvent<{ message: string }>;
    expect(evt.detail.message).toBe('Network Error');
  });

  it('falls back to a friendly message when the error carries no message', () => {
    fireQueryError({});

    const evt = listener.mock.calls[0][0] as CustomEvent<{ message: string }>;
    expect(evt.detail.message).toBe('Network error. Please check your connection.');
  });

  it('handles a null error without throwing, using the fallback message', () => {
    expect(() => fireQueryError(null)).not.toThrow();

    const evt = listener.mock.calls[0][0] as CustomEvent<{ message: string }>;
    expect(evt.detail.message).toBe('Network error. Please check your connection.');
  });

  it('stays silent when the error HAS a response — the Axios interceptor owns that toast', () => {
    const withResponse = new AxiosError('Request failed');
    // @ts-expect-error — minimal response shape.
    withResponse.response = { status: 500, data: { message: 'Server exploded' } };

    fireQueryError(withResponse);

    // Firing here as well would double-toast the user for a single failure.
    expect(listener).not.toHaveBeenCalled();
  });

  it('applies the same dispatch rule to mutation errors', () => {
    fireMutationError(new AxiosError('Network Error'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stays silent for a mutation error that carries a response', () => {
    const withResponse = new AxiosError('Bad request');
    // @ts-expect-error — minimal response shape.
    withResponse.response = { status: 400, data: {} };

    fireMutationError(withResponse);
    expect(listener).not.toHaveBeenCalled();
  });
});

// ─── retry predicate ──────────────────────────────────────────────────────────

describe('queryClient retry predicate', () => {
  /** axios@1.x sets `status` directly on the error, which is what the predicate reads. */
  function axiosErrorWithStatus(status: number): AxiosError {
    const err = new AxiosError('failed');
    (err as unknown as { status: number }).status = status;
    return err;
  }

  it('does not retry a 400', () => {
    expect(retry(0, axiosErrorWithStatus(400))).toBe(false);
  });

  it('does not retry a 401', () => {
    expect(retry(0, axiosErrorWithStatus(401))).toBe(false);
  });

  it('does not retry a 404', () => {
    expect(retry(0, axiosErrorWithStatus(404))).toBe(false);
  });

  it('does not retry a 499, the top of the 4xx range', () => {
    expect(retry(0, axiosErrorWithStatus(499))).toBe(false);
  });

  it('retries a 500 — a server fault may be transient', () => {
    expect(retry(0, axiosErrorWithStatus(500))).toBe(true);
  });

  it('retries a 399, just below the 4xx range', () => {
    expect(retry(0, axiosErrorWithStatus(399))).toBe(true);
  });

  it('gives up after two retries on a retryable error', () => {
    const err = axiosErrorWithStatus(500);
    expect(retry(0, err)).toBe(true);
    expect(retry(1, err)).toBe(true);
    expect(retry(2, err)).toBe(false);
  });

  it('retries an Error with no status field at all', () => {
    expect(retry(0, new Error('boom'))).toBe(true);
    expect(retry(2, new Error('boom'))).toBe(false);
  });

  it('retries a non-Error rejection, which cannot carry a status', () => {
    expect(retry(0, 'string rejection')).toBe(true);
  });
});

// ─── Configured defaults ──────────────────────────────────────────────────────

describe('queryClient defaults', () => {
  it('uses a 5 minute staleTime and 10 minute gcTime', () => {
    const q = queryClient.getDefaultOptions().queries;
    expect(q?.staleTime).toBe(5 * 60 * 1000);
    expect(q?.gcTime).toBe(10 * 60 * 1000);
  });

  it('does not refetch on window focus', () => {
    expect(queryClient.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false);
  });

  it('never retries mutations, since they are not idempotent', () => {
    expect(queryClient.getDefaultOptions().mutations?.retry).toBe(0);
  });
});
