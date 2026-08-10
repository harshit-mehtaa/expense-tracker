import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import api, { setAccessToken } from '@/lib/api';

interface User {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'MEMBER';
  avatarUrl?: string;
  colorTag?: string;
  mustChangePassword: boolean;
}

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const sessionRestored = useRef(false);
  const authEpoch = useRef(0);

  const fetchCurrentUser = useCallback(async () => {
    try {
      const response = await api.get<{ data: User }>('/auth/me');
      setUser(response.data.data);
    } catch {
      setUser(null);
      setAccessToken(null);
    }
  }, []);

  // Restore session on app load by attempting a token refresh.
  // The ref guard prevents React StrictMode's double-invoke from firing two concurrent refresh calls
  // (which would trigger the backend's token-reuse detection and nuke valid sessions).
  useEffect(() => {
    if (sessionRestored.current) return;
    sessionRestored.current = true;

    const restoreSession = async () => {
      const restoreEpoch = authEpoch.current;
      try {
        const response = await api.post<{ data: { accessToken: string } }>('/auth/refresh');
        if (authEpoch.current !== restoreEpoch) return;
        setAccessToken(response.data.data.accessToken);

        const me = await api.get<{ data: User }>('/auth/me');
        if (authEpoch.current !== restoreEpoch) return;
        setUser(me.data.data);
      } catch {
        if (authEpoch.current === restoreEpoch) {
          setUser(null);
          setAccessToken(null);
        }
      } finally {
        setIsLoading(false);
      }
    };

    restoreSession();
  }, [fetchCurrentUser]);

  // Listen for forced logout (e.g., refresh token expired)
  useEffect(() => {
    const handleLogout = () => {
      authEpoch.current += 1;
      setUser(null);
      setAccessToken(null);
    };
    window.addEventListener('auth:logout', handleLogout);
    return () => window.removeEventListener('auth:logout', handleLogout);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    authEpoch.current += 1;
    const response = await api.post<{ data: { user: User; accessToken: string } }>('/auth/login', {
      email,
      password,
    });
    setAccessToken(response.data.data.accessToken);
    setUser(response.data.data.user);
  }, []);

  const logout = useCallback(async () => {
    authEpoch.current += 1;
    try {
      await api.post('/auth/logout');
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
        refreshUser: fetchCurrentUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
