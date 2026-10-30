import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import * as Icons from 'lucide-react';
import api from '../services/api';
import { useToastStore } from '../store/toastStore';
import {
  exportCampaignMatrixXLSX,
  exportCampaignKPIDataset,
  CampaignMatrixData,
  CampaignSummaryData
} from '../utils/exportCampaignMatrixXLSX';

type PeriodType = 'daily' | 'monthly' | 'annually';

type MetricKey =
  | 'callsMade'
  | 'hotLeads'
  | 'logins'
  | 'approved'
  | 'disbursed'
  | 'targetAchievement';

interface KPICardConfig {
  key: MetricKey;
  label: string;
  pillText: string;
  pillKey: 'dials' | 'hot' | 'logins' | 'approved' | 'disbursed' | 'target';
  icon: any;
  metricParam: string;
  accentBg: string;
  iconBg: string;
  iconColor: string;
  pillBg: string;
  pillTextColor: string;
}

const KPI_CARDS: KPICardConfig[] = [
  {
    key: 'callsMade',
    label: 'CALLS MADE',
    pillText: 'Dials',
    pillKey: 'dials',
    icon: Icons.PhoneCall,
    metricParam: 'callsMade',
    accentBg: 'bg-purple-50/60 dark:bg-purple-950/20',
    iconBg: 'bg-purple-100 dark:bg-purple-900/40',
    iconColor: 'text-purple-600 dark:text-purple-400',
    pillBg: 'bg-purple-100 hover:bg-purple-200 dark:bg-purple-900/60 dark:hover:bg-purple-800',
    pillTextColor: 'text-purple-700 dark:text-purple-200'
  },
  {
    key: 'hotLeads',
    label: 'HOT LEADS',
    pillText: 'Hot',
    pillKey: 'hot',
    icon: Icons.Flame,
    metricParam: 'hotLeads',
    accentBg: 'bg-red-50/60 dark:bg-red-950/20',
    iconBg: 'bg-red-100 dark:bg-red-900/40',
    iconColor: 'text-red-600 dark:text-red-400',
    pillBg: 'bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/60',
    pillTextColor: 'text-red-700 dark:text-red-300'
  },
  {
    key: 'logins',
    label: 'LOGINS',
    pillText: 'Logins',
    pillKey: 'logins',
    icon: Icons.FileCheck,
    metricParam: 'logins',
    accentBg: 'bg-blue-50/60 dark:bg-blue-950/20',
    iconBg: 'bg-blue-100 dark:bg-blue-900/40',
    iconColor: 'text-blue-600 dark:text-blue-400',
    pillBg: 'bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/60',
    pillTextColor: 'text-blue-700 dark:text-blue-300'
  },
  {
    key: 'approved',
    label: 'APPROVED',
    pillText: 'Approved',
    pillKey: 'approved',
    icon: Icons.CheckCircle2,
    metricParam: 'approved',
    accentBg: 'bg-amber-50/60 dark:bg-amber-950/20',
    iconBg: 'bg-amber-100 dark:bg-amber-900/40',
    iconColor: 'text-amber-600 dark:text-amber-400',
    pillBg: 'bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/60',
    pillTextColor: 'text-amber-700 dark:text-amber-300'
  },
  {
    key: 'disbursed',
    label: 'DISBURSED',
    pillText: 'Disbursed',
    pillKey: 'disbursed',
    icon: Icons.Banknote,
    metricParam: 'disbursed',
    accentBg: 'bg-emerald-50/60 dark:bg-emerald-950/20',
    iconBg: 'bg-emerald-100 dark:bg-emerald-900/40',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    pillBg: 'bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/60',
    pillTextColor: 'text-emerald-700 dark:text-emerald-300'
  },
  {
    key: 'targetAchievement',
    label: 'TARGET ACHIEVEMENT',
    pillText: 'Target',
    pillKey: 'target',
    icon: Icons.Award,
    metricParam: 'targetAchievement',
    accentBg: 'bg-rose-50/60 dark:bg-rose-950/20',
    iconBg: 'bg-rose-100 dark:bg-rose-900/40',
    iconColor: 'text-rose-600 dark:text-rose-400',
    pillBg: 'bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60',
    pillTextColor: 'text-rose-700 dark:text-rose-300'
  }
];

interface CampaignReportPageProps {
  initialPeriod?: PeriodType;
}

export default function CampaignReportPage({ initialPeriod = 'daily' }: CampaignReportPageProps) {
  const navigate = useNavigate();
  const { showToast } = useToastStore();

  const [period, setPeriod] = useState<PeriodType>(initialPeriod);
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>('callsMade'); // Card 5 default active like Image 5!
  const [selectedCampaign, setSelectedCampaign] = useState<string>('ALL');
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const m = new Date().getMonth() + 1;
    return m < 10 ? `0${m}` : `${m}`;
  });
  const [selectedYear, setSelectedYear] = useState<string>(() => String(new Date().getFullYear()));
  const [searchCaller, setSearchCaller] = useState<string>('');

  useEffect(() => {
    if (initialPeriod) {
      setPeriod(initialPeriod);
    }
  }, [initialPeriod]);

  const months = [
    { label: 'January', val: '01' },
    { label: 'February', val: '02' },
    { label: 'March', val: '03' },
    { label: 'April', val: '04' },
    { label: 'May', val: '05' },
    { label: 'June', val: '06' },
    { label: 'July', val: '07' },
    { label: 'August', val: '08' },
    { label: 'September', val: '09' },
    { label: 'October', val: '10' },
    { label: 'November', val: '11' },
    { label: 'December', val: '12' }
  ];

  const years = ['2024', '2025', '2026', '2027'];

  // Current active KPI config
  const activeCardConfig = useMemo(() => {
    return KPI_CARDS.find((c) => c.key === selectedMetric) || KPI_CARDS[0];
  }, [selectedMetric]);

  // Fast React Query with client & server cache (60s staleTime)
  const { data: matrixResponse, isLoading: loading, refetch: refetchMatrixReport } = useQuery({
    queryKey: ['campaign-matrix-report', period, selectedMetric, selectedCampaign, selectedMonth, selectedYear],
    queryFn: async () => {
      const metricParam = activeCardConfig.metricParam;
      const res = await api.get('/reports/campaign-matrix', {
        params: {
          period,
          metric: metricParam,
          campaignName: selectedCampaign,
          month: selectedMonth,
          year: selectedYear
        }
      });
      return res.data;
    },
    staleTime: 60000,
    gcTime: 15 * 60 * 1000,
    placeholderData: keepPreviousData
  });

  const summary: CampaignSummaryData = useMemo(() => {
    return matrixResponse?.summary || {
      callsMade: 0,
      hotLeads: 0,
      logins: 0,
      approved: 0,
      disbursed: 0,
      targetAchievement: 0
    };
  }, [matrixResponse]);

  const matrixData: CampaignMatrixData = useMemo(() => {
    return matrixResponse?.matrix || {
      columns: [],
      rows: [],
      totals: {},
      grandTotal: 0
    };
  }, [matrixResponse]);

  const campaignsList: string[] = useMemo(() => {
    return matrixResponse?.campaignsList || [];
  }, [matrixResponse]);

  // Filter rows based on search input
  const filteredRows = useMemo(() => {
    if (!searchCaller.trim()) return matrixData.rows;
    const term = searchCaller.toLowerCase().trim();
    return matrixData.rows.filter((r) => r.callerName.toLowerCase().includes(term));
  }, [matrixData.rows, searchCaller]);

  // Handle Export Full Matrix
  const handleExportFullMatrix = () => {
    exportCampaignMatrixXLSX(
      matrixData,
      activeCardConfig.label,
      period.toUpperCase(),
      selectedCampaign
    );
    showToast('Exported Calling Matrix to Excel (.xlsx)', 'success');
  };

  // Handle Pill Download on any card
  const handlePillDownload = (e: React.MouseEvent, card: KPICardConfig) => {
    e.stopPropagation(); // Don't trigger card selection change
    exportCampaignKPIDataset(card.pillKey, summary, matrixData, selectedCampaign);
    showToast(`Downloaded ${card.label} dataset.`, 'success');
  };

  // Format metric value for display
  const formatCardValue = (val: number, key: MetricKey) => {
    if (key === 'targetAchievement') return `${val}%`;
    return (val ?? 0).toLocaleString('en-IN');
  };

  return (
    <div className="flex flex-col h-full bg-[#FBFBFA] dark:bg-[#0B0F19] text-slate-800 dark:text-slate-100 overflow-y-auto">
      {/* 1. Header Banner */}
      <div className="flex-shrink-0 px-4 sm:px-6 md:px-8 pt-5 pb-4 border-b border-black/[0.06] dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur sticky top-0 z-30">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 tracking-wide uppercase">
                <Icons.Sparkles className="w-3.5 h-3.5" /> Outbound Performance
              </span>
              <span className="text-xs text-slate-400">•</span>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                Live Campaign Matrix
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-1">
              {period === 'daily' ? 'Daily Report' : period === 'monthly' ? 'Monthly Report' : 'Annual Report'}
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {period === 'daily' ? 'Daily' : period === 'monthly' ? 'Monthly' : 'Annual'} calling matrix, dial attempts, and outbound contact progress.
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              onClick={handleExportFullMatrix}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-bold rounded-xl text-white bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] transition-all shadow-sm shadow-emerald-600/20 cursor-pointer"
              title="Download exact spreadsheet matching Image 4"
            >
              <Icons.FileSpreadsheet className="w-4 h-4 text-emerald-100" />
              <span>Export Matrix to Excel (.xlsx)</span>
            </button>

            <button
              onClick={() => refetchMatrixReport()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-slate-800 border border-black/10 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200 transition-colors shadow-sm cursor-pointer"
              title="Refresh live data"
            >
              <Icons.RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>

        {/* 2. Period Switcher & Filter Row */}
        <div className="mt-4 pt-3 border-t border-black/[0.05] dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
          {/* Period Tabs: Daily | Monthly | Annually */}
          <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-800 rounded-xl border border-black/[0.06] dark:border-slate-700/80 shadow-inner">
            <button
              onClick={() => {
                setPeriod('daily');
                navigate('/reports/campaign-daily');
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                period === 'daily'
                  ? 'bg-white dark:bg-slate-700 text-purple-700 dark:text-purple-300 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Daily Report
            </button>
            <button
              onClick={() => {
                setPeriod('monthly');
                navigate('/reports/campaign-monthly');
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                period === 'monthly'
                  ? 'bg-white dark:bg-slate-700 text-purple-700 dark:text-purple-300 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Monthly Report
            </button>
            <button
              onClick={() => {
                setPeriod('annually');
                navigate('/reports/campaign-annual');
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                period === 'annually'
                  ? 'bg-white dark:bg-slate-700 text-purple-700 dark:text-purple-300 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Annual Report
            </button>
          </div>

          {/* Filters: Campaign, Month, Year */}
          <div className="flex items-center gap-2 flex-wrap flex-1 sm:flex-initial justify-end">
            {/* Campaign Select */}
            <div className="relative min-w-[170px]">
              <select
                value={selectedCampaign}
                onChange={(e) => setSelectedCampaign(e.target.value)}
                className="w-full h-8 pl-8 pr-7 text-xs font-semibold bg-white dark:bg-slate-800 border border-black/10 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-500 shadow-sm appearance-none cursor-pointer"
              >
                <option value="ALL">All Campaigns</option>
                {campaignsList.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <Icons.Megaphone className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
              <Icons.ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-2.5 pointer-events-none" />
            </div>

            {/* Month Select (if daily or monthly) */}
            {period === 'daily' && (
              <div className="relative">
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="h-8 pl-7 pr-7 text-xs font-semibold bg-white dark:bg-slate-800 border border-black/10 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-500 shadow-sm appearance-none cursor-pointer"
                >
                  {months.map((m) => (
                    <option key={m.val} value={m.val}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <Icons.Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
                <Icons.ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-2.5 pointer-events-none" />
              </div>
            )}

            {/* Year Select */}
            <div className="relative">
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="h-8 pl-7 pr-7 text-xs font-semibold bg-white dark:bg-slate-800 border border-black/10 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-500 shadow-sm appearance-none cursor-pointer"
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
              <Icons.CalendarDays className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
              <Icons.ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-2.5 pointer-events-none" />
            </div>

            {/* Search Caller */}
            <div className="relative min-w-[150px] max-w-[200px]">
              <input
                type="text"
                placeholder="Search caller..."
                value={searchCaller}
                onChange={(e) => setSearchCaller(e.target.value)}
                className="w-full h-8 pl-7 pr-2.5 text-xs bg-white dark:bg-slate-800 border border-black/10 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500 shadow-sm"
              />
              <Icons.Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
            </div>
          </div>
        </div>
      </div>

      {/* 3. Main Content Area */}
      <div className="p-4 sm:p-6 md:p-8 space-y-6 flex-1">
        {/* ========================================================= */}
        {/* Image 5 Feature: The 6 Clickable KPI Hero Cards           */}
        {/* ========================================================= */}
        <section aria-label="Campaign Overview KPI Cards">
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Select Metric to View in Calling Matrix:
            </h2>
            <span className="text-[11px] text-purple-600 dark:text-purple-400 font-semibold flex items-center gap-1">
              <Icons.CheckCircle2 className="w-3.5 h-3.5" />
              Active: <strong className="font-bold underline">{activeCardConfig.label}</strong>
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
            {KPI_CARDS.map((card) => {
              const isSelected = selectedMetric === card.key;
              const CardIcon = card.icon;
              const val = summary[card.key] ?? 0;

              return (
                <div
                  key={card.key}
                  onClick={() => setSelectedMetric(card.key)}
                  className={`relative flex flex-col justify-between p-4 rounded-2xl bg-white dark:bg-slate-900 transition-all duration-200 cursor-pointer select-none group ${
                    isSelected
                      ? 'ring-2 ring-purple-600 border-2 border-purple-600 shadow-lg shadow-purple-500/10 scale-[1.02]'
                      : 'border border-black/[0.08] dark:border-slate-800 hover:border-purple-300 dark:hover:border-purple-900 shadow-sm hover:shadow-md'
                  }`}
                >
                  {/* Top row: Label + Icon */}
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 tracking-tight leading-tight uppercase">
                      {card.label}
                    </span>
                    <div
                      className={`w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110 ${
                        isSelected ? 'bg-purple-600 text-white shadow-sm' : `${card.iconBg} ${card.iconColor}`
                      }`}
                    >
                      <CardIcon className="w-4 h-4" />
                    </div>
                  </div>

                  {/* Middle: Big Metric Number */}
                  <div className="my-3">
                    <div className="text-2xl sm:text-[26px] font-black tracking-tight text-slate-900 dark:text-white leading-none">
                      {formatCardValue(val, card.key)}
                    </div>
                  </div>

                  {/* Bottom: Pill Button with Download Arrow matching Image 5 */}
                  <div className="pt-1">
                    <button
                      onClick={(e) => handlePillDownload(e, card)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-950/80 dark:text-purple-300'
                          : `${card.pillBg} ${card.pillTextColor}`
                      }`}
                      title={`Download ${card.pillText} report`}
                    >
                      <span>{card.pillText}</span>
                      <Icons.Download className="w-3 h-3 opacity-80" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ========================================================= */}
        {/* Image 4 Feature: Spreadsheet Matrix Table                 */}
        {/* ========================================================= */}
        <section
          aria-label="Telecaller Calling Matrix Table"
          className="bg-white dark:bg-slate-900 rounded-2xl border border-black/[0.08] dark:border-slate-800 shadow-sm overflow-hidden flex flex-col"
        >
          {/* Table Control Header */}
          <div className="p-4 sm:px-6 border-b border-black/[0.06] dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/60 dark:bg-slate-900/60">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
              <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
                {activeCardConfig.label} — {period.toUpperCase()} CALLING MATRIX
              </h3>
              <span className="text-xs px-2 py-0.5 rounded-md bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 font-bold">
                {filteredRows.length} Callers
              </span>
            </div>

            <div className="text-xs text-slate-500 dark:text-slate-400">
              Showing breakdown across{' '}
              <strong className="text-slate-800 dark:text-slate-200 font-bold">
                {matrixData.columns.length} intervals
              </strong>
            </div>
          </div>

          {/* Scrollable Matrix Table Container matching Image 4 */}
          <div className="relative overflow-x-auto max-h-[620px] select-text">
            <table className="w-full border-collapse text-left text-xs">
              {/* Header matching Image 4 Excel columns: Caller Name, Day 01, Day 02, ... Day 31, Total */}
              <thead className="sticky top-0 z-20 bg-[#F4F6F8] dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold shadow-sm">
                <tr className="border-b border-slate-300 dark:border-slate-700">
                  {/* Sticky Column A for Caller Name */}
                  <th className="sticky left-0 z-30 bg-[#F4F6F8] dark:bg-slate-800 px-4 py-2.5 text-left font-black tracking-tight border-r border-slate-300 dark:border-slate-700 min-w-[200px] shadow-[2px_0_4px_rgba(0,0,0,0.03)]">
                    Caller Name
                  </th>

                  {/* Day / Interval Columns */}
                  {matrixData.columns.map((col) => (
                    <th
                      key={col}
                      className="px-2.5 py-2.5 text-center font-bold tracking-tight border-r border-slate-200/80 dark:border-slate-700/80 min-w-[68px] whitespace-nowrap"
                    >
                      {col}
                    </th>
                  ))}

                  {/* Total Column */}
                  <th className="px-4 py-2.5 text-right font-black text-purple-700 dark:text-purple-400 bg-purple-50/60 dark:bg-purple-950/40 min-w-[90px]">
                    Total
                  </th>
                </tr>
              </thead>

              {/* Rows matching Image 4 */}
              <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800/80">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={matrixData.columns.length + 2}
                      className="text-center py-12 text-slate-400 dark:text-slate-500"
                    >
                      <Icons.Inbox className="w-8 h-8 mx-auto mb-2 opacity-40" />
                      No telecaller records found matching the search criteria.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row, rIdx) => {
                    const isEven = rIdx % 2 === 0;
                    return (
                      <tr
                        key={row.callerName}
                        className={`transition-colors hover:bg-purple-50/40 dark:hover:bg-purple-950/20 ${
                          isEven
                            ? 'bg-white dark:bg-slate-900'
                            : 'bg-slate-50/30 dark:bg-slate-900/40'
                        }`}
                      >
                        {/* Sticky Caller Name Cell */}
                        <td
                          className={`sticky left-0 z-10 px-4 py-2 font-bold text-slate-800 dark:text-slate-100 border-r border-slate-200 dark:border-slate-700/80 whitespace-nowrap shadow-[2px_0_4px_rgba(0,0,0,0.03)] ${
                            isEven
                              ? 'bg-white dark:bg-slate-900'
                              : 'bg-slate-50 dark:bg-slate-900'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-500 flex items-center justify-center flex-shrink-0">
                              {rIdx + 1}
                            </span>
                            <span className="font-semibold text-slate-900 dark:text-white">
                              {row.callerName}
                            </span>
                          </div>
                        </td>

                        {/* Interval Cells */}
                        {matrixData.columns.map((col) => {
                          const val = row.data[col];
                          const hasVal = val !== undefined && val !== null && val > 0;
                          return (
                            <td
                              key={col}
                              className={`px-2 py-2 text-center border-r border-slate-100 dark:border-slate-800/60 font-mono text-[11px] tabular-nums whitespace-nowrap ${
                                hasVal
                                  ? 'font-bold text-slate-900 dark:text-slate-100 bg-emerald-50/20 dark:bg-emerald-950/10'
                                  : 'text-slate-300 dark:text-slate-700'
                              }`}
                            >
                              {hasVal ? val.toLocaleString('en-IN') : ''}
                            </td>
                          );
                        })}

                        {/* Row Total */}
                        <td className="px-4 py-2 text-right font-mono font-black text-[12px] text-purple-700 dark:text-purple-300 bg-purple-50/30 dark:bg-purple-950/20 tabular-nums whitespace-nowrap">
                          {row.total.toLocaleString('en-IN')}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>

              {/* Summary Footer Row */}
              <tfoot className="sticky bottom-0 z-20 bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white font-black border-t-2 border-slate-300 dark:border-slate-700 shadow-inner">
                <tr>
                  <td className="sticky left-0 z-30 bg-slate-100 dark:bg-slate-800 px-4 py-2.5 font-black text-left uppercase tracking-wider border-r border-slate-300 dark:border-slate-700 shadow-[2px_0_4px_rgba(0,0,0,0.03)]">
                    Total
                  </td>

                  {matrixData.columns.map((col) => {
                    const sum = matrixData.totals[col] ?? 0;
                    return (
                      <td
                        key={col}
                        className="px-2.5 py-2.5 text-center font-mono font-bold text-[11px] border-r border-slate-200 dark:border-slate-700 tabular-nums whitespace-nowrap"
                      >
                        {sum > 0 ? sum.toLocaleString('en-IN') : ''}
                      </td>
                    );
                  })}

                  <td className="px-4 py-2.5 text-right font-mono font-black text-sm text-purple-700 dark:text-purple-300 bg-purple-100/60 dark:bg-purple-950/60 tabular-nums whitespace-nowrap">
                    {matrixData.grandTotal.toLocaleString('en-IN')}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
