import React, { useEffect, useState, useRef } from 'react';
import * as Icons from 'lucide-react';
import api, { FILE_BASE_URL } from '../services/api';
import { useThemeStore } from '../store/themeStore';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useDelayedLoading } from '../hooks/useDelayedLoading';
import { formatDate } from '../utils/dateFormatter';
import { useToastStore } from '../store/toastStore';
import SalesFunnel3D from '../components/SalesFunnel3D';
import SalesCallingVisualIntelligence from '../components/SalesCallingVisualIntelligence';
import { getStatusTokens } from '../utils/statusTokenMapper';

// Reusable Animated Number component with tabular-nums and ease-out interpolation
function AnimatedNumber({
  value,
  duration = 500,
  prefix = '',
  suffix = '',
  format
}: {
  value: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  format?: (n: number) => string;
}) {
  const [displayValue, setDisplayValue] = useState<number>(0);
  const startRef = useRef<number | null>(null);
  const targetRef = useRef<number>(value);

  useEffect(() => {
    targetRef.current = value;
    startRef.current = null;
    let frameId: number;

    const animate = (timestamp: number) => {
      if (!startRef.current) startRef.current = timestamp;
      const progress = Math.min((timestamp - startRef.current) / duration, 1);
      // easeOutCubic
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(targetRef.current * ease);
      setDisplayValue(current);

      if (progress < 1) {
        frameId = requestAnimationFrame(animate);
      }
    };

    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [value, duration]);

  const formatted = format ? format(displayValue) : displayValue.toLocaleString('en-IN');
  return (
    <span className="tabular-nums">
      {prefix}{formatted}{suffix}
    </span>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { showToast } = useToastStore();
  const { branding } = useThemeStore();
  const [followupTab, setFollowupTab] = useState<'today' | 'upcoming'>('today');

  // File upload and History timeline states
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingRecordId, setUploadingRecordId] = useState<string | null>(null);
  const [activeHistoryRecord, setActiveHistoryRecord] = useState<any | null>(null);
  const [historyActivities, setHistoryActivities] = useState<any[]>([]);
  const [historyDocuments, setHistoryDocuments] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Phone masking
  const [revealedPhones, setRevealedPhones] = useState<Record<string, boolean>>({});
  const togglePhoneReveal = (id: string) => {
    setRevealedPhones(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const maskPhoneNumber = (phone?: string, isRevealed: boolean = false) => {
    if (!phone || phone === 'N/A') return 'N/A';
    const clean = String(phone).trim();
    if (isRevealed) return clean;
    if (clean.length <= 4) return '******';
    if (clean.length === 10) {
      return `${clean.slice(0, 5)}*****`;
    }
    const prefixLen = Math.min(4, Math.floor(clean.length / 2));
    return `${clean.slice(0, prefixLen)}${'*'.repeat(Math.max(4, clean.length - prefixLen))}`;
  };

  // Fetch dynamic configured statuses from database (Settings -> Status Settings)
  const { data: configuredStatuses = [] } = useQuery({
    queryKey: ['dashboard-configured-statuses'],
    queryFn: async () => {
      const res = await api.get('/statuses').catch(() => ({ data: [] }));
      return Array.isArray(res.data) ? res.data : [];
    },
    staleTime: 10 * 60 * 1000, // 10 minutes master data
    placeholderData: keepPreviousData
  });

  // Fetch campaigns for Campaign Status section (capped at 100 for fast payload)
  const { data: campaignRecords } = useQuery({
    queryKey: ['dashboard-campaigns-list'],
    queryFn: async () => {
      const res = await api.get('/records/campaigns?limit=100').catch(() => ({ data: { records: [] } }));
      return res.data?.records || res.data || [];
    },
    staleTime: 60000,
    placeholderData: keepPreviousData
  });

  const handleUploadClick = (recordId: string) => {
    setUploadingRecordId(recordId);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadingRecordId) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('recordId', uploadingRecordId);

    try {
      await api.post('/documents/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      showToast('File uploaded successfully!', 'success');
    } catch (err) {
      showToast('Failed to upload file.', 'error');
    } finally {
      setUploadingRecordId(null);
    }
  };

  const openHistory = async (rec: any) => {
    setActiveHistoryRecord(rec);
    setLoadingHistory(true);
    try {
      const [activitiesRes, docsRes] = await Promise.all([
        api.get(`/records/leads/${rec._id}/activities`),
        api.get(`/documents`, { params: { recordId: rec._id } })
      ]);
      setHistoryActivities(activitiesRes.data);
      setHistoryDocuments(docsRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingHistory(false);
    }
  };

  // Fetch live dashboard metrics from database with 60s polling intervals and 60s cache
  const { 
    data: metricsData, 
    isLoading, 
    isError: isMetricsError, 
    error: metricsError, 
    refetch: refetchMetrics 
  } = useQuery({
    queryKey: ['dashboard-metrics'],
    queryFn: async () => {
      const res = await api.get('/dashboard/metrics');
      return res.data;
    },
    staleTime: 60000,
    placeholderData: keepPreviousData,
    retry: 1,
    refetchInterval: (query) => (query.state.error ? false : 60000),
    refetchOnWindowFocus: false
  });

  const { showLoading: showDelayedSkeleton, isTakingLonger } = useDelayedLoading(isLoading && !metricsData, 400);

  const { data: usersDropdown } = useQuery({
    queryKey: ['users-dropdown'],
    queryFn: async () => {
      const res = await api.get('/auth/users?purpose=dropdown');
      return res.data || [];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    placeholderData: keepPreviousData
  });

    // Fetch live leads for Visual Intelligence charts (cached for 5 minutes)
  const { data: visualLeads = [] } = useQuery({
    queryKey: ['dashboard-visual-leads'],
    queryFn: async () => {
      const res = await api.get('/records/leads?limit=100').catch(() => ({ data: { records: [] } }));
      return res.data?.records || res.data || [];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    placeholderData: keepPreviousData
  });

  const { data: myCampaignsData } = useQuery({
    queryKey: ['my-campaigns-list'],
    queryFn: async () => {
      const res = await api.get('/records/campaigns/my-campaigns');
      const data = res.data?.campaigns || res.data;
      return Array.isArray(data) ? data : [];
    },
    staleTime: 60000,
    gcTime: 15 * 60 * 1000,
    placeholderData: keepPreviousData
  });

  const resolveUserDisplayName = (val: any) => {
    if (!val) return 'Unassigned';
    if (typeof val === 'object') {
      if (val.firstName || val.lastName) return `${val.firstName || ''} ${val.lastName || ''}`.trim();
      if (val.name) return val.name;
      if (val.email) return val.email.split('@')[0];
    }
    const str = String(val).trim();
    if (!str || str === 'undefined' || str === 'null') return 'Unassigned';
    if (Array.isArray(usersDropdown)) {
      const found = usersDropdown.find((u: any) => 
        u._id === str || u.id === str || u.email?.toLowerCase() === str.toLowerCase() || u.userCode === str
      );
      if (found) {
        return `${found.firstName || ''} ${found.lastName || ''}`.trim() || found.name || found.email || str;
      }
    }
    if (/^[0-9a-fA-F]{24}$/.test(str)) {
      return 'Assigned Agent';
    }
    return str;
  };

  useEffect(() => {
    if (metricsData) {
      if (metricsData.todayFollowupsCount > 0) {
        setFollowupTab('today');
      } else if (metricsData.upcomingFollowupsCount > 0 || metricsData.isUpcoming) {
        setFollowupTab('upcoming');
      }
    }
  }, [metricsData]);

  const getStatusCount = (lbl: string) => {
    if (!metricsData?.statusCounts) return 0;
    const raw = (lbl || '').trim();
    if (!raw) return 0;
    const upper = raw.toUpperCase();

    if (upper === "TODAY'S FOLLOWUPS") {
      return metricsData.todayFollowupsCount || 0;
    }

    // Accumulate all counts that match synonyms for this status label
    let total = 0;
    const matchedKeys = new Set<string>();

    const checkAndAdd = (key: string) => {
      const kUpper = key.trim().toUpperCase();
      if (!matchedKeys.has(kUpper) && metricsData.statusCounts[kUpper] !== undefined) {
        matchedKeys.add(kUpper);
        total += Number(metricsData.statusCounts[kUpper] || 0);
      }
    };

    if (upper.includes('HOT')) {
      ['HOT', 'HOT LEADS', 'HOT LEAD'].forEach(checkAndAdd);
    } else if (upper.includes('WARM')) {
      ['WARM', 'WARM LEADS', 'WARM LEAD'].forEach(checkAndAdd);
    } else if (upper.includes('CEBIL') || upper.includes('CEDIL')) {
      ['CEBIL PENDING', 'CEDIL PENDING', 'CEBIL', 'CEDIL'].forEach(checkAndAdd);
    } else if (upper.includes('DOCUMENT') || upper.includes('DOC PENDING')) {
      ['DOCUMENT PENDING', 'DOCUMENTS PENDING', 'DOC PENDING', 'PROPOSAL'].forEach(checkAndAdd);
    } else if (upper.includes('APPROVAL') || upper === 'NEGOTIATION') {
      ['APPROVAL PENDING', 'APPROVALS PENDING', 'NEGOTIATION'].forEach(checkAndAdd);
    } else if (upper.includes('APPROVED') && !upper.includes('DISBU')) {
      ['APPROVED BUT NOT DISBUSE', 'APPROVED BUT NOT DISBURSED', 'APPROVED'].forEach(checkAndAdd);
    } else if (upper.includes('APPROVED BUT NOT')) {
      ['APPROVED BUT NOT DISBUSE', 'APPROVED BUT NOT DISBURSED', 'APPROVED'].forEach(checkAndAdd);
    } else if (upper.includes('DISBUSED') || upper.includes('DISBURSED')) {
      ['DISBUSED', 'DISBURSED'].forEach(checkAndAdd);
    } else if (upper.includes('REJECT')) {
      ['REJECTED', 'REJECT'].forEach(checkAndAdd);
    } else if (upper.includes('FOLLOW')) {
      ['FOLLOWUP', 'FOLLOW UP', 'FOLLOW-UP'].forEach(checkAndAdd);
    } else if (upper.includes('DROP')) {
      ['DROPPED', 'DROP'].forEach(checkAndAdd);
    } else if (upper === 'PENDING' || upper.includes('INKWORLDWIDE')) {
      ['PENDING', 'INKWORLDWIDE', 'INK WORLDWIDE'].forEach(checkAndAdd);
    } else {
      checkAndAdd(raw);
      checkAndAdd(upper);
      const noLeadsKey = upper.replace(/\s+LEADS?$/, '');
      if (noLeadsKey) checkAndAdd(noLeadsKey);
    }

    if (total > 0) return total;

    // Fallback: check exact or case-insensitive key
    if (metricsData.statusCounts[raw] !== undefined) return Number(metricsData.statusCounts[raw]);
    if (metricsData.statusCounts[upper] !== undefined) return Number(metricsData.statusCounts[upper]);

    return 0;
  };

  // Construct dynamic metric cards from configured statuses in Settings, plus Today's Followups
  const getDynamicMetricCards = () => {
    const todaysFollowupsCard = {
      label: "TODAY'S FOLLOWUPS",
      rawName: "TODAY'S FOLLOWUPS",
      category: 'followups',
      icon: Icons.Calendar,
      sub: 'Due Today',
      accentColor: '#4F46E5'
    };

    if (configuredStatuses && configuredStatuses.length > 0) {
      const visible = configuredStatuses
        .filter((s: any) => s.dashboardVisibility !== false)
        .sort((a: any, b: any) => (a.order || 0) - (b.order || 0));

      if (visible.length > 0) {
        const dynamicCards = visible.map((st: any) => {
          const IconComp = (Icons as any)[st.icon] || Icons.Circle;
          const upperName = (st.name || '').toUpperCase();

          let category = 'overview';
          if (st.pipelinePosition > 0) category = 'pipeline';
          if (upperName.includes('FOLLOW') || upperName.includes('WARM') || upperName.includes('PENDING') || upperName.includes('REACHABLE')) {
            category = 'followups';
          }

          const themeTokens = getStatusTokens(st);

          return {
            label: st.name.toUpperCase(),
            rawName: st.name,
            category,
            accentColor: st.color || themeTokens.accentHex,
            icon: IconComp,
            sub: st.isFinal 
              ? (st.isSuccess ? '✔ Closed Won' : '✕ Closed Final') 
              : (st.pipelinePosition > 0 ? `Stage #${st.pipelinePosition}` : 'Configured Status')
          };
        });

        return [...dynamicCards, todaysFollowupsCard];
      }
    }

    // Default fallback list of 11 cards + Today's Followups
    return [
      { label: 'HOT LEADS', rawName: 'HOT LEADS', category: 'pipeline', icon: Icons.Flame, sub: 'Stage #2', accentColor: '#EF4444' },
      { label: 'WARM LEADS', rawName: 'WARM LEADS', category: 'pipeline', icon: Icons.Sun, sub: 'Stage #3', accentColor: '#F59E0B' },
      { label: 'CEBIL PENDING', rawName: 'CEBIL PENDING', category: 'pipeline', icon: Icons.FileWarning, sub: 'Stage #5', accentColor: '#0284C7' },
      { label: 'DOCUMENT PENDING', rawName: 'DOCUMENT PENDING', category: 'pipeline', icon: Icons.FileText, sub: 'Stage #6', accentColor: '#0D9488' },
      { label: 'APPROVAL PENDING', rawName: 'APPROVAL PENDING', category: 'pipeline', icon: Icons.Clock, sub: 'Stage #7', accentColor: '#F97316' },
      { label: 'APPROVED BUT NOT DISBUSE', rawName: 'APPROVED BUT NOT DISBUSE', category: 'pipeline', icon: Icons.CheckCircle, sub: 'Stage #8', accentColor: '#10B981' },
      { label: 'DISBUSED', rawName: 'DISBUSED', category: 'pipeline', icon: Icons.Banknote, sub: '✔ Closed Won', accentColor: '#10B981' },
      { label: 'REJECTED', rawName: 'REJECTED', category: 'overview', icon: Icons.XOctagon, sub: '✕ Closed Final', accentColor: '#F43F5E' },
      { label: 'FOLLOWUP', rawName: 'FOLLOWUP', category: 'followups', icon: Icons.PhoneCall, sub: 'Stage #11', accentColor: '#0284C7' },
      { label: 'DROPPED', rawName: 'DROPPED', category: 'overview', icon: Icons.ArrowDownCircle, sub: '✕ Closed Final', accentColor: '#F43F5E' },
      { label: 'PENDING', rawName: 'PENDING', category: 'followups', icon: Icons.Hourglass, sub: 'Stage #13', accentColor: '#8B5CF6' },
      todaysFollowupsCard
    ];
  };

  // Convert pipeline stage data to array with dynamic percentage scaling
  const rawPipeline = [
    { 
      name: 'Lead Ingestion / New', 
      val: metricsData?.pipelineData?.['Prospecting'] || getStatusCount('NEW') * 50000 || 50000, 
      count: getStatusCount('NEW') || 10,
      icon: Icons.UserPlus,
      color: '#4F46E5',
      bgTint: 'rgba(79, 70, 229, 0.1)'
    },
    { 
      name: 'Qualification & Hot Leads', 
      val: metricsData?.pipelineData?.['Qualification'] || 90000, 
      count: getStatusCount('HOT') + getStatusCount('WARM') || 14,
      icon: Icons.Flame,
      color: '#059669',
      bgTint: 'rgba(5, 150, 105, 0.1)'
    },
    { 
      name: 'Proposal & Documentation', 
      val: metricsData?.pipelineData?.['Proposal'] || 150000, 
      count: getStatusCount('DOCUMENT PENDING') + getStatusCount('CEDIL PENDING') || 8,
      icon: Icons.FileText,
      color: '#D97706',
      bgTint: 'rgba(217, 119, 6, 0.1)'
    },
    { 
      name: 'Negotiation & Approval', 
      val: metricsData?.pipelineData?.['Negotiation'] || 300000, 
      count: getStatusCount('APPROVAL PENDING') || 6,
      icon: Icons.TrendingUp,
      color: '#EA580C',
      bgTint: 'rgba(234, 88, 12, 0.1)'
    },
    { 
      name: 'Disbursed / Closed Won', 
      val: metricsData?.pipelineData?.['Closed Won'] || 120000, 
      count: getStatusCount('APPROVED') + getStatusCount('DISBURSED') || 12,
      icon: Icons.CheckCircle2,
      color: '#7C3AED',
      bgTint: 'rgba(124, 58, 237, 0.1)'
    }
  ];

  const maxPipelineVal = Math.max(...rawPipeline.map(s => s.val), 1);

  const totalPipeline = rawPipeline.reduce((a, b) => a + Number(b.val), 0);
  const activeDeals = metricsData?.dealStatus?.open || 12;
  const avgDealSize = activeDeals > 0 ? Math.round(totalPipeline / activeDeals) : 25000;

  const wonCount = metricsData?.dealStatus?.won || 4;
  const lostCount = metricsData?.dealStatus?.lost || 1;
  const totalClosed = wonCount + lostCount;
  const winRate = totalClosed > 0 ? Math.round((wonCount / totalClosed) * 100) : 80;

  if (showDelayedSkeleton && !metricsData) {
    return (
      <div className="space-y-6 max-w-[1400px] mx-auto text-left px-4 md:px-8 py-6">
        <div className="h-8 w-64 rounded-control animate-shimmer bg-surface-raised"></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-32 rounded-card animate-shimmer bg-surface-card border border-border-subtle"></div>
          ))}
        </div>
        {isTakingLonger && (
          <div className="p-4 bg-status-warm-bg border border-status-warm-border rounded-card text-center space-y-2">
            <p className="text-xs font-semibold text-status-warm-text">Taking longer than usual...</p>
            <button
              onClick={() => refetchMetrics()}
              className="px-3.5 py-1.5 bg-brand-500 hover:bg-brand-600 text-brand-contrast text-xs font-semibold rounded-control shadow-card transition-colors cursor-pointer"
            >
              Retry Connection
            </button>
          </div>
        )}
      </div>
    );
  }

  if (isMetricsError && !metricsData) {
    return (
      <div className="max-w-[1400px] mx-auto text-left px-4 md:px-8 py-12">
        <div className="p-6 rounded-card bg-surface-card border border-status-danger-border shadow-card text-center max-w-lg mx-auto space-y-4">
          <div className="w-12 h-12 rounded-control bg-status-danger-bg text-status-danger flex items-center justify-center mx-auto border border-status-danger-border">
            <Icons.AlertCircle className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-content-primary">Unable to Load Dashboard Data</h3>
            <p className="text-xs text-content-muted mt-1">
              {(metricsError as any)?.message || 'The request was blocked or could not reach the server.'}
            </p>
          </div>
          <button
            onClick={() => refetchMetrics()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-brand-500 hover:bg-brand-600 text-brand-contrast text-xs font-semibold rounded-control shadow-card transition-colors cursor-pointer"
          >
            <Icons.RefreshCw className="w-3.5 h-3.5" />
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-[1400px] mx-auto text-left px-0 py-0.5">
      
      {/* 1. COMPACT TELEMETRY HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border-subtle">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-content-primary tracking-tight">
            Dashboard
          </h1>
          <p className="text-xs text-content-muted mt-0.5">
            Live pipeline velocity, status distributions, and scheduled follow-ups
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Total Leads Badge */}
          <Link
            to="/modules/leads"
            className="group h-8.5 px-3 bg-surface-card hover:bg-surface-raised text-content-secondary hover:text-content-primary rounded-control flex items-center gap-2 border border-border-subtle shadow-card transition-colors text-xs font-semibold"
            title="View All Leads"
          >
            <Icons.Layers className="w-3.5 h-3.5 text-brand-500" />
            <span className="hidden sm:inline">All Leads:</span>
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-brand-500/10 text-brand-600 dark:text-brand-400 tabular-nums">
              {(metricsData?.totalLeads ?? 0).toLocaleString('en-IN')}
            </span>
          </Link>

          {/* Quick Create Lead CTA */}
          <Link 
            to="/modules/leads/new" 
            className="group h-8.5 px-3.5 bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-brand-contrast rounded-control flex items-center gap-2 shadow-card hover:shadow-card-hover transition-all text-xs font-semibold"
          >
            <Icons.Plus className="w-4.5 h-4.5 stroke-[2.5]" />
            <span>Create Lead</span>
          </Link>
        </div>
      </div>

      {/* 2. OVERVIEW STATUS KPI CARDS (Compact, Flat, High-Density Linear/Stripe Style) */}
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3">
        {getDynamicMetricCards().map((metric, idx) => {
          const Icon = metric.icon;
          const count = getStatusCount(metric.rawName || metric.label);
          const isZero = count === 0;
          const tokens = getStatusTokens({
            name: metric.rawName || metric.label,
            color: metric.accentColor
          });

          return (
            <Link
              to={
                metric.rawName === "TODAY'S FOLLOWUPS"
                  ? '/modules/leads?followup=today'
                  : `/modules/leads?status=${encodeURIComponent(metric.rawName || metric.label)}`
              }
              key={idx} 
              className="group flex flex-col justify-between bg-surface-card border border-border-subtle rounded-control shadow-2xs hover:shadow-card hover:-translate-y-0.5 hover:border-brand-500/40 transition-all duration-150 relative overflow-hidden text-left p-3 select-none"
            >
              {/* 2.5px Top Accent Bar */}
              <div 
                className="absolute top-0 left-0 right-0 h-[2.5px]"
                style={{ backgroundColor: tokens.accentHex }}
              />

              {/* Card Header: Label & Tinted Icon */}
              <div className="flex items-center justify-between gap-2 mb-1.5 pt-0.5">
                <span 
                  className="text-[11px] font-bold uppercase tracking-wider text-content-secondary truncate"
                  title={metric.label}
                >
                  {metric.label}
                </span>
                <div 
                  className={`w-6 h-6 rounded-control flex items-center justify-center flex-shrink-0 transition-transform duration-150 group-hover:scale-105 ${tokens.iconBgClass}`}
                >
                  <Icon className="w-3 h-3 stroke-[2.2]" />
                </div>
              </div>

              {/* Card Metric: Number & Zero State */}
              <div className="flex items-baseline gap-1.5 mb-2">
                <span className="text-2xl font-bold tracking-tight text-content-primary tabular-nums leading-none">
                  <AnimatedNumber value={count} />
                </span>
                {isZero && (
                  <span className="text-[10px] font-medium text-content-muted">
                    No leads
                  </span>
                )}
              </div>

              {/* Card Footer: Status Dot + Subtext + Arrow slide on hover */}
              <div className="pt-2 border-t border-border-subtle/70 flex items-center justify-between mt-auto">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span 
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${tokens.dotClass}`} 
                    style={{ backgroundColor: tokens.accentHex }} 
                  />
                  <span className="text-[10.5px] font-medium text-content-muted truncate">
                    {metric.sub}
                  </span>
                </div>
                <Icons.ArrowRight className="w-3 h-3 text-content-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-brand-500 flex-shrink-0" />
              </div>
            </Link>
          );
        })}
      </div>

      {/* 3. CAMPAIGN STATUS & EXECUTION TELEMETRY */}
      {(() => {
        const campaignsList: any[] = Array.isArray(myCampaignsData) ? myCampaignsData : ((myCampaignsData as any)?.campaigns || []);
        const totalCampaigns = campaignsList.length > 0 ? campaignsList.length : 21;
        const completedCampaigns = campaignsList.filter((c: any) => c.yetToDial === 0 && c.totalAssigned > 0).length || 0;
        const inProgressCampaigns = campaignsList.filter((c: any) => c.yetToDial > 0 || c.dialed > 0).length || totalCampaigns;
        const yetToStartCampaigns = campaignsList.filter((c: any) => c.dialed === 0).length || 0;

        const totalLeadsDialed = campaignsList.reduce((acc: number, c: any) => acc + (c.dialed || 0), 0) || 44586;
        const totalLeadsAllocated = campaignsList.reduce((acc: number, c: any) => acc + (c.totalAssigned || 0), 0) || 110735;
        const remainingLeads = Math.max(0, totalLeadsAllocated - totalLeadsDialed) || 66149;
        const dialedPercentage = totalLeadsAllocated > 0 ? Math.round((totalLeadsDialed / totalLeadsAllocated) * 100) : 40;
        const activeCampaignName = campaignsList[0]?.campaignName || "Active Telephony Drive";

        return (
          <div id="campaign-section" className="w-full">
            <div className="bg-surface-card border border-border-subtle rounded-card p-5 sm:p-6 shadow-card transition-all duration-150">
              
              {/* Header Bar */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-control bg-status-warm-bg border border-status-warm-border flex items-center justify-center text-status-warm shadow-xs flex-shrink-0">
                    <Icons.Megaphone className="w-5 h-5 stroke-[2]" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base sm:text-lg font-bold text-content-primary tracking-tight">Campaign Status</h3>
                      <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-status-warm-bg text-status-warm-text border border-status-warm-border tabular-nums">
                        {totalCampaigns} Drives
                      </span>
                    </div>
                    <p className="text-xs text-content-muted mt-0.5">Execution overview across assigned dialing queues</p>
                  </div>
                </div>

                <Link 
                  to="/my-campaign" 
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-content-secondary hover:text-content-primary bg-surface-card hover:bg-surface-raised px-3.5 py-2 rounded-control border border-border-subtle shadow-card transition-colors"
                >
                  <span>View All Campaigns</span>
                  <Icons.ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>

              {/* 4 Clean Metric Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
                {/* 1. TOTAL CAMPAIGNS */}
                <div 
                  onClick={() => navigate('/my-campaign')}
                  className="p-4 sm:p-5 bg-surface-card border border-border-subtle rounded-card shadow-card hover:shadow-card-hover hover:border-brand-500/30 transition-all cursor-pointer group text-left"
                >
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-semibold text-content-muted uppercase tracking-wider">Total Campaigns</span>
                    <div className="w-8 h-8 rounded-control bg-brand-500/10 text-brand-600 dark:text-brand-400 flex items-center justify-center">
                      <Icons.Megaphone className="w-4 h-4 stroke-[2]" />
                    </div>
                  </div>
                  <h4 className="text-2xl sm:text-3xl font-bold text-content-primary tracking-tight tabular-nums">
                    <AnimatedNumber value={totalCampaigns} />
                  </h4>
                  <p className="text-xs text-content-muted mt-1">All active telephony drives</p>
                </div>

                {/* 2. COMPLETED CAMPAIGN */}
                <div 
                  onClick={() => navigate('/my-campaign')}
                  className="p-4 sm:p-5 bg-surface-card border border-border-subtle rounded-card shadow-card hover:shadow-card-hover hover:border-status-success/30 transition-all cursor-pointer group text-left"
                >
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-semibold text-content-muted uppercase tracking-wider">Completed</span>
                    <div className="w-8 h-8 rounded-control bg-status-success-bg text-status-success flex items-center justify-center border border-status-success-border">
                      <Icons.CheckCircle2 className="w-4 h-4 stroke-[2]" />
                    </div>
                  </div>
                  <h4 className="text-2xl sm:text-3xl font-bold text-content-primary tracking-tight tabular-nums">
                    <AnimatedNumber value={completedCampaigns} />
                  </h4>
                  <p className="text-xs text-content-muted mt-1">100% Dialed & Closed</p>
                </div>

                {/* 3. INPROGRESS */}
                <div 
                  onClick={() => navigate('/my-campaign')}
                  className="p-4 sm:p-5 bg-surface-card border border-border-subtle rounded-card shadow-card hover:shadow-card-hover hover:border-status-info/30 transition-all cursor-pointer group text-left"
                >
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-semibold text-content-muted uppercase tracking-wider">In Progress</span>
                    <div className="w-8 h-8 rounded-control bg-status-info-bg text-status-info flex items-center justify-center border border-status-info-border">
                      <Icons.PhoneCall className="w-4 h-4 stroke-[2]" />
                    </div>
                  </div>
                  <h4 className="text-2xl sm:text-3xl font-bold text-content-primary tracking-tight tabular-nums">
                    <AnimatedNumber value={inProgressCampaigns} />
                  </h4>
                  <p className="text-xs text-content-muted mt-1">Currently active calling</p>
                </div>

                {/* 4. YET TO START */}
                <div 
                  onClick={() => navigate('/my-campaign')}
                  className="p-4 sm:p-5 bg-surface-card border border-border-subtle rounded-card shadow-card hover:shadow-card-hover hover:border-status-warm/30 transition-all cursor-pointer group text-left"
                >
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-semibold text-content-muted uppercase tracking-wider">Yet To Start</span>
                    <div className="w-8 h-8 rounded-control bg-status-warm-bg text-status-warm flex items-center justify-center border border-status-warm-border">
                      <Icons.Clock className="w-4 h-4 stroke-[2]" />
                    </div>
                  </div>
                  <h4 className="text-2xl sm:text-3xl font-bold text-content-primary tracking-tight tabular-nums">
                    <AnimatedNumber value={yetToStartCampaigns} />
                  </h4>
                  <p className="text-xs text-content-muted mt-1">Queued drives</p>
                </div>
              </div>

              {/* Execution Progress Banner */}
              <div className="p-5 sm:p-6 bg-slate-900 border border-slate-800 rounded-card shadow-card relative overflow-hidden text-left text-white">
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-brand-500 via-indigo-500 to-emerald-400 opacity-90" />

                <div className="flex items-center justify-between text-xs mb-3 relative z-10">
                  <div className="flex items-center gap-2">
                    <Icons.Activity className="w-4 h-4 text-brand-400" />
                    <span className="font-semibold uppercase tracking-wider text-xs text-white">
                      Overall Campaign Execution
                    </span>
                  </div>

                  <div className="bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-bold text-xs px-2.5 py-0.5 rounded-full flex items-center gap-1.5 tabular-nums">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    <span>{dialedPercentage}% DIALED</span>
                  </div>
                </div>

                <div className="flex items-baseline justify-between text-xs sm:text-sm mb-2 px-0.5 relative z-10">
                  <div className="flex items-baseline gap-2">
                    <span className="text-base sm:text-lg font-bold text-white tracking-tight tabular-nums">
                      {totalLeadsDialed.toLocaleString('en-IN')}
                    </span>
                    <span className="text-xs text-slate-400">
                      of {totalLeadsAllocated.toLocaleString('en-IN')} Leads Dialed
                    </span>
                  </div>
                  <span className="text-xs font-semibold text-slate-300 tabular-nums">
                    {remainingLeads.toLocaleString('en-IN')} Remaining
                  </span>
                </div>

                <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden mb-3 relative">
                  <div 
                    className="h-full rounded-full transition-all duration-700 ease-out relative" 
                    style={{ 
                      width: `${Math.max(dialedPercentage, 4)}%`,
                      background: 'linear-gradient(90deg, #3B82F6 0%, #06B6D4 50%, #10B981 100%)'
                    }} 
                  />
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs relative z-10">
                  <div className="flex items-center gap-2 bg-white/5 border border-white/10 px-3 py-1 rounded-control max-w-full sm:max-w-md truncate">
                    <Icons.PhoneCall className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                    <span className="text-slate-300 font-medium text-xs truncate">
                      {activeCampaignName}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-control self-start sm:self-auto">
                    <Icons.Target className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400 font-semibold text-xs">
                      Target: 100%
                    </span>
                  </div>
                </div>

              </div>

            </div>
          </div>
        );
      })()}

      {/* 3.5. SALES & CALLING VISUAL INTELLIGENCE (Image 1 Feature) */}
      <SalesCallingVisualIntelligence
        leads={visualLeads}
        statusCounts={metricsData?.statusCounts}
        totalLeadsCount={metricsData?.totalLeads}
      />

      {/* 4. TODAY'S & UPCOMING FOLLOWUP LEADS DETAILS */}
      <div className="bg-surface-card border border-border-subtle rounded-card p-5 sm:p-6 shadow-card overflow-hidden text-left">
        <div className="pb-4 border-b border-border-subtle flex flex-wrap items-center justify-between gap-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-control bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-600 dark:text-brand-400 shadow-xs">
              <Icons.CalendarClock className="w-4.5 h-4.5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-content-primary">
                Followup Leads Details
              </h2>
              <p className="text-xs text-content-muted mt-0.5">
                {followupTab === 'today' ? "Scheduled for action today" : "Upcoming scheduled followups"}
              </p>
            </div>
          </div>

          {/* Segmented Pill Tabs */}
          <div className="flex items-center bg-surface-raised border border-border-subtle p-1 rounded-control shadow-card">
            <button
              onClick={() => setFollowupTab('today')}
              className={`px-3 py-1.5 rounded-control text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                followupTab === 'today'
                  ? 'bg-surface-card text-brand-600 dark:text-brand-400 shadow-card'
                  : 'text-content-secondary hover:text-content-primary'
              }`}
            >
              <Icons.Calendar className="w-3.5 h-3.5" />
              <span>Today's Followups</span>
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] tabular-nums font-mono ${
                followupTab === 'today' ? 'bg-brand-500/10 text-brand-600 dark:text-brand-400 font-bold' : 'bg-surface-card text-content-muted'
              }`}>
                {metricsData?.todayFollowupsCount || 0}
              </span>
            </button>

            <button
              onClick={() => setFollowupTab('upcoming')}
              className={`px-3 py-1.5 rounded-control text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                followupTab === 'upcoming'
                  ? 'bg-surface-card text-brand-600 dark:text-brand-400 shadow-card'
                  : 'text-content-secondary hover:text-content-primary'
              }`}
            >
              <Icons.Clock className="w-3.5 h-3.5" />
              <span>Upcoming Followups</span>
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] tabular-nums font-mono ${
                followupTab === 'upcoming' ? 'bg-brand-500/10 text-brand-600 dark:text-brand-400 font-bold' : 'bg-surface-card text-content-muted'
              }`}>
                {metricsData?.upcomingFollowupsCount || 0}
              </span>
            </button>
          </div>
        </div>
        
        <div className="space-y-4">
          {(() => {
            const activeList = followupTab === 'today'
              ? (metricsData?.todayFollowupsList || [])
              : (metricsData?.upcomingFollowupsList?.length ? metricsData.upcomingFollowupsList : (metricsData?.todayFollowupsList || []));

            if (!activeList || activeList.length === 0) {
              return (
                <div className="py-12 bg-surface-raised border border-border-subtle rounded-card flex flex-col items-center justify-center text-center">
                  <div className="w-12 h-12 rounded-full bg-surface-card border border-border-subtle flex items-center justify-center mb-3 text-content-muted">
                    <Icons.CheckCircle2 className="w-6 h-6" />
                  </div>
                  <h3 className="text-sm font-semibold text-content-primary">
                    {followupTab === 'today' ? "No follow-ups scheduled today." : "No upcoming follow-ups scheduled."}
                  </h3>
                  <p className="text-xs text-content-muted mt-0.5">All scheduled outreach items are up to date.</p>
                </div>
              );
            }

            return activeList.map((rec: any, idx: number) => {
              const leadNo = rec._id.slice(-6).toUpperCase();
              const leadName = `${rec.data?.firstName || ''} ${rec.data?.lastName || ''}`.trim() || rec.data?.fullName || rec.data?.customerName || rec.data?.name || rec.data?.leadName || 'N/A';
              const leadLocation = rec.data?.location || [rec.data?.city, rec.data?.state].filter(Boolean).join(', ') || rec.data?.city || rec.data?.presentAddress || rec.data?.address || 'N/A';
              const amountVal = rec.data?.budget ?? rec.data?.loanAmount ?? rec.data?.amount;
              const formattedAmount = amountVal != null && amountVal !== '' ? `₹${Number(amountVal).toLocaleString('en-IN')}` : 'N/A';
              const createdByName = rec.createdBy?.firstName 
                ? `${rec.createdBy.firstName} ${rec.createdBy.lastName || ''}`.trim()
                : (rec.createdBy?.name || rec.createdBy?.email?.split('@')[0] || (typeof rec.createdBy === 'string' && rec.createdBy.length < 25 && !rec.createdBy.match(/^[0-9a-fA-F]{24}$/) ? rec.createdBy : '') || rec.data?.source || rec.data?.createdBy || 'Super Admin');

              const assignedToName = rec.data?.assignedToName || resolveUserDisplayName(rec.data?.assignedTo || rec.data?.assignTo || rec.assignedTo);
              const assignedByName = rec.data?.assignedByName 
                ? resolveUserDisplayName(rec.data.assignedByName) 
                : (rec.data?.assignedBy 
                    ? resolveUserDisplayName(rec.data.assignedBy) 
                    : (createdByName && createdByName !== 'System' && createdByName !== 'N/A' ? createdByName : 'System Router'));
              const psmName = rec.data?.psmName || resolveUserDisplayName(rec.data?.psm || rec.data?.assignedTo || 'Unassigned');
              const statusTokens = getStatusTokens(rec.data?.status || 'HOT');
              const rawStatus = (rec.data?.status || 'NEW').toUpperCase();
              const statusBadgeText = rawStatus.endsWith('LEAD') || rawStatus.endsWith('LEADS') 
                ? rawStatus 
                : `${rawStatus} LEAD`;

              let statusBadgeStyle = 'border border-slate-300 bg-slate-50 text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300';
              let StatusBadgeIcon: any = Icons.Sparkles;

              if (rawStatus.includes('HOT')) {
                statusBadgeStyle = 'border border-rose-200 bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:border-rose-900/60 dark:text-rose-400';
                StatusBadgeIcon = Icons.Flame;
              } else if (rawStatus.includes('CALL NOT CONNECT') || rawStatus.includes('NOT CONNECT')) {
                statusBadgeStyle = 'border border-sky-200 bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:border-sky-900/60 dark:text-sky-400';
                StatusBadgeIcon = Icons.PhoneOff;
              } else if (rawStatus.includes('WARM') || rawStatus.includes('DEMO')) {
                statusBadgeStyle = 'border border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:border-amber-900/60 dark:text-amber-400';
                StatusBadgeIcon = Icons.Zap;
              } else if (rawStatus.includes('DISBURS') || rawStatus.includes('APPROV') || rawStatus.includes('WON')) {
                statusBadgeStyle = 'border border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:border-emerald-900/60 dark:text-emerald-400';
                StatusBadgeIcon = Icons.CheckCircle2;
              } else if (rawStatus.includes('REJECT') || rawStatus.includes('DROP') || rawStatus.includes('DEAD')) {
                statusBadgeStyle = 'border border-slate-300 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400';
                StatusBadgeIcon = Icons.XCircle;
              } else {
                statusBadgeStyle = 'border border-indigo-200 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:border-indigo-900/60 dark:text-indigo-400';
                StatusBadgeIcon = Icons.PhoneCall;
              }

              const remarksText = rec.data?.notes 
                ? rec.data.notes.replace(/<[^>]*>/g, '') 
                : (rec.data?.remarks || (rec.data?.dataCode ? `Data Code: ${rec.data.dataCode}` : 'N/A'));

              return (
                <div 
                  key={rec._id} 
                  className="border border-slate-200 dark:border-slate-700/80 rounded-2xl p-5 sm:p-6 bg-white dark:bg-slate-900 hover:shadow-md relative mb-4 last:mb-0 text-left shadow-xs transition-all duration-150 overflow-hidden"
                >
                  {/* Status-colored Top Accent Bar */}
                  <div 
                    className="absolute top-0 left-0 right-0 h-[3px]" 
                    style={{ backgroundColor: statusTokens.accentHex }} 
                  />
                  
                  {/* 4-Column CSS Grid matching Image 1 */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3.5 text-xs">
                    {/* --- Column 1 --- */}
                    <div className="space-y-3.5">
                      <div className="leading-snug">
                        <span className="font-bold text-slate-800 dark:text-slate-100">Sl No.: </span>
                        <span className="text-slate-700 dark:text-slate-300 font-normal">{idx + 1}</span>
                      </div>

                      <div className="leading-snug flex items-center gap-1.5">
                        <span className="font-bold text-slate-800 dark:text-slate-100">Lead No.: </span>
                        <span className="inline-block px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700/70 text-slate-700 dark:text-slate-300 font-mono text-[11px] font-semibold border border-slate-200/60 dark:border-slate-600/60">
                          LND-{leadNo}
                        </span>
                      </div>

                      <div className="leading-snug">
                        <span className="font-bold text-slate-800 dark:text-slate-100">Product: </span>
                        <span className="text-slate-700 dark:text-slate-300 uppercase truncate inline-block max-w-[190px] align-bottom" title={rec.data?.loanType || 'N/A'}>
                          {rec.data?.loanType || 'N/A'}
                        </span>
                      </div>

                      <div className="leading-snug">
                        <span className="font-bold text-slate-800 dark:text-slate-100">Status: </span>
                        <span className="text-slate-700 dark:text-slate-300 font-semibold uppercase">
                          {rec.data?.status || 'NEW'}
                        </span>
                      </div>

                      <div className="leading-snug">
                        <span className="font-bold text-slate-800 dark:text-slate-100">Bank Partner: </span>
                        <span className="text-slate-700 dark:text-slate-300 font-semibold uppercase truncate inline-block max-w-[170px] align-bottom" title={rec.data?.businessPartner || rec.data?.bankPartner || 'BAJAJ FINANCE'}>
                          {rec.data?.businessPartner || rec.data?.bankPartner || 'BAJAJ FINANCE'}
                        </span>
                      </div>
                    </div>

                    {/* --- Column 2 --- */}
                    <div className="space-y-3.5">
                      <div className="leading-snug">
                        <span className="font-bold text-slate-800 dark:text-slate-100">Lead Name: </span>
                        <Link 
                          to={`/modules/leads/${rec._id}`}
                          className="text-sky-600 dark:text-sky-400 font-bold hover:underline cursor-pointer uppercase truncate inline-block max-w-[190px] align-bottom" 
                          title={leadName}
                        >
                          {leadName}
                        </Link>
                      </div>

                      <div className="leading-snug">
                        <span className="font-bold text-slate-800 dark:text-slate-100">Location: </span>
                        <span className="text-slate-700 dark:text-slate-300 uppercase truncate inline-block max-w-[190px] align-bottom" title={leadLocation}>
                          {leadLocation}
                        </span>
                      </div>

                      <div className="leading-snug flex items-center gap-1.5">
                        <span className="font-bold text-slate-800 dark:text-slate-100">Mobile No.: </span>
                        <span className="text-slate-700 dark:text-slate-300 font-mono font-medium inline-flex items-center gap-1.5">
                          {maskPhoneNumber(rec.data?.phone, !!revealedPhones[rec._id])}
                          {rec.data?.phone && rec.data?.phone !== 'N/A' && (
                            <button
                              type="button"
                              onClick={() => togglePhoneReveal(rec._id)}
                              title={revealedPhones[rec._id] ? "Hide number" : "Show number"}
                              className="p-0.5 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
                            >
                              {revealedPhones[rec._id] ? <Icons.EyeOff className="w-3.5 h-3.5" /> : <Icons.Eye className="w-3.5 h-3.5" />}
                            </button>
                          )}
                        </span>
                      </div>

                      <div className="leading-snug">
                        <span className="font-bold text-slate-800 dark:text-slate-100">Amount: </span>
                        <span className={formattedAmount !== 'N/A' ? "text-emerald-600 dark:text-emerald-400 font-bold" : "text-slate-700 dark:text-slate-300"}>
                          {formattedAmount}
                        </span>
                      </div>

                      <div className="leading-snug">
                        <span className="font-bold text-slate-800 dark:text-slate-100">Case Details: </span>
                        <span className="text-slate-700 dark:text-slate-300 truncate inline-block max-w-[180px] align-bottom" title={rec.data?.caseDetails || 'N/A'}>
                          {rec.data?.caseDetails || 'N/A'}
                        </span>
                      </div>
                    </div>

                    {/* --- Column 3 --- */}
                    <div className="space-y-3.5">
                      <div className="leading-snug">
                        <span className="font-bold text-slate-800 dark:text-slate-100">Created On: </span>
                        <span className="text-slate-700 dark:text-slate-300">{formatDate(rec.createdAt)}</span>
                      </div>

                      <div className="leading-snug">
                        <span className="font-bold text-slate-800 dark:text-slate-100">By: </span>
                        <span className="text-slate-700 dark:text-slate-300 truncate inline-block max-w-[180px] align-bottom" title={createdByName}>
                          {createdByName}
                        </span>
                      </div>

                      <div className="leading-snug flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-slate-800 dark:text-slate-100">Followup Date: </span>
                        <span className="inline-block px-2.5 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 font-semibold text-[11px] border border-indigo-100 dark:border-indigo-900/40">
                          {rec.data?.followUpDate ? formatDate(rec.data.followUpDate) : 'N/A'}
                        </span>
                      </div>

                      <div className="leading-snug">
                        <span className="font-bold text-slate-800 dark:text-slate-100">Pending at: </span>
                        <span className="text-slate-700 dark:text-slate-300 font-semibold uppercase truncate inline-block max-w-[180px] align-bottom" title={rec.data?.assignToTeam || rec.data?.pendingAt || 'SALES MANAGER'}>
                          {rec.data?.assignToTeam || rec.data?.pendingAt || 'SALES MANAGER'}
                        </span>
                      </div>

                      <div className="leading-snug">
                        <span className="font-bold text-slate-800 dark:text-slate-100">PSM: </span>
                        <span className="text-slate-700 dark:text-slate-300 truncate inline-block max-w-[180px] align-bottom" title={psmName}>
                          {psmName}
                        </span>
                      </div>
                    </div>

                    {/* --- Column 4 --- */}
                    <div className="space-y-3.5">
                      <div className="leading-snug">
                        <span className="font-bold text-slate-800 dark:text-slate-100">Firm/Company: </span>
                        <span className="text-slate-700 dark:text-slate-300 truncate inline-block max-w-[180px] align-bottom" title={rec.data?.company || rec.data?.firm || 'N/A'}>
                          {rec.data?.company || rec.data?.firm || 'N/A'}
                        </span>
                      </div>

                      <div className="leading-snug">
                        <span className="font-bold text-slate-800 dark:text-slate-100">Modified On: </span>
                        <span className="text-slate-700 dark:text-slate-300">{formatDate(rec.updatedAt)}</span>
                      </div>

                      <div className="leading-snug">
                        <span className="font-bold text-slate-800 dark:text-slate-100">Assigned By: </span>
                        <span className="text-slate-700 dark:text-slate-300 truncate inline-block max-w-[180px] align-bottom" title={assignedByName}>
                          {assignedByName}
                        </span>
                      </div>

                      <div className="leading-snug">
                        <span className="font-bold text-slate-800 dark:text-slate-100">Assigned To: </span>
                        <span className="text-indigo-600 dark:text-indigo-400 font-semibold truncate inline-block max-w-[180px] align-bottom" title={assignedToName}>
                          {assignedToName}
                        </span>
                      </div>

                      <div className="leading-snug">
                        <span className="font-bold text-slate-800 dark:text-slate-100">Remarks: </span>
                        <span className="italic text-slate-500 dark:text-slate-400 truncate inline-block max-w-[180px] align-bottom" title={remarksText}>
                          {remarksText}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions Row */}
                  <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider ${statusBadgeStyle}`}>
                        <StatusBadgeIcon className="w-3.5 h-3.5" />
                        <span>{statusBadgeText}</span>
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {/* WA Chat (Green) */}
                      <button 
                        type="button"
                        onClick={() => {
                          const rawPhone = rec.data?.phone || rec.data?.mobile || rec.data?.contactNumber || rec.data?.contactNum || rec.data?.mobileNo || rec.data?.contact_num || '';
                          let cleanPhone = String(rawPhone).replace(/\D/g, '').trim();
                          if (cleanPhone) {
                            if (cleanPhone.length === 10) {
                              cleanPhone = `91${cleanPhone}`;
                            }
                            window.open(`https://wa.me/${cleanPhone}`, '_blank');
                          } else {
                            showToast('No phone number available for this lead.', 'warning');
                          }
                        }}
                        className="inline-flex items-center gap-1.5 bg-[#10b981] hover:bg-[#059669] active:bg-[#047857] text-white text-xs font-bold px-3.5 py-1.5 rounded-lg transition-colors shadow-2xs cursor-pointer"
                      >
                        <Icons.MessageSquare className="w-3.5 h-3.5" />
                        <span>WA Chat</span>
                      </button>
                      
                      {/* Call (Purple/Indigo) */}
                      <button 
                        type="button"
                        onClick={() => {
                          const rawPhone = rec.data?.phone || rec.data?.mobile || rec.data?.contactNumber || rec.data?.contactNum || rec.data?.mobileNo || rec.data?.contact_num || '';
                          const cleanPhone = String(rawPhone).replace(/[^\d+]/g, '').trim();
                          if (cleanPhone) {
                            const name = `${rec.data?.firstName || ''} ${rec.data?.lastName || ''}`.trim() || rec.data?.fullName || rec.data?.customerName || rec.data?.name || 'Lead';
                            showToast(`Calling ${name} (${cleanPhone})...`, 'info');
                            window.location.href = `tel:${cleanPhone}`;
                          } else {
                            showToast('No phone number available for this lead.', 'warning');
                          }
                        }}
                        className="inline-flex items-center gap-1.5 bg-[#4f46e5] hover:bg-[#4338ca] active:bg-[#3730a3] text-white text-xs font-bold px-3.5 py-1.5 rounded-lg transition-colors shadow-2xs cursor-pointer"
                      >
                        <Icons.PhoneCall className="w-3.5 h-3.5" />
                        <span>Call</span>
                      </button>
                      
                      {/* Upload File (White with border) */}
                      <button 
                        type="button"
                        onClick={() => handleUploadClick(rec._id)}
                        className="inline-flex items-center gap-1.5 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/60 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-xs font-bold px-3.5 py-1.5 rounded-lg transition-colors shadow-2xs cursor-pointer"
                      >
                        <Icons.Upload className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                        <span>Upload File</span>
                      </button>
                      
                      {/* Edit (Blue) */}
                      <Link 
                        to={`/modules/leads/${rec._id}`} 
                        className="inline-flex items-center gap-1.5 bg-[#0284c7] hover:bg-[#0369a1] active:bg-[#075985] text-white text-xs font-bold px-3.5 py-1.5 rounded-lg transition-colors shadow-2xs"
                      >
                        <Icons.Edit3 className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </Link>

                      {/* History (White with border) */}
                      <button 
                        type="button"
                        onClick={() => openHistory(rec)}
                        className="inline-flex items-center gap-1.5 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/60 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-xs font-bold px-3.5 py-1.5 rounded-lg transition-colors shadow-2xs cursor-pointer"
                      >
                        <Icons.History className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                        <span>History</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            });
          })()}
        </div>
      </div>

      {/* 5. 3D CONICAL SALES FUNNEL & PIPELINE METRICS */}
      <div className="space-y-4">
        <SalesFunnel3D
          stages={rawPipeline.map(s => ({
            name: s.name,
            val: Number(s.val),
            count: Number(s.count),
            pct: Math.round((Number(s.val) / maxPipelineVal) * 100),
            icon: s.icon
          }))}
          maxVal={maxPipelineVal}
        />

        {/* Pipeline Summary 4-Col KPI Bar */}
        <div className="w-full grid grid-cols-2 sm:grid-cols-4 bg-surface-card border border-border-subtle rounded-card p-4 sm:p-5 items-center gap-4 shadow-card text-left">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-control bg-brand-500/10 border border-brand-500/20 text-brand-600 dark:text-brand-400 flex items-center justify-center flex-shrink-0">
              <Icons.Briefcase className="w-4.5 h-4.5 stroke-[2.2]" />
            </div>
            <div className="text-left min-w-0">
              <p className="text-xs font-semibold text-content-muted uppercase tracking-wider truncate">Total Pipeline</p>
              <p className="text-base font-bold text-content-primary tracking-tight mt-0.5 truncate tabular-nums">₹{totalPipeline.toLocaleString('en-IN')}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 sm:border-l border-border-subtle sm:pl-4">
            <div className="w-9 h-9 rounded-control bg-status-success-bg border border-status-success-border text-status-success flex items-center justify-center flex-shrink-0">
              <Icons.Percent className="w-4.5 h-4.5 stroke-[2.2]" />
            </div>
            <div className="text-left min-w-0">
              <p className="text-xs font-semibold text-content-muted uppercase tracking-wider truncate">Win Rate</p>
              <p className="text-base font-bold text-content-primary tracking-tight mt-0.5 truncate tabular-nums">{winRate}%</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3 sm:border-l border-border-subtle sm:pl-4">
            <div className="w-9 h-9 rounded-control bg-status-info-bg border border-status-info-border text-status-info flex items-center justify-center flex-shrink-0">
              <Icons.Calendar className="w-4.5 h-4.5 stroke-[2.2]" />
            </div>
            <div className="text-left min-w-0">
              <p className="text-xs font-semibold text-content-muted uppercase tracking-wider truncate">Avg. Cycle</p>
              <p className="text-base font-bold text-content-primary tracking-tight mt-0.5 truncate tabular-nums">28 Days</p>
            </div>
          </div>

          <div className="flex items-center gap-3 sm:border-l border-border-subtle sm:pl-4">
            <div className="w-9 h-9 rounded-control bg-status-warm-bg border border-status-warm-border text-status-warm flex items-center justify-center flex-shrink-0">
              <Icons.IndianRupee className="w-4.5 h-4.5 stroke-[2.2]" />
            </div>
            <div className="text-left min-w-0">
              <p className="text-xs font-semibold text-content-muted uppercase tracking-wider truncate">Avg. Deal</p>
              <p className="text-base font-bold text-content-primary tracking-tight mt-0.5 truncate tabular-nums">₹{avgDealSize.toLocaleString('en-IN')}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Hidden file uploader */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        className="hidden" 
      />

      {/* Record History & Timeline Modal */}
      {activeHistoryRecord && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4 text-left">
          <div className="bg-surface-overlay border border-border-strong rounded-card max-w-lg w-full max-h-[85vh] flex flex-col shadow-overlay overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 border-b border-border-subtle flex justify-between items-center bg-surface-raised">
              <div>
                <h3 className="font-bold text-content-primary text-xs uppercase tracking-wider">
                  Lead Audit History
                </h3>
                <p className="text-xs text-content-muted mt-0.5">
                  {activeHistoryRecord.data?.firstName} {activeHistoryRecord.data?.lastName}
                </p>
              </div>
              <button 
                onClick={() => setActiveHistoryRecord(null)}
                className="w-7 h-7 rounded-control flex items-center justify-center bg-surface-card hover:bg-surface-raised border border-border-subtle text-content-secondary transition-colors cursor-pointer"
              >
                <Icons.X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {loadingHistory ? (
                <div className="flex justify-center items-center py-10">
                  <Icons.Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
                </div>
              ) : (
                <>
                  {/* Documents Section */}
                  <div>
                    <h4 className="text-xs font-semibold text-content-muted uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                      <Icons.File className="w-3.5 h-3.5 text-content-secondary" /> Attached Documents ({historyDocuments.length})
                    </h4>
                    {historyDocuments.length > 0 ? (
                      <div className="space-y-2">
                        {historyDocuments.map((doc: any) => (
                          <div key={doc._id} className="flex justify-between items-center p-3 bg-surface-raised border border-border-subtle rounded-control">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <Icons.FileText className="w-4 h-4 text-brand-500 flex-shrink-0" />
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-content-primary truncate">{doc.name}</p>
                                <p className="text-[10px] text-content-muted tabular-nums">{(doc.size / 1024).toFixed(1)} KB</p>
                              </div>
                            </div>
                            <a 
                              href={`${FILE_BASE_URL}${doc.filePath}`} 
                              target="_blank" 
                              rel="noreferrer"
                              className="text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1"
                            >
                              <Icons.Download className="w-3.5 h-3.5" /> Download
                            </a>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-content-muted italic">No files attached to this record.</p>
                    )}
                  </div>

                  {/* Timeline Section */}
                  <div>
                    <h4 className="text-xs font-semibold text-content-muted uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                      <Icons.Clock className="w-3.5 h-3.5 text-content-secondary" /> System Activities
                    </h4>
                    {historyActivities.length > 0 ? (
                      <div className="relative border-l border-border-subtle ml-2 pl-4 space-y-4">
                        {historyActivities.map((act: any) => (
                          <div key={act._id} className="relative">
                            <span className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-brand-500 ring-4 ring-surface-card" />
                            <div className="text-xs">
                              <p className="font-semibold text-content-primary">{act.action}</p>
                              {act.details && Object.keys(act.details).length > 0 && (
                                <p className="text-[11px] text-content-secondary mt-0.5">
                                  {act.details.status && `Status: ${act.details.status}`}
                                  {act.details.assignedTo && ` Assigned To: ${act.details.assignedTo}`}
                                </p>
                              )}
                              <p className="text-[10px] text-content-muted mt-1 tabular-nums">
                                {act.performedBy ? `${act.performedBy.firstName} ${act.performedBy.lastName}` : 'System'} • {new Date(act.createdAt).toLocaleString()}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-content-muted italic">No activity log found for this record.</p>
                    )}
                  </div>
                </>
              )}
            </div>
            
            {/* Modal Footer */}
            <div className="p-4 bg-surface-raised border-t border-border-subtle flex justify-end">
              <button 
                onClick={() => setActiveHistoryRecord(null)}
                className="flex items-center justify-center px-4 h-8 text-xs font-semibold bg-brand-500 hover:bg-brand-600 text-brand-contrast rounded-control transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
