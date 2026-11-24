import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as Icons from 'lucide-react';
import api from '../services/api';
import { useToastStore } from '../store/toastStore';
import { exportFunnelAnalyticsXLSX } from '../utils/exportFunnelAnalyticsXLSX';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';

export type FunnelPeriod = 'daily' | 'monthly' | 'annual';
export type DatePreset =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'this_month'
  | 'last_month'
  | 'this_year'
  | 'last_year'
  | 'custom';

interface FunnelAnalyticsDashboardProps {
  defaultPeriod?: FunnelPeriod;
  defaultPreset?: DatePreset;
}

interface FunnelStage {
  id: string;
  name: string;
  color: string;
  icon: string;
  order: number;
  count: number;
  percentage: number;
  progressionRate: number;
  dropOffRate: number;
  isSuccess: boolean;
  isFinal: boolean;
}

interface SummaryData {
  totalLeads: number;
  newLeads: number;
  activeLeads: number;
  convertedLeads: number;
  lostLeads: number;
  overallConversionRate: number;
  comparison?: {
    previousTotalLeads: number;
    previousConvertedLeads: number;
    previousConversionRate: number;
    leadGrowthPct: number;
    conversionRateDiff: number;
  };
}

export default function FunnelAnalyticsDashboard({
  defaultPeriod = 'daily',
  defaultPreset = 'today'
}: FunnelAnalyticsDashboardProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { showToast } = useToastStore();

  // Period & Preset state
  const [period, setPeriod] = useState<FunnelPeriod>(() => {
    const qPeriod = searchParams.get('period') as FunnelPeriod;
    if (qPeriod && ['daily', 'monthly', 'annual'].includes(qPeriod)) return qPeriod;
    return defaultPeriod;
  });

  const [datePreset, setDatePreset] = useState<DatePreset>(() => {
    const qPreset = searchParams.get('preset') as DatePreset;
    if (
      qPreset &&
      [
        'today',
        'yesterday',
        'this_week',
        'this_month',
        'last_month',
        'this_year',
        'last_year',
        'custom'
      ].includes(qPreset)
    ) {
      return qPreset;
    }
    if (defaultPeriod === 'monthly') return 'this_month';
    if (defaultPeriod === 'annual') return 'this_year';
    return defaultPreset;
  });

  // Custom date inputs
  const [customStartDate, setCustomStartDate] = useState<string>(() => {
    return searchParams.get('startDate') || new Date().toISOString().slice(0, 10);
  });
  const [customEndDate, setCustomEndDate] = useState<string>(() => {
    return searchParams.get('endDate') || new Date().toISOString().slice(0, 10);
  });

  // Filters
  const [selectedCampaign, setSelectedCampaign] = useState<string>(() => searchParams.get('campaign') || 'ALL');
  const [selectedAgent, setSelectedAgent] = useState<string>(() => searchParams.get('agent') || 'ALL');

  // Data states
  const [loading, setLoading] = useState<boolean>(true);
  const [exporting, setExporting] = useState<boolean>(false);
  const [summary, setSummary] = useState<SummaryData>({
    totalLeads: 0,
    newLeads: 0,
    activeLeads: 0,
    convertedLeads: 0,
    lostLeads: 0,
    overallConversionRate: 0
  });
  const [funnelStages, setFunnelStages] = useState<FunnelStage[]>([]);
  const [stageDistribution, setStageDistribution] = useState<any[]>([]);
  const [trends, setTrends] = useState<any[]>([]);
  const [campaignsList, setCampaignsList] = useState<string[]>([]);
  const [agentsList, setAgentsList] = useState<any[]>([]);
  const [dateRangeInfo, setDateRangeInfo] = useState<{ startDate: string; endDate: string; formatted: string }>({
    startDate: '',
    endDate: '',
    formatted: ''
  });
  const [previousRangeInfo, setPreviousRangeInfo] = useState<{ startDate: string; endDate: string; formatted: string }>({
    startDate: '',
    endDate: '',
    formatted: ''
  });

  // Load registered agents once
  useEffect(() => {
    api
      .get('/auth/users')
      .then((res) => {
        const users = Array.isArray(res.data) ? res.data : res.data?.users || [];
        setAgentsList(users);
      })
      .catch(() => {});
  }, []);

  // Sync state to URL params cleanly
  const updateUrl = useCallback(
    (newPeriod: FunnelPeriod, newPreset: DatePreset) => {
      const p = new URLSearchParams(searchParams);
      p.set('period', newPeriod);
      p.set('preset', newPreset);
      if (selectedCampaign && selectedCampaign !== 'ALL') p.set('campaign', selectedCampaign);
      else p.delete('campaign');
      if (selectedAgent && selectedAgent !== 'ALL') p.set('agent', selectedAgent);
      else p.delete('agent');
      if (newPreset === 'custom') {
        p.set('startDate', customStartDate);
        p.set('endDate', customEndDate);
      } else {
        p.delete('startDate');
        p.delete('endDate');
      }
      setSearchParams(p, { replace: true });
    },
    [searchParams, selectedCampaign, selectedAgent, customStartDate, customEndDate, setSearchParams]
  );

  // Main data fetcher
  const fetchFunnelData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = {
        period,
        datePreset,
        campaign: selectedCampaign,
        agent: selectedAgent
      };

      if (datePreset === 'custom') {
        params.startDate = customStartDate;
        params.endDate = customEndDate;
      }

      const res = await api.get('/reports/funnel-analytics', { params });
      const data = res.data || {};

      setSummary(data.summary || {});
      setFunnelStages(data.funnelStages || []);
      setStageDistribution(data.stageDistribution || []);
      setTrends(data.trends || []);
      if (Array.isArray(data.campaignsList)) {
        setCampaignsList(data.campaignsList);
      }
      if (data.dateRange) setDateRangeInfo(data.dateRange);
      if (data.previousDateRange) setPreviousRangeInfo(data.previousDateRange);
    } catch (err: any) {
      console.error('Error fetching funnel analytics:', err);
      showToast(err.response?.data?.error || 'Failed to load funnel analytics', 'error');
    } finally {
      setLoading(false);
    }
  }, [
    period,
    datePreset,
    selectedCampaign,
    selectedAgent,
    customStartDate,
    customEndDate,
    showToast
  ]);

  useEffect(() => {
    fetchFunnelData();
  }, [fetchFunnelData]);

  // Handle period change
  const handlePeriodChange = (newPeriod: FunnelPeriod) => {
    setPeriod(newPeriod);
    let newPreset: DatePreset = 'today';
    if (newPeriod === 'monthly') newPreset = 'this_month';
    if (newPeriod === 'annual') newPreset = 'this_year';
    setDatePreset(newPreset);
    updateUrl(newPeriod, newPreset);
  };

  // Handle preset change
  const handlePresetChange = (newPreset: DatePreset) => {
    setDatePreset(newPreset);
    updateUrl(period, newPreset);
  };

  // Export summary & pipeline matrix to Excel
  const handleExportXLSX = async () => {
    setExporting(true);
    try {
      const params: Record<string, any> = {
        period,
        datePreset,
        campaign: selectedCampaign,
        agent: selectedAgent
      };
      if (datePreset === 'custom') {
        params.startDate = customStartDate;
        params.endDate = customEndDate;
      }
      const res = await api.get('/reports/funnel-analytics', { params });
      const exportPayload = res.data;

      exportFunnelAnalyticsXLSX({
        period,
        datePreset,
        dateRange: exportPayload.dateRange || dateRangeInfo,
        previousDateRange: exportPayload.previousDateRange || previousRangeInfo,
        summary: exportPayload.summary || summary,
        funnelStages: exportPayload.funnelStages || funnelStages
      });

      showToast('Funnel report exported successfully', 'success');
    } catch (err: any) {
      console.error('Export error:', err);
      showToast('Failed to export funnel data', 'error');
    } finally {
      setExporting(false);
    }
  };

  // Helper for delta badge
  const renderComparisonBadge = (currentVal: number, prevVal?: number, isPercentage: boolean = false) => {
    if (prevVal === undefined || prevVal === null) return null;
    const diff = Number((currentVal - prevVal).toFixed(1));
    const isPositive = diff > 0;
    const isZero = diff === 0;

    const prevLabel =
      period === 'daily'
        ? 'prev day'
        : period === 'monthly'
        ? 'prev month'
        : 'prev year';

    if (isZero) {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
          <span>0.0% vs {prevLabel}</span>
        </span>
      );
    }

    return (
      <span
        className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${
          isPositive
            ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/60'
            : 'text-rose-700 bg-rose-50 dark:text-rose-300 dark:bg-rose-950/60'
        }`}
      >
        {isPositive ? <Icons.TrendingUp className="w-3 h-3" /> : <Icons.TrendingDown className="w-3 h-3" />}
        <span>
          {isPositive ? '+' : ''}
          {diff}
          {isPercentage ? '%' : ''} vs {prevLabel}
        </span>
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-[#F7F9FC] dark:bg-slate-950 text-[#1E293B] dark:text-slate-100 p-4 sm:p-6 lg:p-8 space-y-6">
      {/* 1. TOP HEADER & CONTROL SECTION */}
      <div className="bg-white dark:bg-slate-900 border border-[#E2E8F0] dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-[#E2E8F0] dark:border-slate-800 pb-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-[#2563EB]/10 dark:bg-blue-500/20 text-[#2563EB] dark:text-blue-400 flex items-center justify-center font-bold">
                <Icons.Filter className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-black text-[#1E3A5F] dark:text-white tracking-tight">
                  CRM Funnel & Conversion Analytics
                </h1>
                <p className="text-xs sm:text-sm text-[#64748B] dark:text-slate-400">
                  Real-time pipeline progression, stage-wise conversion rates, and volume velocity.
                </p>
              </div>
            </div>
          </div>

          {/* Period Selection Tabs (Daily / Monthly / Annual) */}
          <div className="flex items-center gap-1.5 bg-[#F1F5F9] dark:bg-slate-800 p-1.5 rounded-xl border border-[#E2E8F0] dark:border-slate-700">
            <button
              onClick={() => handlePeriodChange('daily')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all ${
                period === 'daily'
                  ? 'bg-white dark:bg-slate-900 text-[#2563EB] dark:text-blue-400 shadow-sm'
                  : 'text-[#64748B] dark:text-slate-400 hover:text-[#1E293B] dark:hover:text-white'
              }`}
            >
              <Icons.Calendar className="w-3.5 h-3.5" />
              <span>Daily Funnel</span>
            </button>
            <button
              onClick={() => handlePeriodChange('monthly')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all ${
                period === 'monthly'
                  ? 'bg-white dark:bg-slate-900 text-[#2563EB] dark:text-blue-400 shadow-sm'
                  : 'text-[#64748B] dark:text-slate-400 hover:text-[#1E293B] dark:hover:text-white'
              }`}
            >
              <Icons.CalendarDays className="w-3.5 h-3.5" />
              <span>Monthly Funnel</span>
            </button>
            <button
              onClick={() => handlePeriodChange('annual')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all ${
                period === 'annual'
                  ? 'bg-white dark:bg-slate-900 text-[#2563EB] dark:text-blue-400 shadow-sm'
                  : 'text-[#64748B] dark:text-slate-400 hover:text-[#1E293B] dark:hover:text-white'
              }`}
            >
              <Icons.TrendingUp className="w-3.5 h-3.5" />
              <span>Annual Funnel</span>
            </button>
          </div>
        </div>

        {/* Dynamic Date Filter Presets & Dropdowns */}
        <div className="pt-4 flex flex-wrap items-center justify-between gap-3">
          {/* Presets pill buttons */}
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'today', label: 'Today' },
              { id: 'yesterday', label: 'Yesterday' },
              { id: 'this_week', label: 'This Week' },
              { id: 'this_month', label: 'This Month' },
              { id: 'last_month', label: 'Last Month' },
              { id: 'this_year', label: 'This Year' },
              { id: 'last_year', label: 'Last Year' },
              { id: 'custom', label: 'Custom Range' }
            ].map((preset) => (
              <button
                key={preset.id}
                onClick={() => handlePresetChange(preset.id as DatePreset)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                  datePreset === preset.id
                    ? 'bg-[#1E3A5F] text-white border-[#1E3A5F] shadow-xs'
                    : 'bg-white dark:bg-slate-800 text-[#64748B] dark:text-slate-300 border-[#E2E8F0] dark:border-slate-700 hover:bg-slate-50'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Action buttons: Refresh & Export */}
          <div className="flex items-center gap-2">
            <button
              onClick={fetchFunnelData}
              disabled={loading}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-white dark:bg-slate-800 border border-[#E2E8F0] dark:border-slate-700 text-[#1E293B] dark:text-white hover:bg-slate-50 transition-all shadow-xs"
              title="Refresh CRM Data"
            >
              <Icons.RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-600' : ''}`} />
              <span>Refresh</span>
            </button>
            <button
              onClick={handleExportXLSX}
              disabled={exporting || loading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-[#16A34A] hover:bg-emerald-700 text-white transition-all shadow-xs"
              title="Download Funnel Report XLSX"
            >
              <Icons.Download className="w-3.5 h-3.5" />
              <span>{exporting ? 'Exporting...' : 'Export XLSX'}</span>
            </button>
          </div>
        </div>

        {/* Custom Date Pickers & Campaign/Agent Filter Selectors */}
        <div className="mt-4 pt-3 border-t border-[#E2E8F0] dark:border-slate-800/80 flex flex-wrap items-center gap-3">
          {datePreset === 'custom' && (
            <div className="flex items-center gap-2 bg-[#F8FAFC] dark:bg-slate-800/60 p-1.5 rounded-xl border border-[#E2E8F0] dark:border-slate-700">
              <span className="text-xs font-bold text-[#64748B] pl-2">From:</span>
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="bg-white dark:bg-slate-900 border border-[#CBD5E1] dark:border-slate-700 text-xs rounded-lg px-2.5 py-1 text-[#1E293B] dark:text-white font-medium focus:ring-2 focus:ring-blue-500 outline-hidden"
              />
              <span className="text-xs font-bold text-[#64748B]">To:</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="bg-white dark:bg-slate-900 border border-[#CBD5E1] dark:border-slate-700 text-xs rounded-lg px-2.5 py-1 text-[#1E293B] dark:text-white font-medium focus:ring-2 focus:ring-blue-500 outline-hidden"
              />
              <button
                onClick={fetchFunnelData}
                className="px-3 py-1 bg-[#2563EB] text-white text-xs font-bold rounded-lg hover:bg-blue-700 transition"
              >
                Apply
              </button>
            </div>
          )}

          {/* Campaign Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-[#64748B] dark:text-slate-400">Campaign:</span>
            <select
              value={selectedCampaign}
              onChange={(e) => setSelectedCampaign(e.target.value)}
              className="bg-white dark:bg-slate-800 border border-[#CBD5E1] dark:border-slate-700 text-xs font-semibold rounded-xl px-3 py-1.5 text-[#1E293B] dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden shadow-xs"
            >
              <option value="ALL">All Campaigns</option>
              {campaignsList.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Agent Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-[#64748B] dark:text-slate-400">Agent:</span>
            <select
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
              className="bg-white dark:bg-slate-800 border border-[#CBD5E1] dark:border-slate-700 text-xs font-semibold rounded-xl px-3 py-1.5 text-[#1E293B] dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden shadow-xs"
            >
              <option value="ALL">All Telecallers / Agents</option>
              {agentsList.map((u) => {
                const name = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.name || u.email;
                return (
                  <option key={u.id || u._id} value={name}>
                    {name}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Date Range Badge */}
          {dateRangeInfo.formatted && (
            <div className="ml-auto flex items-center gap-2 text-xs font-bold text-[#1E3A5F] dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 px-3 py-1.5 rounded-xl border border-blue-200 dark:border-blue-900">
              <Icons.Clock className="w-3.5 h-3.5 text-[#2563EB]" />
              <span>Active Period: {dateRangeInfo.formatted}</span>
            </div>
          )}
        </div>
      </div>

      {/* 2. SUMMARY KPI CARDS (6 CARDS) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {/* Total Leads */}
        <div className="bg-white dark:bg-slate-900 border border-[#E2E8F0] dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 left-0 right-0 h-1 bg-[#1E3A5F]" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-[#64748B] dark:text-slate-400">
              Total Leads
            </span>
            <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-[#1E3A5F] dark:text-white flex items-center justify-center">
              <Icons.Layers className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-black text-[#1E293B] dark:text-white">
              {summary.totalLeads?.toLocaleString() ?? 0}
            </div>
            <div className="mt-2 flex items-center gap-1">
              {renderComparisonBadge(summary.totalLeads, summary.comparison?.previousTotalLeads)}
            </div>
          </div>
        </div>

        {/* New Leads */}
        <div className="bg-white dark:bg-slate-900 border border-[#E2E8F0] dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 left-0 right-0 h-1 bg-[#2563EB]" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-[#64748B] dark:text-slate-400">
              New Leads
            </span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-[#2563EB] flex items-center justify-center">
              <Icons.UserPlus className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-black text-[#2563EB] dark:text-blue-400">
              {summary.newLeads?.toLocaleString() ?? 0}
            </div>
            <div className="mt-2 text-[11px] font-semibold text-[#64748B] dark:text-slate-400">
              Generated in selected period
            </div>
          </div>
        </div>

        {/* Active Pipeline */}
        <div className="bg-white dark:bg-slate-900 border border-[#E2E8F0] dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 left-0 right-0 h-1 bg-[#0F9D8A]" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-[#64748B] dark:text-slate-400">
              Active Pipeline
            </span>
            <div className="w-8 h-8 rounded-lg bg-teal-50 dark:bg-teal-950/50 text-[#0F9D8A] flex items-center justify-center">
              <Icons.Activity className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-black text-[#0F9D8A]">
              {summary.activeLeads?.toLocaleString() ?? 0}
            </div>
            <div className="mt-2 text-[11px] font-semibold text-[#64748B] dark:text-slate-400">
              In progress & qualifying
            </div>
          </div>
        </div>

        {/* Converted Leads */}
        <div className="bg-white dark:bg-slate-900 border border-[#E2E8F0] dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 left-0 right-0 h-1 bg-[#16A34A]" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-[#64748B] dark:text-slate-400">
              Converted / Won
            </span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-[#16A34A] flex items-center justify-center">
              <Icons.CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-black text-[#16A34A]">
              {summary.convertedLeads?.toLocaleString() ?? 0}
            </div>
            <div className="mt-2 flex items-center gap-1">
              {renderComparisonBadge(summary.convertedLeads, summary.comparison?.previousConvertedLeads)}
            </div>
          </div>
        </div>

        {/* Lost Leads */}
        <div className="bg-white dark:bg-slate-900 border border-[#E2E8F0] dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 left-0 right-0 h-1 bg-[#DC2626]" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-[#64748B] dark:text-slate-400">
              Lost / Dropped
            </span>
            <div className="w-8 h-8 rounded-lg bg-rose-50 dark:bg-rose-950/50 text-[#DC2626] flex items-center justify-center">
              <Icons.XCircle className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-black text-[#DC2626]">
              {summary.lostLeads?.toLocaleString() ?? 0}
            </div>
            <div className="mt-2 text-[11px] font-semibold text-[#64748B] dark:text-slate-400">
              Closed lost or dropped
            </div>
          </div>
        </div>

        {/* Conversion Rate */}
        <div className="bg-white dark:bg-slate-900 border border-[#E2E8F0] dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 left-0 right-0 h-1 bg-[#F59E0B]" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-[#64748B] dark:text-slate-400">
              Conversion Rate
            </span>
            <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-[#F59E0B] flex items-center justify-center">
              <Icons.Percent className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-black text-[#F59E0B]">
              {summary.overallConversionRate}%
            </div>
            <div className="mt-2 flex items-center gap-1">
              {renderComparisonBadge(
                summary.overallConversionRate,
                summary.comparison?.previousConversionRate,
                true
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 3. VISUAL SALES FUNNEL PIPELINE SECTION */}
      <div className="bg-white dark:bg-slate-900 border border-[#E2E8F0] dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-sm">
        <div className="border-b border-[#E2E8F0] dark:border-slate-800 pb-4 mb-6">
          <h2 className="text-base sm:text-lg font-black text-[#1E3A5F] dark:text-white uppercase tracking-tight">
            Sales Pipeline Funnel Stages
          </h2>
          <p className="text-xs text-[#64748B] dark:text-slate-400">
            Stage-to-stage progression rates and drop-off percentages computed from real lead volume.
          </p>
        </div>

        {funnelStages.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm font-semibold">
            No pipeline stages found for this organization.
          </div>
        ) : (
          <div className="space-y-3">
            {funnelStages.map((stage, idx) => {
              const widthPct = Math.max(18, Math.min(100, stage.percentage));

              return (
                <div
                  key={stage.id || idx}
                  className="rounded-xl p-3.5 border border-[#E2E8F0] dark:border-slate-800 bg-white dark:bg-slate-900/80 shadow-xs"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    {/* Stage Name & Tag */}
                    <div className="flex items-center gap-3 min-w-[200px]">
                      <span className="text-xs font-black text-slate-400 dark:text-slate-500 font-mono w-5">
                        #{stage.order}
                      </span>
                      <div
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: stage.color || '#3B82F6' }}
                      />
                      <div className="truncate">
                        <span className="text-sm font-bold text-[#1E293B] dark:text-white">
                          {stage.name}
                        </span>
                        {stage.isSuccess && (
                          <span className="ml-2 text-[10px] font-black uppercase text-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded-md">
                            Won
                          </span>
                        )}
                        {stage.isFinal && !stage.isSuccess && (
                          <span className="ml-2 text-[10px] font-black uppercase text-rose-600 bg-rose-50 dark:bg-rose-950/60 px-1.5 py-0.5 rounded-md">
                            Final
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Progress Bar Visual */}
                    <div className="flex-1 max-w-xl mx-2">
                      <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-3 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${widthPct}%`,
                            backgroundColor: stage.color || '#3B82F6'
                          }}
                        />
                      </div>
                    </div>

                    {/* Stage Metrics Badges */}
                    <div className="flex items-center gap-4 text-xs font-semibold justify-between md:justify-end">
                      {/* Count & % of Total */}
                      <div className="text-right">
                        <span className="text-sm font-black text-[#1E293B] dark:text-white">
                          {stage.count.toLocaleString()}
                        </span>
                        <span className="text-[11px] text-slate-500 ml-1">({stage.percentage}%)</span>
                      </div>

                      {/* Progression Rate */}
                      {idx > 0 && (
                        <div
                          className="text-[11px] px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-bold"
                          title="Conversion progression from prior stage"
                        >
                          {stage.progressionRate}% flow
                        </div>
                      )}

                      {/* Drop-off */}
                      {idx > 0 && stage.dropOffRate > 0 && (
                        <div
                          className="text-[11px] px-2 py-0.5 rounded-md bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 font-bold"
                          title="Drop-off rate from prior stage"
                        >
                          {stage.dropOffRate}% drop
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. ANALYTICS CHARTS SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Trend Area Chart */}
        <div className="bg-white dark:bg-slate-900 border border-[#E2E8F0] dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-slate-800 pb-3">
            <h3 className="text-sm font-black text-[#1E3A5F] dark:text-white uppercase tracking-tight flex items-center gap-2">
              <Icons.BarChart3 className="w-4 h-4 text-[#2563EB]" />
              <span>Lead Flow & Conversion Velocity</span>
            </h3>
            <span className="text-xs font-semibold text-slate-500">
              {period === 'daily' ? 'Hourly Intervals' : period === 'annual' ? 'Monthly Trend' : 'Daily Trend'}
            </span>
          </div>

          <div className="h-64 sm:h-72 w-full">
            {trends.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-400 text-xs font-semibold">
                No trend data available for selected period
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trends} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563EB" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#2563EB" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorConverted" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#16A34A" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#16A34A" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" opacity={0.6} />
                  <XAxis dataKey="label" stroke="#64748B" fontSize={11} tickLine={false} />
                  <YAxis stroke="#64748B" fontSize={11} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1E293B',
                      color: '#fff',
                      borderRadius: '10px',
                      border: 'none',
                      fontSize: '11px',
                      fontWeight: 600
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', fontWeight: 600 }} />
                  <Area type="monotone" dataKey="Total" stroke="#2563EB" fillOpacity={1} fill="url(#colorTotal)" />
                  <Area
                    type="monotone"
                    dataKey="Converted"
                    stroke="#16A34A"
                    fillOpacity={1}
                    fill="url(#colorConverted)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Stage-wise Distribution Donut */}
        <div className="bg-white dark:bg-slate-900 border border-[#E2E8F0] dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-slate-800 pb-3">
            <h3 className="text-sm font-black text-[#1E3A5F] dark:text-white uppercase tracking-tight flex items-center gap-2">
              <Icons.PieChart className="w-4 h-4 text-[#0F9D8A]" />
              <span>Stage Distribution Breakdown</span>
            </h3>
            <span className="text-xs font-semibold text-slate-500">Live CRM Proportions</span>
          </div>

          <div className="h-64 sm:h-72 w-full">
            {stageDistribution.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-400 text-xs font-semibold">
                No lead distribution data for selected period
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={stageDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={3}
                    dataKey="count"
                    nameKey="name"
                  >
                    {stageDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color || '#3B82F6'} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1E293B',
                      color: '#fff',
                      borderRadius: '10px',
                      border: 'none',
                      fontSize: '11px',
                      fontWeight: 600
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', fontWeight: 600 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
