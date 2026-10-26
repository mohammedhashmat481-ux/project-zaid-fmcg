import { create } from 'zustand';
import api from '../services/api';
import { applyBrandScaleToDOM } from '../utils/themeGenerator';

// Apply brand scale immediately on script load to eliminate any styling flash
if (typeof document !== 'undefined') {
  applyBrandScaleToDOM();
}

export interface ThemeSettings {
  primaryColor: string; // RGB triplet e.g. "79 70 229"
  sidebarBg: string;
  headerBg: string;
  fontFamily: string;
  mode: 'light' | 'dark' | 'system';
}

interface TenantBranding {
  id: string;
  name: string;
  subdomain: string;
  logoUrl?: string;
  faviconUrl?: string;
  loginBgUrl?: string;
  themeSettings: ThemeSettings;
  enabledModules: string[];

  // Extended fields
  companyCode?: string;
  registrationId?: string;
  startDate?: string;
  endDate?: string;
  companyDocUrl?: string;
  phoneNumber?: string;
  mobile?: string;
  email?: string;
  fax?: string;
  website?: string;
  currency?: string;

  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;

  adminDetails?: {
    firstName?: string;
    lastName?: string;
    username?: string;
    password?: string;
    financialYear?: string;
    roleType?: string;
  };
}

interface ThemeState {
  branding: TenantBranding | null;
  loadingBranding: boolean;
  fetchBranding: (subdomain?: string, tenantId?: string) => Promise<TenantBranding | null>;
  applyTheme: (settings: ThemeSettings) => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  branding: null,
  loadingBranding: false,

  fetchBranding: async (subdomain, tenantId) => {
    set({ loadingBranding: true });
    try {
      const params: Record<string, string> = {};
      if (subdomain) params.subdomain = subdomain;
      
      const headers: Record<string, string> = {};
      if (tenantId) headers['x-tenant-id'] = tenantId;

      const res = await api.get('/tenants/branding', { params, headers });
      const branding = res.data;

      set({ branding, loadingBranding: false });
      
      // Save branding details
      localStorage.setItem('tenantId', branding.id);
      localStorage.setItem('tenantSubdomain', branding.subdomain);
      
      get().applyTheme(branding.themeSettings);
      return branding;
    } catch (err) {
      console.error('Failed to load branding:', err);
      set({ loadingBranding: false });
      return null;
    }
  },

  applyTheme: (settings) => {
    const s = settings || {};
    const root = document.documentElement;
    const sidebarBg = s.sidebarBg || '#FFFFFF';
    
    // Apply full brand scale & WCAG contrast tokens dynamically
    applyBrandScaleToDOM(s.primaryColor);

    // Apply CSS Variables
    root.style.setProperty('--color-primary', s.primaryColor || '2 132 199');
    root.style.setProperty('--sidebar-bg', sidebarBg);
    root.style.setProperty('--header-bg', s.headerBg || '#0B132B');
    root.style.setProperty('--font-family', `'Plus Jakarta Sans', '${s.fontFamily || 'Inter'}', -apple-system, BlinkMacSystemFont, sans-serif`);

    // Detect brightness of sidebarBg
    const hex = sidebarBg.replace('#', '');
    let isLight = false;
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      isLight = ((r * 299) + (g * 587) + (b * 114)) / 1000 >= 128;
    } else if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      isLight = ((r * 299) + (g * 587) + (b * 114)) / 1000 >= 128;
    }

    if (isLight) {
      root.style.setProperty('--sidebar-text', '#18181b');
      root.style.setProperty('--sidebar-text-muted', '#52525b');
      root.style.setProperty('--sidebar-text-muted-more', '#8c8c93');
      root.style.setProperty('--sidebar-border', 'rgba(0, 0, 0, 0.06)');
      root.style.setProperty('--sidebar-hover', 'rgba(0, 0, 0, 0.03)');
      root.style.setProperty('--sidebar-active-bg', 'rgba(0, 0, 0, 0.05)');
      root.style.setProperty('--sidebar-indicator', '#4f46e5');
    } else {
      root.style.setProperty('--sidebar-text', '#ffffff');
      root.style.setProperty('--sidebar-text-muted', 'rgba(255, 255, 255, 0.65)');
      root.style.setProperty('--sidebar-text-muted-more', 'rgba(255, 255, 255, 0.45)');
      root.style.setProperty('--sidebar-border', 'rgba(255, 255, 255, 0.08)');
      root.style.setProperty('--sidebar-hover', 'rgba(255, 255, 255, 0.04)');
      root.style.setProperty('--sidebar-active-bg', 'rgba(255, 255, 255, 0.08)');
      root.style.setProperty('--sidebar-indicator', '#ffffff');
    }

    // Apply dark/light class based on user override or branding defaults
    const isDark = localStorage.getItem('theme') === 'dark' || (localStorage.getItem('theme') === null && s.mode === 'dark');
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }
}));
