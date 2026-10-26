import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';
import { useThemeStore } from './store/themeStore';
import { useAuthStore } from './store/authStore';
import { useToastStore } from './store/toastStore';

// Override native window.alert to use premium custom toast notifications
window.alert = (message: any) => {
  const msgStr = message ? String(message) : '';
  const msgLower = msgStr.toLowerCase();
  let type: 'success' | 'error' | 'info' | 'warning' = 'info';
  if (
    msgLower.includes('success') ||
    msgLower.includes('successfully') ||
    msgLower.includes('created') ||
    msgLower.includes('saved') ||
    msgLower.includes('added')
  ) {
    type = 'success';
  } else if (
    msgLower.includes('fail') ||
    msgLower.includes('failed') ||
    msgLower.includes('error') ||
    msgLower.includes('denied')
  ) {
    type = 'error';
  } else if (
    msgLower.includes('warning') ||
    msgLower.includes('invalid') ||
    msgLower.includes('required') ||
    msgLower.includes('select')
  ) {
    type = 'warning';
  }
  useToastStore.getState().showToast(msgStr, type);
};

// Override native window.confirm to prevent Chrome default popups
window.confirm = (message?: string): boolean => {
  useToastStore.getState().showConfirm({
    title: 'Confirmation',
    message: message || 'Are you sure you want to proceed?',
    onConfirm: () => {}
  });
  return true;
};

// Create React Query Client with strict limits and exponential backoff
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30000,
      gcTime: 1000 * 60 * 10,
      retry: (failureCount, error: any) => {
        // Never retry on client errors (4xx) or canceled requests
        const status = error?.response?.status;
        if ((status && status >= 400 && status < 500) || error?.name === 'CanceledError') {
          return false;
        }
        // Strict limit: maximum 1 retry to prevent 100+ error cascading loops
        return failureCount < 1;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 4000)
    }
  }
});

// Bootstrapper: Load White-Label settings before mounting App
const bootstrap = async () => {
  const host = window.location.host;
  const parts = host.split('.');
  
  let subdomain = '';
  // Check if we are running on a subdomain, e.g. sales.localhost:5173
  if (parts.length > 1 && parts[0] !== 'www' && parts[0] !== 'localhost') {
    subdomain = parts[0].toLowerCase();
  }

  // Load from local storage fallback if no subdomain
  const cachedSubdomain = localStorage.getItem('tenantSubdomain') || 'sales';
  
  // Fetch theme specifications
  await useThemeStore.getState().fetchBranding(subdomain || cachedSubdomain);
  
  // Initialize Auth user session
  useAuthStore.getState().initialize();
};

bootstrap().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>
  );
});
