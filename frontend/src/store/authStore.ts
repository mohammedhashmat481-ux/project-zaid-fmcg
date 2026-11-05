import { create } from 'zustand';
import api from '../services/api';

export interface ModulePermission {
  moduleName: string;
  create: boolean;
  read: 'all' | 'own' | 'none';
  update: 'all' | 'own' | 'none';
  delete: 'all' | 'own' | 'none';
}

export interface UserRole {
  _id: string;
  name: string;
  description?: string;
  isSystem?: boolean;
  permissions?: {
    modules?: ModulePermission[];
    menus?: string[];
    fields?: any[];
  };
}

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  roleId: string | UserRole;
  organizationId: string;
}

interface AuthState {
  user: User | null;
  role: UserRole | null;
  token: string | null;
  isAuthenticated: boolean;
  isInitializing: boolean;
  setAuth: (user: User, token: string, refreshToken?: string) => void;
  setRole: (role: UserRole) => void;
  fetchProfile: () => Promise<void>;
  logout: () => Promise<void>;
  initialize: () => void;
  canAccessMenu: (menuKey: string) => boolean;
  canAccessModule: (moduleName: string, action?: 'create' | 'read' | 'update' | 'delete') => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  role: null,
  token: null,
  isAuthenticated: false,
  isInitializing: true,

  setAuth: (user, token, refreshToken) => {
    localStorage.setItem('token', token);
    if (refreshToken) {
      localStorage.setItem('refreshToken', refreshToken);
    }
    localStorage.setItem('tenantId', user.organizationId);
    localStorage.setItem('user', JSON.stringify(user));
    set({ user, token, isAuthenticated: true, isInitializing: false });
    // Fetch full role details in background
    get().fetchProfile();
    // Prefetch master data right after login
    import('../services/queryClient').then((m) => m.prefetchMasterData()).catch(() => {});
  },

  setRole: (role) => {
    if (role) {
      localStorage.setItem('role', JSON.stringify(role));
    } else {
      localStorage.removeItem('role');
    }
    set({ role });
  },

  fetchProfile: async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await api.get('/auth/me');
      if (res.data?.role) {
        localStorage.setItem('role', JSON.stringify(res.data.role));
        set({ role: res.data.role });
      }
      if (res.data?.user) {
        const updatedUser: User = {
          id: res.data.user._id || res.data.user.id,
          firstName: res.data.user.firstName,
          lastName: res.data.user.lastName,
          email: res.data.user.email,
          roleId: res.data.user.roleId,
          organizationId: res.data.user.organizationId
        };
        localStorage.setItem('user', JSON.stringify(updatedUser));
        set({ user: updatedUser });
      }
    } catch (err) {
      console.warn('Failed to load user profile & permissions:', err);
    }
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } catch (e) {
      // Ignore network errors on logout
    } finally {
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
      localStorage.removeItem('role');
      localStorage.removeItem('INKCRM_QUERY_OFFLINE_CACHE');
      import('../services/queryClient').then((m) => m.clearPersistedQueryCache()).catch(() => {});
      set({ user: null, role: null, token: null, isAuthenticated: false });
    }
  },

  initialize: async () => {
    const token = localStorage.getItem('token');
    const tenantId = localStorage.getItem('tenantId');
    const userStr = localStorage.getItem('user');
    const roleStr = localStorage.getItem('role');

    if (token && tenantId && userStr) {
      try {
        const user = JSON.parse(userStr);
        const role = roleStr ? JSON.parse(roleStr) : null;
        set({ user, role, token, isAuthenticated: true, isInitializing: false });
        get().fetchProfile();
      } catch (e) {
        set({ isInitializing: false });
      }
    } else {
      set({ isInitializing: false });
    }
  },

  canAccessMenu: (menuKey: string) => {
    const state = get();
    const normalizedKey = (menuKey || '').toLowerCase().replace(/[-_\s]/g, '');

    const role = state.role;
    if (!role) {
      // If role not yet loaded, allow during initial render
      return true;
    }

    const roleName = (role.name || '').toLowerCase();
    const isSuperAdmin = roleName.includes('super admin') || roleName === 'main admin' || roleName === 'admin';

    // Super Admin has full administrative access to all menus
    if (isSuperAdmin) {
      return true;
    }

    const allowedMenus = role.permissions?.menus;
    // If no explicit menu list is defined on role (undefined/null), default to true
    if (!Array.isArray(allowedMenus)) {
      return true;
    }

    // Exact matching between menuKey and allowedMenus
    const normalizedAllowed = allowedMenus.map((m: string) => (m || '').toLowerCase().replace(/[-_\s]/g, ''));
    if (normalizedAllowed.includes(normalizedKey)) return true;

    // Strict explicit alias matching (no generic broad substring includes!)
    const exactAliases: Record<string, string[]> = {
      dashboard: ['dashboard'],
      leads: ['leads', 'leadsprocess', 'allleads'],
      leadsprocess: ['leads', 'leadsprocess', 'allleads'],
      campaigns: ['campaigns', 'campaignlist'],
      campaignlist: ['campaigns', 'campaignlist'],
      campaignassignments: ['campaignassignments', 'assigncampaign'],
      assigncampaign: ['campaignassignments', 'assigncampaign'],
      telecaller_reports: ['telecaller_reports', 'telecallerreports', 'livecallerstatus'],
      telecallerreports: ['telecaller_reports', 'telecallerreports', 'livecallerstatus'],
      lead_reports: ['lead_reports', 'leadreports'],
      leadreports: ['lead_reports', 'leadreports'],
      campaign_daily: ['campaign_daily', 'campaigndaily', 'dailyreport'],
      campaigndaily: ['campaign_daily', 'campaigndaily', 'dailyreport'],
      campaign_monthly: ['campaign_monthly', 'campaignmonthly', 'monthlyreport'],
      campaignmonthly: ['campaign_monthly', 'campaignmonthly', 'monthlyreport'],
      campaign_annual: ['campaign_annual', 'campaignannual', 'annualreport'],
      campaignannual: ['campaign_annual', 'campaignannual', 'annualreport'],
      funnel_daily: ['funnel_daily', 'funneldaily', 'dailyfunnel'],
      funneldaily: ['funnel_daily', 'funneldaily', 'dailyfunnel'],
      funnel_monthly: ['funnel_monthly', 'funnelmonthly', 'monthlyfunnel'],
      funnelmonthly: ['funnel_monthly', 'funnelmonthly', 'monthlyfunnel'],
      funnel_annual: ['funnel_annual', 'funnelannual', 'annualfunnel'],
      funnelannual: ['funnel_annual', 'funnelannual', 'annualfunnel'],
      settings: ['settings'],
      access_privilege: ['access_privilege', 'accessprivilege', 'security'],
      accessprivilege: ['access_privilege', 'accessprivilege', 'security'],
      lead_transfer: ['lead_transfer', 'leadtransfer'],
      leadtransfer: ['lead_transfer', 'leadtransfer'],
      lead_import_delete: ['lead_import_delete', 'leadimportdelete'],
      leadimportdelete: ['lead_import_delete', 'leadimportdelete'],
      users_management: ['users_management', 'usersmanagement', 'users'],
      usersmanagement: ['users_management', 'usersmanagement', 'users'],
      mycampaign: ['mycampaign', 'my_campaign', 'campaigns']
    };

    const targetAliases = exactAliases[normalizedKey] || [normalizedKey];
    return targetAliases.some(alias => normalizedAllowed.includes(alias.replace(/[-_\s]/g, '')));
  },

  canAccessModule: (moduleName: string, action: 'create' | 'read' | 'update' | 'delete' = 'read') => {
    const state = get();
    const role = state.role;
    if (!role) return true;

    const roleName = (role.name || '').toLowerCase();
    if (roleName.includes('super admin') || roleName === 'main admin' || roleName === 'admin') return true;

    const modules = role.permissions?.modules;
    if (!Array.isArray(modules) || modules.length === 0) return true;

    const mod = modules.find(
      (m) => m.moduleName.toLowerCase() === moduleName.toLowerCase()
    );
    if (!mod) {
      // If module is not in the permissions list, check if user has access via menus
      return get().canAccessMenu(moduleName);
    }

    if (action === 'create') return mod.create !== false;
    if (action === 'read') return mod.read !== 'none';
    if (action === 'update') return mod.update !== 'none';
    if (action === 'delete') return mod.delete !== 'none';

    return true;
  }
}));
