/**
 * useLogout: the one logout handler for every button. AuthContext.logout clears the
 * local session in a `finally` and then RETHROWS, so a bare onClick={logout} surfaced a
 * failed server call as an unhandled rejection. HTTP failures are already toasted by
 * the api interceptor; a network failure (no response) is not, so the hook says it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AxiosError, AxiosHeaders } from 'axios';

const logout = vi.fn();
const toast = vi.fn();
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ logout }) }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ toast }) }));

const { useLogout } = await import('@/hooks/useLogout');
const wrapper = ({ children }: { children: ReactNode }) => <>{children}</>;

beforeEach(() => {
  logout.mockReset();
  toast.mockReset();
});

describe('useLogout', () => {
  it('logs out and shows nothing on success', async () => {
    logout.mockResolvedValue(undefined);
    const { result } = renderHook(() => useLogout(), { wrapper });
    await act(() => result.current());
    expect(logout).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
  });

  it('swallows an HTTP failure — the api interceptor already toasted it', async () => {
    const config = { headers: new AxiosHeaders() };
    logout.mockRejectedValue(new AxiosError('Request failed with status code 500', 'ERR_BAD_RESPONSE', config, {}, {
      status: 500, statusText: 'Internal Server Error', data: { message: 'Server exploded' }, headers: {}, config,
    }));
    const { result } = renderHook(() => useLogout(), { wrapper });
    await expect(act(() => result.current())).resolves.toBeUndefined();
    expect(toast).not.toHaveBeenCalled();
  });

  it('warns when the server could not be reached (no response)', async () => {
    logout.mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK'));
    const { result } = renderHook(() => useLogout(), { wrapper });
    await act(() => result.current());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Signed out on this device',
      variant: 'error',
    }));
  });

  it('rethrows a non-HTTP error (a bug) instead of showing the offline toast', async () => {
    logout.mockRejectedValue(new TypeError('boom'));
    const { result } = renderHook(() => useLogout(), { wrapper });
    await expect(result.current()).rejects.toThrow('boom');
    expect(toast).not.toHaveBeenCalled();
  });
});
