import React, { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api, { resolveFileUrl } from '../services/api';
import { useModuleStore } from '../store/moduleStore';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import { useToastStore } from '../store/toastStore';
import loginLogo from '../assets/login-logo.png';
import * as Icons from 'lucide-react';
import { getStatusTokens } from '../utils/statusTokenMapper';
import {
  SidebarItem,
  SidebarAccordion,
  SidebarGroup,
  SidebarProfile,
  cn
} from './layout/SidebarComponents';

// Dynamic Icon resolver
export const DynamicIcon = ({ name, className = 'w-4 h-4' }: { name: string; className?: string }) => {
  const IconComponent = (Icons as any)[name] || Icons.FileText;
  return <IconComponent className={className} strokeWidth={1.75} />;
};

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const { modules } = useModuleStore();
  const { user, logout, canAccessMenu } = useAuthStore();
  const { branding, fetchBranding } = useThemeStore();
  const { showToast } = useToastStore();

  // Mobile drawer open state
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  // Desktop sidebar collapsed state (persisted)
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('inkcrm_sidebar_collapsed') === 'true';
  });

  const toggleCollapsed = () => {
    setIsCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('inkcrm_sidebar_collapsed', String(next));
      return next;
    });
  };

  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('theme') === 'dark' || (localStorage.getItem('theme') === null && branding?.themeSettings?.mode === 'dark');
  });
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  // Global Command Palette (Ctrl/Cmd+K)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleGlobalSearch = async (val: string) => {
    setSearchQuery(val);
    if (!val.trim()) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const res = await api.get('/search', { params: { q: val } });
      setSearchResults(res.data || []);
    } catch (e) {
      console.error('Search error:', e);
    } finally {
      setIsSearching(false);
    }
  };

  // Keyboard shortcut for Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(prev => !prev);
      } else if (e.key === 'Escape') {
        setCommandPaletteOpen(false);
        setShowUserDropdown(false);
        setShowNotifications(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (commandPaletteOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else {
      setSearchQuery('');
      setSearchResults([]);
    }
  }, [commandPaletteOpen]);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [darkMode]);

  // Close mobile drawer on route navigation
  useEffect(() => {
    setMobileDrawerOpen(false);
    setShowUserDropdown(false);
    setShowNotifications(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!branding) {
      const cachedSub = localStorage.getItem('tenantSubdomain') || 'sales';
      fetchBranding(cachedSub);
    }
  }, [branding, fetchBranding]);

  // Lead metrics for sidebar badge
  const { data: metricsData } = useQuery({
    queryKey: ['dashboard-metrics-sidebar'],
    queryFn: async () => {
      const res = await api.get('/dashboard/metrics');
      return res.data;
    },
    staleTime: 60000,
    refetchInterval: (query) => (query.state.error ? false : 60000),
    refetchOnWindowFocus: false
  });

  // Notifications queries
  const { data: notificationsData } = useQuery({
    queryKey: ['user-notifications'],
    queryFn: async () => {
      const res = await api.get('/notifications', { params: { limit: 20 } });
      return res.data;
    },
    staleTime: 60000,
    refetchInterval: (query) => (query.state.error ? false : 60000),
    refetchOnWindowFocus: false,
    enabled: !!user
  });

  const { data: unreadData } = useQuery({
    queryKey: ['unread-notifications-count'],
    queryFn: async () => {
      const res = await api.get('/notifications/unread-count');
      return res.data;
    },
    staleTime: 60000,
    refetchInterval: (query) => (query.state.error ? false : 60000),
    refetchOnWindowFocus: false,
    enabled: !!user
  });

  // Dynamic configured statuses for Sidebar "Leads Process" submenu
  const { data: configuredStatuses = [] } = useQuery({
    queryKey: ['layout-configured-statuses'],
    queryFn: async () => {
      const res = await api.get('/statuses').catch(() => ({ data: [] }));
      return Array.isArray(res.data) ? res.data : [];
    },
    staleTime: 10 * 60 * 1000
  });

  const fallbackLeadStatuses = [
    { name: 'HOT LEADS', icon: 'Flame', color: '#EF4444' },
    { name: 'WARM LEADS', icon: 'Sun', color: '#F59E0B' },
    { name: 'CEBIL PENDING', icon: 'FileWarning', color: '#0284C7' },
    { name: 'DOCUMENT PENDING', icon: 'FileText', color: '#0D9488' },
    { name: 'APPROVAL PENDING', icon: 'Clock', color: '#F97316' },
    { name: 'APPROVED BUT NOT DISBUSE', icon: 'CheckCircle', color: '#10B981' },
    { name: 'DISBUSED', icon: 'Banknote', color: '#10B981' },
    { name: 'REJECTED', icon: 'XOctagon', color: '#F43F5E' },
    { name: 'FOLLOWUP', icon: 'PhoneCall', color: '#0284C7' },
    { name: 'DROPPED', icon: 'ArrowDownCircle', color: '#F43F5E' },
    { name: 'PENDING', icon: 'Hourglass', color: '#8B5CF6' }
  ];

  const leadStatusesToRender = (configuredStatuses && configuredStatuses.length > 0)
    ? configuredStatuses.filter((s: any) => s.dashboardVisibility !== false).sort((a: any, b: any) => (a.order || 0) - (b.order || 0))
    : fallbackLeadStatuses;

  const handleMarkAsRead = async (id: string, link?: string) => {
    try {
      await api.put(`/notifications/${id}/read`);
      await queryClient.invalidateQueries({ queryKey: ['user-notifications'] });
      await queryClient.invalidateQueries({ queryKey: ['unread-notifications-count'] });
      if (link) {
        setShowNotifications(false);
        navigate(link);
      }
    } catch (e) {
      console.error('Failed to mark notification read', e);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await api.put('/notifications/read-all');
      await queryClient.invalidateQueries({ queryKey: ['user-notifications'] });
      await queryClient.invalidateQueries({ queryKey: ['unread-notifications-count'] });
    } catch (e) {
      console.error('Failed to mark all read', e);
    }
  };

  const handleClearAllNotifications = async () => {
    try {
      await api.delete('/notifications/clear-all');
      await queryClient.invalidateQueries({ queryKey: ['user-notifications'] });
      await queryClient.invalidateQueries({ queryKey: ['unread-notifications-count'] });
    } catch (e) {
      console.error('Failed to clear notifications', e);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Derive Current Page Title & Breadcrumbs for consistent content header
  const pageMeta = (() => {
    const path = location.pathname;
    if (path === '/') return { title: 'Dashboard', breadcrumb: 'DASHBOARD' };
    if (path === '/modules/leads/new') return { title: 'Create Lead', breadcrumb: 'LEADS' };
    if (path === '/modules/leads') return { title: 'Leads Process', breadcrumb: 'LEADS' };
    if (path === '/modules/campaigns') return { title: 'Campaign List', breadcrumb: 'CAMPAIGNS' };
    if (path === '/modules/campaignassignments') return { title: 'Assign Campaign', breadcrumb: 'CAMPAIGNS' };
    if (path === '/my-campaign') return { title: 'My Campaign', breadcrumb: 'CAMPAIGNS' };
    if (path === '/reports/telecaller-reports') return { title: 'Live Caller Status', breadcrumb: 'REPORTS' };
    if (path === '/reports/lead-reports') return { title: 'Lead Reports', breadcrumb: 'REPORTS' };
    if (path === '/reports/campaign-daily') return { title: 'Daily Campaign Report', breadcrumb: 'REPORTS' };
    if (path === '/reports/campaign-monthly') return { title: 'Monthly Campaign Report', breadcrumb: 'REPORTS' };
    if (path === '/reports/campaign-annual') return { title: 'Annual Campaign Report', breadcrumb: 'REPORTS' };
    if (path === '/reports/funnel-daily') return { title: 'Daily Lead Funnel', breadcrumb: 'FUNNEL' };
    if (path === '/reports/funnel-monthly') return { title: 'Monthly Lead Funnel', breadcrumb: 'FUNNEL' };
    if (path === '/reports/funnel-annual') return { title: 'Annual Lead Funnel', breadcrumb: 'FUNNEL' };
    if (path === '/settings') return { title: 'Settings', breadcrumb: 'ADMINISTRATION' };
    if (path === '/access-privilege') return { title: 'Access Privilege', breadcrumb: 'SECURITY' };
    if (path === '/lead-transfer') return { title: 'Lead Transfer', breadcrumb: 'SECURITY' };
    if (path === '/lead-import-delete') return { title: 'Lead Import & Delete', breadcrumb: 'SECURITY' };
    if (path === '/users-management') return { title: 'Users Management', breadcrumb: 'ADMINISTRATION' };
    if (path === '/workflows') return { title: 'Workflows & Automation', breadcrumb: 'AUTOMATION' };
    if (path === '/status') return { title: 'Status Pipeline Stages', breadcrumb: 'SETTINGS' };
    if (path.startsWith('/modules/')) {
      const parts = path.split('/');
      const mod = modules.find(m => m.apiPath.toLowerCase() === parts[2]?.toLowerCase());
      if (parts[3] === 'new') return { title: `Create ${mod?.name || 'Record'}`, breadcrumb: mod?.name?.toUpperCase() || 'MODULE' };
      if (parts[3]) return { title: `Edit ${mod?.name || 'Record'}`, breadcrumb: mod?.name?.toUpperCase() || 'MODULE' };
      return { title: mod?.pluralLabel || mod?.name || 'Records', breadcrumb: 'MODULE' };
    }
    return { title: 'Workspace', breadcrumb: 'APP' };
  })();

  const renderNavItems = (collapsed: boolean) => (
    <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar px-2 py-3 space-y-1">
      {/* Group 1: Quick Actions */}
      <SidebarGroup title="QUICK ACTIONS" isCollapsed={collapsed}>
        {(!branding || !branding.enabledModules || branding.enabledModules.includes('leads')) && (
          <SidebarItem 
            to="/modules/leads/new" 
            label="Create Lead" 
            icon={Icons.UserPlus} 
            colorClass="text-status-info"
            isCollapsed={collapsed}
          />
        )}
        <SidebarItem 
          to="/my-campaign" 
          label="My Campaign" 
          icon={Icons.Megaphone} 
          colorClass="text-status-warm"
          isCollapsed={collapsed}
        />
      </SidebarGroup>

      {/* Group 2: Main Menu */}
      {(canAccessMenu('dashboard') ||
        canAccessMenu('leads') ||
        canAccessMenu('campaigns') ||
        canAccessMenu('lead_reports') ||
        canAccessMenu('funnel_daily')) && (
        <SidebarGroup title="MAIN MENU" isCollapsed={collapsed}>
          {canAccessMenu('dashboard') && (
            <SidebarItem 
              to="/" 
              label="Dashboard" 
              icon={Icons.LayoutDashboard} 
              isCollapsed={collapsed}
            />
          )}

          {canAccessMenu('leads') && (
            <SidebarAccordion 
              label="Leads Process" 
              icon={Icons.Layers} 
              defaultOpen={location.pathname.startsWith('/modules/leads')}
              isCollapsed={collapsed}
            >
              <SidebarItem 
                to="/modules/leads" 
                label="All Leads" 
                icon={Icons.Layers} 
                indent 
                badge={metricsData?.totalLeads ?? 0} 
                isCollapsed={collapsed}
              />
              <SidebarItem 
                to="/modules/leads?followup=today" 
                label="Today's Followup" 
                icon={Icons.Calendar} 
                indent 
                badge={metricsData?.todayFollowupsCount > 0 ? metricsData.todayFollowupsCount : undefined}
                isCollapsed={collapsed}
              />
              {leadStatusesToRender.map((st: any) => {
                const IconComp = (Icons as any)[st.icon] || Icons.Circle;
                const statusTokens = getStatusTokens(st);
                const upperName = (st.name || '').toUpperCase();
                const count = metricsData?.statusCounts?.[upperName] || metricsData?.statusCounts?.[st.name];
                return (
                  <SidebarItem 
                    key={st._id || st.name}
                    to={`/modules/leads?status=${encodeURIComponent(st.name)}`}
                    label={st.name} 
                    icon={IconComp} 
                    colorClass={statusTokens.iconTextClass}
                    indent 
                    badge={count > 0 ? count : undefined}
                    isCollapsed={collapsed}
                  />
                );
              })}
            </SidebarAccordion>
          )}

          {/* Campaigns accordion */}
          {(canAccessMenu('campaigns') || canAccessMenu('campaignassignments')) && (
            <SidebarAccordion 
              label="Campaigns" 
              icon={Icons.Megaphone} 
              defaultOpen={location.pathname.startsWith('/modules/campaign') || location.pathname.startsWith('/my-campaign')}
              isCollapsed={collapsed}
            >
              {canAccessMenu('campaigns') && (
                <SidebarItem 
                  to="/modules/campaigns" 
                  label="Campaign List" 
                  icon={Icons.Target} 
                  indent 
                  isCollapsed={collapsed} 
                />
              )}
              {canAccessMenu('campaignassignments') && (
                <SidebarItem 
                  to="/modules/campaignassignments" 
                  label="Assign Campaign" 
                  icon={Icons.UserCheck} 
                  indent 
                  isCollapsed={collapsed} 
                />
              )}
            </SidebarAccordion>
          )}

          {/* Dynamic tenant modules */}
          {modules.filter(m => {
            const hidden = ['departments', 'products', 'bankmasters', 'bankingpartners', 'companies', 'deals', 'campaigns', 'campaignassignments', 'leads'];
            if (hidden.includes(m.apiPath.toLowerCase())) return false;
            if (!canAccessMenu(m.apiPath.toLowerCase())) return false;
            return true;
          }).map(m => (
            <SidebarItem
              key={m._id}
              to={`/modules/${m.apiPath}`}
              label={m.pluralLabel || m.name}
              icon={(Icons as any)[m.icon] || Icons.FileText}
              isCollapsed={collapsed}
            />
          ))}

          {/* Reports Navigation */}
          {(canAccessMenu('lead_reports') || canAccessMenu('telecaller_reports') || canAccessMenu('telecaller_monthly')) && (
            <SidebarAccordion 
              label="Reports & Analytics" 
              icon={Icons.BarChart3} 
              defaultOpen={location.pathname.startsWith('/reports')}
              isCollapsed={collapsed}
            >
              <SidebarItem to="/reports/telecaller-reports" label="Live Caller Status" icon={Icons.Radio} colorClass="text-status-success" indent isCollapsed={collapsed} />
              <SidebarItem to="/reports/lead-reports" label="Lead Reports" icon={Icons.ListFilter} indent isCollapsed={collapsed} />
              <SidebarItem to="/reports/campaign-daily" label="Daily Campaign Report" icon={Icons.PhoneCall} indent isCollapsed={collapsed} />
              <SidebarItem to="/reports/campaign-monthly" label="Monthly Campaign Report" icon={Icons.Calendar} indent isCollapsed={collapsed} />
              <SidebarItem to="/reports/campaign-annual" label="Annual Campaign Report" icon={Icons.CalendarDays} indent isCollapsed={collapsed} />
            </SidebarAccordion>
          )}

          {/* Funnel Navigation */}
          {(canAccessMenu('funnel_daily') || canAccessMenu('funnel_monthly') || canAccessMenu('funnel_annual')) && (
            <SidebarAccordion label="Funnel Analysis" icon={Icons.Filter} isCollapsed={collapsed}>
              {canAccessMenu('funnel_daily') && (
                <SidebarItem to="/reports/funnel-daily" label="Daily Funnel" icon={Icons.CalendarRange} indent isCollapsed={collapsed} />
              )}
              {canAccessMenu('funnel_monthly') && (
                <SidebarItem to="/reports/funnel-monthly" label="Monthly Funnel" icon={Icons.CalendarDays} indent isCollapsed={collapsed} />
              )}
              {canAccessMenu('funnel_annual') && (
                <SidebarItem to="/reports/funnel-annual" label="Annual Funnel" icon={Icons.TrendingUp} indent isCollapsed={collapsed} />
              )}
            </SidebarAccordion>
          )}
        </SidebarGroup>
      )}

      {/* Group 3: Administration */}
      {(canAccessMenu('settings') || canAccessMenu('access_privilege') || canAccessMenu('lead_transfer') || canAccessMenu('lead_import_delete') || canAccessMenu('users_management')) && (
        <SidebarGroup title="ADMINISTRATION" isCollapsed={collapsed}>
          {canAccessMenu('settings') && (
            <SidebarItem to="/settings" label="Settings" icon={Icons.Settings} isCollapsed={collapsed} />
          )}

          {(canAccessMenu('access_privilege') || canAccessMenu('lead_transfer') || canAccessMenu('lead_import_delete')) && (
            <SidebarAccordion label="Security & Data" icon={Icons.ShieldCheck} colorClass="text-status-danger" isCollapsed={collapsed}>
              {canAccessMenu('access_privilege') && (
                <SidebarItem to="/access-privilege" label="Access Privilege" icon={Icons.ShieldCheck} indent isCollapsed={collapsed} />
              )}
              {canAccessMenu('lead_transfer') && (
                <SidebarItem to="/lead-transfer" label="Lead Transfer" icon={Icons.Send} indent isCollapsed={collapsed} />
              )}
              {canAccessMenu('lead_import_delete') && (
                <SidebarItem to="/lead-import-delete" label="Lead Import & Delete" icon={Icons.FileSpreadsheet} indent isCollapsed={collapsed} />
              )}
            </SidebarAccordion>
          )}

          {canAccessMenu('users_management') && (
            <SidebarItem to="/users-management" label="Users Management" icon={Icons.Users} isCollapsed={collapsed} />
          )}
        </SidebarGroup>
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-screen h-[100dvh] w-full overflow-hidden bg-surface-page text-content-primary">
      
      {/* =====================================================================
          1. SOLID BRAND 64PX APP BAR (LINEAR / STRIPE DASHBOARD HEADER)
          ===================================================================== */}
      <header className="h-16 bg-brand-dark text-white border-b border-white/10 px-4 sm:px-6 flex items-center justify-between z-30 select-none flex-shrink-0">
        
        {/* Left: Hamburger (mobile) + Client Logo + Tenant Name */}
        <div className="flex items-center gap-3 min-w-0">
          <button 
            type="button"
            onClick={() => setMobileDrawerOpen(true)}
            className="lg:hidden p-1.5 -ml-1 text-white/80 hover:text-white hover:bg-white/10 rounded-control transition-colors cursor-pointer"
            title="Open Mobile Navigation"
          >
            <Icons.Menu className="w-5 h-5 stroke-[1.75]" />
          </button>

          <Link to="/" className="flex items-center gap-3 group focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 rounded-control">
            <div className="w-9 h-9 rounded-control bg-white/10 p-1 flex items-center justify-center border border-white/15 flex-shrink-0 overflow-hidden shadow-xs">
              <img 
                src={resolveFileUrl(branding?.logoUrl) || loginLogo} 
                alt="Logo" 
                className="w-full h-full object-contain" 
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.onerror = null;
                  target.src = loginLogo;
                }}
              />
            </div>
            <div className="hidden sm:flex flex-col text-left">
              <span className="text-sm font-bold text-white tracking-tight leading-tight line-clamp-1">
                {branding?.name || 'INK CRM'}
              </span>
              <span className="text-[10px] font-medium text-white/60 tracking-wider uppercase">
                Loan & Lending CRM
              </span>
            </div>
          </Link>
        </div>

        {/* Center: ONE Global Search Bar with Cmd+K Command Palette Trigger */}
        <div className="flex-1 max-w-md mx-4 hidden md:block">
          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            className="w-full h-9 px-3.5 bg-white/10 hover:bg-white/15 border border-white/15 rounded-control text-xs text-white/70 flex items-center justify-between transition-all cursor-pointer shadow-xs group"
          >
            <div className="flex items-center gap-2.5">
              <Icons.Search className="w-4 h-4 text-white/50 group-hover:text-white/80 transition-colors stroke-[1.75]" />
              <span className="font-normal text-white/70">Search leads, deals, contacts, campaigns...</span>
            </div>
            <kbd className="px-1.5 py-0.5 rounded bg-white/15 text-[10px] font-semibold text-white/70 border border-white/20">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Right: Actions, Notifications, Theme Toggle & User Menu */}
        <div className="flex items-center gap-2 sm:gap-3">
          
          {/* Mobile Search Button */}
          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            className="md:hidden p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-control transition-colors"
            title="Search"
          >
            <Icons.Search className="w-5 h-5 stroke-[1.75]" />
          </button>

          {/* Notifications Popover Toggle */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowNotifications(!showNotifications);
                setShowUserDropdown(false);
              }}
              className="w-8.5 h-8.5 rounded-control bg-white/10 hover:bg-white/15 border border-white/15 flex items-center justify-center text-white/80 hover:text-white transition-colors relative cursor-pointer"
              title="Notifications"
            >
              <Icons.Bell className="w-4 h-4 stroke-[1.75]" />
              {(unreadData?.unreadCount || 0) > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-status-hot text-white text-[9px] font-bold rounded-full flex items-center justify-center border-2 border-brand-dark tabular-nums">
                  {unreadData.unreadCount > 9 ? '9+' : unreadData.unreadCount}
                </span>
              )}
            </button>

            {/* Notifications Popover */}
            <AnimatePresence>
              {showNotifications && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowNotifications(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.98 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 top-11 w-[calc(100vw-32px)] sm:w-88 max-w-sm bg-surface-card border border-border-subtle rounded-card shadow-raised p-4 z-50 text-left text-content-primary"
                  >
                    <div className="flex justify-between items-center pb-2.5 border-b border-border-subtle mb-3">
                      <div className="flex items-center gap-2">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-content-primary flex items-center gap-1.5">
                          <Icons.Bell className="w-3.5 h-3.5 text-status-warm stroke-[1.75]" /> Notifications
                        </h4>
                        {(unreadData?.unreadCount || 0) > 0 && (
                          <span className="text-[10px] bg-status-hot-bg text-status-hot-text px-2 py-0.5 rounded-full font-bold tabular-nums border border-status-hot-border">
                            {unreadData.unreadCount} New
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[10px]">
                        {(unreadData?.unreadCount || 0) > 0 && (
                          <button
                            type="button"
                            onClick={handleMarkAllAsRead}
                            className="text-brand hover:underline font-semibold cursor-pointer"
                          >
                            Mark all read
                          </button>
                        )}
                        {notificationsData && notificationsData.length > 0 && (
                          <button
                            type="button"
                            onClick={handleClearAllNotifications}
                            className="text-content-muted hover:text-status-danger font-medium cursor-pointer"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="space-y-1.5 max-h-72 overflow-y-auto custom-scrollbar pr-1">
                      {notificationsData && notificationsData.length > 0 ? (
                        notificationsData.map((item: any) => (
                          <div 
                            key={item._id} 
                            onClick={() => handleMarkAsRead(item._id, item.link)}
                            className={cn(
                              "flex gap-2.5 items-start p-2.5 rounded-control border transition-all cursor-pointer text-left",
                              !item.isRead
                                ? "bg-brand-50/50 dark:bg-slate-800/60 border-brand/20 hover:bg-brand-50 dark:hover:bg-slate-800"
                                : "bg-surface-card border-transparent hover:bg-surface-page"
                            )}
                          >
                            <div className="p-1 rounded bg-brand-500/10 text-brand-500 mt-0.5 flex-shrink-0">
                              <Icons.Sparkles className="w-3.5 h-3.5 stroke-[1.75]" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2 mb-0.5">
                                <p className={cn("text-xs font-semibold truncate", !item.isRead ? "text-content-primary" : "text-content-secondary")}>
                                  {item.title}
                                </p>
                                <span className="text-[10px] text-content-muted tabular-nums flex-shrink-0">
                                  {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              <p className="text-[11px] text-content-muted leading-snug line-clamp-2">
                                {item.message}
                              </p>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-6 text-content-muted text-xs space-y-2">
                          <Icons.BellOff className="w-6 h-6 mx-auto stroke-[1.5] text-content-muted/60" />
                          <p className="font-medium">No new notifications</p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>

          {/* Theme Toggle (Light / Dark) */}
          <button 
            type="button"
            onClick={() => setDarkMode(!darkMode)}
            className="w-8.5 h-8.5 rounded-control bg-white/10 hover:bg-white/15 border border-white/15 flex items-center justify-center text-white/80 hover:text-white transition-colors cursor-pointer"
            title={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            {darkMode ? (
              <Icons.Sun className="w-4 h-4 text-amber-300 stroke-[1.75]" />
            ) : (
              <Icons.Moon className="w-4 h-4 text-white/80 stroke-[1.75]" />
            )}
          </button>

          {/* User Profile Menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowUserDropdown(!showUserDropdown);
                setShowNotifications(false);
              }}
              className="flex items-center gap-2 p-1 pl-1.5 pr-2 rounded-control bg-white/10 hover:bg-white/15 border border-white/15 transition-colors cursor-pointer"
            >
              <div className="w-7 h-7 rounded-full bg-brand-500 text-brand-contrast font-bold text-xs flex items-center justify-center shadow-xs">
                {user ? `${user.firstName?.charAt(0) || ''}${user.lastName?.charAt(0) || ''}`.toUpperCase() || 'AD' : 'AD'}
              </div>
              <span className="hidden sm:inline text-xs font-semibold text-white truncate max-w-[120px]">
                {user?.firstName || 'Admin'}
              </span>
              <Icons.ChevronDown className="w-3.5 h-3.5 text-white/60 stroke-[2]" />
            </button>

            {/* User Dropdown Popover */}
            <AnimatePresence>
              {showUserDropdown && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowUserDropdown(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.98 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 top-11 w-56 bg-surface-card border border-border-subtle rounded-card shadow-raised py-2 z-50 text-left text-content-primary"
                  >
                    <div className="px-3.5 py-2 border-b border-border-subtle mb-1">
                      <p className="text-[10px] font-bold text-content-muted uppercase tracking-wider">Signed in as</p>
                      <p className="text-xs font-semibold text-content-primary truncate mt-0.5">{user?.email || 'admin@crm.com'}</p>
                    </div>

                    <Link
                      to="/settings"
                      onClick={() => setShowUserDropdown(false)}
                      className="w-full px-3.5 py-2 text-xs font-medium text-content-secondary hover:text-content-primary hover:bg-surface-page transition-colors flex items-center gap-2.5"
                    >
                      <Icons.Settings className="w-4 h-4 stroke-[1.75] text-content-muted" />
                      Settings & Preferences
                    </Link>

                    <button
                      type="button"
                      onClick={() => {
                        setShowUserDropdown(false);
                        handleLogout();
                      }}
                      className="w-full px-3.5 py-2 text-xs font-semibold text-status-danger hover:bg-status-danger-bg transition-colors flex items-center gap-2.5 border-t border-border-subtle mt-1 pt-2 cursor-pointer"
                    >
                      <Icons.LogOut className="w-4 h-4 stroke-[1.75]" />
                      Sign Out
                    </button>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {/* =====================================================================
          2. APP SHELL BODY: SIDEBAR + CONTENT
          ===================================================================== */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        
        {/* Desktop Sidebar (Collapsible 248px -> 72px) */}
        <aside
          className={cn(
            "hidden lg:flex flex-col bg-surface-card border-r border-border-subtle flex-shrink-0 transition-all duration-200 select-none",
            isCollapsed ? "w-[72px]" : "w-[248px]"
          )}
        >
          {/* Top Collapse Toggle Header */}
          <div className="h-11 px-3 border-b border-border-subtle flex items-center justify-between flex-shrink-0 bg-surface-card">
            {!isCollapsed && (
              <span className="text-[11px] font-bold uppercase tracking-wider text-content-muted">
                Navigation
              </span>
            )}
            <button
              type="button"
              onClick={toggleCollapsed}
              className={cn(
                "p-1.5 text-content-muted hover:text-content-primary hover:bg-surface-page rounded-control transition-colors cursor-pointer",
                isCollapsed && "mx-auto"
              )}
              title={isCollapsed ? "Expand Sidebar (248px)" : "Collapse to Rail (72px)"}
            >
              {isCollapsed ? (
                <Icons.PanelLeftOpen className="w-4 h-4 stroke-[1.75]" />
              ) : (
                <Icons.PanelLeftClose className="w-4 h-4 stroke-[1.75]" />
              )}
            </button>
          </div>

          {/* Navigation Items */}
          {renderNavItems(isCollapsed)}

          {/* Profile Section Footer */}
          <SidebarProfile isCollapsed={isCollapsed} />
        </aside>

        {/* Mobile Slide-Over Drawer */}
        <AnimatePresence>
          {mobileDrawerOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setMobileDrawerOpen(false)}
                className="fixed inset-0 bg-surface-overlay/50 backdrop-blur-xs z-40 lg:hidden"
              />
              <motion.aside
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="fixed inset-y-0 left-0 w-72 bg-surface-card border-r border-border-subtle z-50 flex flex-col lg:hidden"
              >
                <div className="h-16 px-4 border-b border-border-subtle flex items-center justify-between bg-brand-dark text-white">
                  <div className="flex items-center gap-2.5">
                    <img src={resolveFileUrl(branding?.logoUrl) || loginLogo} alt="Logo" className="w-8 h-8 object-contain" />
                    <span className="text-sm font-bold truncate text-white">{branding?.name || 'INK CRM'}</span>
                  </div>
                  <button 
                    type="button" 
                    onClick={() => setMobileDrawerOpen(false)}
                    className="p-1.5 text-white/80 hover:text-white rounded-control"
                  >
                    <Icons.X className="w-5 h-5" />
                  </button>
                </div>
                {renderNavItems(false)}
                <SidebarProfile isCollapsed={false} />
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {/* Main Content Area */}
        <main className="flex-1 min-w-0 min-h-0 overflow-y-auto custom-scrollbar flex flex-col bg-surface-page">
          
          {/* Consistent Page Header Bar (Hidden on Dashboard to eliminate duplicate header and save vertical space) */}
          {location.pathname !== '/' && (
            <div className="sticky top-0 z-20 bg-surface-page/95 backdrop-blur-xs border-b border-border-subtle px-4 sm:px-6 md:px-8 py-3.5 flex items-center justify-between gap-4 transition-colors">
              <div className="flex flex-col text-left min-w-0">
                <div className="flex items-center gap-2 text-[11px] font-semibold text-content-muted tracking-wider uppercase mb-0.5">
                  <span>{pageMeta.breadcrumb}</span>
                </div>
                <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-content-primary tracking-tight leading-tight truncate">
                  {pageMeta.title}
                </h1>
              </div>

              {/* Primary Action Button (Add Lead or Contextual) */}
              <div className="flex items-center gap-2.5 flex-shrink-0">
                {location.pathname !== '/modules/leads/new' && (
                  <Link
                    to="/modules/leads/new"
                    className="inline-flex items-center gap-2 h-9 px-3.5 bg-brand-500 hover:bg-brand-600 text-brand-contrast text-xs font-semibold rounded-control shadow-xs hover:shadow-card transition-all cursor-pointer"
                  >
                    <Icons.Plus className="w-4.5 h-4.5 stroke-[2.5]" />
                    <span>Create Lead</span>
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* Page Body Viewport Container */}
          <div className={cn(
            "flex-1 max-w-[1600px] w-full mx-auto",
            location.pathname === '/' ? "px-3 sm:px-6 pt-2 pb-6" : "p-4 sm:p-6 md:p-8"
          )}>
            {children}
          </div>
        </main>
      </div>

      {/* =====================================================================
          3. COMMAND PALETTE MODAL (Ctrl/Cmd+K)
          ===================================================================== */}
      <AnimatePresence>
        {commandPaletteOpen && (
          <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setCommandPaletteOpen(false)}
              className="fixed inset-0 bg-surface-overlay/60 backdrop-blur-xs"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -10 }}
              transition={{ duration: 0.15 }}
              className="relative w-full max-w-xl bg-surface-card border border-border-subtle rounded-overlay shadow-overlay overflow-hidden z-50 text-left text-content-primary"
            >
              {/* Search Bar Input */}
              <div className="p-3.5 border-b border-border-subtle flex items-center gap-3">
                <Icons.Search className="w-5 h-5 text-content-muted flex-shrink-0 stroke-[1.75]" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleGlobalSearch(e.target.value)}
                  placeholder="Type a command or search leads, deals, contacts..."
                  className="w-full bg-transparent text-sm font-medium text-content-primary placeholder:text-content-muted focus:outline-none"
                />
                <kbd className="px-2 py-0.5 bg-surface-page text-[10px] font-semibold text-content-muted rounded border border-border-subtle">
                  ESC
                </kbd>
              </div>

              {/* Palette Results or Default Shortcuts */}
              <div className="max-h-80 overflow-y-auto custom-scrollbar p-2 space-y-1">
                {isSearching ? (
                  <div className="p-6 text-center text-xs text-content-muted">Searching...</div>
                ) : searchResults.length > 0 ? (
                  searchResults.map((res: any, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setCommandPaletteOpen(false);
                        navigate(`/modules/${res.modulePath || 'leads'}/${res._id || res.id}`);
                      }}
                      className="w-full px-3 py-2 rounded-control text-xs flex items-center justify-between hover:bg-brand-50 dark:hover:bg-slate-800 text-left transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <Icons.FileText className="w-4 h-4 text-brand-500 flex-shrink-0" />
                        <span className="font-semibold text-content-primary truncate">{res.title || res.name || res.fullName || 'Record'}</span>
                        <span className="text-[10px] font-medium text-content-muted uppercase tracking-wider">{res.moduleName || 'Lead'}</span>
                      </div>
                      <Icons.ChevronRight className="w-3.5 h-3.5 text-content-muted flex-shrink-0" />
                    </button>
                  ))
                ) : (
                  <div className="p-2 space-y-1">
                    <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-content-muted">
                      Quick Shortcuts
                    </p>
                    {[
                      { label: 'Go to Dashboard Overview', to: '/', icon: Icons.LayoutDashboard },
                      { label: 'Create New Lead', to: '/modules/leads/new', icon: Icons.UserPlus },
                      { label: 'View Leads Process', to: '/modules/leads', icon: Icons.Layers },
                      { label: 'Open My Campaign calling desk', to: '/my-campaign', icon: Icons.Megaphone },
                      { label: 'View Live Caller Status', to: '/reports/telecaller-reports', icon: Icons.Radio },
                      { label: 'Open System Settings', to: '/settings', icon: Icons.Settings },
                    ].map((item, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setCommandPaletteOpen(false);
                          navigate(item.to);
                        }}
                        className="w-full px-3 py-2 rounded-control text-xs flex items-center justify-between hover:bg-brand-50/60 dark:hover:bg-slate-800/60 text-left transition-colors cursor-pointer group"
                      >
                        <div className="flex items-center gap-2.5">
                          <item.icon className="w-4 h-4 text-content-muted group-hover:text-brand-500 transition-colors stroke-[1.75]" />
                          <span className="font-medium text-content-primary">{item.label}</span>
                        </div>
                        <Icons.CornerDownLeft className="w-3.5 h-3.5 text-content-muted/60 group-hover:text-content-primary transition-colors" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
