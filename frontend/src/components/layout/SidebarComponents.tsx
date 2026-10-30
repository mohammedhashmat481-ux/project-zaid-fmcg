import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, LogOut, FileText } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useAuthStore } from '../../store/authStore';
import { useNavigate } from 'react-router-dom';
import { queryClient } from '../../services/queryClient';
import api from '../../services/api';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ---------------------------------------------------------
// PURE ENTERPRISE SIDEBAR ICON (Lucide 18px / 1.75 stroke)
// ---------------------------------------------------------
export const SidebarIcon = ({ 
  icon: Icon, 
  colorClass, 
  active 
}: { 
  icon: any; 
  colorClass?: string; 
  active?: boolean;
}) => {
  const FallbackIcon = FileText;
  const SafeIcon = Icon || FallbackIcon;

  return (
    <SafeIcon
      className={cn(
        "w-[18px] h-[18px] flex-shrink-0 transition-colors duration-150",
        active 
          ? "text-brand-contrast" 
          : (colorClass || "text-content-muted group-hover:text-content-primary")
      )}
      strokeWidth={1.75}
    />
  );
};

// ---------------------------------------------------------
// PURE ENTERPRISE SIDEBAR ITEM
// ---------------------------------------------------------
export const SidebarItem = ({
  to,
  label,
  icon,
  colorClass,
  onClick,
  indent = false,
  badge,
  isCollapsed = false
}: {
  to: string;
  label: string;
  icon: any;
  colorClass?: string;
  onClick?: () => void;
  indent?: boolean;
  badge?: number;
  isCollapsed?: boolean;
}) => {
  const location = useLocation();
  const isActive =
    location.pathname + location.search === to ||
    (to !== '/' && location.pathname.startsWith(to.split('?')[0]) && (location.search === (to.includes('?') ? '?' + to.split('?')[1] : '') || !to.includes('?')));

  const handlePrefetch = () => {
    if (!to) return;
    try {
      if (to === '/') {
        queryClient.prefetchQuery({
          queryKey: ['dashboard-metrics'],
          queryFn: async () => (await api.get('/dashboard/metrics')).data,
          staleTime: 60000
        });
      } else if (to.startsWith('/modules/')) {
        const parts = to.split('?')[0].split('/');
        const modulePath = parts[2];
        if (modulePath) {
          queryClient.prefetchQuery({
            queryKey: ['records', modulePath, '', '', '', 1],
            queryFn: async () => (await api.get(`/records/${modulePath}?page=1&limit=10`)).data,
            staleTime: 60000
          });
        }
      } else if (to === '/my-campaign') {
        queryClient.prefetchQuery({
          queryKey: ['my-campaigns-list'],
          queryFn: async () => {
            const res = await api.get('/records/campaigns/my-campaigns');
            const data = res.data?.campaigns || res.data;
            return Array.isArray(data) ? data : [];
          },
          staleTime: 60000
        });
      } else if (to === '/modules/leads/new') {
        queryClient.prefetchQuery({
          queryKey: ['master-bankmasters'],
          queryFn: async () => (await api.get('/records/bankmasters')).data?.records || [],
          staleTime: 5 * 60 * 1000
        });
        queryClient.prefetchQuery({
          queryKey: ['master-products'],
          queryFn: async () => (await api.get('/records/products')).data?.records || [],
          staleTime: 5 * 60 * 1000
        });
        queryClient.prefetchQuery({
          queryKey: ['master-departments'],
          queryFn: async () => (await api.get('/records/departments')).data?.records || [],
          staleTime: 5 * 60 * 1000
        });
        queryClient.prefetchQuery({
          queryKey: ['master-bankingpartners'],
          queryFn: async () => (await api.get('/records/bankingpartners')).data?.records || [],
          staleTime: 5 * 60 * 1000
        });
        queryClient.prefetchQuery({
          queryKey: ['users-dropdown'],
          queryFn: async () => (await api.get('/auth/users?purpose=dropdown')).data || [],
          staleTime: 5 * 60 * 1000
        });
      }
    } catch (e) {
      // Ignore prefetch error
    }
  };

  return (
    <Link
      to={to}
      onClick={onClick}
      onMouseEnter={handlePrefetch}
      onFocus={handlePrefetch}
      title={isCollapsed ? label : undefined}
      className="block w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-control"
    >
      <div
        className={cn(
          "relative flex items-center gap-3 px-3 py-2 min-h-[38px] rounded-control transition-all duration-150 group cursor-pointer text-xs select-none",
          isActive
            ? "bg-brand text-brand-contrast font-semibold shadow-xs"
            : "text-content-secondary hover:text-content-primary hover:bg-brand-50/60 dark:hover:bg-slate-800/60 font-medium",
          indent && "pl-4 text-[11.5px]",
          isCollapsed && "justify-center px-0 py-2"
        )}
      >
        <SidebarIcon icon={icon} colorClass={colorClass} active={isActive} />

        {!isCollapsed && (
          <span className={cn(
            "truncate flex-1 text-left tracking-[0.01em] transition-colors duration-150",
            isActive ? "font-semibold text-brand-contrast" : "font-medium text-content-secondary group-hover:text-content-primary"
          )}>
            {label}
          </span>
        )}

        {!isCollapsed && badge !== undefined && badge > 0 && (
          <span className={cn(
            "ml-auto px-1.5 py-0.5 text-[10px] font-bold rounded tabular-nums border",
            isActive
              ? "bg-white/20 text-brand-contrast border-white/30"
              : "bg-surface-page text-content-secondary border-border-subtle"
          )}>
            {badge}
          </span>
        )}
      </div>
    </Link>
  );
};

// ---------------------------------------------------------
// PURE ENTERPRISE ACCORDION (EXPANDABLE NAV)
// ---------------------------------------------------------
export const SidebarAccordion = ({
  label,
  icon,
  colorClass,
  children,
  defaultOpen = false,
  isCollapsed = false
}: {
  label: string;
  icon: any;
  colorClass?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  isCollapsed?: boolean;
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  useEffect(() => {
    if (defaultOpen) {
      setIsOpen(true);
    }
  }, [defaultOpen]);

  if (isCollapsed) {
    return (
      <div className="flex flex-col items-center py-1">
        <div className="p-2 text-content-muted hover:text-content-primary rounded-control hover:bg-brand-50/60 dark:hover:bg-slate-800/60 cursor-pointer transition-colors" title={label}>
          <SidebarIcon icon={icon} colorClass={colorClass} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col my-0.5">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center justify-between w-full px-3 py-2 min-h-[38px] rounded-control text-xs transition-all duration-150 group cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand select-none",
          isOpen 
            ? "text-content-primary font-semibold bg-brand-50/40 dark:bg-slate-800/40" 
            : "text-content-secondary hover:text-content-primary hover:bg-brand-50/60 dark:hover:bg-slate-800/60 font-medium"
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          <SidebarIcon icon={icon} colorClass={colorClass} active={false} />
          <span className="truncate tracking-[0.01em] font-medium">{label}</span>
        </div>
        <ChevronRight
          className={cn(
            "w-3.5 h-3.5 text-content-muted transition-transform duration-150 flex-shrink-0 group-hover:text-content-primary",
            isOpen && "rotate-90 text-content-primary"
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="ml-3 pl-2.5 my-1 space-y-0.5 border-l border-border-subtle">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ---------------------------------------------------------
// PURE ENTERPRISE SUB-ACCORDION (NESTED EXPANDABLE NAV)
// ---------------------------------------------------------
export const SidebarSubAccordion = ({
  label,
  icon,
  colorClass,
  children,
  defaultOpen = false,
  isCollapsed = false
}: {
  label: string;
  icon?: any;
  colorClass?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  isCollapsed?: boolean;
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  if (isCollapsed) return null;

  return (
    <div className="flex flex-col my-0.5 ml-1">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center justify-between w-full px-2.5 py-1.5 min-h-[32px] rounded-control text-[11.5px] transition-all duration-150 group cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand select-none",
          isOpen 
            ? "text-content-primary font-semibold bg-brand-50/40 dark:bg-slate-800/40" 
            : "text-content-secondary hover:text-content-primary hover:bg-brand-50/60 dark:hover:bg-slate-800/60 font-medium"
        )}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {icon && <SidebarIcon icon={icon} colorClass={colorClass} active={false} />}
          <span className="truncate tracking-[0.01em] font-medium">{label}</span>
        </div>
        <ChevronRight
          className={cn(
            "w-3 h-3 text-content-muted transition-transform duration-150 flex-shrink-0 group-hover:text-content-primary",
            isOpen && "rotate-90 text-content-primary"
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="ml-2.5 pl-2 my-1 space-y-0.5 border-l border-border-subtle">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ---------------------------------------------------------
// SECTION GROUP & HEADERS (Small, Muted, Strict Spacing)
// ---------------------------------------------------------
export const SidebarGroup = ({ title, children, isCollapsed = false }: { title: string; children: React.ReactNode; isCollapsed?: boolean }) => (
  <div className="mb-2 pt-2.5 first:pt-0">
    {!isCollapsed ? (
      <div className="px-3 mb-1.5 flex items-center justify-between select-none">
        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-content-muted">
          {title}
        </span>
      </div>
    ) : (
      <div className="h-px bg-border-subtle my-2 mx-3" />
    )}
    <div className="space-y-0.5">{children}</div>
  </div>
);

// ---------------------------------------------------------
// PURE ENTERPRISE PROFILE SECTION (Sidebar Bottom Card)
// ---------------------------------------------------------
export const SidebarProfile = ({ isCollapsed = false }: { isCollapsed?: boolean }) => {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const name = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Admin User' : 'Admin User';
  const initials = user ? `${user.firstName?.charAt(0) || ''}${user.lastName?.charAt(0) || ''}`.toUpperCase() || 'AD' : 'AD';
  const email = user?.email || '';

  if (isCollapsed) {
    return (
      <div className="p-2 border-t border-border-subtle flex justify-center bg-surface-card flex-shrink-0">
        <button
          onClick={handleLogout}
          title="Logout"
          className="w-9 h-9 rounded-control bg-surface-page hover:bg-rose-50 hover:text-rose-600 text-content-muted border border-border-subtle flex items-center justify-center transition-colors cursor-pointer"
        >
          <LogOut className="w-4 h-4 stroke-[1.75]" />
        </button>
      </div>
    );
  }

  return (
    <div className="p-2.5 border-t border-border-subtle bg-surface-card select-none flex-shrink-0">
      <div className="p-2 rounded-control bg-surface-page border border-border-subtle flex items-center justify-between gap-2.5">
        {/* User Info */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative flex-shrink-0">
            <div className="w-8 h-8 rounded-full bg-brand-800 text-brand-contrast font-bold text-xs flex items-center justify-center border border-border-subtle">
              {initials}
            </div>
            {/* Green presence dot */}
            <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 rounded-full ring-2 ring-surface-card" />
          </div>
          <div className="flex flex-col min-w-0 text-left">
            <span className="text-xs font-semibold text-content-primary truncate leading-tight">
              {name}
            </span>
            <span className="text-[10px] font-medium text-content-muted truncate leading-tight mt-0.5">
              {email}
            </span>
          </div>
        </div>

        {/* Logout Quick Action */}
        <button
          onClick={handleLogout}
          title="Logout"
          className="p-1.5 text-content-muted hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-control transition-colors flex-shrink-0 cursor-pointer"
        >
          <LogOut className="w-4 h-4 stroke-[1.75]" />
        </button>
      </div>
    </div>
  );
};
