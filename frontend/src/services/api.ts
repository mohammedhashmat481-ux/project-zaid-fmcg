import axios from 'axios';

const getApiBaseUrl = (): string => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    // When accessed from a remote host without explicit VITE_API_URL, use same host with backend port 5000 or relative /api/v1
    return `${window.location.protocol}//${window.location.hostname}:5000/api/v1`;
  }
  return 'http://localhost:5000/api/v1';
};

const API_BASE_URL = getApiBaseUrl();

export const getFileBaseUrl = (): string => {
  if (import.meta.env.VITE_FILE_BASE_URL) {
    return import.meta.env.VITE_FILE_BASE_URL.replace(/\/+$/, '');
  }
  try {
    const parsed = new URL(API_BASE_URL, typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5000');
    return parsed.origin;
  } catch (e) {
    return typeof window !== 'undefined' ? window.location.origin : '';
  }
};

export const FILE_BASE_URL = getFileBaseUrl();

export const resolveFileUrl = (url?: string | null): string => {
  if (!url || typeof url !== 'string') return '';
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;

  // Always strip accidental localhost:5000 or 127.0.0.1:5000 prefixes
  const clean = url.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i, '');

  if (clean.startsWith('http://') || clean.startsWith('https://')) {
    return clean;
  }

  const normalized = clean.startsWith('/') ? clean : `/${clean}`;
  const base = getFileBaseUrl();
  return base ? `${base}${normalized}` : normalized;
};

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Request Interceptor: Attach JWT token and Tenant ID
api.interceptors.request.use(
  (config) => {
    // 1. Inject access token
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // 2. Inject tenant ID context
    const tenantId = localStorage.getItem('tenantId');
    if (tenantId && tenantId !== 'undefined' && tenantId !== 'null') {
      config.headers['x-tenant-id'] = tenantId;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor: Handle Token Expiration (MFA or 401)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const refreshToken = localStorage.getItem('refreshToken');
        if (refreshToken) {
          // Attempt refresh
          const res = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
          const newToken = res.data.token;

          localStorage.setItem('token', newToken);
          originalRequest.headers.Authorization = `Bearer ${newToken}`;

          return api(originalRequest);
        } else {
          // No refresh token, clear credentials and redirect to login
          localStorage.removeItem('token');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('user');
          localStorage.removeItem('tenantId');
          if (window.location.pathname !== '/login') {
            window.location.href = '/login';
          }
        }
      } catch (refreshError) {
        // Refresh token failed, clear state & logout
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
        localStorage.removeItem('tenantId');
        if (window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
      }
    } else if (
      error.response?.status === 404 && originalRequest.url?.includes('/auth/')
    ) {
      // User/role/tenant context invalid — log out
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
      localStorage.removeItem('tenantId');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  }
);

export default api;
export { API_BASE_URL };
