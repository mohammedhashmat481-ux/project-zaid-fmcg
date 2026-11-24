import React, { useState, useEffect, useCallback, useMemo } from 'react';
import * as Icons from 'lucide-react';
import api from '../services/api';
import { useToastStore } from '../store/toastStore';
import MultiSelectDropdown from '../components/MultiSelectDropdown';

interface AgentReport {
  id: string;
  _id: string;
  name: string;
  email: string;
  role: string;
  assigned: number;
  connected: number;
  followups: number;
  connectionRate: number;
}

interface SummaryStats {
  totalActiveTelecallers: number;
  totalCallsConnected: number;
  totalAssignedLeads: number;
  totalFollowups: number;
  connectionRate: number;
}

export default function TelecallerReportsPage() {
  const { showToast } = useToastStore();
  const [loading, setLoading] = useState(false);

  // Filter States
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]);
  const [selectedYears, setSelectedYears] = useState<string[]>(['2026']);
  const [selectedCampaigns, setSelectedCampaigns] = useState<string[]>([]);
  const [selectedRoleTypes, setSelectedRoleTypes] = useState<string[]>([]);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [tableSearch, setTableSearch] = useState<string>('');

  // Real Database Data
  const [summary, setSummary] = useState<SummaryStats>({
    totalActiveTelecallers: 0,
    totalCallsConnected: 0,
    totalAssignedLeads: 0,
    totalFollowups: 0,
    connectionRate: 0
  });
  const [agents, setAgents] = useState<AgentReport[]>([]);
  const [campaignsList, setCampaignsList] = useState<string[]>([]);
  const [rolesList, setRolesList] = useState<string[]>([]);

  const months = useMemo(
    () => [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ],
    []
  );
  const years = useMemo(() => ['2024', '2025', '2026', '2027'], []);

  // Fetch real aggregated metrics from backend API
  const fetchReportData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = {};

      if (selectedMonths.length > 0) {
        params.month = selectedMonths;
      }
      if (selectedYears.length > 0) {
        params.year = selectedYears.length === 1 ? selectedYears[0] : 'ALL';
      }
      if (selectedCampaigns.length > 0) {
        params.campaign = selectedCampaigns;
      }
      if (selectedRoleTypes.length > 0) {
        params.role = selectedRoleTypes;
      }
      if (selectedAgents.length > 0) {
        params.agent = selectedAgents;
      }

      const res = await api.get('/reports/telecaller-performance', { params });
      const data = res.data || {};

      setSummary(
        data.summary || {
          totalActiveTelecallers: 0,
          totalCallsConnected: 0,
          totalAssignedLeads: 0,
          totalFollowups: 0,
          connectionRate: 0
        }
      );
      setAgents(data.agents || []);
      if (Array.isArray(data.campaignsList) && data.campaignsList.length > 0) {
        setCampaignsList(data.campaignsList);
      }
      if (Array.isArray(data.rolesList) && data.rolesList.length > 0) {
        setRolesList(data.rolesList);
      }
    } catch (err: any) {
      console.error('Failed to load telecaller performance report:', err);
      showToast(err.response?.data?.error || 'Failed to load telecaller report data.', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedMonths, selectedYears, selectedCampaigns, selectedRoleTypes, selectedAgents, showToast]);

  useEffect(() => {
    fetchReportData();
  }, [fetchReportData]);

  const handleApplyFilter = () => {
    fetchReportData();
    showToast('Updated caller status with live CRM database records.', 'info');
  };

  // Filter agents by live table search
  const displayedAgents = useMemo(() => {
    if (!tableSearch.trim()) return agents;
    const q = tableSearch.toLowerCase().trim();
    return agents.filter(
      (ag) =>
        ag.name.toLowerCase().includes(q) ||
        ag.email.toLowerCase().includes(q) ||
        ag.role.toLowerCase().includes(q)
    );
  }, [agents, tableSearch]);

  const exportCSV = () => {
    const headers = ['Agent Name', 'Email', 'Role Type', 'Assigned Leads', 'Calls Connected', 'Followups Scheduled'];
    const rows = displayedAgents.map((ag) => [
      `"${ag.name}"`,
      `"${ag.email}"`,
      `"${ag.role}"`,
      ag.assigned,
      ag.connected,
      ag.followups
    ]);
    const csvContent =
      'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Live_Caller_Status_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const agentNamesList = useMemo(() => {
    return Array.from(new Set(agents.map((u) => u.name)));
  }, [agents]);

  const availableRoles = useMemo(() => {
    return rolesList.length > 0
      ? rolesList
      : ['Super Admin', 'Admin', 'Sales Manager', 'Telecaller', 'Sales Representative'];
  }, [rolesList]);

  return (
    <div className="space-y-3.5 max-w-[1400px] mx-auto text-left px-2 sm:px-4 py-1.5">
      {/* 1. COMPACT 4-STAT HERO KPI TILES */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Active Telecallers */}
        <div className="bg-white dark:bg-slate-900 border border-[#E2E8F0] dark:border-slate-800 rounded-xl p-3.5 shadow-xs relative overflow-hidden flex flex-col justify-between hover:shadow-sm transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-[#1E3A5F]" />
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Active Telecallers
            </span>
            <div className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 text-[#1E3A5F] dark:text-white flex items-center justify-center">
              <Icons.Users className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl sm:text-2xl font-black text-[#1E293B] dark:text-white font-mono">
              {summary.totalActiveTelecallers}
            </span>
            <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 dark:text-indigo-300 dark:bg-indigo-950/60 px-1.5 py-0.5 rounded-md">
              {displayedAgents.length} Filtered
            </span>
          </div>
        </div>

        {/* Calls Connected */}
        <div className="bg-white dark:bg-slate-900 border border-[#E2E8F0] dark:border-slate-800 rounded-xl p-3.5 shadow-xs relative overflow-hidden flex flex-col justify-between hover:shadow-sm transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-[#16A34A]" />
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Calls Connected
            </span>
            <div className="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center">
              <Icons.PhoneCall className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl sm:text-2xl font-black text-[#1E293B] dark:text-white font-mono">
              {summary.totalCallsConnected}
            </span>
            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded-md">
              {summary.connectionRate}% Connected
            </span>
          </div>
        </div>

        {/* Assigned Leads */}
        <div className="bg-white dark:bg-slate-900 border border-[#E2E8F0] dark:border-slate-800 rounded-xl p-3.5 shadow-xs relative overflow-hidden flex flex-col justify-between hover:shadow-sm transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-[#0284C7]" />
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Assigned Leads
            </span>
            <div className="w-7 h-7 rounded-lg bg-sky-50 dark:bg-sky-950/60 text-sky-600 flex items-center justify-center">
              <Icons.ListOrdered className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl sm:text-2xl font-black text-[#1E293B] dark:text-white font-mono">
              {summary.totalAssignedLeads}
            </span>
            <span className="text-[10px] font-bold text-sky-700 bg-sky-50 dark:text-sky-300 dark:bg-sky-950/60 px-1.5 py-0.5 rounded-md">
              Lead Pool
            </span>
          </div>
        </div>

        {/* Followups Set */}
        <div className="bg-white dark:bg-slate-900 border border-[#E2E8F0] dark:border-slate-800 rounded-xl p-3.5 shadow-xs relative overflow-hidden flex flex-col justify-between hover:shadow-sm transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-[#EA580C]" />
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Followups Set
            </span>
            <div className="w-7 h-7 rounded-lg bg-orange-50 dark:bg-orange-950/60 text-orange-600 flex items-center justify-center">
              <Icons.CalendarClock className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl sm:text-2xl font-black text-[#1E293B] dark:text-white font-mono">
              {summary.totalFollowups}
            </span>
            <span className="text-[10px] font-bold text-orange-700 bg-orange-50 dark:text-orange-300 dark:bg-orange-950/60 px-1.5 py-0.5 rounded-md">
              Scheduled
            </span>
          </div>
        </div>
      </div>

      {/* 2. COMPACT, STREAMLINED FILTER CONTROL BAR */}
      <div className="bg-white dark:bg-slate-900 border border-[#E2E8F0] dark:border-slate-800 rounded-xl p-3 sm:p-4 shadow-xs relative">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[#F1F5F9] dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-[#1E3A5F]/10 text-[#1E3A5F] dark:text-blue-400 flex items-center justify-center font-bold">
              <Icons.SlidersHorizontal className="w-3.5 h-3.5" />
            </div>
            <h3 className="text-xs font-black text-[#1E3A5F] dark:text-slate-200 uppercase tracking-wider">
              Telecaller Performance Parameters
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={exportCSV}
              className="h-8 px-3 bg-slate-50 hover:bg-slate-100 text-[#1E293B] dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-white border border-[#CBD5E1] dark:border-slate-700 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 shadow-xs cursor-pointer"
              title="Download Telecaller Performance CSV"
            >
              <Icons.Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
            <button
              onClick={handleApplyFilter}
              disabled={loading}
              className="h-8 px-4 bg-[#1E3A5F] hover:bg-slate-800 active:scale-[0.98] text-white text-xs font-bold rounded-lg shadow-xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Icons.RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Apply Filter</span>
            </button>
          </div>
        </div>

        {/* Compact 5-Dropdown Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 pt-2.5">
          <MultiSelectDropdown
            label="Select Month"
            options={months}
            selectedValues={selectedMonths}
            onChange={setSelectedMonths}
            placeholder="-All Months-"
          />
          <MultiSelectDropdown
            label="Select Year"
            options={years}
            selectedValues={selectedYears}
            onChange={setSelectedYears}
            placeholder="-All Years-"
          />
          <MultiSelectDropdown
            label="Campaign Filter"
            options={campaignsList.length > 0 ? campaignsList : ['No Active Campaigns']}
            selectedValues={selectedCampaigns}
            onChange={setSelectedCampaigns}
            placeholder="-All Campaigns-"
          />
          <MultiSelectDropdown
            label="Load Agents Types"
            options={availableRoles}
            selectedValues={selectedRoleTypes}
            onChange={setSelectedRoleTypes}
            placeholder="-All Agent Roles-"
          />
          <MultiSelectDropdown
            label="Calling Agent"
            options={agentNamesList}
            selectedValues={selectedAgents}
            onChange={setSelectedAgents}
            placeholder="-All Calling Agents-"
          />
        </div>
      </div>

      {/* 3. TELECALLER PERFORMANCE TABLE */}
      <div className="bg-white dark:bg-slate-900 border border-[#E2E8F0] dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
        <div className="p-3.5 sm:p-4 border-b border-[#F1F5F9] dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-[#1E3A5F] dark:text-white uppercase tracking-tight flex items-center gap-2">
              <span>Telecaller Productivity & Conversion Ledger</span>
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              Live database records ({displayedAgents.length} active callers)
            </p>
          </div>

          {/* Quick Table Search */}
          <div className="relative min-w-[220px]">
            <Icons.Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search agent name, email, role..."
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              className="w-full bg-[#F8FAFC] dark:bg-slate-800 border border-[#CBD5E1] dark:border-slate-700 text-xs rounded-lg pl-8 pr-3 py-1.5 text-[#1E293B] dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden transition"
            />
            {tableSearch && (
              <button
                onClick={() => setTableSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <Icons.X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-xs text-slate-400 font-semibold flex items-center justify-center gap-2">
            <Icons.RotateCw className="w-4 h-4 animate-spin text-blue-600" />
            <span>Loading live telecaller metrics from database...</span>
          </div>
        ) : displayedAgents.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400 font-semibold">
            No telecallers match the selected filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[700px]">
              <thead>
                <tr className="border-b border-[#E2E8F0] dark:border-slate-700 text-[10px] font-black text-[#64748B] dark:text-slate-400 uppercase tracking-wider h-10 bg-[#F8FAFC] dark:bg-slate-800/80">
                  <th className="py-2.5 px-5">Agent Name</th>
                  <th className="py-2.5 px-5">Role Type</th>
                  <th className="py-2.5 px-5 text-center">Assigned Leads</th>
                  <th className="py-2.5 px-5 text-center">Calls Connected</th>
                  <th className="py-2.5 px-5 text-center">Followups Scheduled</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9] dark:divide-slate-800/60 font-semibold text-[#1E293B] dark:text-slate-200">
                {displayedAgents.map((ag) => (
                  <tr
                    key={ag.id}
                    className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors h-12"
                  >
                    <td className="py-2.5 px-5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-[#1E3A5F] text-white flex items-center justify-center font-bold text-[11px] uppercase shadow-3xs">
                          {ag.name.substring(0, 2)}
                        </div>
                        <div>
                          <div className="font-bold text-[#1E293B] dark:text-white leading-tight">
                            {ag.name}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono leading-tight">
                            {ag.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-5">
                      <span className="px-2 py-0.5 rounded-md bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 text-[10px] font-bold uppercase tracking-wider border border-purple-200/80 dark:border-purple-800/50">
                        {ag.role}
                      </span>
                    </td>
                    <td className="py-2.5 px-5 text-center">
                      <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800/60 min-w-[2.5rem]">
                        {ag.assigned}
                      </span>
                    </td>
                    <td className="py-2.5 px-5 text-center">
                      <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 min-w-[2.5rem]">
                        {ag.connected}
                      </span>
                    </td>
                    <td className="py-2.5 px-5 text-center">
                      <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 min-w-[2.5rem]">
                        {ag.followups}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
