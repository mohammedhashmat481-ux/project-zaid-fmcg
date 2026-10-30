import React from 'react';
import ReactDOM from 'react-dom/client';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { queryClient, persister, prefetchMasterData } from './services/queryClient';
import App from './App';
import './index.css';
import { useThemeStore } from './store/themeStore';
import { useAuthStore } from './store/authStore';
import { useToastStore } from './store/toastStore';

// Override native window.alert to use premium custom modal alerts
window.alert = (message: any) => {
  const msgStr = message ? String(message) : '';
  const msgLower = msgStr.toLowerCase();
  let type: 'success' | 'error' | 'info' | 'warning' = 'info';
  let title = 'Information';
  if (
    msgLower.includes('success') ||
    msgLower.includes('successfully') ||
    msgLower.includes('created') ||
    msgLower.includes('saved') ||
    msgLower.includes('added')
  ) {
    type = 'success';
    title = 'Successful';
  } else if (
    msgLower.includes('fail') ||
    msgLower.includes('failed') ||
    msgLower.includes('error') ||
    msgLower.includes('denied')
  ) {
    type = 'error';
    title = 'Action Required';
  } else if (
    msgLower.includes('warning') ||
    msgLower.includes('invalid') ||
    msgLower.includes('required') ||
    msgLower.includes('select')
  ) {
    type = 'warning';
    title = 'Attention';
  }
  useToastStore.getState().showAlertModal({
    title,
    message: msgStr,
    type
  });
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
  await useAuthStore.getState().initialize();

  // If user is already authenticated, prefetch master data in background
  if (useAuthStore.getState().isAuthenticated) {
    prefetchMasterData();
  }
};

bootstrap().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: 1000 * 60 * 60 * 24, // 24 hours
          dehydrateOptions: {
            shouldDehydrateQuery: (query) => {
              // Never persist sensitive queries, mutations, or error states
              const queryKey = query.queryKey[0];
              if (
                typeof queryKey === 'string' &&
                (queryKey.includes('auth') || queryKey.includes('token') || queryKey.includes('password'))
              ) {
                return false;
              }
              return query.state.status === 'success';
            }
          }
        }}
      >
        <App />
      </PersistQueryClientProvider>
    </React.StrictMode>
  );
});
