import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, LogOut, FileText } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useAuthStore } from '../../store/authStore';
import { useNavigate } from 'react-router-dom';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ---------------------------------------------------------
// PURE ENTERPRISE THEME ICON (Curated Harmonious Color System)
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
        "w-4 h-4 flex-shrink-0 transition-colors duration-120",
        active 
          ? "text-white dark:text-slate-900" 
          : (colorClass || "text-slate-500 dark:text-slate-400")
      )}
      strokeWidth={1.8}
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

  return (
    <Link
      to={to}
      onClick={onClick}
      title={isCollapsed ? label : undefined}
      className="block w-full focus:outline-none rounded-lg"
    >
      <div
        className={cn(
          "relative flex items-center gap-2.5 px-2.5 py-1.5 min-h-[34px] rounded-lg transition-all duration-120 group cursor-pointer text-[12px]",
          isActive
            ? "bg-[#111111] text-white dark:bg-white dark:text-slate-900 font-semibold shadow-2xs"
            : "text-[#44403C] dark:text-stone-300 hover:text-[#1C1917] dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.05] font-medium",
          indent && "pl-3.5 text-[11.5px]",
          isCollapsed && "justify-center px-0 py-1.5"
        )}
      >
        <SidebarIcon icon={icon} colorClass={colorClass} active={isActive} />

        {!isCollapsed && (
          <span className={cn(
            "truncate flex-1 text-left uppercase tracking-[0.02em] transition-colors duration-120",
            isActive ? "font-semibold text-white dark:text-slate-900" : "font-medium text-[#44403C] dark:text-stone-300 group-hover:text-[#1C1917] dark:group-hover:text-white"
          )}>
            {label}
          </span>
        )}

        {!isCollapsed && badge !== undefined && badge > 0 && (
          <span className={cn(
            "ml-auto px-1.5 py-0.2 text-[9.5px] font-bold rounded-md border",
            isActive
              ? "bg-white/20 text-white border-white/30 dark:bg-slate-900/20 dark:text-slate-900 dark:border-slate-900/30"
              : "bg-black/[0.04] text-[#44403C] border-black/[0.08] dark:bg-slate-800 dark:text-stone-300 dark:border-slate-700"
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

  if (isCollapsed) {
    return (
      <div className="flex flex-col items-center py-1">
        <div className="p-2 text-slate-400 hover:text-slate-900 cursor-pointer" title={label}>
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
          "flex items-center justify-between w-full px-2.5 py-1.5 min-h-[34px] rounded-lg text-[12px] transition-all duration-120 group cursor-pointer text-left",
          isOpen 
            ? "text-[#1C1917] dark:text-white font-semibold bg-black/[0.035] dark:bg-white/[0.04]" 
            : "text-[#44403C] dark:text-stone-300 hover:text-[#1C1917] dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.05] font-medium"
        )}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <SidebarIcon icon={icon} colorClass={colorClass} active={false} />
          <span className="truncate tracking-[0.02em] uppercase font-medium">{label}</span>
        </div>
        <ChevronRight
          className={cn(
            "w-3.5 h-3.5 text-[#78716C] transition-transform duration-120 flex-shrink-0 group-hover:text-[#1C1917] dark:group-hover:text-slate-200",
            isOpen && "rotate-90 text-[#1C1917] dark:text-white"
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
            <div className="ml-3 pl-2 my-0.5 space-y-0.5 border-l border-black/[0.08] dark:border-slate-800">
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
    <div className="flex flex-col my-0.5 ml-1.5">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center justify-between w-full px-2 py-1.5 min-h-[30px] rounded-lg text-[11.5px] transition-all duration-120 group cursor-pointer text-left",
          isOpen 
            ? "text-[#1C1917] dark:text-white font-semibold bg-black/[0.035] dark:bg-white/[0.04]" 
            : "text-[#44403C] dark:text-stone-300 hover:text-[#1C1917] dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.05] font-medium"
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          {icon && <SidebarIcon icon={icon} colorClass={colorClass} active={false} />}
          <span className="truncate tracking-[0.02em] uppercase font-medium text-[11px]">{label}</span>
        </div>
        <ChevronRight
          className={cn(
            "w-3 h-3 text-[#78716C] transition-transform duration-120 flex-shrink-0 group-hover:text-[#1C1917] dark:group-hover:text-slate-200",
            isOpen && "rotate-90 text-[#1C1917] dark:text-white"
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
            <div className="ml-2.5 pl-2 my-0.5 space-y-0.5 border-l border-black/[0.08] dark:border-slate-800">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ---------------------------------------------------------
// SECTION GROUP & HEADERS (High-Contrast & Refined)
// ---------------------------------------------------------
export const SidebarGroup = ({ title, children, isCollapsed = false }: { title: string; children: React.ReactNode; isCollapsed?: boolean }) => (
  <div className="mb-2 pt-3 first:pt-0">
    {!isCollapsed ? (
      <div className="px-2.5 mb-1 flex items-center justify-between select-none">
        <span className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-[#78716C] dark:text-stone-400">
          {title}
        </span>
      </div>
    ) : (
      <div className="h-px bg-black/[0.08] dark:bg-slate-800 my-2 mx-2" />
    )}
    <div className="space-y-0.5">{children}</div>
  </div>
);

// ---------------------------------------------------------
// PURE ENTERPRISE PROFILE SECTION (Elevated Bottom Card)
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
      <div className="p-2 border-t border-black/[0.08] dark:border-slate-800 flex justify-center bg-white dark:bg-slate-900 rounded-b-xl">
        <button
          onClick={handleLogout}
          title="Logout"
          className="w-8 h-8 rounded-lg bg-white dark:bg-slate-800 hover:bg-rose-50 hover:text-rose-600 text-slate-500 border border-black/[0.08] dark:border-slate-700 flex items-center justify-center transition-colors shadow-2xs cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="p-2 border-t border-black/[0.08] dark:border-slate-800 bg-transparent rounded-b-xl mt-auto select-none">
      <div className="p-2 rounded-xl bg-white dark:bg-slate-800 border border-black/[0.08] dark:border-slate-700 shadow-2xs flex items-center justify-between gap-2.5">
        {/* User Info */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative flex-shrink-0">
            <div className="w-8 h-8 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold text-xs flex items-center justify-center ring-1 ring-black/[0.08] shadow-2xs">
              {initials}
            </div>
            {/* Green dot with clean white ring */}
            <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 rounded-full ring-2 ring-white dark:ring-slate-800" />
          </div>
          <div className="flex flex-col min-w-0 text-left">
            <span className="text-xs font-bold text-[#1C1917] dark:text-white truncate leading-tight">
              {name}
            </span>
            <span className="text-[10px] font-medium text-[#78716C] dark:text-stone-400 truncate leading-tight mt-0.5">
              {email}
            </span>
          </div>
        </div>

        {/* Logout Quick Action */}
        <button
          onClick={handleLogout}
          title="Logout"
          className="p-1.5 text-[#78716C] hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition-colors flex-shrink-0 cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
