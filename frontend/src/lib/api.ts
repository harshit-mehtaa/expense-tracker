import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

function getApiBaseURL(): string {
  const configured = import.meta.env.VITE_API_URL;
  if (!configured || typeof window === 'undefined') return configured ?? '/api';

  try {
    const configuredUrl = new URL(configured, window.location.origin);
    const currentUrl = new URL(window.location.origin);
    const localHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]']);
    const isApiPath = configuredUrl.pathname.replace(/\/$/, '') === '/api';

    if (isApiPath && configuredUrl.origin === currentUrl.origin) return '/api';
    if (
      isApiPath
      && localHosts.has(configuredUrl.hostname)
      && localHosts.has(currentUrl.hostname)
      && configuredUrl.protocol === currentUrl.protocol
      && configuredUrl.port === currentUrl.port
    ) {
      return '/api';
    }
  } catch {
    // Fall through to the configured value.
  }

  return configured;
}

// Central Axios instance — all API calls go through here
// withCredentials: true is CRITICAL for HttpOnly refresh cookie to be sent
const api = axios.create({
  baseURL: getApiBaseURL(),
  withCredentials: true, // Required for HttpOnly cookie auth
  headers: {
    'Content-Type': 'application/json',
  },
});

// Access token storage (in memory — not localStorage to avoid XSS)
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

// Request interceptor — attach access token to every request
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken && config.headers) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// Response interceptor — handle 401 by attempting token refresh
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value: string) => void;
  reject: (reason: unknown) => void;
}> = [];

function processQueue(error: unknown, token: string | null = null): void {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token!);
    }
  });
  failedQueue = [];
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // Never retry public auth endpoints. A stale refresh cookie should not interfere
    // with an explicit login attempt.
    const isRefreshEndpoint = originalRequest.url?.endsWith('/auth/refresh');
    const isLoginEndpoint = originalRequest.url?.endsWith('/auth/login');

    if (error.response?.status === 401 && !originalRequest._retry && !isRefreshEndpoint && !isLoginEndpoint) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const response = await api.post<{ data: { accessToken: string } }>('/auth/refresh');
        const newToken = response.data.data.accessToken;
        setAccessToken(newToken);
        processQueue(null, newToken);
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        setAccessToken(null);
        // Redirect to login — handled by AuthContext
        window.dispatchEvent(new CustomEvent('auth:logout'));
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    // For all non-401 errors (and 401s that are not retried), dispatch a toast event.
    // Skip network errors that have no response (handled by queryClient onError).
    // Skip refresh/login 401s — those are handled by AuthContext/LoginPage.
    if (error.response && !((isRefreshEndpoint || isLoginEndpoint) && error.response.status === 401)) {
      const data = error.response.data as { message?: string } | undefined;
      const message = data?.message ?? `Request failed (${error.response.status})`;
      window.dispatchEvent(new CustomEvent('api:error', { detail: { message } }));
    }

    return Promise.reject(error);
  },
);

export default api;
