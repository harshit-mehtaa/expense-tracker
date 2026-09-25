import { useCallback } from 'react';
import { isAxiosError } from 'axios';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';

/**
 * The logout action for every "Log out" control (UserMenu, Settings > Session).
 *
 * AuthContext.logout clears the local session in a `finally` and then RETHROWS a failed
 * server call, so `onClick={logout}` turned one into an unhandled rejection. The user is
 * signed out locally either way. An HTTP failure was already toasted by the api
 * interceptor; a network failure (no response) was not, and it matters: the server-side
 * refresh session may still be alive, so say so.
 */
export function useLogout(): () => Promise<void> {
  const { logout } = useAuth();
  const { toast } = useToast();

  return useCallback(async () => {
    try {
      await logout();
    } catch (err) {
      // Not an HTTP-layer failure → a bug: surface it rather than dress it up as "offline".
      if (!isAxiosError(err)) throw err;
      if (err.response) return;
      toast({
        title: 'Signed out on this device',
        description: 'The server could not be reached, so your session may stay active until it expires.',
        variant: 'error',
      });
    }
  }, [logout, toast]);
}
