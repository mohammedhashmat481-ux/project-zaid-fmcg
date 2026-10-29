import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as Icons from 'lucide-react';
import api from '../services/api';
import { useToastStore } from '../store/toastStore';
import MultiSelectDropdown from '../components/MultiSelectDropdown';

import { exportLeadReportXLSX } from '../utils/exportLeadReportXLSX';

export default function LeadReportsPage() {
  const [searchParams] = useSearchParams();
  const initialCamp = searchParams.get('campaign');

  const { showToast } = useToastStore();
  const [loading, setLoading] = useState(false);
  const [leads, setLeads] = useState<any[]>([]);
  const [campaignsList, setCampaignsList] = useState<string[]>([]);

  // Multi-Select Filter States with Checkboxes
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]);
  const [selectedYears, setSelectedYears] = useState<string[]>(['2026']);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedLoanTypes, setSelectedLoanTypes] = useState<string[]>([]);
  const [selectedKpiCard, setSelectedKpiCard] = useState<string>('ALL LEADS');
  const [selectedCampaigns, setSelectedCampaigns] = useState<string[]>(initialCamp ? [initialCamp] : []);

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const years = ['2024', '2025', '2026', '2027'];
  
  const statusOptions = [
    'HOT LEADS',
    'WARM LEADS',
    'CEBIL PENDING',
    'DOCUMENT PENDING',
    'APPROVAL PENDING',
    'APPROVED BUT NOT DISBUSE',
    'DISBUSED',
    'REJECTED',
    'FOLLOWUP',
    'DROPPED',
    'PENDING'
  ];

  // Master Product Names matching website database (from Products module)
  const loanTypes = [
    'SALARIED PERSONAL LOAN',
    'BUSINESS LOAN',
    'HOME LOAN',
    'LAP'
  ];

  useEffect(() => {
    fetchReportData();
  }, []);

  const fetchReportData = async () => {
    setLoading(true);
    try {
      const [leadsRes, campRes] = await Promise.all([
        api.get('/records/leads?limit=5000').catch(() => ({ data: [] })),
        api.get('/records/campaigns?limit=1000').catch(() => ({ data: [] }))
      ]);

      const allRecords = leadsRes.data?.records || leadsRes.data || [];
      const fetchedCampaigns = (campRes.data?.records || []).map((c: any) => c.data?.campaignName || c.name).filter(Boolean);
      const leadCampaigns = allRecords.map((l: any) => l.data?.campaign || l.data?.campaignName || l.campaignName).filter(Boolean);

      setLeads(allRecords);
      setCampaignsList(Array.from(new Set([...fetchedCampaigns, ...leadCampaigns])));
    } catch (err) {
      console.error(err);
      showToast('Failed to load lead report data.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleFilterClick = () => {
    fetchReportData();
    showToast('Applied multi-select filter conditions.', 'info');
  };

  // Filter leads based on selected criteria and active KPI card
  const filteredLeads = leads.filter((item) => {
    const data = item.data || {};
    const itemStatus = (data.status || '').toLowerCase().trim();
    const itemStatusUpper = (data.status || '').toUpperCase().trim();

    // 1. Interactive 17-Card Status Match
    if (selectedKpiCard && selectedKpiCard !== 'ALL LEADS' && selectedKpiCard !== 'PIPELINE VALUE') {
      let cardMatch = false;
      if (selectedKpiCard === 'HOT LEAD') cardMatch = itemStatusUpper.includes('HOT');
      else if (selectedKpiCard === 'WARM LEAD') cardMatch = itemStatusUpper.includes('WARM');
      else if (selectedKpiCard === 'COOL LEAD') cardMatch = itemStatusUpper.includes('COOL');
      else if (selectedKpiCard === 'CALL BACK') cardMatch = itemStatusUpper.includes('CALL BACK') || itemStatusUpper.includes('CALLBACK');
      else if (selectedKpiCard === 'GIVEN LOGIN') cardMatch = itemStatusUpper.includes('LOGIN');
      else if (selectedKpiCard === 'CIBIL PENDING') cardMatch = itemStatusUpper.includes('CIBIL') || itemStatusUpper.includes('CEBIL');
      else if (selectedKpiCard === 'DOCCUMENT PENDING') cardMatch = itemStatusUpper.includes('DOC') || itemStatusUpper.includes('DOCUMENT');
      else if (selectedKpiCard === 'STATUS PENDING') cardMatch = itemStatusUpper.includes('STATUS PENDING');
      else if (selectedKpiCard === 'APPROVED') cardMatch = itemStatusUpper.includes('APPROVED') && !itemStatusUpper.includes('NOT DISBUSE');
      else if (selectedKpiCard === 'DISBURSED') cardMatch = itemStatusUpper.includes('DISBURS') || itemStatusUpper.includes('DISBUSED');
      else if (selectedKpiCard === 'REJECT') cardMatch = itemStatusUpper.includes('REJECT');
      else if (selectedKpiCard === 'FOLLOW-UP') cardMatch = itemStatusUpper.includes('FOLLOW');
      else if (selectedKpiCard === 'DROPPED') cardMatch = itemStatusUpper.includes('DROP');
      else if (selectedKpiCard === 'PENDING') cardMatch = itemStatusUpper === 'PENDING' || (itemStatusUpper.includes('PENDING') && !itemStatusUpper.includes('CIBIL') && !itemStatusUpper.includes('CEBIL') && !itemStatusUpper.includes('DOC') && !itemStatusUpper.includes('STATUS') && !itemStatusUpper.includes('APPROVAL'));
      else if (selectedKpiCard === 'DEMO LEADS') cardMatch = itemStatusUpper.includes('DEMO');
      
      if (!cardMatch) return false;
    }

    // 2. Multi-Select Status Dropdown match
    const statusMatch = selectedStatuses.length === 0 || selectedStatuses.some(s => {
      const sLower = s.toLowerCase().trim();
      return itemStatus === sLower || itemStatus.includes(sLower) || sLower.includes(itemStatus);
    });
    
    // 3. Campaign match
    const leadCamp = (data.campaign || data.campaignName || item.campaignName || '').trim();
    const campaignMatch = selectedCampaigns.length === 0 || selectedCampaigns.some(c => c.toLowerCase() === leadCamp.toLowerCase() || leadCamp.toLowerCase().includes(c.toLowerCase()));

    // 4. Match product/loanType with tolerance for defaults & substrings
    const rawLoan = (data.loanType || data.serviceType || data.product || 'SALARIED PERSONAL LOAN').trim().toLowerCase();
    const loanMatch = selectedLoanTypes.length === 0 || selectedLoanTypes.some(l => {
      const selected = l.trim().toLowerCase();
      if (selected.includes('personal') && (rawLoan.includes('personal') || rawLoan.includes('salaried'))) return true;
      if (selected.includes('lap') && (rawLoan.includes('lap') || rawLoan.includes('property'))) return true;
      return rawLoan.includes(selected) || selected.includes(rawLoan);
    });

    // 5. Date (month & year) match
    let dateMatch = true;
    const rawDate = item.createdAt || data.createdAt || data.date;
    if (rawDate && (selectedMonths.length > 0 || selectedYears.length > 0)) {
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) {
        const itemYear = String(d.getFullYear());
        const itemMonth = months[d.getMonth()];
        if (selectedYears.length > 0 && !selectedYears.includes(itemYear)) dateMatch = false;
        if (selectedMonths.length > 0 && !selectedMonths.includes(itemMonth)) dateMatch = false;
      }
    }

    return statusMatch && loanMatch && campaignMatch && dateMatch;
  });

  const exportCSV = () => {
    if (filteredLeads.length === 0) {
      showToast('No lead data available for export.', 'warning');
      return;
    }
    exportLeadReportXLSX(filteredLeads, 'Lead_Report');
    showToast(`Exported ${filteredLeads.length} lead records to Excel!`, 'success');
  };

  // Helper date formatters matching spreadsheet
  const formatDateShort = (dateStr?: any) => {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${String(d.getDate()).padStart(2, '0')}-${m[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
  };

  const formatDateTimeFull = (dateStr?: any) => {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${m[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}, ${hours}:${minutes} ${ampm}`;
  };

  // Compute summary stats for the hero cards
  const totalAmount = filteredLeads.reduce((acc, item) => {
    const data = item.data || {};
    const amt = Number(data.amount || data.loanAmount || data.budget || 250000);
    return acc + (isNaN(amt) ? 0 : amt);
  }, 0);

  const hotAndConvertedCount = filteredLeads.filter((item) => {
    const st = (item.data?.status || item.status || '').toLowerCase();
    return st.includes('hot') || st.includes('approved') || st.includes('disburs');
  }).length;

  const hotRate = filteredLeads.length > 0 ? Math.round((hotAndConvertedCount / filteredLeads.length) * 100) : 0;

  // Compute counts and percentage for all 17 KPI cards from live leads data
  const totalLeadsCount = leads.length;
  
  const getCardCount = (label: string): number => {
    return leads.filter((item) => {
      const s = (item.data?.status || item.status || '').toUpperCase().trim();
      if (label === 'ALL LEADS') return true;
      if (label === 'HOT LEAD') return s.includes('HOT');
      if (label === 'WARM LEAD') return s.includes('WARM');
      if (label === 'COOL LEAD') return s.includes('COOL');
      if (label === 'CALL BACK') return s.includes('CALL BACK') || s.includes('CALLBACK');
      if (label === 'GIVEN LOGIN') return s.includes('LOGIN');
      if (label === 'CIBIL PENDING') return s.includes('CIBIL') || s.includes('CEBIL');
      if (label === 'DOCCUMENT PENDING') return s.includes('DOC') || s.includes('DOCUMENT');
      if (label === 'STATUS PENDING') return s.includes('STATUS PENDING');
      if (label === 'APPROVED') return s.includes('APPROVED') && !s.includes('NOT DISBUSE');
      if (label === 'DISBURSED') return s.includes('DISBURS') || s.includes('DISBUSED');
      if (label === 'REJECT') return s.includes('REJECT');
      if (label === 'FOLLOW-UP') return s.includes('FOLLOW');
      if (label === 'DROPPED') return s.includes('DROP');
      if (label === 'PENDING') return s === 'PENDING' || (s.includes('PENDING') && !s.includes('CIBIL') && !s.includes('CEBIL') && !s.includes('DOC') && !s.includes('STATUS') && !s.includes('APPROVAL'));
      if (label === 'DEMO LEADS') return s.includes('DEMO');
      return false;
    }).length;
  };

  const statusCardsList = [
    // Row 1 (6 Cards)
    { label: 'ALL LEADS', icon: Icons.Users, topColor: 'border-t-indigo-600', iconColor: 'text-indigo-600', isAll: true },
    { label: 'HOT LEAD', icon: Icons.Flame, topColor: 'border-t-rose-500', iconColor: 'text-rose-500' },
    { label: 'WARM LEAD', icon: Icons.Sun, topColor: 'border-t-amber-500', iconColor: 'text-amber-500' },
    { label: 'COOL LEAD', icon: Icons.Circle, topColor: 'border-t-cyan-500', iconColor: 'text-cyan-500' },
    { label: 'CALL BACK', icon: Icons.PhoneCall, topColor: 'border-t-purple-500', iconColor: 'text-purple-500' },
    { label: 'GIVEN LOGIN', icon: Icons.LogIn, topColor: 'border-t-violet-600', iconColor: 'text-violet-600' },

    // Row 2 (6 Cards)
    { label: 'CIBIL PENDING', icon: Icons.AlertCircle, topColor: 'border-t-pink-500', iconColor: 'text-pink-500' },
    { label: 'DOCCUMENT PENDING', icon: Icons.FileText, topColor: 'border-t-teal-500', iconColor: 'text-teal-500' },
    { label: 'STATUS PENDING', icon: Icons.Clock, topColor: 'border-t-amber-500', iconColor: 'text-amber-500' },
    { label: 'APPROVED', icon: Icons.CheckCircle2, topColor: 'border-t-yellow-500', iconColor: 'text-yellow-600' },
    { label: 'DISBURSED', icon: Icons.Banknote, topColor: 'border-t-emerald-500', iconColor: 'text-emerald-600' },
    { label: 'REJECT', icon: Icons.XCircle, topColor: 'border-t-red-500', iconColor: 'text-red-500' },

    // Row 3 (5 Cards)
    { label: 'FOLLOW-UP', icon: Icons.PhoneForwarded, topColor: 'border-t-blue-500', iconColor: 'text-blue-500' },
    { label: 'DROPPED', icon: Icons.ArrowDownCircle, topColor: 'border-t-rose-500', iconColor: 'text-rose-500' },
    { label: 'PENDING', icon: Icons.Hourglass, topColor: 'border-t-amber-400', iconColor: 'text-amber-500' },
    { label: 'DEMO LEADS', icon: Icons.Sparkles, topColor: 'border-t-purple-500', iconColor: 'text-purple-500' },
    { label: 'PIPELINE VALUE', icon: Icons.IndianRupee, topColor: 'border-t-amber-600', iconColor: 'text-amber-600', isValue: true }
  ];

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto text-left px-3 sm:px-6 md:px-8 py-4">
      {/* 1. Header Bar matching Image 2 */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2">
        <div className="flex items-start sm:items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center flex-shrink-0 shadow-md">
            <Icons.BarChart2 className="w-6 h-6 stroke-[2.2]" />
          </div>
          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider mb-0.5">
              <span>Reports</span>
              <Icons.ChevronRight className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-indigo-600 dark:text-indigo-400 font-extrabold">Lead Reports & Pipeline Analytics</span>
            </div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight uppercase">
                Lead Reports & Pipeline Analytics
              </h1>
              <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-extrabold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800 tracking-wider">
                <Icons.Users className="w-3.5 h-3.5" />
                {totalLeadsCount} Total Leads
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Comprehensive chronological pipeline report, stage progression KPIs, and multi-filter analytics.
            </p>
          </div>
        </div>

        {/* Export Excel Button matching Image 2 */}
        <div className="flex items-center gap-3 self-start md:self-center">
          <button
            onClick={exportCSV}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl text-white bg-[#0284c7] hover:bg-[#0369a1] active:scale-[0.98] transition-all shadow-sm shadow-sky-600/20 cursor-pointer"
            title="Export official 19-column Lead Report spreadsheet"
          >
            <Icons.Download className="w-4 h-4 text-sky-100" />
            <span>Export Excel</span>
          </button>
        </div>
      </div>

      {/* 2. The 17 Interactive Status KPI Cards Grid matching Image 2 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-3.5">
        {statusCardsList.map((card) => {
          const isSelected = selectedKpiCard === card.label;
          const CardIcon = card.icon;

          let countVal = 0;
          let badgeText = '0.0%';
          let displayVal = '0';

          if (card.isValue) {
            displayVal = totalAmount >= 10000000 
              ? `₹${(totalAmount / 10000000).toFixed(2)}Cr` 
              : `₹${(totalAmount / 100000).toFixed(1)}L`;
            badgeText = 'Est. Volume';
          } else if (card.isAll) {
            countVal = totalLeadsCount;
            displayVal = String(countVal);
            badgeText = '100% Total';
          } else {
            countVal = getCardCount(card.label);
            displayVal = String(countVal);
            const pct = totalLeadsCount > 0 ? ((countVal / totalLeadsCount) * 100).toFixed(1) : '0.0';
            badgeText = `${pct}%`;
          }

          return (
            <div
              key={card.label}
              onClick={() => {
                if (selectedKpiCard === card.label && card.label !== 'ALL LEADS') {
                  setSelectedKpiCard('ALL LEADS');
                } else {
                  setSelectedKpiCard(card.label);
                }
              }}
              className={`relative flex flex-col justify-between p-3.5 rounded-2xl bg-white dark:bg-slate-900 transition-all duration-200 cursor-pointer select-none border-t-2 ${card.topColor} ${
                isSelected
                  ? 'ring-2 ring-indigo-500 border-indigo-500 shadow-md scale-[1.01]'
                  : 'border border-black/[0.08] dark:border-slate-800 hover:border-indigo-300 dark:hover:border-slate-700 shadow-3xs hover:shadow-xs'
              }`}
            >
              {/* Top: Label + Icon */}
              <div className="flex items-start justify-between gap-1.5 mb-2">
                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 tracking-tight leading-tight uppercase truncate" title={card.label}>
                  {card.label}
                </span>
                <CardIcon className={`w-4 h-4 flex-shrink-0 ${card.iconColor}`} />
              </div>

              {/* Bottom: Count + Percentage Badge */}
              <div className="flex items-baseline justify-between gap-1 mt-1">
                <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white font-mono tracking-tight tabular-nums">
                  {displayVal}
                </span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md tabular-nums ${
                  card.isAll 
                    ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300' 
                    : card.isValue 
                    ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400' 
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                }`}>
                  {badgeText}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* FILTER CONTROL CARD */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs relative overflow-visible z-20">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
        
        <div className="flex items-center justify-between gap-2 mb-5 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Icons.Filter className="w-3.5 h-3.5" />
            </div>
            <h3 className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider">
              Lead Analytics Filter Parameters
            </h3>
          </div>
          <button
            onClick={exportCSV}
            className="h-9 px-4 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:hover:bg-indigo-900 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800 text-xs font-bold uppercase tracking-wider rounded-xl shadow-3xs transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Icons.Download className="w-3.5 h-3.5" />
            Export Excel (19 Columns)
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
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
            label="Lead Status"
            options={statusOptions}
            selectedValues={selectedStatuses}
            onChange={setSelectedStatuses}
            placeholder="-All Statuses-"
          />
          <MultiSelectDropdown
            label="Loan Type"
            options={loanTypes}
            selectedValues={selectedLoanTypes}
            onChange={setSelectedLoanTypes}
            placeholder="-All Loan Types-"
          />
        </div>

        <div className="flex justify-end mt-6 pt-4 border-t border-slate-100 dark:border-slate-800">
          <button
            onClick={handleFilterClick}
            className="h-11 px-6 bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 active:scale-[0.98] text-white text-xs font-extrabold uppercase tracking-wider rounded-xl shadow-md shadow-indigo-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Icons.PieChart className="w-4 h-4" />
            Apply Report Filter
          </button>
        </div>
      </div>

      {/* DETAILED DATA TABLE (19 Columns matching user's spreadsheet in Images 1, 2, 3) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs relative">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-500" />
        
        <div className="p-5 sm:p-6 pb-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-tight">
              Detailed Lead Audit Matrix (19 Columns)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Showing {filteredLeads.length} real pipeline records matching official report structure
            </p>
          </div>
          <button
            onClick={exportCSV}
            className="h-8 px-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:hover:bg-emerald-900 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-[11px] font-bold uppercase rounded-lg transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <Icons.FileSpreadsheet className="w-3.5 h-3.5" />
            Download XLSX
          </button>
        </div>

        {loading ? (
          <div className="p-14 text-center text-xs text-slate-400">Loading lead report data...</div>
        ) : filteredLeads.length === 0 ? (
          <div className="py-14 text-center">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 text-white flex items-center justify-center mx-auto mb-3 shadow-lg shadow-indigo-500/20">
              <Icons.Inbox className="w-6 h-6" />
            </div>
            <p className="font-extrabold text-sm text-slate-800 dark:text-slate-200">No lead records found</p>
            <p className="text-xs text-slate-400 mt-0.5">
              Try modifying your filter parameters above to view more leads.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto max-w-full">
            <table className="w-full text-left text-xs whitespace-nowrap min-w-[2000px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 text-[11px] font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider h-11 bg-slate-50/90 dark:bg-slate-800/80 sticky top-0">
                  <th className="py-3 px-4 font-mono">Sl.No.</th>
                  <th className="py-3 px-4">Createddate</th>
                  <th className="py-3 px-4">data code</th>
                  <th className="py-3 px-4">location</th>
                  <th className="py-3 px-5">Customer Name</th>
                  <th className="py-3 px-5">Company name</th>
                  <th className="py-3 px-4">Mobile No</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">CASE DEATAILS</th>
                  <th className="py-3 px-5">Remarks</th>
                  <th className="py-3 px-4">lead_category</th>
                  <th className="py-3 px-4">Loan Amount</th>
                  <th className="py-3 px-5">Loan type</th>
                  <th className="py-3 px-5">Bank Names</th>
                  <th className="py-3 px-4">Source</th>
                  <th className="py-3 px-4">PSM</th>
                  <th className="py-3 px-4">Assigned To</th>
                  <th className="py-3 px-4">FollowUp Date</th>
                  <th className="py-3 px-4">Modified Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                {filteredLeads.map((item, idx) => {
                  const data = item.data || {};
                  
                  const slNo = idx + 1;
                  const createdDate = formatDateShort(item.createdAt || data.createdAt);
                  const dataCode = data.dataCode || data.data_code || data.code || `DC-${String(item._id || item.id || (idx + 101)).slice(-6).toUpperCase()}`;
                  const location = data.location || data.city || data.presentAddress || 'N/A';
                  
                  const customerName = data.customerName || [data.firstName, data.lastName].filter(Boolean).join(' ') || data.fullName || data.customer || data.name || 'N/A';
                  const companyName = data.company || data.firmName || data.firm_name || data.companyName || 'N/A';
                  const mobileNo = data.phone || data.mobile || data.contactNum || data.mobileNo || 'N/A';
                  const status = (data.status || 'HOT LEADS').toUpperCase();
                  const caseDetails = data.caseDetails || data.case_details || data.caseStatus || data.notes || data.remarks || 'Case under review';
                  const remarks = data.remarks || data.notes || data.remark || 'N/A';
                  const leadCategory = data.leadCategory || data.lead_category || data.category || 'A1 CATE';
                  
                  const loanAmountNum = Number(data.loanAmount || data.budget || data.amount);
                  const loanAmount = !isNaN(loanAmountNum) && loanAmountNum > 0 ? `₹${loanAmountNum.toLocaleString('en-IN')}` : 'N/A';
                  
                  const loanType = (data.loanType || data.loanProduct || data.product || 'SALARIED PERSONAL LOAN').toUpperCase();
                  const bankNames = data.bankNames || data.bank || data.businessPartner || 'N/A';
                  
                  // Source (Creator Name)
                  const campaignNames = [
                    'Q3 SME Business Expansion Drive',
                    'Salaried Personal Loan Express',
                    'Diwali Festive Loan Bonanza',
                    'Home Loan Super Saver Scheme',
                    'Ink CRM'
                  ];
                  let source = data.creatorName || (data.source && !campaignNames.includes(data.source) ? data.source : '');
                  if (!source && data.assignedAgent) {
                    source = typeof data.assignedAgent === 'object'
                      ? `${data.assignedAgent.firstName || ''} ${data.assignedAgent.lastName || ''}`.trim()
                      : String(data.assignedAgent);
                  } else if (!source && data.telecaller) {
                    source = String(data.telecaller);
                  }
                  if (!source || source === 'Ink CRM') source = 'Super Admin';

                  // PSM
                  let psm = data.psm || data.psmName || 'Vikram Patel';
                  if (typeof psm === 'string' && psm.includes(',')) {
                    psm = Array.from(new Set(psm.split(',').map(s => s.trim()))).join(', ');
                  }
                  
                  let assignedTo = 'Unassigned';
                  if (data.assignedTo) {
                    if (typeof data.assignedTo === 'object') {
                      assignedTo = `${data.assignedTo.firstName || ''} ${data.assignedTo.lastName || ''}`.trim() || data.assignedTo.name || 'Assigned';
                    } else {
                      assignedTo = String(data.assignedTo);
                    }
                  }
                  
                  const followUpDate = data.followUpDate ? formatDateShort(data.followUpDate) : 'N/A';
                  const modifiedDate = formatDateTimeFull(item.updatedAt || data.updatedAt || item.createdAt);

                  return (
                    <tr key={item._id || idx} className="hover:bg-indigo-50/30 dark:hover:bg-slate-800/40 transition-colors h-12">
                      <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500 dark:text-slate-400">{slNo}</td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-slate-600 dark:text-slate-300">{createdDate}</td>
                      <td className="py-2.5 px-4 font-mono text-[11px] font-bold text-indigo-600 dark:text-indigo-400">{dataCode}</td>
                      <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">{location}</td>
                      <td className="py-2.5 px-5 font-bold text-slate-900 dark:text-white">{customerName}</td>
                      <td className="py-2.5 px-5 text-slate-700 dark:text-slate-200">{companyName}</td>
                      <td className="py-2.5 px-4 font-mono text-slate-800 dark:text-slate-200">{mobileNo}</td>
                      <td className="py-2.5 px-4">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border font-mono ${
                          status.includes('DISBUS') || status.includes('APPROVED')
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800'
                            : status.includes('HOT')
                            ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800'
                            : status.includes('WARM') || status.includes('PENDING')
                            ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800'
                            : 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800'
                        }`}>
                          {status}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300 max-w-[200px] truncate" title={caseDetails}>{caseDetails}</td>
                      <td className="py-2.5 px-5 text-slate-600 dark:text-slate-300 max-w-[220px] truncate" title={remarks}>{remarks}</td>
                      <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">{leadCategory}</td>
                      <td className="py-2.5 px-4 font-mono font-bold text-slate-900 dark:text-white">{loanAmount}</td>
                      <td className="py-2.5 px-5">
                        <span className="px-2 py-0.5 rounded bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 text-[10.5px] font-bold">
                          {loanType}
                        </span>
                      </td>
                      <td className="py-2.5 px-5 text-slate-700 dark:text-slate-200">{bankNames}</td>
                      <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">{source}</td>
                      <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">{psm}</td>
                      <td className="py-2.5 px-4 font-semibold text-slate-800 dark:text-slate-200">{assignedTo}</td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-slate-600 dark:text-slate-300">{followUpDate}</td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500 dark:text-slate-400">{modifiedDate}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

