import { QueryClient } from '@tanstack/react-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import api from './api';

// Part B Target Requirements:
// - staleTime: 60s for normal data
// - gcTime: 30 minutes
// - refetchOnWindowFocus: false
// - retry max 1
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 60 * 1000, // 60 seconds
      gcTime: 30 * 60 * 1000, // 30 minutes
      retry: (failureCount, error: any) => {
        const status = error?.response?.status;
        if ((status && status >= 400 && status < 500) || error?.name === 'CanceledError') {
          return false;
        }
        return failureCount < 1;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 4000)
    }
  }
});

// Configure 10-minute master/dropdown cache as required by PART B
const masterKeys = [
  'statuses',
  'modules',
  'banks',
  'departments',
  'products',
  'banking-partners',
  'users-dropdown',
  'all-modules',
  'tenant-settings'
];

masterKeys.forEach((key) => {
  queryClient.setQueryDefaults([key], {
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 60 * 60 * 1000, // 1 hour
  });
});

// LocalStorage Persister for Instant Offline/Returning Experience
export const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: 'INKCRM_QUERY_OFFLINE_CACHE',
  throttleTime: 1000,
});

// Clear cache helper (called on logout)
export const clearPersistedQueryCache = () => {
  try {
    localStorage.removeItem('INKCRM_QUERY_OFFLINE_CACHE');
    queryClient.clear();
  } catch (e) {
    console.warn('Failed to clear persisted query cache', e);
  }
};

// Prefetch master data helper (called after login / session init)
export const prefetchMasterData = async () => {
  try {
    queryClient.prefetchQuery({
      queryKey: ['statuses'],
      queryFn: async () => {
        const res = await api.get('/statuses');
        return res.data;
      },
      staleTime: 10 * 60 * 1000,
    });
    queryClient.prefetchQuery({
      queryKey: ['modules'],
      queryFn: async () => {
        const res = await api.get('/modules');
        return res.data;
      },
      staleTime: 10 * 60 * 1000,
    });
  } catch (e) {
    // Non-blocking prefetch failure
  }
};
